//! Read-only provider catalogs and durable cost consent; this owner creates no resources.
use crate::{
    contract::CloudProvider,
    store::{SaveError, Store},
    vault::{Secret, Vault},
};
use serde::{Deserialize, Serialize};
use std::{collections::BTreeSet, future::Future, path::PathBuf, pin::Pin, sync::Arc};
use tokio::sync::Mutex;
use uuid::Uuid;

pub type CloudFuture<'a> = Pin<Box<dyn Future<Output = Result<Catalog, String>> + Send + 'a>>;
pub trait CloudHost: Send + Sync {
    fn catalog<'a>(&'a self, provider: CloudProvider, token: &'a Secret) -> CloudFuture<'a>;
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
pub struct Amount {
    pub net: String,
    pub gross: Option<String>,
}
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
pub struct Price {
    pub monthly: Amount,
    pub hourly: Amount,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct Region {
    pub id: String,
    pub name: String,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct Plan {
    pub id: String,
    pub name: String,
    pub region: String,
    pub vcpus: u32,
    pub memory_mib: u32,
    pub disk_gb: u32,
    pub included_traffic_bytes: u64,
    pub compute: Price,
    pub ipv4: Price,
    pub traffic_per_tb: Option<Amount>,
    pub recommended: bool,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct Catalog {
    pub currency: String,
    pub tax: String,
    pub regions: Vec<Region>,
    pub plans: Vec<Plan>,
}

const SCALE: u64 = 1_000_000_000;
pub fn decimal_units(text: &str) -> Result<u64, String> {
    let mut parts = text.split('.');
    let integer = parts.next().unwrap_or_default();
    let fraction = parts.next().unwrap_or_default();
    if integer.is_empty()
        || !integer.bytes().all(|b| b.is_ascii_digit())
        || !fraction.bytes().all(|b| b.is_ascii_digit())
        || fraction.len() > 9
        || parts.next().is_some()
    {
        return Err("Provider returned an unsupported price. Refresh the plans.".into());
    }
    integer
        .parse::<u64>()
        .ok()
        .and_then(|n| n.checked_mul(SCALE))
        .and_then(|n| {
            n.checked_add(
                fraction.parse::<u64>().unwrap_or(0) * 10u64.pow(9 - fraction.len() as u32),
            )
        })
        .ok_or_else(|| "Provider price is out of range.".into())
}
fn decimal_text(units: u64) -> String {
    format!("{}.{:09}", units / SCALE, units % SCALE)
        .trim_end_matches('0')
        .trim_end_matches('.')
        .into()
}
fn sum_amount(a: &Amount, b: &Amount) -> Result<Amount, String> {
    let sum = |a: &str, b: &str| -> Result<String, String> {
        Ok(decimal_text(
            decimal_units(a)?
                .checked_add(decimal_units(b)?)
                .ok_or("Provider price is out of range.")?,
        ))
    };
    Ok(Amount {
        net: sum(&a.net, &b.net)?,
        gross: match (&a.gross, &b.gross) {
            (Some(a), Some(b)) => Some(sum(a, b)?),
            _ => None,
        },
    })
}
impl Catalog {
    pub fn validate(&self) -> Result<(), String> {
        let regions: BTreeSet<_> = self.regions.iter().map(|r| &r.id).collect();
        let mut plans = BTreeSet::new();
        if self.currency.len() != 3
            || !self.currency.bytes().all(|b| b.is_ascii_uppercase())
            || self.tax.is_empty()
            || regions.len() != self.regions.len()
            || self.plans.is_empty()
        {
            return Err(
                "No usable priced plans were returned. Choose another provider or refresh.".into(),
            );
        }
        for plan in &self.plans {
            if plan.id.is_empty()
                || plan.name.is_empty()
                || !regions.contains(&plan.region)
                || plan.vcpus == 0
                || plan.memory_mib < 2048
                || plan.disk_gb == 0
                || !plans.insert((&plan.region, &plan.id))
            {
                return Err("Provider returned an invalid plan catalog.".into());
            }
            for amount in [
                &plan.compute.monthly,
                &plan.compute.hourly,
                &plan.ipv4.monthly,
                &plan.ipv4.hourly,
            ]
            .into_iter()
            .chain(plan.traffic_per_tb.iter())
            {
                let net = decimal_units(&amount.net)?;
                if let Some(gross) = &amount.gross {
                    if decimal_units(gross)? < net {
                        return Err("Provider returned inconsistent tax prices.".into());
                    }
                }
            }
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct Quote {
    pub id: Uuid,
    pub plan: Plan,
    pub total: Price,
    pub quoted_at: u64,
    pub expires_at: u64,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct Review {
    pub id: Uuid,
    pub name: String,
    pub provider: CloudProvider,
    pub catalog: Catalog,
    pub fetched_at: u64,
    pub expires_at: u64,
    pub quote: Option<Quote>,
    pub confirmed: bool,
}
#[derive(Clone, Deserialize, Serialize)]
struct Record {
    review: Review,
    credential_ref: Uuid,
}
#[derive(Clone, Default, Deserialize, Serialize)]
struct State {
    records: Vec<Record>,
    retired_credentials: Vec<Uuid>,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ReadCatalog {
    pub id: Uuid,
    pub name: String,
    pub provider: CloudProvider,
    pub api_token: Option<String>,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SelectPlan {
    pub id: Uuid,
    pub plan: String,
    pub region: String,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ConfirmQuote {
    pub id: Uuid,
    pub quote_id: Uuid,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ReviewId {
    pub id: Uuid,
}

pub struct CloudSetup {
    store: Arc<Store>,
    state: Mutex<State>,
    vault: Arc<dyn Vault>,
    host: Arc<dyn CloudHost>,
}
impl CloudSetup {
    pub async fn open(
        root: PathBuf,
        vault: Arc<dyn Vault>,
        host: Arc<dyn CloudHost>,
    ) -> Result<Self, String> {
        let store = Arc::new(
            Store::open(root.join("cloud-review.json"))
                .await
                .map_err(|e| e.to_string())?,
        );
        let state = store
            .load()
            .await
            .map_err(|e| e.to_string())?
            .unwrap_or_default();
        Ok(Self {
            store,
            state: Mutex::new(state),
            vault,
            host,
        })
    }
    async fn recover(&self, state: &mut State) -> Result<(), String> {
        *state = self
            .store
            .load()
            .await
            .map_err(|e| e.to_string())?
            .unwrap_or_default();
        Ok(())
    }
    pub async fn status(&self) -> Result<Vec<Review>, String> {
        let mut state = self.state.lock().await;
        self.recover(&mut state).await?;
        Ok(state.records.iter().map(|r| r.review.clone()).collect())
    }
    async fn commit(&self, state: &mut State, next: State) -> Result<(), String> {
        match self.store.save_with_outcome(&next).await {
            Ok(()) => {
                *state = next;
                Ok(())
            }
            Err(SaveError::NotPublished(e)) => Err(e.to_string()),
            Err(SaveError::Published) => {
                *state = next;
                Err("Cost review was saved, but durability could not be confirmed. Reload before continuing.".into())
            }
            Err(SaveError::Unconfirmed) => {
                if let Ok(Some(saved)) = self.store.load().await {
                    *state = saved;
                }
                Err("Cost review save could not be confirmed. Reload before continuing.".into())
            }
        }
    }
    async fn cleanup(&self, state: &mut State) -> Result<(), String> {
        let mut next = state.clone();
        for id in &state.retired_credentials {
            self.vault.delete(*id).await.map_err(|e| e.to_string())?;
        }
        if !next.retired_credentials.is_empty() {
            next.retired_credentials.clear();
            self.commit(state, next).await?;
        }
        Ok(())
    }
    pub async fn read(self: &Arc<Self>, input: ReadCatalog, now: u64) -> Result<Review, String> {
        // Keep the vault/state transaction alive if a client disconnects during a save.
        let owner = self.clone();
        tokio::spawn(async move { owner.read_inner(input, now).await })
            .await
            .map_err(|_| "Provider review did not finish.".to_string())?
    }
    async fn read_inner(&self, input: ReadCatalog, now: u64) -> Result<Review, String> {
        if input.id.is_nil()
            || input.name.trim().is_empty()
            || input.name.len() > 200
            || !matches!(
                input.provider,
                CloudProvider::Hetzner | CloudProvider::DigitalOcean
            )
        {
            return Err("Choose Hetzner or DigitalOcean and give the bot a name.".into());
        }
        let mut state = self.state.lock().await;
        self.recover(&mut state).await?;
        self.cleanup(&mut state).await?;
        let previous = state.records.iter().find(|r| r.review.id == input.id);
        if previous.is_some_and(|r| r.review.provider != input.provider) {
            return Err("Use a new setup when changing provider.".into());
        }
        let (reference, secret, new_secret) = match input.api_token {
            Some(token) if !token.trim().is_empty() => {
                let token = token.trim();
                if token.len() > 4096 || !token.bytes().all(|b| b.is_ascii_graphic()) {
                    return Err("Enter a valid provider API token.".into());
                }
                (Uuid::new_v4(), Secret::new(token.as_bytes().to_vec()), true)
            }
            _ => {
                let reference = previous
                    .ok_or("Enter your provider API token. It is saved only in GChat's vault.")?
                    .credential_ref;
                (
                    reference,
                    self.vault
                        .get(reference)
                        .await
                        .map_err(|e| e.to_string())?
                        .ok_or("Provider token is missing. Enter it again.")?,
                    false,
                )
            }
        };
        let catalog = self.host.catalog(input.provider, &secret).await?;
        catalog.validate()?;
        let review = Review {
            id: input.id,
            name: input.name.trim().into(),
            provider: input.provider,
            catalog,
            fetched_at: now,
            expires_at: now.checked_add(900).ok_or("Invalid quote time")?,
            quote: None,
            confirmed: false,
        };
        if new_secret {
            // Record cleanup intent before writing a credential outside the state file.
            let mut pending = state.clone();
            pending.retired_credentials.push(reference);
            self.commit(&mut state, pending).await?;
            self.vault
                .put(reference, secret)
                .await
                .map_err(|e| e.to_string())?;
        }
        let mut next = state.clone();
        next.retired_credentials.retain(|id| *id != reference);
        if let Some(old) = next.records.iter().find(|r| r.review.id == input.id) {
            if old.credential_ref != reference {
                next.retired_credentials.push(old.credential_ref);
            }
        }
        next.records.retain(|r| r.review.id != input.id);
        next.records.push(Record {
            review: review.clone(),
            credential_ref: reference,
        });
        self.commit(&mut state, next).await?;
        self.cleanup(&mut state).await?;
        Ok(review)
    }
    pub async fn select(&self, input: SelectPlan, now: u64) -> Result<Review, String> {
        let mut state = self.state.lock().await;
        self.recover(&mut state).await?;
        let mut next = state.clone();
        let record = next
            .records
            .iter_mut()
            .find(|r| r.review.id == input.id)
            .ok_or("Cost review not found.")?;
        let review = &mut record.review;
        if now < review.fetched_at || now >= review.expires_at {
            return Err("Prices expired. Refresh the plans and review the cost again.".into());
        }
        let plan = review
            .catalog
            .plans
            .iter()
            .find(|p| p.id == input.plan && p.region == input.region)
            .ok_or("Selected plan is unavailable. Refresh the plans; no replacement was selected.")?
            .clone();
        let total = Price {
            monthly: sum_amount(&plan.compute.monthly, &plan.ipv4.monthly)?,
            hourly: sum_amount(&plan.compute.hourly, &plan.ipv4.hourly)?,
        };
        review.quote = Some(Quote {
            id: Uuid::new_v4(),
            plan,
            total,
            quoted_at: now,
            expires_at: review.expires_at,
        });
        review.confirmed = false;
        let result = review.clone();
        self.commit(&mut state, next).await?;
        Ok(result)
    }
    pub async fn confirm(&self, input: ConfirmQuote, now: u64) -> Result<Review, String> {
        let mut state = self.state.lock().await;
        self.recover(&mut state).await?;
        let mut next = state.clone();
        let review = &mut next
            .records
            .iter_mut()
            .find(|r| r.review.id == input.id)
            .ok_or("Cost review not found.")?
            .review;
        let quote = review
            .quote
            .as_ref()
            .ok_or("Select a plan and review its price first.")?;
        if quote.id != input.quote_id {
            return Err("The selected plan changed. Review its price again.".into());
        }
        if now < quote.quoted_at || now >= quote.expires_at {
            return Err("Prices expired. Refresh the plans and review the cost again.".into());
        }
        review.confirmed = true;
        let result = review.clone();
        self.commit(&mut state, next).await?;
        Ok(result)
    }
    pub async fn remove(&self, id: Uuid) -> Result<(), String> {
        let mut state = self.state.lock().await;
        self.recover(&mut state).await?;
        let mut next = state.clone();
        let record = next
            .records
            .iter()
            .find(|r| r.review.id == id)
            .ok_or("Cost review not found.")?;
        next.retired_credentials.push(record.credential_ref);
        next.records.retain(|r| r.review.id != id);
        self.commit(&mut state, next).await?;
        self.cleanup(&mut state).await
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::vault::VaultFuture;
    use std::{
        collections::BTreeMap,
        sync::{atomic::Ordering, Mutex as SyncMutex},
    };

    #[derive(Default)]
    struct MemoryVault(SyncMutex<BTreeMap<Uuid, Vec<u8>>>);
    impl Vault for MemoryVault {
        fn get(&self, id: Uuid) -> VaultFuture<'_, Option<Secret>> {
            Box::pin(async move { Ok(self.0.lock().unwrap().get(&id).cloned().map(Secret::new)) })
        }
        fn put(&self, id: Uuid, secret: Secret) -> VaultFuture<'_, ()> {
            Box::pin(async move {
                self.0
                    .lock()
                    .unwrap()
                    .insert(id, secret.expose_secret().to_vec());
                Ok(())
            })
        }
        fn delete(&self, id: Uuid) -> VaultFuture<'_, ()> {
            Box::pin(async move {
                self.0.lock().unwrap().remove(&id);
                Ok(())
            })
        }
    }
    struct Provider(SyncMutex<Catalog>);
    impl CloudHost for Provider {
        fn catalog<'a>(&'a self, _: CloudProvider, token: &'a Secret) -> CloudFuture<'a> {
            Box::pin(async move {
                assert!(!token.expose_secret().is_empty());
                Ok(self.0.lock().unwrap().clone())
            })
        }
    }
    fn amount(net: &str, gross: &str) -> Amount {
        Amount {
            net: net.into(),
            gross: Some(gross.into()),
        }
    }
    fn catalog() -> Catalog {
        Catalog {
            currency: "EUR".into(),
            tax: "VAT included in gross prices".into(),
            regions: vec![Region {
                id: "fsn1".into(),
                name: "Falkenstein".into(),
            }],
            plans: vec![Plan {
                id: "22".into(),
                name: "cpx11".into(),
                region: "fsn1".into(),
                vcpus: 2,
                memory_mib: 4096,
                disk_gb: 40,
                included_traffic_bytes: 20_000_000_000_000,
                compute: Price {
                    monthly: amount("4.1", "4.879"),
                    hourly: amount("0.0061", "0.007259"),
                },
                ipv4: Price {
                    monthly: amount("0.5", "0.595"),
                    hourly: amount("0.0007", "0.000833"),
                },
                traffic_per_tb: Some(amount("1", "1.19")),
                recommended: true,
            }],
        }
    }
    fn input(id: Uuid, token: Option<&str>) -> ReadCatalog {
        ReadCatalog {
            id,
            name: "Research bot".into(),
            provider: CloudProvider::Hetzner,
            api_token: token.map(str::to_owned),
        }
    }
    fn selection(id: Uuid) -> SelectPlan {
        SelectPlan {
            id,
            plan: "22".into(),
            region: "fsn1".into(),
        }
    }

    #[tokio::test]
    async fn cloud_review_persists_exact_prices_without_secrets_and_refresh_requires_new_consent() {
        let root = tempfile::tempdir().unwrap();
        let vault = Arc::new(MemoryVault::default());
        let host = Arc::new(Provider(SyncMutex::new(catalog())));
        let id = Uuid::new_v4();
        let owner = Arc::new(
            CloudSetup::open(root.path().into(), vault.clone(), host.clone())
                .await
                .unwrap(),
        );
        owner
            .read(input(id, Some("fixture-token")), 100)
            .await
            .unwrap();
        let selected = owner.select(selection(id), 101).await.unwrap();
        let quote = selected.quote.unwrap();
        assert_eq!(quote.total.monthly, amount("4.6", "5.474"));
        assert_eq!(quote.total.hourly, amount("0.0068", "0.008092"));
        owner
            .confirm(
                ConfirmQuote {
                    id,
                    quote_id: quote.id,
                },
                102,
            )
            .await
            .unwrap();
        let public = serde_json::to_string(&owner.status().await.unwrap()).unwrap();
        assert!(!public.contains("credential_ref"));
        assert!(!public.contains("fixture-token"));
        assert!(
            !tokio::fs::read_to_string(root.path().join("cloud-review.json"))
                .await
                .unwrap()
                .contains("fixture-token")
        );
        drop(owner);
        let owner = Arc::new(
            CloudSetup::open(root.path().into(), vault.clone(), host)
                .await
                .unwrap(),
        );
        assert!(owner.status().await.unwrap()[0].confirmed);
        let refreshed = owner.read(input(id, None), 200).await.unwrap();
        assert!(!refreshed.confirmed);
        assert!(refreshed.quote.is_none());
        assert!(owner
            .confirm(
                ConfirmQuote {
                    id,
                    quote_id: quote.id
                },
                201
            )
            .await
            .is_err());
        owner
            .read(input(id, Some("replacement-token")), 202)
            .await
            .unwrap();
        assert_eq!(vault.0.lock().unwrap().len(), 1);
        owner.remove(id).await.unwrap();
        assert!(vault.0.lock().unwrap().is_empty());
        assert!(owner.status().await.unwrap().is_empty());
    }

    #[tokio::test]
    async fn cloud_review_refuses_expired_missing_and_changed_plans_without_substitution() {
        let root = tempfile::tempdir().unwrap();
        let vault = Arc::new(MemoryVault::default());
        let host = Arc::new(Provider(SyncMutex::new(catalog())));
        let owner = Arc::new(
            CloudSetup::open(root.path().into(), vault.clone(), host.clone())
                .await
                .unwrap(),
        );
        let id = Uuid::new_v4();
        owner.read(input(id, Some("fixture")), 100).await.unwrap();
        assert!(owner
            .select(
                SelectPlan {
                    id,
                    plan: "gone".into(),
                    region: "fsn1".into()
                },
                101
            )
            .await
            .unwrap_err()
            .contains("no replacement"));
        assert!(owner
            .select(selection(id), 1000)
            .await
            .unwrap_err()
            .contains("expired"));
        let quote = owner
            .select(selection(id), 102)
            .await
            .unwrap()
            .quote
            .unwrap();
        assert!(owner
            .confirm(
                ConfirmQuote {
                    id,
                    quote_id: Uuid::new_v4()
                },
                103
            )
            .await
            .unwrap_err()
            .contains("changed"));
        assert!(owner
            .confirm(
                ConfirmQuote {
                    id,
                    quote_id: quote.id
                },
                1000
            )
            .await
            .unwrap_err()
            .contains("expired"));
        assert!(owner
            .confirm(
                ConfirmQuote {
                    id,
                    quote_id: quote.id
                },
                101
            )
            .await
            .is_err());
        host.0.lock().unwrap().plans[0].compute.monthly.net = "NaN".into();
        assert!(owner
            .read(input(Uuid::new_v4(), Some("bad-catalog")), 110)
            .await
            .is_err());
        assert_eq!(vault.0.lock().unwrap().len(), 1);
        assert!(!owner.status().await.unwrap()[0].confirmed);
    }

    #[tokio::test]
    async fn cloud_review_recovers_published_saves_and_credential_cleanup_intent() {
        let root = tempfile::tempdir().unwrap();
        let vault = Arc::new(MemoryVault::default());
        let host = Arc::new(Provider(SyncMutex::new(catalog())));
        let owner = Arc::new(
            CloudSetup::open(root.path().into(), vault.clone(), host)
                .await
                .unwrap(),
        );
        let id = Uuid::new_v4();
        owner.store.fail_after_publish.store(true, Ordering::SeqCst);
        assert!(owner.read(input(id, Some("fixture")), 100).await.is_err());
        assert!(vault.0.lock().unwrap().is_empty());
        owner.read(input(id, Some("fixture")), 101).await.unwrap();
        owner.store.fail_after_publish.store(true, Ordering::SeqCst);
        assert!(owner.select(selection(id), 102).await.is_err());
        let recovered = owner.status().await.unwrap().remove(0);
        owner
            .confirm(
                ConfirmQuote {
                    id,
                    quote_id: recovered.quote.unwrap().id,
                },
                103,
            )
            .await
            .unwrap();
        owner.store.fail_after_publish.store(true, Ordering::SeqCst);
        assert!(owner.remove(id).await.is_err());
        assert!(owner.status().await.unwrap().is_empty());
        owner
            .read(input(Uuid::new_v4(), Some("new")), 104)
            .await
            .unwrap();
        assert_eq!(vault.0.lock().unwrap().len(), 1);
    }

    #[test]
    fn cloud_price_arithmetic_keeps_provider_precision_and_rejects_invalid_values() {
        assert_eq!(decimal_units("0.000000001").unwrap(), 1);
        assert_eq!(
            sum_amount(&amount("1.999999999", "2"), &amount("0.000000001", "0.1")).unwrap(),
            amount("2", "2.1")
        );
        for invalid in [
            "-1",
            "NaN",
            "1e3",
            ".5",
            "1.2.3",
            "0.0000000001",
            "18446744073709551615",
        ] {
            assert!(decimal_units(invalid).is_err(), "{invalid}");
        }
    }
}
