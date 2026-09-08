//! Agent worker placement and process-wide slot accounting.
//! A pool never loads models and never owns a remote workspace.
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashMap, HashSet};
use std::path::Path;
use std::sync::{Arc, Mutex, OnceLock};
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

static STORE_LOCK: Mutex<()> = Mutex::new(());

pub fn list(data: &Path) -> Result<Vec<WorkerPool>, String> {
    let _guard = STORE_LOCK.lock().map_err(|e| e.to_string())?;
    read(data)
}

fn read(data: &Path) -> Result<Vec<WorkerPool>, String> {
    let path = data.join("agent-worker-pools.json");
    if !path.exists() {
        return Ok(Vec::new());
    }
    let pools: Vec<WorkerPool> =
        serde_json::from_slice(&std::fs::read(path).map_err(|e| e.to_string())?)
            .map_err(|e| format!("Invalid worker pool store: {e}"))?;
    for pool in &pools {
        validate(pool)?;
    }
    Ok(pools)
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

pub fn save(data: &Path, mut pool: WorkerPool) -> Result<WorkerPool, String> {
    validate(&pool)?;
    let _guard = STORE_LOCK.lock().map_err(|e| e.to_string())?;
    let mut pools = read(data)?;
    if pool.id.is_empty() {
        pool.id = Uuid::new_v4().to_string();
    }
    if Uuid::parse_str(&pool.id).is_err() {
        return Err("Invalid worker pool ID".into());
    }
    pool.name = pool.name.trim().into();
    if let Some(existing) = pools.iter_mut().find(|p| p.id == pool.id) {
        *existing = pool.clone();
    } else {
        if pools.len() >= 128 {
            return Err("Worker pool limit reached".into());
        }
        pools.push(pool.clone());
    }
    write(data, &pools)?;
    Ok(pool)
}

pub fn remove(data: &Path, id: &str) -> Result<(), String> {
    let _guard = STORE_LOCK.lock().map_err(|e| e.to_string())?;
    let mut pools = read(data)?;
    pools.retain(|p| p.id != id);
    write(data, &pools)
}

fn write(data: &Path, pools: &[WorkerPool]) -> Result<(), String> {
    std::fs::create_dir_all(data).map_err(|e| e.to_string())?;
    super::storage::atomic_write(
        &data.join("agent-worker-pools.json"),
        &serde_json::to_vec_pretty(pools).map_err(|e| e.to_string())?,
        "Worker pools",
    )
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
                    && affinity
                        .is_none_or(|(id, session)| c.instance_id == id && c.session_id == session)
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
            .try_acquire(&[a.clone()], &RoleAssignment::default(), None)
            .unwrap();
        let second = allocator
            .try_acquire(&[a.clone(), b], &RoleAssignment::default(), None)
            .unwrap();
        assert_eq!(second.candidate.instance_id, "b");
        assert!(allocator
            .try_acquire(&[a.clone()], &RoleAssignment::default(), None)
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
    #[test]
    fn persisted_membership_is_explicit_and_validated() {
        let dir = tempfile::tempdir().unwrap();
        let pool = save(
            dir.path(),
            WorkerPool {
                id: String::new(),
                name: "Workers".into(),
                members: vec![PoolMember {
                    instance_id: "offline-host-instance".into(),
                    worker_limit: 2,
                }],
            },
        )
        .unwrap();
        assert_eq!(list(dir.path()).unwrap(), vec![pool.clone()]);
        let mut duplicate = pool.clone();
        duplicate.members.push(duplicate.members[0].clone());
        assert!(save(dir.path(), duplicate).is_err());
        remove(dir.path(), &pool.id).unwrap();
        assert!(list(dir.path()).unwrap().is_empty());
    }
}
