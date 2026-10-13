//! Provider-owned prices; only fixed catalog endpoints receive vault credentials.
use gbot_service::{
    cloud::{decimal_units, Amount, Catalog, CloudFuture, CloudHost, Plan, Price, Region},
    contract::CloudProvider,
    vault::Secret,
};
use serde_json::Value;
use std::time::Duration;

pub struct NativeCloudHost(reqwest::Client);
impl NativeCloudHost {
    pub fn new() -> Result<Self, String> {
        reqwest::Client::builder()
            .timeout(Duration::from_secs(30))
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .map(Self)
            .map_err(|_| "Cloud catalog client could not start.".into())
    }
    async fn get(
        &self,
        base: &str,
        path: &str,
        page: u64,
        token: &Secret,
    ) -> Result<Value, String> {
        let token =
            std::str::from_utf8(token.expose_secret()).map_err(|_| "Invalid provider token.")?;
        let response = self
            .0
            .get(format!("{base}/{path}"))
            .bearer_auth(token)
            .query(&[("page", page), ("per_page", 100)])
            .send()
            .await
            .map_err(|_| "Could not reach the provider. Check your connection and refresh.")?;
        match response.status().as_u16() {
            200 => response
                .json()
                .await
                .map_err(|_| "Provider returned an unreadable catalog.".into()),
            401 | 403 => {
                Err("Provider refused this token. Check its read permissions and try again.".into())
            }
            429 => Err("Provider rate limit reached. Try again later.".into()),
            _ => Err("Provider could not return prices. Try again later.".into()),
        }
    }
    async fn list(
        &self,
        base: &str,
        path: &str,
        field: &str,
        token: &Secret,
        hetzner: bool,
    ) -> Result<Vec<Value>, String> {
        let mut all = Vec::new();
        for page in 1..=100 {
            let value = self.get(base, path, page, token).await?;
            all.extend(array(&value, field)?.iter().cloned());
            if hetzner {
                match value
                    .pointer("/meta/pagination/next_page")
                    .and_then(Value::as_u64)
                {
                    Some(next) if next == page + 1 => {}
                    Some(_) => return Err("Provider pagination changed. Refresh the plans.".into()),
                    None => return Ok(all),
                }
            } else if value
                .pointer("/links/pages/next")
                .and_then(Value::as_str)
                .is_none()
            {
                return Ok(all);
            }
        }
        Err("Provider catalog was too large. Try again later.".into())
    }
}
impl CloudHost for NativeCloudHost {
    fn catalog<'a>(&'a self, provider: CloudProvider, token: &'a Secret) -> CloudFuture<'a> {
        Box::pin(async move {
            match provider {
                CloudProvider::Hetzner => {
                    let base = "https://api.hetzner.cloud/v1";
                    let (types, regions, pricing) = tokio::try_join!(
                        self.list(base, "server_types", "server_types", token, true),
                        self.list(base, "locations", "locations", token, true),
                        self.get(base, "pricing", 1, token),
                    )?;
                    hetzner_catalog(types, regions, pricing)
                }
                CloudProvider::DigitalOcean => {
                    let base = "https://api.digitalocean.com/v2";
                    let (sizes, regions) = tokio::try_join!(
                        self.list(base, "sizes", "sizes", token, false),
                        self.list(base, "regions", "regions", token, false),
                    )?;
                    digitalocean_catalog(sizes, regions)
                }
                _ => Err("This provider uses guided setup. Choose Hetzner or DigitalOcean for live cost review.".into()),
            }
        })
    }
}
fn invalid() -> String {
    "Provider returned an incomplete price catalog. Refresh the plans.".into()
}
fn array<'a>(v: &'a Value, key: &str) -> Result<&'a Vec<Value>, String> {
    v.get(key).and_then(Value::as_array).ok_or_else(invalid)
}
fn string(v: &Value, key: &str) -> Result<String, String> {
    v.get(key)
        .and_then(Value::as_str)
        .map(str::to_owned)
        .ok_or_else(invalid)
}
fn count(v: &Value, key: &str) -> Result<u32, String> {
    v.get(key)
        .and_then(Value::as_u64)
        .and_then(|n| n.try_into().ok())
        .ok_or_else(invalid)
}
fn numeric(v: &Value, key: &str) -> Result<String, String> {
    v.get(key)
        .filter(|v| v.is_number())
        .map(Value::to_string)
        .ok_or_else(invalid)
}
fn amount(v: &Value) -> Result<Amount, String> {
    Ok(Amount {
        net: string(v, "net")?,
        gross: Some(string(v, "gross")?),
    })
}
fn price(v: &Value) -> Result<Price, String> {
    Ok(Price {
        monthly: amount(&v["price_monthly"])?,
        hourly: amount(&v["price_hourly"])?,
    })
}
fn scaled_count(value: &str, factor: u64) -> Result<u64, String> {
    let scaled = u128::from(decimal_units(value)?) * u128::from(factor);
    if scaled % 1_000_000_000 != 0 {
        return Err(invalid());
    }
    (scaled / 1_000_000_000).try_into().map_err(|_| invalid())
}
fn hetzner_catalog(
    types: Vec<Value>,
    locations: Vec<Value>,
    raw: Value,
) -> Result<Catalog, String> {
    let pricing = &raw["pricing"];
    let regions: Vec<_> = locations
        .iter()
        .map(|v| {
            Ok(Region {
                id: string(v, "name")?,
                name: string(v, "description")?,
            })
        })
        .collect::<Result<_, String>>()?;
    let ips = array(pricing, "primary_ips")?
        .iter()
        .find(|p| p["type"] == "ipv4")
        .ok_or_else(invalid)?;
    let mut plans = Vec::new();
    for server in &types {
        if server["architecture"] != "x86" {
            continue;
        }
        let memory_mib: u32 = scaled_count(&numeric(server, "memory")?, 1024)?
            .try_into()
            .map_err(|_| invalid())?;
        if memory_mib < 2048 {
            continue;
        }
        let prices = array(pricing, "server_types")?
            .iter()
            .find(|p| p["id"] == server["id"])
            .ok_or_else(invalid)?;
        for location in array(server, "locations")? {
            if location["available"] != true || !location["deprecation"].is_null() {
                continue;
            }
            let region = string(location, "name")?;
            let compute = array(prices, "prices")?
                .iter()
                .find(|p| p["location"] == region)
                .ok_or_else(invalid)?;
            let ipv4 = array(ips, "prices")?
                .iter()
                .find(|p| p["location"] == region)
                .ok_or_else(invalid)?;
            let name = string(server, "name")?;
            let vcpus = count(server, "cores")?;
            plans.push(Plan {
                id: server["id"].as_u64().ok_or_else(invalid)?.to_string(),
                recommended: name.starts_with("cpx") && vcpus == 2 && memory_mib == 4096,
                name,
                region,
                vcpus,
                memory_mib,
                disk_gb: count(server, "disk")?,
                included_traffic_bytes: compute["included_traffic"].as_u64().ok_or_else(invalid)?,
                compute: price(compute)?,
                ipv4: price(ipv4)?,
                traffic_per_tb: Some(amount(&compute["price_per_tb_traffic"])?),
            });
        }
    }
    let catalog = Catalog {
        currency: string(pricing, "currency")?,
        tax: format!("Provider VAT rate: {}%", string(pricing, "vat_rate")?),
        regions,
        plans,
    };
    catalog.validate()?;
    Ok(catalog)
}
fn digitalocean_catalog(sizes: Vec<Value>, locations: Vec<Value>) -> Result<Catalog, String> {
    let regions: Vec<_> = locations
        .iter()
        .filter(|v| v["available"] == true)
        .map(|v| {
            Ok(Region {
                id: string(v, "slug")?,
                name: string(v, "name")?,
            })
        })
        .collect::<Result<_, String>>()?;
    let mut plans = Vec::new();
    for size in sizes.iter().filter(|v| v["available"] == true) {
        let id = string(size, "slug")?;
        // Bundled shared-CPU plans include IPv4; v5 resource billing needs a separate adapter.
        if !id.starts_with("s-") {
            continue;
        }
        let memory_mib = count(size, "memory")?;
        if memory_mib < 2048 {
            continue;
        }
        let vcpus = count(size, "vcpus")?;
        let net = |key| -> Result<Amount, String> {
            Ok(Amount {
                net: numeric(size, key)?,
                gross: None,
            })
        };
        for location in array(size, "regions")? {
            let region = location.as_str().ok_or_else(invalid)?;
            if !regions.iter().any(|r| r.id == region) {
                continue;
            }
            let zero = Amount {
                net: "0".into(),
                gross: None,
            };
            plans.push(Plan {
                id: id.clone(),
                name: id.clone(),
                region: region.into(),
                vcpus,
                memory_mib,
                disk_gb: count(size, "disk")?,
                included_traffic_bytes: scaled_count(
                    &numeric(size, "transfer")?,
                    1_000_000_000_000,
                )?,
                compute: Price {
                    monthly: net("price_monthly")?,
                    hourly: net("price_hourly")?,
                },
                ipv4: Price {
                    monthly: zero.clone(),
                    hourly: zero,
                },
                traffic_per_tb: None,
                recommended: vcpus == 2 && memory_mib == 4096,
            });
        }
    }
    let catalog = Catalog { currency: "USD".into(), tax: "Taxes and excess traffic are not returned by the sizes API; check your provider account. Bundled shared-CPU plans only.".into(), regions, plans };
    catalog.validate()?;
    Ok(catalog)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn cloud_hetzner_prices_use_location_tax_ipv4_and_traffic() {
        let types = vec![
            json!({"id":22,"name":"cpx11","architecture":"x86","cores":2,"memory":4.0,"disk":40,
            "locations":[{"name":"fsn1","available":true,"deprecation":null},{"name":"gone","available":false}]}),
        ];
        let locations = vec![json!({"name":"fsn1","description":"Falkenstein"})];
        let raw = json!({"pricing":{"currency":"EUR","vat_rate":"19.00",
            "traffic":{"price_per_tb":{"net":"0","gross":"0"}},
            "primary_ips":[{"type":"ipv4","prices":[{"location":"fsn1",
                "price_monthly":{"net":"0.5","gross":"0.595"},"price_hourly":{"net":"0.0007","gross":"0.000833"}}]}],
            "server_types":[{"id":22,"prices":[{"location":"fsn1","included_traffic":20000000000000u64,
                "price_per_tb_traffic":{"net":"1","gross":"1.19"},
                "price_monthly":{"net":"4.1","gross":"4.879"},"price_hourly":{"net":"0.0061","gross":"0.007259"}}]}]}});
        let catalog = hetzner_catalog(types.clone(), locations.clone(), raw.clone()).unwrap();
        assert_eq!(catalog.plans.len(), 1);
        let plan = &catalog.plans[0];
        assert!(plan.recommended);
        assert_eq!(plan.memory_mib, 4096);
        assert_eq!(plan.ipv4.monthly.gross.as_deref(), Some("0.595"));
        assert_eq!(plan.traffic_per_tb.as_ref().unwrap().net, "1");
        assert_eq!(plan.included_traffic_bytes, 20_000_000_000_000);
        let mut incomplete = raw;
        incomplete["pricing"]["primary_ips"] = json!([]);
        assert!(hetzner_catalog(types, locations, incomplete).is_err());
    }

    #[test]
    fn cloud_digitalocean_keeps_available_bundled_plans_and_marks_tax_unknown() {
        let size = json!({"slug":"s-2vcpu-4gb","available":true,"vcpus":2,"memory":4096,"disk":80,
            "price_monthly":24.0,"price_hourly":0.03571,"transfer":4.0,"regions":["nyc1","gone"]});
        let mut tiny = size.clone();
        tiny["memory"] = json!(1024);
        let mut unavailable = size.clone();
        unavailable["available"] = json!(false);
        let mut unbundled = size.clone();
        unbundled["slug"] = json!("v5-resource");
        let catalog = digitalocean_catalog(
            vec![size, tiny, unavailable, unbundled],
            vec![
                json!({"slug":"nyc1","name":"New York 1","available":true}),
                json!({"slug":"gone","name":"Gone","available":false}),
            ],
        )
        .unwrap();
        assert_eq!(catalog.plans.len(), 1);
        let plan = &catalog.plans[0];
        assert!(plan.recommended);
        assert_eq!(plan.region, "nyc1");
        assert_eq!(plan.ipv4.monthly.net, "0");
        assert_eq!(plan.compute.hourly.net, "0.03571");
        assert!(plan.compute.monthly.gross.is_none());
        assert_eq!(plan.included_traffic_bytes, 4_000_000_000_000);
        assert!(catalog.tax.contains("not returned"));
    }
}
