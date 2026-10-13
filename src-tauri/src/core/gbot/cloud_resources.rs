//! Paid mutations are preceded by service-owned intents and exact ownership checks.
use super::NativeCloudHost;
use gbot_service::{
    cloud::{CreateResource, Pending, ProviderError, Resource, ResourceKind},
    contract::CloudProvider,
    vault::Secret,
};
use reqwest::Method;
use serde_json::{json, Value};
use uuid::Uuid;

fn owner(id: Uuid) -> String {
    format!("gbot-{}", id.simple())
}
fn origin(provider: CloudProvider) -> Result<&'static str, ProviderError> {
    match provider {
        CloudProvider::Hetzner => Ok("https://api.hetzner.cloud/v1"),
        CloudProvider::DigitalOcean => Ok("https://api.digitalocean.com/v2"),
        _ => Err(ProviderError::rejected("This provider needs guided setup.")),
    }
}
fn collection(
    provider: CloudProvider,
    kind: ResourceKind,
) -> Result<(&'static str, &'static str), ProviderError> {
    match (provider, kind) {
        (CloudProvider::Hetzner, ResourceKind::Firewall) => Ok(("firewalls", "firewall")),
        (CloudProvider::Hetzner, ResourceKind::Ipv4) => Ok(("primary_ips", "primary_ip")),
        (CloudProvider::Hetzner, ResourceKind::Server) => Ok(("servers", "server")),
        (CloudProvider::DigitalOcean, ResourceKind::Tag) => Ok(("tags", "tag")),
        (CloudProvider::DigitalOcean, ResourceKind::Firewall) => Ok(("firewalls", "firewall")),
        (CloudProvider::DigitalOcean, ResourceKind::Server) => Ok(("droplets", "droplet")),
        _ => Err(ProviderError::rejected("Unsupported cloud resource.")),
    }
}
async fn request(
    host: &NativeCloudHost,
    provider: CloudProvider,
    token: &Secret,
    method: Method,
    path: &str,
    body: Option<Value>,
) -> Result<Option<Value>, ProviderError> {
    let mutation = method != Method::GET;
    let token = std::str::from_utf8(token.expose_secret())
        .map_err(|_| ProviderError::rejected("Invalid provider token."))?;
    let mut request = host
        .0
        .request(method.clone(), format!("{}/{path}", origin(provider)?))
        .bearer_auth(token);
    if let Some(body) = body {
        request = request.json(&body);
    }
    let response = request.send().await.map_err(|_| {
        ProviderError::uncertain(
            "Provider request was interrupted. Check progress before trying again.",
        )
    })?;
    let status = response.status();
    if status.as_u16() == 404 && (method == Method::GET || method == Method::DELETE) {
        return Ok(None);
    }
    if status.is_success() {
        if status.as_u16() == 204 {
            return Ok(Some(Value::Null));
        }
        return response.json().await.map(Some).map_err(|_| {
            ProviderError::uncertain(
                "Provider reply was unreadable. Check progress before continuing.",
            )
        });
    }
    let message = match status.as_u16() {
        401 | 403 => "Provider refused this operation. Check your token's create/delete permissions.",
        429 => "Provider rate limit reached. Check progress later.",
        400 | 422 => "Provider refused the exact requested configuration. Check account limits, plan, region and Debian 13 image availability.",
        _ => "Provider could not finish this operation. Check progress before continuing.",
    };
    if mutation && (status.is_server_error() || status.as_u16() == 409) {
        Err(ProviderError::uncertain(message))
    } else {
        Err(ProviderError::rejected(message))
    }
}
fn identifier(value: &Value) -> Option<String> {
    value
        .as_str()
        .map(str::to_owned)
        .or_else(|| value.as_u64().map(|v| v.to_string()))
}
fn safe_id(id: &str) -> Result<(), ProviderError> {
    if id.is_empty() || !id.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'-') {
        return Err(ProviderError::rejected(
            "Invalid saved cloud resource identifier.",
        ));
    }
    Ok(())
}
fn owned(provider: CloudProvider, setup: Uuid, kind: ResourceKind, v: &Value) -> bool {
    match provider {
        CloudProvider::Hetzner => {
            v.pointer("/labels/gbot_setup").and_then(Value::as_str)
                == Some(setup.simple().to_string().as_str())
        }
        CloudProvider::DigitalOcean if kind == ResourceKind::Tag => {
            v.get("name").and_then(Value::as_str) == Some(owner(setup).as_str())
        }
        CloudProvider::DigitalOcean => {
            v.get("tags").and_then(Value::as_array).is_some_and(|tags| {
                tags.iter()
                    .any(|t| t.as_str() == Some(owner(setup).as_str()))
            })
        }
        _ => false,
    }
}
fn parse(
    provider: CloudProvider,
    setup: Uuid,
    kind: ResourceKind,
    v: &Value,
) -> Result<Resource, ProviderError> {
    if !owned(provider, setup, kind, v) {
        return Err(ProviderError::rejected(
            "Resource ownership does not match this setup. Nothing was changed.",
        ));
    }
    let name = v
        .get("name")
        .and_then(Value::as_str)
        .ok_or_else(|| ProviderError::uncertain("Provider resource name is missing."))?
        .to_owned();
    let id = if kind == ResourceKind::Tag {
        name.clone()
    } else {
        v.get("id")
            .and_then(identifier)
            .ok_or_else(|| ProviderError::uncertain("Provider resource identifier is missing."))?
    };
    safe_id(&id)?;
    let ready = match (provider, kind) {
        (_, ResourceKind::Tag) => true,
        (CloudProvider::Hetzner, ResourceKind::Server) => {
            v.get("status").and_then(Value::as_str) == Some("running")
        }
        (CloudProvider::DigitalOcean, ResourceKind::Server) => {
            v.get("status").and_then(Value::as_str) == Some("active")
        }
        (CloudProvider::DigitalOcean, ResourceKind::Firewall) => {
            v.get("status").and_then(Value::as_str) == Some("succeeded")
                && v.get("pending_changes")
                    .and_then(Value::as_array)
                    .map_or(true, Vec::is_empty)
        }
        _ => true,
    };
    let address = match (provider, kind) {
        (CloudProvider::Hetzner, ResourceKind::Server) => {
            v.pointer("/public_net/ipv4/ip").and_then(Value::as_str)
        }
        (CloudProvider::DigitalOcean, ResourceKind::Server) => v
            .pointer("/networks/v4")
            .and_then(Value::as_array)
            .and_then(|networks| {
                networks
                    .iter()
                    .find(|n| n.get("type").and_then(Value::as_str) == Some("public"))
            })
            .and_then(|n| n.get("ip_address"))
            .and_then(Value::as_str),
        _ => None,
    }
    .map(str::to_owned);
    if address
        .as_ref()
        .is_some_and(|a| a.parse::<std::net::Ipv4Addr>().is_err())
    {
        return Err(ProviderError::uncertain(
            "Provider returned an invalid public IPv4 address.",
        ));
    }
    Ok(Resource {
        kind,
        id,
        name,
        ready,
        address,
        actions: vec![],
    })
}
fn actions(value: &Value) -> Vec<String> {
    value
        .get("action")
        .into_iter()
        .chain(
            value
                .get("actions")
                .and_then(Value::as_array)
                .into_iter()
                .flatten(),
        )
        .chain(
            value
                .get("next_actions")
                .and_then(Value::as_array)
                .into_iter()
                .flatten(),
        )
        .filter_map(|a| a.get("id").and_then(identifier))
        .collect()
}
fn prerequisite(request: &CreateResource, kind: ResourceKind) -> Result<&Resource, ProviderError> {
    request
        .resources
        .iter()
        .find(|r| r.kind == kind && r.ready)
        .ok_or_else(|| ProviderError::rejected("Required owned resource is not ready."))
}
fn number(resource: &Resource) -> Result<u64, ProviderError> {
    resource
        .id
        .parse()
        .map_err(|_| ProviderError::rejected("Invalid saved resource identifier."))
}
fn firewall(provider: CloudProvider, r: &CreateResource) -> Value {
    if provider == CloudProvider::Hetzner {
        json!({"name":r.pending.name,"labels":{"gbot_setup":r.setup.simple().to_string()},"rules":[
            {"direction":"in","protocol":"tcp","port":"22","source_ips":r.source_cidrs},
            {"direction":"out","protocol":"tcp","port":"443","destination_ips":["0.0.0.0/0","::/0"]},
            {"direction":"out","protocol":"tcp","port":"53","destination_ips":["0.0.0.0/0","::/0"]},
            {"direction":"out","protocol":"udp","port":"53","destination_ips":["0.0.0.0/0","::/0"]}]})
    } else {
        json!({"name":r.pending.name,"tags":[owner(r.setup)],"inbound_rules":[{"protocol":"tcp","ports":"22","sources":{"addresses":r.source_cidrs}}],"outbound_rules":[
            {"protocol":"tcp","ports":"443","destinations":{"addresses":["0.0.0.0/0","::/0"]}},
            {"protocol":"tcp","ports":"53","destinations":{"addresses":["0.0.0.0/0","::/0"]}},
            {"protocol":"udp","ports":"53","destinations":{"addresses":["0.0.0.0/0","::/0"]}}]})
    }
}
async fn image(
    host: &NativeCloudHost,
    provider: CloudProvider,
    token: &Secret,
    region: &str,
) -> Result<Value, ProviderError> {
    let base = origin(provider)?;
    let values = if provider == CloudProvider::Hetzner {
        host.list(base, "images?type=system", "images", token, true)
            .await
    } else {
        host.list(base, "images?type=distribution", "images", token, false)
            .await
    };
    let values = values.map_err(ProviderError::rejected)?;
    let matches: Vec<_> = values
        .iter()
        .filter(|v| {
            if provider == CloudProvider::Hetzner {
                v.get("name").and_then(Value::as_str) == Some("debian-13")
                    && v.get("architecture").and_then(Value::as_str) == Some("x86")
                    && v.get("status").and_then(Value::as_str) == Some("available")
                    && v.get("deprecated").map_or(true, Value::is_null)
            } else {
                v.get("slug").and_then(Value::as_str) == Some("debian-13-x64")
                    && v.get("public").and_then(Value::as_bool) == Some(true)
                    && v.get("status").and_then(Value::as_str) == Some("available")
                    && v.get("regions")
                        .and_then(Value::as_array)
                        .is_some_and(|regions| regions.iter().any(|v| v.as_str() == Some(region)))
            }
        })
        .collect();
    match matches.as_slice() {
        [v] => v
            .get("id")
            .cloned()
            .ok_or_else(|| ProviderError::rejected("Debian 13 image has no identifier.")),
        _ => Err(ProviderError::rejected(
            "No unique available Debian 13 x86 image in this region. Nothing was substituted.",
        )),
    }
}
pub(super) async fn create(
    host: &NativeCloudHost,
    provider: CloudProvider,
    token: &Secret,
    r: &CreateResource,
) -> Result<Resource, ProviderError> {
    let kind = r.pending.kind;
    let body = match (provider, kind) {
        (CloudProvider::DigitalOcean, ResourceKind::Tag) => json!({"name":owner(r.setup)}),
        (_, ResourceKind::Firewall) => firewall(provider, r),
        (CloudProvider::Hetzner, ResourceKind::Ipv4) => {
            json!({"name":r.pending.name,"type":"ipv4","assignee_type":"server","auto_delete":false,"location":r.plan.region,"labels":{"gbot_setup":r.setup.simple().to_string()}})
        }
        (CloudProvider::Hetzner, ResourceKind::Server) => {
            json!({"name":r.pending.name,"server_type":r.plan.id.parse::<u64>().map_err(|_| ProviderError::rejected("Invalid selected Hetzner plan."))?,"location":r.plan.region,"image":image(host,provider,token,&r.plan.region).await?,"user_data":r.user_data,"start_after_create":true,"labels":{"gbot_setup":r.setup.simple().to_string()},"firewalls":[{"firewall":number(prerequisite(r,ResourceKind::Firewall)?)?}],"public_net":{"enable_ipv4":true,"enable_ipv6":false,"ipv4":number(prerequisite(r,ResourceKind::Ipv4)?)?}})
        }
        (CloudProvider::DigitalOcean, ResourceKind::Server) => {
            prerequisite(r, ResourceKind::Tag)?;
            prerequisite(r, ResourceKind::Firewall)?;
            json!({"name":r.pending.name,"size":r.plan.id,"region":r.plan.region,"image":image(host,provider,token,&r.plan.region).await?,"user_data":r.user_data,"tags":[owner(r.setup)],"backups":false,"ipv6":false,"monitoring":false,"volumes":[]})
        }
        _ => return Err(ProviderError::rejected("Unsupported cloud resource.")),
    };
    let (path, field) = collection(provider, kind)?;
    let reply = request(host, provider, token, Method::POST, path, Some(body))
        .await?
        .ok_or_else(|| ProviderError::uncertain("Provider create reply is missing."))?;
    let mut resource = parse(
        provider,
        r.setup,
        kind,
        reply
            .get(field)
            .ok_or_else(|| ProviderError::uncertain("Provider create reply has no resource."))?,
    )?;
    if provider == CloudProvider::Hetzner {
        resource.actions = actions(&reply);
        if !resource.actions.is_empty() {
            resource.ready = false;
        }
    }
    Ok(resource)
}
pub(super) async fn find(
    host: &NativeCloudHost,
    provider: CloudProvider,
    token: &Secret,
    setup: Uuid,
    pending: &Pending,
) -> Result<Vec<Resource>, ProviderError> {
    let (path, _) = collection(provider, pending.kind)?;
    let values = host
        .list(
            origin(provider)?,
            path,
            path,
            token,
            provider == CloudProvider::Hetzner,
        )
        .await
        .map_err(ProviderError::rejected)?;
    let mut matches = vec![];
    for v in values.iter().filter(|v| {
        v.get("name").and_then(Value::as_str) == Some(pending.name.as_str())
            && owned(provider, setup, pending.kind, v)
    }) {
        let resource = parse(provider, setup, pending.kind, v)?;
        if let Some(resource) = inspect(host, provider, token, setup, &resource).await? {
            matches.push(resource);
        }
    }
    Ok(matches)
}
async fn read_resource(
    host: &NativeCloudHost,
    provider: CloudProvider,
    token: &Secret,
    resource: &Resource,
) -> Result<Option<Value>, ProviderError> {
    safe_id(&resource.id)?;
    let (path, field) = collection(provider, resource.kind)?;
    request(
        host,
        provider,
        token,
        Method::GET,
        &format!("{path}/{}", resource.id),
        None,
    )
    .await?
    .map(|v| {
        v.get(field)
            .cloned()
            .ok_or_else(|| ProviderError::uncertain("Provider resource reply was incomplete."))
    })
    .transpose()
}
pub(super) async fn inspect(
    host: &NativeCloudHost,
    provider: CloudProvider,
    token: &Secret,
    setup: Uuid,
    saved: &Resource,
) -> Result<Option<Resource>, ProviderError> {
    let Some(v) = read_resource(host, provider, token, saved).await? else {
        return Ok(None);
    };
    let mut resource = parse(provider, setup, saved.kind, &v)?;
    if resource.id != saved.id || resource.name != saved.name {
        return Err(ProviderError::rejected(
            "Saved resource identity changed. Nothing was changed.",
        ));
    }
    resource.actions = saved.actions.clone();
    if provider == CloudProvider::Hetzner {
        let mut complete = true;
        for id in &saved.actions {
            safe_id(id)?;
            let v = request(
                host,
                provider,
                token,
                Method::GET,
                &format!("actions/{id}"),
                None,
            )
            .await?
            .ok_or_else(|| ProviderError::rejected("Provider action is unavailable."))?;
            match v.pointer("/action/status").and_then(Value::as_str) {
                Some("success") => {}
                Some("running") => complete = false,
                _ => return Err(ProviderError::rejected(
                    "Provider action failed. Check the owned resource in your provider console.",
                )),
            }
        }
        let (path, _) = collection(provider, saved.kind)?;
        let current = host
            .list(
                origin(provider)?,
                &format!("{path}/{}/actions", saved.id),
                "actions",
                token,
                true,
            )
            .await
            .map_err(ProviderError::rejected)?;
        for action in current
            .iter()
            .filter(|v| v.get("status").and_then(Value::as_str) == Some("running"))
        {
            complete = false;
            if let Some(id) = action.get("id").and_then(identifier) {
                if !resource.actions.contains(&id) {
                    resource.actions.push(id);
                }
            }
        }
        resource.ready &= complete;
    }
    Ok(Some(resource))
}
pub(super) async fn delete(
    host: &NativeCloudHost,
    provider: CloudProvider,
    token: &Secret,
    setup: Uuid,
    saved: &Resource,
) -> Result<(), ProviderError> {
    let Some(v) = read_resource(host, provider, token, saved).await? else {
        return Ok(());
    };
    let resource = parse(provider, setup, saved.kind, &v)?;
    if resource.id != saved.id || resource.name != saved.name {
        return Err(ProviderError::rejected(
            "Saved resource identity changed. Nothing was removed.",
        ));
    }
    let attached = match saved.kind {
        ResourceKind::Firewall => v
            .get("applied_to")
            .or_else(|| v.get("droplet_ids"))
            .and_then(Value::as_array)
            .is_some_and(|v| !v.is_empty()),
        ResourceKind::Ipv4 => v
            .get("assignee_id")
            .is_some_and(|v| !v.is_null() && v.as_u64() != Some(0)),
        ResourceKind::Tag => v
            .pointer("/resources/count")
            .and_then(Value::as_u64)
            != Some(0),
        ResourceKind::Server => false,
    };
    if attached {
        return Err(ProviderError::rejected("Owned resource is still attached. Wait for server deletion or detach it in the provider console; unrelated resources will not be removed."));
    }
    let (path, _) = collection(provider, saved.kind)?;
    request(
        host,
        provider,
        token,
        Method::DELETE,
        &format!("{path}/{}", saved.id),
        None,
    )
    .await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn cloud_resource_ownership_and_public_address_are_verified() {
        let id = Uuid::new_v4();
        let v = json!({"id":42,"name":"bot","status":"active","tags":[owner(id)],"networks":{"v4":[{"type":"private","ip_address":"10.0.0.1"},{"type":"public","ip_address":"203.0.113.7"}]}});
        let result = parse(CloudProvider::DigitalOcean, id, ResourceKind::Server, &v).unwrap();
        assert!(result.ready);
        assert_eq!(result.address.as_deref(), Some("203.0.113.7"));
        assert!(parse(
            CloudProvider::DigitalOcean,
            Uuid::new_v4(),
            ResourceKind::Server,
            &v
        )
        .is_err());
        assert!(safe_id("../servers/7").is_err());
    }
    #[test]
    fn cloud_firewalls_expose_only_ssh_from_explicit_sources() {
        let request = CreateResource {
            setup: Uuid::new_v4(),
            pending: Pending {
                kind: ResourceKind::Firewall,
                name: "owned-bot".into(),
                deleting: None,
            },
            plan: gbot_service::cloud::Plan {
                id: "22".into(),
                name: "cpx11".into(),
                region: "fsn1".into(),
                vcpus: 2,
                memory_mib: 4096,
                disk_gb: 40,
                included_traffic_bytes: 0,
                compute: gbot_service::cloud::Price {
                    monthly: gbot_service::cloud::Amount {
                        net: "4".into(),
                        gross: None,
                    },
                    hourly: gbot_service::cloud::Amount {
                        net: "0.01".into(),
                        gross: None,
                    },
                },
                ipv4: gbot_service::cloud::Price {
                    monthly: gbot_service::cloud::Amount {
                        net: "0.5".into(),
                        gross: None,
                    },
                    hourly: gbot_service::cloud::Amount {
                        net: "0.001".into(),
                        gross: None,
                    },
                },
                traffic_per_tb: None,
                recommended: true,
            },
            source_cidrs: vec!["203.0.113.10/32".into()],
            resources: vec![],
            user_data: String::new(),
        };
        let h = firewall(CloudProvider::Hetzner, &request);
        let inbound: Vec<_> = h["rules"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|r| r["direction"] == "in")
            .collect();
        assert_eq!(inbound.len(), 1);
        assert_eq!(inbound[0]["port"], "22");
        assert_eq!(inbound[0]["source_ips"], json!(request.source_cidrs));
        let d = firewall(CloudProvider::DigitalOcean, &request);
        assert_eq!(d["inbound_rules"].as_array().unwrap().len(), 1);
        assert_eq!(d["inbound_rules"][0]["ports"], "22");
        assert_eq!(
            d["inbound_rules"][0]["sources"]["addresses"],
            json!(request.source_cidrs)
        );
    }
}
