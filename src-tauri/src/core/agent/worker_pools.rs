//! Agent worker placement and process-wide slot accounting.
//! A pool never loads models and never owns a remote workspace.
use ginfer_host::{
    fleet::{
        AuthorityLocator, ClientAssignment, FleetMember, FleetOperation, FleetPool,
        FleetPoolMember, FleetUpdate,
    },
    fleet_client::{FleetCatalog, FleetClient, FleetHostPhase},
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, HashMap, HashSet};
use std::path::Path;
use std::sync::{Arc, Mutex, OnceLock};
use tauri::{AppHandle, Manager, Runtime};
use tokio::sync::Notify;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WorkerPool {
    pub id: String,
    pub name: String,
    pub members: Vec<PoolMember>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PoolMember {
    pub instance_id: String,
    pub worker_limit: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum WorkerTarget {
    #[default]
    Current,
    Fleet,
    Instance {
        id: String,
    },
    Pool {
        id: String,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RoleAssignment {
    #[serde(default)]
    pub target: WorkerTarget,
    #[serde(default)]
    pub vision: bool,
    #[serde(default)]
    pub minimum_context: u32,
}
pub type RoleAssignments = BTreeMap<String, RoleAssignment>;

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct FleetStatus {
    pub authority_id: Option<Uuid>,
    pub client_id: Option<Uuid>,
    pub revision: Option<u64>,
    pub connected: bool,
    pub error: Option<String>,
    pub migration_issues: Vec<String>,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FleetHostChoice {
    pub id: Uuid,
    pub name: String,
    pub origins: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Catalog {
    pub pools: Vec<WorkerPool>,
    pub fleet: FleetStatus,
    pub aliases: BTreeMap<String, String>,
    pub assignment: Option<ClientAssignment>,
    pub available_pool_ids: Option<Vec<String>>,
    pub fleet_targets: Vec<String>,
    pub fleet_hosts: Vec<FleetHostChoice>,
    #[serde(skip)]
    pub all_pools: Vec<WorkerPool>,
}

impl Catalog {
    pub fn canonical(&self, id: &str) -> String {
        self.aliases
            .get(id)
            .cloned()
            .unwrap_or_else(|| id.to_owned())
    }

    pub fn validate_assignments(&self, assignments: &RoleAssignments) -> Result<(), String> {
        for assignment in assignments.values() {
            if let WorkerTarget::Pool { id } = &assignment.target {
                if !self.fleet.connected {
                    return Err(format!(
                        "Fleet coordinator is unavailable. Connect before starting pooled work. {}",
                        self.fleet.error.as_deref().unwrap_or("")
                    ));
                }
                if !self.pools.iter().any(|pool| &pool.id == id)
                    || self
                        .available_pool_ids
                        .as_ref()
                        .is_some_and(|ids| !ids.contains(id))
                {
                    return Err(format!("Worker pool `{id}` is unavailable in this client's fleet assignment. Review the pool or pending migration before running."));
                }
            }
            if assignment.target == WorkerTarget::Fleet {
                if !self.fleet.connected {
                    return Err("Fleet coordinator is unavailable. Connect before using this client's fleet assignment.".into());
                }
                if self.fleet_targets.is_empty() {
                    return Err("This client has no usable fleet placement. Assign preferred instances/hosts or visible pools in GInfer Server Manager.".into());
                }
            }
        }
        Ok(())
    }
}

pub fn validate(pool: &WorkerPool) -> Result<(), String> {
    if pool.name.trim().is_empty() || pool.name.chars().count() > 80 {
        return Err("Pool name must contain 1–80 characters".into());
    }
    if pool.members.is_empty() || pool.members.len() > 64 {
        return Err("A pool needs 1–64 explicitly selected members".into());
    }
    let mut ids = HashSet::new();
    for member in &pool.members {
        if member.instance_id.trim().is_empty()
            || member.instance_id.len() > 256
            || !ids.insert(&member.instance_id)
        {
            return Err("Pool instance IDs must be nonempty and unique".into());
        }
        if !(1..=8).contains(&member.worker_limit) {
            return Err("Worker limits must be between 1 and 8".into());
        }
    }
    Ok(())
}

/// The legacy file is a migration input, never a writable or offline authority.
fn legacy_pools(data: &Path) -> Result<Vec<WorkerPool>, String> {
    let bytes = match std::fs::read(data.join("agent-worker-pools.json")) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(error) => return Err(error.to_string()),
    };
    let pools: Vec<WorkerPool> = serde_json::from_slice(&bytes)
        .map_err(|error| format!("Invalid legacy worker pool store: {error}"))?;
    for pool in &pools {
        validate(pool)?;
    }
    Ok(pools)
}

pub fn exact_aliases(
    instances: &[super::commands::AgentModelInstance],
) -> BTreeMap<String, String> {
    let mut candidates: BTreeMap<String, Vec<String>> = BTreeMap::new();
    for instance in instances {
        for alias in &instance.aliases {
            candidates
                .entry(alias.clone())
                .or_default()
                .push(instance.id.clone());
        }
    }
    candidates
        .into_iter()
        .filter_map(|(alias, ids)| {
            let distinct: HashSet<_> = ids.iter().collect();
            (distinct.len() == 1).then(|| (alias, ids[0].clone()))
        })
        .collect()
}

fn project(pool: &FleetPool) -> WorkerPool {
    WorkerPool {
        id: pool.id.to_string(),
        name: pool.name.clone(),
        members: pool
            .members
            .iter()
            .map(|member| PoolMember {
                instance_id: member.instance.model_alias(),
                worker_limit: member.worker_limit,
            })
            .collect(),
    }
}

fn convert(pool: &WorkerPool, aliases: &BTreeMap<String, String>) -> Result<FleetPool, String> {
    validate(pool)?;
    let members = pool.members.iter().map(|member| {
        let id = aliases.get(&member.instance_id).unwrap_or(&member.instance_id);
        let instance = crate::core::engine_hosts::parse_alias(id)
            .map_err(|_| format!("{}: instance `{}` has no exact unique local mapping. Start its original instance or resolve the member in GInfer Server Manager; the original file is retained.", pool.name, member.instance_id))?;
        Ok(FleetPoolMember { instance, worker_limit: member.worker_limit })
    }).collect::<Result<Vec<_>, String>>()?;
    if members
        .iter()
        .map(|member| &member.instance)
        .collect::<std::collections::BTreeSet<_>>()
        .len()
        != members.len()
    {
        return Err(format!("{}: multiple legacy aliases map to the same instance; review the retained original pool.",pool.name));
    }
    Ok(FleetPool {
        id: pool
            .id
            .parse()
            .map_err(|_| format!("{}: invalid retained pool UUID", pool.name))?,
        name: pool.name.clone(),
        members,
    })
}

fn project_catalog(
    report: FleetCatalog,
    instances: &[super::commands::AgentModelInstance],
    aliases: BTreeMap<String, String>,
    migration_issues: Vec<String>,
) -> Catalog {
    let error = report.error.clone().or_else(|| {
        report
            .host_issues
            .iter()
            .find(|issue| issue.phase == FleetHostPhase::Coordinator)
            .map(|issue| {
                if issue.offline {
                    "Fleet coordinator is offline. Reconnect before using shared work pools.".into()
                } else {
                    issue.message.clone()
                }
            })
    });
    let warnings = report
        .host_issues
        .iter()
        .filter(|issue| issue.phase != FleetHostPhase::Coordinator)
        .map(|issue| {
            let name = report
                .snapshot
                .as_ref()
                .and_then(|fleet| fleet.members.iter().find(|member| member.host.host_id == issue.host_id))
                .map(|member| member.display_name.clone())
                .unwrap_or_else(|| issue.host_id.to_string());
            if issue.offline {
                format!("{name}: Offline. Fleet information will refresh when this host reconnects.")
            } else {
                format!("{name}: {}", issue.message)
            }
        })
        .collect();
    let assignment = report
        .snapshot
        .as_ref()
        .and_then(|snapshot| {
            snapshot
                .assignments
                .iter()
                .find(|assignment| Some(assignment.client_id) == report.client_id)
        })
        .cloned();
    let all_pools: Vec<_> = report
        .snapshot
        .as_ref()
        .map(|snapshot| snapshot.pools.iter().map(project).collect())
        .unwrap_or_default();
    let pools = all_pools.clone();
    let available_pool_ids = assignment
        .as_ref()
        .map(|assignment| assignment.pool_ids.iter().map(Uuid::to_string).collect());
    let mut fleet_targets = Vec::new();
    if let Some(assignment) = &assignment {
        for instance in &assignment.preferred_instances {
            let id = instance.model_alias();
            if instances.iter().any(|instance| instance.id == id) {
                fleet_targets.push(id);
            }
        }
        if fleet_targets.is_empty() {
            for host in &assignment.preferred_hosts {
                for instance in instances {
                    if crate::core::engine_hosts::parse_alias(&instance.id)
                        .is_ok_and(|reference| reference.host_id == *host)
                        && !fleet_targets.contains(&instance.id)
                    {
                        fleet_targets.push(instance.id.clone());
                    }
                }
            }
        }
        if fleet_targets.is_empty() {
            for pool_id in &assignment.pool_ids {
                for pool in &all_pools {
                    if pool.id == pool_id.to_string() {
                        for member in &pool.members {
                            if instances
                                .iter()
                                .any(|instance| instance.id == member.instance_id)
                                && !fleet_targets.contains(&member.instance_id)
                            {
                                fleet_targets.push(member.instance_id.clone());
                            }
                        }
                    }
                }
            }
        }
    }
    Catalog {
        pools,
        all_pools,
        aliases,
        assignment,
        available_pool_ids,
        fleet_targets,
        fleet_hosts: Vec::new(),
        fleet: FleetStatus {
            authority_id: report.authority.as_ref().map(|authority| authority.host_id),
            client_id: report.client_id,
            revision: report.snapshot.as_ref().map(|snapshot| snapshot.revision),
            connected: report.connected,
            error,
            migration_issues,
            warnings,
        },
    }
}

pub async fn catalog<R: Runtime>(app: &AppHandle<R>, data: &Path) -> Result<Catalog, String> {
    let client = client_for(app).await?;
    let fleet = FleetClient::new(client.clone());
    let instances = super::commands::agent_list_model_instances(app.clone(), app.state()).await?;
    let aliases = exact_aliases(&instances);
    let source = data
        .canonicalize()
        .map_err(|error| error.to_string())?
        .join("agent-worker-pools.json");
    let source_id = hex::encode(Sha256::digest(
        format!(
            "{}:{}",
            client.installation_id().await?,
            source.to_string_lossy()
        )
        .as_bytes(),
    ));
    let data = data.to_owned();
    let legacy = tokio::task::spawn_blocking(move || legacy_pools(&data))
        .await
        .map_err(|error| error.to_string())?;
    let mut issues = Vec::new();
    let legacy = match legacy {
        Ok(pools) => pools,
        Err(error) => {
            issues.push(error);
            Vec::new()
        }
    };
    let mut report = fleet.read().await?;
    let mut converted = Vec::new();
    let imported = report
        .snapshot
        .as_ref()
        .and_then(|snapshot| snapshot.legacy_imports.get(&source_id));
    for pool in &legacy {
        if imported.is_some_and(|ids| ids.iter().any(|id| id.to_string() == pool.id)) {
            continue;
        }
        match convert(pool, &aliases) {
            Ok(pool) => converted.push(pool),
            Err(error) => issues.push(error),
        }
    }
    // Adopt a registered local owner only for an exact legacy migration and only
    // Only migrate after every paired host confirmed there is no coordinator.
    if !converted.is_empty()
        && report.authority.is_none()
        && report.error.is_none()
        && report.host_issues.is_empty()
    {
        if let Some(local) = client.local_host().await? {
            if let Some(host) = client
                .registered()
                .await?
                .into_iter()
                .find(|host| host.host_id == local)
            {
                let authority = AuthorityLocator {
                    host_id: host.host_id,
                    origins: vec![host.base_url],
                    certificate_sha256: host.certificate_sha256,
                };
                match fleet.configure(local, authority).await {
                    Ok(()) => report = fleet.read().await?,
                    Err(error) => issues.push(error),
                }
            }
        }
    }
    if !converted.is_empty() && report.connected {
        let registered = client.registered().await?;
        let hosts: HashSet<_> = converted
            .iter()
            .flat_map(|pool| pool.members.iter().map(|member| member.instance.host_id))
            .collect();
        let mut rejected_hosts = HashSet::new();
        for host_id in hosts {
            if report.snapshot.as_ref().is_some_and(|snapshot| {
                snapshot
                    .members
                    .iter()
                    .any(|member| member.host.host_id == host_id)
            }) {
                continue;
            }
            let Some(host) = registered.iter().find(|host| host.host_id == host_id) else {
                issues.push(format!("Legacy pools reference host `{host_id}` that is not paired/enrolled. Pair it before migration; the original file is retained."));
                rejected_hosts.insert(host_id);
                continue;
            };
            let member = FleetMember {
                host: AuthorityLocator {
                    host_id,
                    origins: vec![host.base_url.clone()],
                    certificate_sha256: host.certificate_sha256.clone(),
                },
                display_name: host.name.clone(),
            };
            let update = FleetUpdate {
                expected_revision: report
                    .snapshot
                    .as_ref()
                    .ok_or("Fleet snapshot missing")?
                    .revision,
                operation: FleetOperation::EnrollMember { member },
            };
            match fleet.update(update).await {
                Ok(snapshot) => report.snapshot = Some(snapshot),
                Err(error) => {
                    issues.push(error);
                    rejected_hosts.insert(host_id);
                }
            }
        }
        converted.retain(|pool| {
            pool.members
                .iter()
                .all(|member| !rejected_hosts.contains(&member.instance.host_id))
        });
        if !converted.is_empty() {
            let update = FleetUpdate {
                expected_revision: report
                    .snapshot
                    .as_ref()
                    .ok_or("Fleet snapshot missing")?
                    .revision,
                operation: FleetOperation::ImportLegacyPools {
                    source_id,
                    pools: converted,
                },
            };
            match fleet.update(update).await {
                Ok(snapshot) => report.snapshot = Some(snapshot),
                Err(error) => issues.push(format!(
                    "Worker pool migration needs review: {error}. Original file retained."
                )),
            }
        }
    } else if !converted.is_empty() {
        issues.push("Legacy worker pools are retained locally until a fleet coordinator is connected; they are not an offline writable store.".into());
    }
    let mut catalog = project_catalog(report, &instances, aliases, issues);
    catalog.fleet_hosts = fleet_host_choices(&client).await?;
    Ok(catalog)
}

fn shared_origin(origin: &str) -> Option<String> {
    let url = reqwest::Url::parse(origin).ok()?;
    if url.scheme() != "https"
        || !url.username().is_empty()
        || url.password().is_some()
        || url.path() != "/"
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return None;
    }
    let host = url.host_str()?.trim_end_matches('.').to_ascii_lowercase();
    if host == "localhost" || host.ends_with(".localhost") {
        return None;
    }
    if let Ok(ip) = host.trim_matches(['[', ']']).parse::<std::net::IpAddr>() {
        if ip.is_loopback()
            || ip.is_unspecified()
            || matches!(ip,std::net::IpAddr::V6(ip) if ip.to_ipv4_mapped().is_some_and(|ip|ip.is_loopback() || ip.is_unspecified()))
        {
            return None;
        }
    }
    Some(origin.trim_end_matches('/').to_owned())
}

async fn fleet_host_choices(
    client: &ginfer_host::client::Client,
) -> Result<Vec<FleetHostChoice>, String> {
    let list = client.command("list", serde_json::json!({})).await?;
    let discovered = list["discovered"]
        .as_array()
        .ok_or("Invalid shared host discovery response")?;
    Ok(client
        .registered()
        .await?
        .into_iter()
        .map(|host| {
            let mut origins: Vec<_> = discovered
                .iter()
                .filter(|known| {
                    known["host_id"].as_str() == Some(host.host_id.to_string().as_str())
                })
                .flat_map(|known| known["urls"].as_array().into_iter().flatten())
                .filter_map(serde_json::Value::as_str)
                .filter_map(shared_origin)
                .collect();
            if let Some(origin) = shared_origin(&host.base_url) {
                if !origins.contains(&origin) {
                    origins.push(origin);
                }
            }
            FleetHostChoice {
                id: host.host_id,
                name: host.name,
                origins,
            }
        })
        .collect())
}

pub async fn configure<R: Runtime>(
    app: &AppHandle<R>,
    host_id: Uuid,
    origin: Option<String>,
) -> Result<(), String> {
    let client = client_for(app).await?;
    let fleet = FleetClient::new(client.clone());
    if fleet.read().await?.authority.is_some() {
        return Err("A fleet coordinator is already published. Refresh and use that fleet; change its authority explicitly in GInfer Server Manager.".into());
    }
    let host = client
        .registered()
        .await?
        .into_iter()
        .find(|host| host.host_id == host_id)
        .ok_or("Choose a registered host as fleet coordinator")?;
    let origins = if let Some(origin) = origin {
        vec![shared_origin(origin.trim()).ok_or("Enter this coordinator's reachable HTTPS address; a loopback address cannot be shared with other computers.")?]
    } else {
        fleet_host_choices(&client)
            .await?
            .into_iter()
            .find(|choice| choice.id == host_id)
            .map(|choice| choice.origins)
            .unwrap_or_default()
    };
    if origins.is_empty() {
        return Err("This host has no advertised LAN address. Enable Share this host and discovery, or enter its reachable HTTPS coordinator address before creating shared pools.".into());
    }
    let token = client.secret(host.client_id).await?;
    let mut verified = Vec::new();
    for origin in origins {
        if ginfer_host::transport::host_snapshot_at(
            &origin,
            &host.certificate_sha256,
            &token,
            host_id,
        )
        .await
        .is_ok()
        {
            verified.push(origin);
        }
    }
    if verified.is_empty() {
        return Err("The coordinator address is unreachable or does not match the paired host's identity and certificate. Check its shared HTTPS address.".into());
    }
    fleet
        .configure(
            host_id,
            AuthorityLocator {
                host_id,
                origins: verified,
                certificate_sha256: host.certificate_sha256,
            },
        )
        .await
}

pub async fn save<R: Runtime>(
    app: &AppHandle<R>,
    pool: WorkerPool,
    expected_revision: u64,
) -> Result<WorkerPool, String> {
    let mut pool = pool;
    if pool.id.is_empty() {
        pool.id = Uuid::new_v4().to_string();
    }
    let converted = convert(&pool, &BTreeMap::new())?;
    let fleet = FleetClient::new(client_for(app).await?);
    let snapshot = fleet
        .update(FleetUpdate {
            expected_revision,
            operation: FleetOperation::SavePool { pool: converted },
        })
        .await?;
    snapshot
        .pools
        .iter()
        .find(|saved| saved.id.to_string() == pool.id)
        .map(project)
        .ok_or_else(|| "Saved fleet pool missing".into())
}

pub async fn remove<R: Runtime>(
    app: &AppHandle<R>,
    id: &str,
    expected_revision: u64,
) -> Result<(), String> {
    let fleet = FleetClient::new(client_for(app).await?);
    fleet
        .update(FleetUpdate {
            expected_revision,
            operation: FleetOperation::DeletePool {
                pool_id: id.parse().map_err(|error: uuid::Error| error.to_string())?,
            },
        })
        .await?;
    Ok(())
}

async fn client_for<R: Runtime>(
    app: &AppHandle<R>,
) -> Result<Arc<ginfer_host::client::Client>, String> {
    #[cfg(test)]
    if let Some(client) = app.try_state::<Arc<ginfer_host::client::Client>>() {
        return Ok(client.inner().clone());
    }
    crate::core::engine_hosts::initialize(app).await?;
    crate::core::engine_hosts::shared_client().await
}

#[derive(Debug, Clone)]
pub struct Candidate {
    pub instance_id: String,
    pub session_id: String,
    pub concurrency: u32,
    pub worker_limit: u32,
    pub vision: bool,
    pub context: u32,
}

#[derive(Default)]
pub struct Allocator {
    active: Mutex<HashMap<String, u32>>,
    pub changed: Notify,
}

pub struct WorkerLease {
    allocator: Arc<Allocator>,
    pub candidate: Candidate,
}

impl Drop for WorkerLease {
    fn drop(&mut self) {
        if let Ok(mut active) = self.allocator.active.lock() {
            if let Some(count) = active.get_mut(&self.candidate.instance_id) {
                *count = count.saturating_sub(1);
                if *count == 0 {
                    active.remove(&self.candidate.instance_id);
                }
            }
        }
        self.allocator.changed.notify_waiters();
    }
}

impl Allocator {
    pub fn shared() -> Arc<Self> {
        static ALLOCATOR: OnceLock<Arc<Allocator>> = OnceLock::new();
        ALLOCATOR.get_or_init(|| Arc::new(Self::default())).clone()
    }

    pub fn usage(&self) -> HashMap<String, u32> {
        self.active.lock().expect("worker accounting lock").clone()
    }

    pub fn try_acquire(
        self: &Arc<Self>,
        candidates: &[Candidate],
        requirement: &RoleAssignment,
        affinity: Option<(&str, &str)>,
    ) -> Option<WorkerLease> {
        let mut active = self.active.lock().ok()?;
        let candidate = candidates
            .iter()
            .filter(|c| {
                let used = active.get(&c.instance_id).copied().unwrap_or(0);
                let limit = c.concurrency.min(c.worker_limit);
                limit > used
                    && (!requirement.vision || c.vision)
                    && c.context >= requirement.minimum_context
                    && affinity.map_or(true, |(id, session)| {
                        c.instance_id == id && c.session_id == session
                    })
            })
            .min_by(|a, b| {
                let au = active.get(&a.instance_id).copied().unwrap_or(0);
                let bu = active.get(&b.instance_id).copied().unwrap_or(0);
                // Compare utilization without rounding; preserve member order on ties.
                (au * b.concurrency.min(b.worker_limit))
                    .cmp(&(bu * a.concurrency.min(a.worker_limit)))
            })?
            .clone();
        *active.entry(candidate.instance_id.clone()).or_default() += 1;
        Some(WorkerLease {
            allocator: self.clone(),
            candidate,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn candidate(id: &str) -> Candidate {
        Candidate {
            instance_id: id.into(),
            session_id: "session".into(),
            concurrency: 1,
            worker_limit: 1,
            vision: false,
            context: 8192,
        }
    }
    #[test]
    fn overlapping_pools_share_capacity_and_drop_releases() {
        let allocator = Arc::new(Allocator::default());
        let a = candidate("a");
        let b = candidate("b");
        let first = allocator
            .try_acquire(std::slice::from_ref(&a), &RoleAssignment::default(), None)
            .unwrap();
        let second = allocator
            .try_acquire(&[a.clone(), b], &RoleAssignment::default(), None)
            .unwrap();
        assert_eq!(second.candidate.instance_id, "b");
        assert!(allocator
            .try_acquire(std::slice::from_ref(&a), &RoleAssignment::default(), None)
            .is_none());
        drop(first);
        assert!(allocator
            .try_acquire(&[a], &RoleAssignment::default(), None)
            .is_some());
    }
    #[test]
    fn capability_and_exact_session_affinity_are_enforced() {
        let allocator = Arc::new(Allocator::default());
        let mut c = candidate("vision");
        let requirement = RoleAssignment {
            vision: true,
            minimum_context: 16000,
            ..Default::default()
        };
        assert!(allocator
            .try_acquire(&[c.clone()], &requirement, None)
            .is_none());
        c.vision = true;
        c.context = 32768;
        assert!(allocator
            .try_acquire(&[c.clone()], &requirement, Some(("vision", "old")))
            .is_none());
        assert!(allocator
            .try_acquire(&[c], &requirement, Some(("vision", "session")))
            .is_some());
    }
    #[tokio::test]
    async fn first_local_coordinator_requires_and_publishes_a_reachable_shared_address() {
        use super::super::test_support::TestFleet;
        use crate::test_support::TestDataRoot;
        let coordinator = TestFleet::unconfigured_shared().await;
        let member = TestFleet::unconfigured().await;
        let host_id = coordinator.host.data.lock().await.host_id;
        let data = tempfile::tempdir().unwrap();
        let app = tauri::test::mock_builder()
            .manage(TestDataRoot(data.path().to_owned()))
            .manage(tauri_plugin_ginfer::state::GinferState::default())
            .manage(coordinator.client.clone())
            .build(tauri::test::mock_context(tauri::test::noop_assets()))
            .unwrap();
        assert!(configure(app.handle(), host_id, None)
            .await
            .unwrap_err()
            .contains("no advertised LAN address"));
        assert!(
            configure(app.handle(), host_id, Some(coordinator.origin.clone()))
                .await
                .unwrap_err()
                .contains("loopback")
        );
        assert!(coordinator
            .host
            .data
            .lock()
            .await
            .fleet
            .authority()
            .is_none());
        let routing = std::net::UdpSocket::bind("0.0.0.0:0").unwrap();
        routing.connect("192.0.2.1:9").unwrap();
        let address = routing.local_addr().unwrap().ip();
        assert!(!address.is_loopback() && !address.is_unspecified());
        let port = reqwest::Url::parse(&coordinator.origin)
            .unwrap()
            .port()
            .unwrap();
        let shared = format!("https://{address}:{port}");
        configure(app.handle(), host_id, Some(shared.clone()))
            .await
            .unwrap();
        let service = FleetClient::new(coordinator.client.clone());
        let initial = service.read().await.unwrap().snapshot.unwrap();
        assert_eq!(initial.authority.origins, vec![shared.clone()]);
        coordinator.register(&member).await;
        let member_id = member.host.data.lock().await.host_id;
        let pool = FleetPool {
            id: Uuid::new_v4(),
            name: "coder".into(),
            members: vec![FleetPoolMember {
                instance: ginfer_host::engine_registry::InstanceRef {
                    host_id: member_id,
                    instance_id: Uuid::new_v4(),
                },
                worker_limit: 1,
            }],
        };
        service
            .update(FleetUpdate {
                expected_revision: initial.revision,
                operation: FleetOperation::SavePool { pool: pool.clone() },
            })
            .await
            .unwrap();
        let joining = member.independent_client().await;
        let report = FleetClient::new(joining.clone()).read().await.unwrap();
        assert!(report.connected, "{:?}", report.error);
        assert_eq!(report.snapshot.unwrap().pools, vec![pool]);
        assert_eq!(
            joining
                .registered()
                .await
                .unwrap()
                .into_iter()
                .find(|host| host.host_id == host_id)
                .unwrap()
                .base_url,
            shared
        );
    }

    #[tokio::test]
    async fn delayed_discovery_and_reads_preserve_another_clients_explicit_authority() {
        use super::super::test_support::TestFleet;
        for established in [false, true] {
            let a = TestFleet::start().await;
            let b = TestFleet::start().await;
            let observing = a.independent_client().await;
            let original = FleetClient::new(a.client.clone())
                .read()
                .await
                .unwrap()
                .authority
                .unwrap();
            if established {
                observing.set_fleet_authority(original).await.unwrap();
            }
            a.pause_fleet_reads();
            let read = FleetClient::new(observing.clone());
            let select = async {
                a.wait_for_fleet_read().await;
                a.register(&b).await;
                let other = a.independent_client().await;
                other
                    .import_legacy(&b.directory.path().join("paired-hosts.json"))
                    .await
                    .unwrap();
                let selected = FleetClient::new(b.client.clone())
                    .read()
                    .await
                    .unwrap()
                    .authority
                    .unwrap();
                other.set_fleet_authority(selected.clone()).await.unwrap();
                a.resume_fleet_reads();
                selected
            };
            let (report, selected) =
                tokio::time::timeout(std::time::Duration::from_secs(2), async {
                    tokio::join!(read.read(), select)
                })
                .await
                .expect("delayed discovery must finish after the explicit selection");
            if established {
                assert!(report.err().unwrap().contains("selection changed"));
            } else {
                let report = report.unwrap();
                assert!(report.connected, "{:?}", report.error);
                assert_eq!(report.snapshot.unwrap().authority, selected);
            }
            assert_eq!(
                observing.fleet_authority().await.unwrap(),
                Some(selected.clone())
            );
            let report = FleetClient::new(observing.clone()).read().await.unwrap();
            assert!(report.connected);
            assert_eq!(report.snapshot.unwrap().authority, selected);
            assert_eq!(
                b.host.data.lock().await.clients.len(),
                1,
                "an already registered selected coordinator must not issue a new grant"
            );
        }
    }

    #[tokio::test]
    async fn pairing_a_member_discovers_coder_pool_and_member_knows_its_projection() {
        use super::super::test_support::TestFleet;
        let coordinator = TestFleet::start().await;
        let member = TestFleet::unconfigured().await;
        coordinator.register(&member).await;
        let member_id = member.host.data.lock().await.host_id;
        let instance = ginfer_host::engine_registry::InstanceRef {
            host_id: member_id,
            instance_id: Uuid::new_v4(),
        };
        let service = FleetClient::new(coordinator.client.clone());
        let before = service.read().await.unwrap();
        let pool = FleetPool {
            id: Uuid::new_v4(),
            name: "coder".into(),
            members: vec![FleetPoolMember {
                instance: instance.clone(),
                worker_limit: 2,
            }],
        };
        let written = service
            .update(FleetUpdate {
                expected_revision: before.snapshot.unwrap().revision,
                operation: FleetOperation::SavePool { pool: pool.clone() },
            })
            .await
            .unwrap();
        assert_eq!(written.pools, vec![pool.clone()]);
        let state = member.host.data.lock().await;
        assert_eq!(
            state.fleet.authority().unwrap().host_id,
            written.authority.host_id
        );
        assert_eq!(
            state.fleet_membership.as_ref().unwrap().pools,
            vec![pool.clone()]
        );
        drop(state);
        // Editing this coordinator's published origins retains its built pools,
        // and members publish the refreshed address to a newly paired client.
        let mut published = written.authority.clone();
        published.origins = vec![coordinator.origin.replace("127.0.0.1", "localhost")];
        service
            .configure(published.host_id, published.clone())
            .await
            .unwrap();
        let refreshed = service.read().await.unwrap().snapshot.unwrap();
        assert_eq!(refreshed.authority, published);
        assert_eq!(refreshed.pools, vec![pool.clone()]);
        assert!(refreshed.revision > written.revision);
        assert_eq!(
            member.host.data.lock().await.fleet.authority(),
            Some(&published)
        );
        let client_b = member.independent_client().await;
        let b = FleetClient::new(client_b.clone()).read().await.unwrap();
        assert!(b.connected, "{:?}", b.error);
        assert_eq!(b.snapshot.as_ref().unwrap().pools, vec![pool.clone()]);
        assert_eq!(b.snapshot.as_ref().unwrap().revision, refreshed.revision);
        assert_eq!(
            client_b
                .registered()
                .await
                .unwrap()
                .into_iter()
                .find(|host| host.host_id == published.host_id)
                .unwrap()
                .base_url,
            published.origins[0]
        );
        assert_ne!(
            b.client_id, before.client_id,
            "different devices receive different coordinator grants"
        );
        service
            .update(FleetUpdate {
                expected_revision: refreshed.revision,
                operation: FleetOperation::SetClientAssignment {
                    assignment: ClientAssignment {
                        client_id: b.client_id.unwrap(),
                        pool_ids: vec![],
                        preferred_hosts: vec![],
                        preferred_instances: vec![instance],
                    },
                },
            })
            .await
            .unwrap();
        let app = tauri::test::mock_builder()
            .manage(tauri_plugin_ginfer::state::GinferState::default())
            .manage(client_b)
            .build(tauri::test::mock_context(tauri::test::noop_assets()))
            .unwrap();
        let data = tempfile::tempdir().unwrap();
        let catalog = catalog(app.handle(), data.path()).await.unwrap();
        assert_eq!(
            catalog.pools[0].id,
            pool.id.to_string(),
            "unassigned shared definitions remain visible"
        );
        assert_eq!(catalog.available_pool_ids, Some(Vec::new()));
        assert!(catalog
            .validate_assignments(&BTreeMap::from([(
                "agent".into(),
                RoleAssignment {
                    target: WorkerTarget::Pool {
                        id: pool.id.to_string()
                    },
                    ..Default::default()
                }
            )]))
            .is_err());
        let emptied = service
            .update(FleetUpdate {
                expected_revision: catalog.fleet.revision.unwrap(),
                operation: FleetOperation::DeletePool { pool_id: pool.id },
            })
            .await
            .unwrap();
        assert!(member
            .host
            .data
            .lock()
            .await
            .fleet_membership
            .as_ref()
            .unwrap()
            .pools
            .is_empty());
        service
            .update(FleetUpdate {
                expected_revision: emptied.revision,
                operation: FleetOperation::SetClientAssignment {
                    assignment: ClientAssignment {
                        client_id: b.client_id.unwrap(),
                        pool_ids: vec![],
                        preferred_hosts: vec![],
                        preferred_instances: vec![],
                    },
                },
            })
            .await
            .unwrap();
        let fresh = service.read().await.unwrap().snapshot.unwrap();
        service
            .update(FleetUpdate {
                expected_revision: fresh.revision,
                operation: FleetOperation::RemoveMember { host_id: member_id },
            })
            .await
            .unwrap();
        assert!(member
            .host
            .data
            .lock()
            .await
            .fleet_membership
            .as_ref()
            .unwrap()
            .assignments
            .is_empty());
    }

    #[tokio::test]
    async fn legacy_migration_waits_for_an_offline_paired_host_before_choosing_a_coordinator() {
        use super::super::test_support::TestFleet;
        use tauri_plugin_ginfer::state::{GinferSession, GinferState, SessionInfo, SessionOwner};
        let local = TestFleet::unconfigured().await;
        let remote = TestFleet::unconfigured().await;
        local.register(&remote).await;
        remote.stop();
        tokio::task::yield_now().await;
        let config = tempfile::tempdir().unwrap();
        let key = if cfg!(windows) { "APPDATA" } else { "XDG_CONFIG_HOME" };
        struct RestoreEnvironment(&'static str, Option<std::ffi::OsString>);
        impl Drop for RestoreEnvironment {
            fn drop(&mut self) {
                match &self.1 {
                    Some(value) => std::env::set_var(self.0, value),
                    None => std::env::remove_var(self.0),
                }
            }
        }
        let _environment = RestoreEnvironment(key, std::env::var_os(key));
        std::env::set_var(key, config.path());
        let locator = ginfer_host::local_host_registry::locator_path().unwrap();
        std::fs::create_dir_all(locator.parent().unwrap()).unwrap();
        std::fs::write(&locator, serde_json::to_vec(&serde_json::json!({
            "schema": "ginfer-local-host-v1",
            "owner": { "mode": "service", "directory": local.directory.path().join("host"), "origin": local.origin }
        })).unwrap()).unwrap();
        let control = Arc::new(ginfer_host::launcher::LocalControl::open(
            &local.directory.path().join("host"), &local.origin).unwrap());
        let instance_id = Uuid::new_v4();
        let ginfer = GinferState::default();
        let info: SessionInfo = serde_json::from_value(serde_json::json!({
            "pid": 1, "port": 10000, "model_id": "legacy-model", "model_path": "fixture.ginfer",
            "is_embedding": false, "vision": false, "api_key": "", "max_concurrency": 1, "max_context": 8192
        })).unwrap();
        ginfer.ginfer_process.lock().await.insert(1, GinferSession {
            info, endpoint: None,
            owner: SessionOwner { control, connection: ginfer_host::launcher::LocalConnection {
                instance_id, session_id: Uuid::new_v4(), model_id: "legacy-model".into(), port: 10000, api_key: String::new()
            } }
        });
        let app = tauri::test::mock_builder().manage(ginfer).manage(local.client.clone())
            .build(tauri::test::mock_context(tauri::test::noop_assets())).unwrap();
        let data = tempfile::tempdir().unwrap();
        let legacy = vec![WorkerPool { id: Uuid::new_v4().to_string(), name: "coder".into(),
            members: vec![PoolMember { instance_id: "legacy-model".into(), worker_limit: 1 }] }];
        let original = serde_json::to_vec(&legacy).unwrap();
        std::fs::write(data.path().join("agent-worker-pools.json"), &original).unwrap();
        let catalog = catalog(app.handle(), data.path()).await.unwrap();
        assert!(catalog.fleet.authority_id.is_none());
        assert!(!catalog.fleet.connected);
        assert!(catalog.pools.is_empty());
        assert!(catalog.fleet.warnings.iter().any(|warning| warning.contains("Offline")));
        assert!(local.host.data.lock().await.fleet.authority().is_none());
        assert!(local.client.fleet_authority().await.unwrap().is_none());
        assert_eq!(std::fs::read(data.path().join("agent-worker-pools.json")).unwrap(), original);
    }

    #[tokio::test]
    async fn real_shared_fleet_migrates_preserves_receipts_and_reports_offline() {
        use super::super::test_support::TestFleet;
        use tauri_plugin_ginfer::state::{GinferSession, GinferState, SessionInfo, SessionOwner};
        let fixture = TestFleet::start().await;
        let control = Arc::new(
            ginfer_host::launcher::LocalControl::open(
                &fixture.directory.path().join("host"),
                &fixture.origin,
            )
            .unwrap(),
        );
        let instance = ginfer_host::engine_registry::InstanceRef {
            host_id: control.host_id(),
            instance_id: Uuid::new_v4(),
        };
        let ginfer = GinferState::default();
        let info:SessionInfo=serde_json::from_value(serde_json::json!({"pid":1,"port":10000,"model_id":"legacy-model","model_path":"fixture.ginfer",
            "is_embedding":false,"vision":true,"api_key":"","max_concurrency":3,"max_context":32768})).unwrap();
        ginfer.ginfer_process.lock().await.insert(
            1,
            GinferSession {
                info,
                endpoint: None,
                owner: SessionOwner {
                    control,
                    connection: ginfer_host::launcher::LocalConnection {
                        instance_id: instance.instance_id,
                        session_id: Uuid::new_v4(),
                        model_id: "legacy-model".into(),
                        port: 10000,
                        api_key: String::new(),
                    },
                },
            },
        );
        let app = tauri::test::mock_builder()
            .manage(ginfer)
            .manage(fixture.client.clone())
            .build(tauri::test::mock_context(tauri::test::noop_assets()))
            .unwrap();
        let data = tempfile::tempdir().unwrap();
        let legacy = vec![
            WorkerPool {
                id: Uuid::new_v4().to_string(),
                name: "coder".into(),
                members: vec![PoolMember {
                    instance_id: "legacy-model".into(),
                    worker_limit: 1,
                }],
            },
            WorkerPool {
                id: Uuid::new_v4().to_string(),
                name: "unresolved".into(),
                members: vec![PoolMember {
                    instance_id: "missing-model".into(),
                    worker_limit: 2,
                }],
            },
        ];
        let original = serde_json::to_vec(&legacy).unwrap();
        std::fs::write(data.path().join("agent-worker-pools.json"), &original).unwrap();
        let first = catalog(app.handle(), data.path()).await.unwrap();
        assert_eq!(first.pools.len(), 1);
        assert_eq!(first.pools[0].id, legacy[0].id);
        assert_eq!(
            first.pools[0].members[0].instance_id,
            instance.model_alias()
        );
        assert_eq!(first.pools[0].members[0].worker_limit, 1);
        assert!(first
            .fleet
            .migration_issues
            .iter()
            .any(|issue| issue.contains("missing-model")));
        assert_eq!(
            std::fs::read(data.path().join("agent-worker-pools.json")).unwrap(),
            original
        );
        let other = FleetClient::new(fixture.second_client());
        let same = other.read().await.unwrap();
        assert_eq!(
            same.snapshot.as_ref().unwrap().pools[0].id.to_string(),
            legacy[0].id
        );
        assert_eq!(same.client_id, first.fleet.client_id);
        let revision = first.fleet.revision.unwrap();
        let mut edited = first.pools[0].clone();
        edited.members[0].worker_limit = 2;
        save(app.handle(), edited.clone(), revision).await.unwrap();
        assert_eq!(
            other.read().await.unwrap().snapshot.unwrap().pools[0].members[0].worker_limit,
            2
        );
        assert!(save(app.handle(), edited, revision)
            .await
            .unwrap_err()
            .contains("409"));
        let fresh = catalog(app.handle(), data.path()).await.unwrap();
        remove(app.handle(), &legacy[0].id, fresh.fleet.revision.unwrap())
            .await
            .unwrap();
        assert!(
            catalog(app.handle(), data.path())
                .await
                .unwrap()
                .pools
                .is_empty(),
            "retained input must not resurrect deleted imported pools"
        );
        let reopened = ginfer_host::service::Host::open(
            fixture.directory.path().join("host"),
            "Fixture".into(),
            std::env::current_exe().unwrap(),
            vec![],
            vec![],
            vec![],
        )
        .await
        .unwrap();
        let persisted = reopened.data.lock().await.fleet.clone();
        let ginfer_host::fleet::FleetView::Coordinator { fleet: persisted } = persisted else {
            panic!("persisted authority")
        };
        assert!(persisted.pools.is_empty());
        assert!(persisted
            .legacy_imports
            .values()
            .any(|ids| ids.iter().any(|id| id.to_string() == legacy[0].id)));
        fixture.stop();
        tokio::task::yield_now().await;
        let offline = catalog(app.handle(), data.path()).await.unwrap();
        assert!(!offline.fleet.connected);
        assert!(offline.fleet.error.is_some());
        assert!(offline
            .validate_assignments(&BTreeMap::from([(
                "agent".into(),
                RoleAssignment {
                    target: WorkerTarget::Pool {
                        id: legacy[0].id.clone()
                    },
                    ..Default::default()
                }
            )]))
            .is_err());
        assert!(offline
            .validate_assignments(&BTreeMap::from([(
                "agent".into(),
                RoleAssignment::default()
            )]))
            .is_ok());
    }
}
