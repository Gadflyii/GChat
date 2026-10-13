//! Provider costs, consent and recovery of this setup's cloud resources.
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
pub type ResourceFuture<'a, T> =
    Pin<Box<dyn Future<Output = Result<T, ProviderError>> + Send + 'a>>;
pub trait CloudHost: Send + Sync {
    fn catalog<'a>(&'a self, provider: CloudProvider, token: &'a Secret) -> CloudFuture<'a>;
    fn create<'a>(
        &'a self,
        provider: CloudProvider,
        token: &'a Secret,
        request: &'a CreateResource,
    ) -> ResourceFuture<'a, Resource>;
    fn find<'a>(
        &'a self,
        provider: CloudProvider,
        token: &'a Secret,
        setup: Uuid,
        pending: &'a Pending,
    ) -> ResourceFuture<'a, Vec<Resource>>;
    fn inspect<'a>(
        &'a self,
        provider: CloudProvider,
        token: &'a Secret,
        setup: Uuid,
        resource: &'a Resource,
    ) -> ResourceFuture<'a, Option<Resource>>;
    fn delete<'a>(
        &'a self,
        provider: CloudProvider,
        token: &'a Secret,
        setup: Uuid,
        resource: &'a Resource,
    ) -> ResourceFuture<'a, ()>;
}

#[derive(Debug)]
pub struct ProviderError {
    pub message: String,
    pub uncertain: bool,
}
impl ProviderError {
    pub fn rejected(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
            uncertain: false,
        }
    }
    pub fn uncertain(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
            uncertain: true,
        }
    }
}
#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ResourceKind {
    Tag,
    Firewall,
    Ipv4,
    Server,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct Resource {
    pub kind: ResourceKind,
    pub id: String,
    pub name: String,
    pub ready: bool,
    pub address: Option<String>,
    pub actions: Vec<String>,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct Pending {
    pub kind: ResourceKind,
    pub name: String,
    pub deleting: Option<Resource>,
}
#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Phase {
    Creating,
    CheckRequired,
    Running,
    Deleting,
    Deleted,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct Deployment {
    pub plan: Plan,
    pub currency: String,
    pub tax: String,
    pub source_cidrs: Vec<String>,
    pub public_key: crate::contract::SshHostPublicKey,
    pub phase: Phase,
    pub server_id: Option<String>,
    pub resources: Vec<Resource>,
    pub pending: Option<Pending>,
    pub issue: Option<String>,
}
pub struct CreateResource {
    pub setup: Uuid,
    pub pending: Pending,
    pub plan: Plan,
    pub source_cidrs: Vec<String>,
    pub resources: Vec<Resource>,
    pub user_data: String,
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
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
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
    #[serde(default)]
    pub deployment: Option<Deployment>,
}
#[derive(Clone, Deserialize, Serialize)]
struct Record {
    review: Review,
    credential_ref: Uuid,
    #[serde(default)]
    key_ref: Option<Uuid>,
}
#[derive(Clone, Default, Deserialize, Serialize)]
struct State {
    records: Vec<Record>,
    retired_credentials: Vec<Uuid>,
    #[serde(default)]
    workspace_retirements: std::collections::BTreeMap<Uuid, Vec<Uuid>>,
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
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CreateComputer {
    pub id: Uuid,
    pub quote_id: Uuid,
    pub consent: bool,
    pub source_cidrs: Vec<String>,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DeleteComputer {
    pub id: Uuid,
    pub consent: bool,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AttachComputer {
    pub id: Uuid,
    pub pinned_host_key: crate::contract::SshHostPublicKey,
    pub verified: bool,
}

pub struct CloudSetup {
    store: Arc<Store>,
    state: Mutex<State>,
    vault: Arc<dyn Vault>,
    host: Arc<dyn CloudHost>,
    assets: PathBuf,
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
            assets: root.join("vms/assets"),
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
            deployment: previous.and_then(|r| r.review.deployment.clone()),
        };
        let key_ref = previous.and_then(|r| r.key_ref);
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
            key_ref,
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
        if review.deployment.as_ref().is_some_and(|d| {
            d.phase != Phase::Deleted && (d.plan.id != input.plan || d.plan.region != input.region)
        }) {
            return Err("This setup already owns resources for another plan. Remove those resources before choosing a new plan.".into());
        }
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
        if next.workspace_retirements.contains_key(&id) {
            return Err("Finish workspace removal before removing the review.".into());
        }
        let record = next
            .records
            .iter()
            .find(|r| r.review.id == id)
            .ok_or("Cost review not found.")?;
        if record
            .review
            .deployment
            .as_ref()
            .is_some_and(|d| d.phase != Phase::Deleted)
        {
            return Err(
                "Remove this setup's cloud resources before removing its saved review.".into(),
            );
        }
        next.retired_credentials.push(record.credential_ref);
        if let Some(key) = record.key_ref {
            next.retired_credentials.push(key);
        }
        next.records.retain(|r| r.review.id != id);
        self.commit(&mut state, next).await?;
        self.cleanup(&mut state).await
    }

    pub async fn create(
        self: &Arc<Self>,
        input: CreateComputer,
        now: u64,
    ) -> Result<Review, String> {
        let owner = self.clone();
        tokio::spawn(async move { owner.create_inner(input, now).await })
            .await
            .map_err(|_| {
                "Cloud creation was interrupted. Check the saved setup before continuing."
                    .to_string()
            })?
    }

    async fn create_inner(&self, input: CreateComputer, now: u64) -> Result<Review, String> {
        if !input.consent {
            return Err("Confirm creation and provider billing first.".into());
        }
        let cidrs = validate_cidrs(input.source_cidrs)?;
        let mut state = self.state.lock().await;
        self.recover(&mut state).await?;
        let index = position(&state, input.id)?;
        if state.workspace_retirements.contains_key(&input.id) {
            return Err("Finish workspace removal before creating another computer.".into());
        }
        let record = state.records[index].clone();
        let quote = record
            .review
            .quote
            .as_ref()
            .ok_or("Review the live price first.")?;
        if !record.review.confirmed
            || quote.id != input.quote_id
            || now < quote.quoted_at
            || now >= quote.expires_at
        {
            return Err(
                "Review the current price and confirm it before creating resources.".into(),
            );
        }
        if let Some(deployment) = &record.review.deployment {
            if deployment.phase != Phase::Deleted {
                if deployment.phase == Phase::Deleting {
                    return Err("Finish deleting this computer before creating another one.".into());
                }
                if deployment.source_cidrs != cidrs {
                    return Err("The saved firewall sources cannot change during creation.".into());
                }
                if deployment.pending.is_some() {
                    return Err("An earlier request needs checking. Use Check progress; do not create again.".into());
                }
                let mut next = state.clone();
                let target = next.records[index].review.deployment.as_mut().unwrap();
                target.plan = quote.plan.clone();
                target.currency = record.review.catalog.currency.clone();
                target.tax = record.review.catalog.tax.clone();
                self.commit(&mut state, next).await?;
                return self.advance(&mut state, index, now).await;
            }
        }
        // Missing bundled tools must fail before a billable resource exists.
        crate::lan_setup::Bundle::new(&self.assets, input.id, "gbot".into())
            .map_err(|e| e.to_string())?;
        let key = crate::ssh::generate_ssh_key().map_err(|e| e.to_string())?;
        let public_key = crate::ssh::ssh_public_key(&key).map_err(|e| e.to_string())?;
        let key_ref = Uuid::new_v4();
        let mut next = state.clone();
        next.retired_credentials.push(key_ref);
        self.commit(&mut state, next).await?;
        self.vault
            .put(key_ref, key)
            .await
            .map_err(|e| e.to_string())?;
        let mut next = state.clone();
        next.retired_credentials.retain(|id| *id != key_ref);
        if let Some(old) = next.records[index].key_ref.replace(key_ref) {
            next.retired_credentials.push(old);
        }
        next.records[index].review.deployment = Some(Deployment {
            plan: quote.plan.clone(),
            currency: record.review.catalog.currency,
            tax: record.review.catalog.tax,
            source_cidrs: cidrs,
            public_key,
            phase: Phase::Creating,
            server_id: None,
            resources: vec![],
            pending: None,
            issue: None,
        });
        self.commit(&mut state, next).await?;
        self.cleanup(&mut state).await?;
        self.advance(&mut state, index, now).await
    }

    pub async fn check(self: &Arc<Self>, id: Uuid, now: u64) -> Result<Review, String> {
        let owner = self.clone();
        tokio::spawn(async move {
            let mut state = owner.state.lock().await;
            owner.recover(&mut state).await?;
            let index = position(&state, id)?;
            owner.reconcile(&mut state, index).await?;
            if state.records[index]
                .review
                .deployment
                .as_ref()
                .is_some_and(|d| d.phase == Phase::Creating)
            {
                owner.advance(&mut state, index, now).await
            } else {
                Ok(state.records[index].review.clone())
            }
        })
        .await
        .map_err(|_| {
            "Cloud progress check was interrupted. Check again before continuing.".to_string()
        })?
    }

    async fn issue(&self, state: &mut State, index: usize, message: String) -> Result<(), String> {
        let mut next = state.clone();
        let deployment = next.records[index]
            .review
            .deployment
            .as_mut()
            .ok_or("Computer has not been created.")?;
        if deployment.phase != Phase::Deleting {
            deployment.phase = Phase::CheckRequired;
        }
        deployment.issue = Some(message);
        self.commit(state, next).await
    }

    async fn reconcile(&self, state: &mut State, index: usize) -> Result<(), String> {
        let record = state.records[index].clone();
        let deployment = record
            .review
            .deployment
            .as_ref()
            .ok_or("Computer has not been created.")?;
        if deployment.phase == Phase::Deleted {
            return Ok(());
        }
        let token = self
            .vault
            .get(record.credential_ref)
            .await
            .map_err(|e| e.to_string())?
            .ok_or("Provider token is missing.")?;
        let mut next = state.clone();
        let target = next.records[index].review.deployment.as_mut().unwrap();
        if let Some(pending) = &deployment.pending {
            if let Some(resource) = &pending.deleting {
                match self
                    .host
                    .inspect(record.review.provider, &token, record.review.id, resource)
                    .await
                {
                    Ok(None) => {
                        target
                            .resources
                            .retain(|r| r.id != resource.id || r.kind != resource.kind);
                        target.pending = None;
                    }
                    Ok(Some(_)) => {
                        target.pending = None;
                    }
                    Err(error) => return self.issue(state, index, error.message).await,
                }
            } else {
                match self.host.find(record.review.provider, &token, record.review.id, pending).await {
                    Ok(mut found) if found.len() == 1 => { let resource = found.remove(0); if resource.kind == ResourceKind::Server { target.server_id = Some(resource.id.clone()); } target.resources.push(resource); target.pending = None; target.phase = Phase::Creating; target.issue = None; }
                    Ok(found) => return self.issue(state, index, format!("Creation outcome is still uncertain ({} matching resources). Review the named operation {} in the provider console. No duplicate will be created.", found.len(), pending.name)).await,
                    Err(error) => return self.issue(state, index, error.message).await,
                }
            }
        }
        for resource in &mut target.resources {
            match self.host.inspect(record.review.provider, &token, record.review.id, resource).await {
                Ok(Some(updated)) => *resource = updated,
                Ok(None) if target.phase == Phase::Deleting => {}
                Ok(None) => return self.issue(state, index, "An owned resource is missing. Review the provider console before continuing.".into()).await,
                Err(error) => return self.issue(state, index, error.message).await,
            }
        }
        if target.phase != Phase::Deleting {
            target.phase = if target.resources.iter().all(|r| r.ready)
                && target
                    .resources
                    .iter()
                    .any(|r| r.kind == ResourceKind::Server && r.ready && r.address.is_some())
            {
                Phase::Running
            } else {
                Phase::Creating
            };
            target.issue = None;
        }
        self.commit(state, next).await
    }

    async fn advance(&self, state: &mut State, index: usize, now: u64) -> Result<Review, String> {
        let started = std::time::Instant::now();
        for _ in 0..4 {
            let record = state.records[index].clone();
            let deployment = record
                .review
                .deployment
                .as_ref()
                .ok_or("Computer has not been created.")?;
            if deployment.pending.is_some()
                || deployment.phase == Phase::Deleting
                || deployment.phase == Phase::Deleted
            {
                break;
            }
            let order = match record.review.provider {
                CloudProvider::Hetzner => &[
                    ResourceKind::Firewall,
                    ResourceKind::Ipv4,
                    ResourceKind::Server,
                ][..],
                CloudProvider::DigitalOcean => &[
                    ResourceKind::Tag,
                    ResourceKind::Firewall,
                    ResourceKind::Server,
                ][..],
                _ => return Err("This provider is not supported for automatic creation.".into()),
            };
            let Some(kind) = order
                .iter()
                .find(|kind| !deployment.resources.iter().any(|r| r.kind == **kind))
                .copied()
            else {
                break;
            };
            if deployment.resources.iter().any(|r| !r.ready) {
                break;
            }
            let token = self
                .vault
                .get(record.credential_ref)
                .await
                .map_err(|e| e.to_string())?
                .ok_or("Provider token is missing.")?;
            let catalog = self.host.catalog(record.review.provider, &token).await?;
            catalog.validate()?;
            let quote_valid = record.review.confirmed
                && record.review.quote.as_ref().is_some_and(|q| {
                    now.saturating_add(started.elapsed().as_secs()) < q.expires_at
                        && q.plan == deployment.plan
                });
            if !quote_valid
                || catalog.currency != deployment.currency
                || catalog.tax != deployment.tax
                || !catalog.plans.iter().any(|p| p == &deployment.plan)
            {
                let mut next = state.clone();
                next.records[index].review.confirmed = false;
                next.records[index].review.deployment.as_mut().unwrap().issue = Some("Price or availability changed. Refresh, select the same plan and confirm its cost again. Existing owned resources are retained.".into());
                self.commit(state, next).await?;
                break;
            }
            let pending = Pending {
                kind,
                name: if kind == ResourceKind::Tag {
                    format!("gbot-{}", record.review.id.simple())
                } else {
                    format!(
                        "gbot-{}-{}",
                        &record.review.id.simple().to_string()[..8],
                        Uuid::new_v4().simple()
                    )
                },
                deleting: None,
            };
            let bundle =
                crate::lan_setup::Bundle::new(&self.assets, record.review.id, "gbot".into())
                    .map_err(|e| e.to_string())?;
            let request = CreateResource {
                setup: record.review.id,
                pending: pending.clone(),
                plan: deployment.plan.clone(),
                source_cidrs: deployment.source_cidrs.clone(),
                resources: deployment.resources.clone(),
                user_data: bootstrap(&bundle, &deployment.public_key, &deployment.source_cidrs)?,
            };
            let mut next = state.clone();
            next.records[index]
                .review
                .deployment
                .as_mut()
                .unwrap()
                .pending = Some(pending);
            self.commit(state, next).await?;
            match self
                .host
                .create(record.review.provider, &token, &request)
                .await
            {
                Ok(resource) => {
                    let mut next = state.clone();
                    let target = next.records[index].review.deployment.as_mut().unwrap();
                    if resource.kind != kind
                        || resource.name != request.pending.name
                        || resource.id.is_empty()
                    {
                        self.issue(state, index, "Provider create response could not be matched. Check progress before continuing.".into()).await?;
                        break;
                    }
                    if resource.kind == ResourceKind::Server {
                        target.server_id = Some(resource.id.clone());
                    }
                    target.resources.push(resource);
                    target.pending = None;
                    target.issue = None;
                    self.commit(state, next).await?;
                }
                Err(error) => {
                    let mut next = state.clone();
                    let target = next.records[index].review.deployment.as_mut().unwrap();
                    if !error.uncertain {
                        target.pending = None;
                    }
                    target.phase = Phase::CheckRequired;
                    target.issue = Some(error.message);
                    self.commit(state, next).await?;
                    break;
                }
            }
        }
        Ok(state.records[index].review.clone())
    }

    pub async fn delete(self: &Arc<Self>, input: DeleteComputer) -> Result<Review, String> {
        if !input.consent {
            return Err("Confirm deletion of this bot computer and its files first.".into());
        }
        let owner = self.clone();
        tokio::spawn(async move {
            let mut state = owner.state.lock().await;
            owner.recover(&mut state).await?;
            let index = position(&state, input.id)?;
            let mut next = state.clone();
            let deployment = next.records[index].review.deployment.as_mut().ok_or("Computer has not been created.")?;
            if deployment.pending.as_ref().is_some_and(|p| p.deleting.is_none()) { return Err("Resolve the uncertain creation in the provider console before deleting this setup.".into()); }
            deployment.phase = Phase::Deleting;
            owner.commit(&mut state, next).await?;
            owner.delete_inner(&mut state, index).await
        }).await.map_err(|_| "Deletion was interrupted. Check progress; the owned resource list is retained.".to_string())?
    }

    async fn delete_inner(&self, state: &mut State, index: usize) -> Result<Review, String> {
        let record = state.records[index].clone();
        let token = self
            .vault
            .get(record.credential_ref)
            .await
            .map_err(|e| e.to_string())?
            .ok_or("Provider token is missing.")?;
        for _ in 0..4 {
            let deployment = state.records[index]
                .review
                .deployment
                .as_ref()
                .ok_or("Computer has not been created.")?;
            let Some(resource) = deployment.resources.last().cloned() else {
                let mut next = state.clone();
                let target = next.records[index].review.deployment.as_mut().unwrap();
                target.phase = Phase::Deleted;
                target.pending = None;
                target.issue = None;
                self.commit(state, next).await?;
                break;
            };
            if let Err(error) = self
                .host
                .inspect(record.review.provider, &token, record.review.id, &resource)
                .await
            {
                self.issue(state, index, error.message).await?;
                break;
            }
            let mut next = state.clone();
            next.records[index]
                .review
                .deployment
                .as_mut()
                .unwrap()
                .pending = Some(Pending {
                kind: resource.kind,
                name: resource.name.clone(),
                deleting: Some(resource.clone()),
            });
            self.commit(state, next).await?;
            if let Err(error) = self
                .host
                .delete(record.review.provider, &token, record.review.id, &resource)
                .await
            {
                self.issue(state, index, error.message).await?;
                break;
            }
            match self
                .host
                .inspect(record.review.provider, &token, record.review.id, &resource)
                .await
            {
                Ok(None) => {
                    let mut next = state.clone();
                    let target = next.records[index].review.deployment.as_mut().unwrap();
                    target.resources.pop();
                    target.pending = None;
                    self.commit(state, next).await?;
                }
                Ok(Some(_)) => break,
                Err(error) => {
                    self.issue(state, index, error.message).await?;
                    break;
                }
            }
        }
        Ok(state.records[index].review.clone())
    }

    pub(crate) async fn stage_workspace_retirement(
        &self,
        id: Uuid,
        credentials: Vec<Uuid>,
    ) -> Result<(), String> {
        let mut state = self.state.lock().await;
        self.recover(&mut state).await?;
        let mut next = state.clone();
        next.workspace_retirements.insert(id, credentials);
        self.commit(&mut state, next).await
    }

    pub(crate) async fn finish_workspace_retirements(&self, live: &[Uuid]) -> Result<(), String> {
        let mut state = self.state.lock().await;
        self.recover(&mut state).await?;
        let mut next = state.clone();
        let retired: Vec<_> = next
            .workspace_retirements
            .keys()
            .filter(|id| !live.contains(id))
            .copied()
            .collect();
        for id in retired {
            if let Some(keys) = next.workspace_retirements.remove(&id) {
                next.retired_credentials.extend(keys);
            }
        }
        self.commit(&mut state, next).await?;
        self.cleanup(&mut state).await
    }

    pub async fn endpoint(&self, id: Uuid) -> Result<crate::contract::SshEndpoint, String> {
        let reviews = self.status().await?;
        let record = reviews
            .iter()
            .find(|r| r.id == id)
            .ok_or("Cloud setup not found.")?;
        let deployment = record
            .deployment
            .as_ref()
            .filter(|d| d.phase == Phase::Running)
            .ok_or("Check progress until the computer is running first.")?;
        let server = deployment
            .resources
            .iter()
            .find(|r| r.kind == ResourceKind::Server && r.ready)
            .ok_or("Computer is not running.")?;
        Ok(crate::contract::SshEndpoint {
            hostname: server
                .address
                .clone()
                .ok_or("Computer has no public IPv4 address.")?,
            port: 22,
            user: "gbot".into(),
        })
    }

    pub async fn connection(
        &self,
        input: AttachComputer,
    ) -> Result<(crate::contract::WorkspaceConfig, Secret), String> {
        use crate::contract::{
            BotPc, ServicePc, SshConnection, SshEndpoint, VaultCredentialRef, WorkspaceConfig,
            WorkspaceConnection, WorkspaceId,
        };
        if !input.verified {
            return Err("Verify the SSH fingerprint in your provider console first.".into());
        }
        input
            .pinned_host_key
            .validate()
            .map_err(|e| e.to_string())?;
        let mut state = self.state.lock().await;
        self.recover(&mut state).await?;
        let record = &state.records[position(&state, input.id)?];
        let deployment = record
            .review
            .deployment
            .as_ref()
            .filter(|d| d.phase == Phase::Running)
            .ok_or("Check progress until the computer is running first.")?;
        let server = deployment
            .resources
            .iter()
            .find(|r| r.kind == ResourceKind::Server && r.ready)
            .ok_or("Computer is not running.")?;
        let key = self
            .vault
            .get(record.key_ref.ok_or("Bot SSH key is missing.")?)
            .await
            .map_err(|e| e.to_string())?
            .ok_or("Bot SSH key is missing.")?;
        let config = WorkspaceConfig {
            id: WorkspaceId(input.id),
            name: record.review.name.clone(),
            service_pc: ServicePc::Local,
            bot_pc: BotPc::Cloud {
                provider: record.review.provider,
                resource_id: server.id.clone(),
            },
            connection: WorkspaceConnection::Ssh(SshConnection {
                endpoint: SshEndpoint {
                    hostname: server
                        .address
                        .clone()
                        .ok_or("Computer has no public IPv4 address.")?,
                    port: 22,
                    user: "gbot".into(),
                },
                pinned_host_key: input.pinned_host_key,
                credential_ref: VaultCredentialRef(input.id),
            }),
        };
        config.validate().map_err(|e| e.to_string())?;
        Ok((config, key))
    }
}

fn position(state: &State, id: Uuid) -> Result<usize, String> {
    state
        .records
        .iter()
        .position(|r| r.review.id == id)
        .ok_or_else(|| "Cloud setup not found.".into())
}

fn validate_cidrs(values: Vec<String>) -> Result<Vec<String>, String> {
    if values.is_empty() || values.len() > 16 {
        return Err("Enter the IP ranges allowed to SSH to this bot computer.".into());
    }
    values
        .into_iter()
        .map(|value| {
            let value = value.trim();
            let (address, prefix) = value
                .split_once('/')
                .ok_or("Use IP ranges such as 203.0.113.4/32.")?;
            let address: std::net::IpAddr = address
                .parse()
                .map_err(|_| "Invalid SSH source IP range.")?;
            let prefix: u8 = prefix.parse().map_err(|_| "Invalid SSH source IP range.")?;
            if prefix > if address.is_ipv4() { 32 } else { 128 } {
                return Err("Invalid SSH source IP range.".into());
            }
            Ok(format!("{address}/{prefix}"))
        })
        .collect()
}

fn bootstrap(
    bundle: &crate::lan_setup::Bundle,
    key: &crate::contract::SshHostPublicKey,
    cidrs: &[String],
) -> Result<String, String> {
    use crate::lan_setup::quote;
    let source = format!("/home/gbot/.local/share/gbot/setup/{}", bundle.id);
    let mut helper = format!("#!/bin/sh\nset -eu\n[ \"$#\" -eq 0 ]\n[ \"${{SUDO_USER:-}}\" = gbot ]\nsource={}\n[ ! -L \"$source\" ]\ncopy=$(mktemp -d /var/tmp/gbot-install.XXXXXXXX)\ntrap 'rm -f -- \"$copy\"/*; rmdir -- \"$copy\"' EXIT\n", quote(&source));
    for (name, digest) in std::iter::once(("install.sh", bundle.installer_digest())).chain(
        bundle
            .archives
            .iter()
            .map(|(_, name, digest)| (name.as_str(), digest.clone())),
    ) {
        helper.push_str(&format!("[ ! -L \"$source/{name}\" ]\ncp -- \"$source/{name}\" \"$copy/{name}\"\nprintf '%s  %s\\n' {} \"$copy/{name}\" | sha256sum --check --status\n", quote(&digest)));
    }
    helper.push_str("sh \"$copy/install.sh\"\n");
    let firewall = format!(
        "set -eu; ufw default deny incoming; ufw default allow outgoing; {}; ufw --force enable",
        cidrs
            .iter()
            .map(|cidr| format!("ufw allow from {} to any port 22 proto tcp", quote(cidr)))
            .collect::<Vec<_>>()
            .join("; ")
    );
    Ok(format!(
        "#cloud-config\n{}\n",
        serde_json::json!({
            "users": [{"name":"gbot","shell":"/bin/bash","lock_passwd":true,"ssh_authorized_keys":[format!("{} {}", key.algorithm,key.public_key)],"sudo":["ALL=(root) NOPASSWD: /usr/local/sbin/gbot-cloud-tools"]}],
            "disable_root":true,"ssh_pwauth":false,"apt":{"preserve_sources_list":false,"sources_list":"Types: deb\nURIs: https://deb.debian.org/debian\nSuites: trixie trixie-updates\nComponents: main\nSigned-By: /usr/share/keyrings/debian-archive-keyring.gpg\n\nTypes: deb\nURIs: https://security.debian.org/debian-security\nSuites: trixie-security\nComponents: main\nSigned-By: /usr/share/keyrings/debian-archive-keyring.gpg\n"},"package_update":true,"packages":["openssh-server","sudo","ufw","systemd","cloud-init"],
            "write_files":[{"path":"/usr/local/sbin/gbot-cloud-tools","owner":"root:root","permissions":"0755","content":helper},{"path":"/etc/ssh/sshd_config.d/70-gbot.conf","permissions":"0644","content":"PasswordAuthentication no\nPermitRootLogin no\n"}],
            "runcmd":[["sh","-c",firewall],["systemctl","reload","ssh"]]
        })
    ))
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
    #[derive(Default)]
    struct Resources {
        items: Vec<(Uuid, Resource)>,
        creates: usize,
        lost_reply: bool,
        reject_delete: Option<ResourceKind>,
        deleted: Vec<ResourceKind>,
    }
    struct Provider(SyncMutex<Catalog>, SyncMutex<Resources>);
    impl Provider {
        fn new() -> Self {
            Self(
                SyncMutex::new(catalog()),
                SyncMutex::new(Resources::default()),
            )
        }
    }
    impl CloudHost for Provider {
        fn catalog<'a>(&'a self, _: CloudProvider, token: &'a Secret) -> CloudFuture<'a> {
            Box::pin(async move {
                assert!(!token.expose_secret().is_empty());
                Ok(self.0.lock().unwrap().clone())
            })
        }
        fn create<'a>(
            &'a self,
            _: CloudProvider,
            _: &'a Secret,
            request: &'a CreateResource,
        ) -> ResourceFuture<'a, Resource> {
            Box::pin(async move {
                let mut state = self.1.lock().unwrap();
                state.creates += 1;
                let resource = Resource {
                    kind: request.pending.kind,
                    id: state.creates.to_string(),
                    name: request.pending.name.clone(),
                    ready: true,
                    address: (request.pending.kind == ResourceKind::Server)
                        .then(|| "203.0.113.7".into()),
                    actions: vec![],
                };
                state.items.push((request.setup, resource.clone()));
                if std::mem::take(&mut state.lost_reply) {
                    Err(ProviderError::uncertain("Lost create reply"))
                } else {
                    Ok(resource)
                }
            })
        }
        fn find<'a>(
            &'a self,
            _: CloudProvider,
            _: &'a Secret,
            setup: Uuid,
            pending: &'a Pending,
        ) -> ResourceFuture<'a, Vec<Resource>> {
            Box::pin(async move {
                Ok(self
                    .1
                    .lock()
                    .unwrap()
                    .items
                    .iter()
                    .filter(|(id, r)| {
                        *id == setup && r.kind == pending.kind && r.name == pending.name
                    })
                    .map(|(_, r)| r.clone())
                    .collect())
            })
        }
        fn inspect<'a>(
            &'a self,
            _: CloudProvider,
            _: &'a Secret,
            setup: Uuid,
            resource: &'a Resource,
        ) -> ResourceFuture<'a, Option<Resource>> {
            Box::pin(async move {
                Ok(self
                    .1
                    .lock()
                    .unwrap()
                    .items
                    .iter()
                    .find(|(id, r)| *id == setup && r.id == resource.id && r.kind == resource.kind)
                    .map(|(_, r)| r.clone()))
            })
        }
        fn delete<'a>(
            &'a self,
            _: CloudProvider,
            _: &'a Secret,
            setup: Uuid,
            resource: &'a Resource,
        ) -> ResourceFuture<'a, ()> {
            Box::pin(async move {
                let mut state = self.1.lock().unwrap();
                if state.reject_delete == Some(resource.kind) {
                    return Err(ProviderError::rejected("Delete refused"));
                }
                state.items.retain(|(id, r)| {
                    !(*id == setup && r.id == resource.id && r.kind == resource.kind)
                });
                state.deleted.push(resource.kind);
                Ok(())
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
        let host = Arc::new(Provider::new());
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
        let host = Arc::new(Provider::new());
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
        let host = Arc::new(Provider::new());
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
    async fn ready_setup(
        root: &std::path::Path,
        host: Arc<Provider>,
    ) -> (Arc<CloudSetup>, Arc<MemoryVault>, Uuid, CreateComputer) {
        let assets = root.join("vms/assets");
        std::fs::create_dir_all(&assets).unwrap();
        for asset in crate::guest_assets::accepted().iter().skip(1) {
            std::fs::write(assets.join(&asset.filename), b"fixture").unwrap();
        }
        let vault = Arc::new(MemoryVault::default());
        let setup = Arc::new(
            CloudSetup::open(root.into(), vault.clone(), host)
                .await
                .unwrap(),
        );
        let id = Uuid::new_v4();
        setup.read(input(id, Some("fixture")), 100).await.unwrap();
        let quote = setup
            .select(selection(id), 101)
            .await
            .unwrap()
            .quote
            .unwrap();
        setup
            .confirm(
                ConfirmQuote {
                    id,
                    quote_id: quote.id,
                },
                102,
            )
            .await
            .unwrap();
        let create = CreateComputer {
            id,
            quote_id: quote.id,
            consent: true,
            source_cidrs: vec!["203.0.113.4/32".into()],
        };
        (setup, vault, id, create)
    }
    #[tokio::test]
    async fn cloud_creation_reconciles_lost_reply_after_restart_without_duplicate() {
        let root = tempfile::tempdir().unwrap();
        let host = Arc::new(Provider::new());
        let (setup, vault, id, create) = ready_setup(root.path(), host.clone()).await;
        host.1.lock().unwrap().lost_reply = true;
        let result = setup.create(create, 103).await.unwrap();
        assert!(result.deployment.unwrap().pending.is_some());
        drop(setup);
        let setup = Arc::new(
            CloudSetup::open(root.path().into(), vault, host.clone())
                .await
                .unwrap(),
        );
        setup.check(id, 104).await.unwrap();
        let result = setup.check(id, 105).await.unwrap();
        assert_eq!(result.deployment.unwrap().phase, Phase::Running);
        assert_eq!(host.1.lock().unwrap().creates, 3);
        assert!(setup.remove(id).await.is_err());
    }
    #[tokio::test]
    async fn cloud_creation_refuses_changed_price_before_mutation() {
        let root = tempfile::tempdir().unwrap();
        let host = Arc::new(Provider::new());
        let (setup, _, _, create) = ready_setup(root.path(), host.clone()).await;
        {
            let mut catalog = host.0.lock().unwrap();
            catalog.plans[0].compute.monthly.net = "9".into();
            catalog.plans[0].compute.monthly.gross = Some("10.8".into());
        }
        let result = setup.create(create, 103).await.unwrap();
        assert!(!result.confirmed);
        assert_eq!(host.1.lock().unwrap().creates, 0);
    }
    #[tokio::test]
    async fn cloud_ambiguous_creation_is_not_retried_or_deleted() {
        let root = tempfile::tempdir().unwrap();
        let host = Arc::new(Provider::new());
        let (setup, _, id, create) = ready_setup(root.path(), host.clone()).await;
        host.1.lock().unwrap().lost_reply = true;
        setup.create(create, 103).await.unwrap();
        host.1.lock().unwrap().items.clear();
        assert_eq!(
            setup
                .check(id, 104)
                .await
                .unwrap()
                .deployment
                .unwrap()
                .phase,
            Phase::CheckRequired
        );
        assert_eq!(host.1.lock().unwrap().creates, 1);
        assert!(setup
            .delete(DeleteComputer { id, consent: true })
            .await
            .is_err());
    }
    #[tokio::test]
    async fn cloud_deletion_retries_owned_resources_in_reverse_order_and_keeps_live_keys() {
        let root = tempfile::tempdir().unwrap();
        let host = Arc::new(Provider::new());
        let (setup, vault, id, create) = ready_setup(root.path(), host.clone()).await;
        setup.create(create, 103).await.unwrap();
        let foreign = Uuid::new_v4();
        host.1.lock().unwrap().items.push((
            foreign,
            Resource {
                kind: ResourceKind::Server,
                id: "foreign".into(),
                name: "other".into(),
                ready: true,
                address: None,
                actions: vec![],
            },
        ));
        host.1.lock().unwrap().reject_delete = Some(ResourceKind::Ipv4);
        assert_eq!(
            setup
                .delete(DeleteComputer { id, consent: true })
                .await
                .unwrap()
                .deployment
                .unwrap()
                .phase,
            Phase::Deleting
        );
        host.1.lock().unwrap().reject_delete = None;
        assert_eq!(
            setup
                .delete(DeleteComputer { id, consent: true })
                .await
                .unwrap()
                .deployment
                .unwrap()
                .phase,
            Phase::Deleted
        );
        {
            let resources = host.1.lock().unwrap();
            assert_eq!(
                resources.deleted,
                vec![
                    ResourceKind::Server,
                    ResourceKind::Ipv4,
                    ResourceKind::Firewall
                ]
            );
            assert_eq!(resources.items[0].0, foreign);
        }
        vault
            .put(id, Secret::new(b"workspace-key".to_vec()))
            .await
            .unwrap();
        setup
            .stage_workspace_retirement(id, vec![id])
            .await
            .unwrap();
        setup.finish_workspace_retirements(&[id]).await.unwrap();
        assert!(vault.get(id).await.unwrap().is_some());
        setup.finish_workspace_retirements(&[]).await.unwrap();
        assert!(vault.get(id).await.unwrap().is_none());
    }
    #[test]
    fn cloud_bootstrap_limits_ssh_and_checks_pinned_tools() {
        let root = tempfile::tempdir().unwrap();
        let assets = root.path();
        for asset in crate::guest_assets::accepted().iter().skip(1) {
            std::fs::write(assets.join(&asset.filename), b"fixture").unwrap();
        }
        let bundle = crate::lan_setup::Bundle::new(assets, Uuid::new_v4(), "gbot".into()).unwrap();
        let key = crate::ssh::ssh_public_key(&crate::ssh::generate_ssh_key().unwrap()).unwrap();
        let data = bootstrap(&bundle, &key, &["203.0.113.4/32".into()]).unwrap();
        let v: serde_json::Value =
            serde_json::from_str(data.strip_prefix("#cloud-config\n").unwrap()).unwrap();
        assert_eq!(v["ssh_pwauth"], false);
        assert_eq!(v["disable_root"], true);
        let helper = v["write_files"][0]["content"].as_str().unwrap();
        assert!(helper.contains(&bundle.installer_digest()));
        assert!(helper.contains("sha256sum --check"));
        assert!(helper.contains("[ \"$#\" -eq 0 ]"));
        assert!(validate_cidrs(vec!["203.0.113.4/33".into()]).is_err());
    }
}
