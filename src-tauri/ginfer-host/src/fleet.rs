//! One host-owned fleet catalog. Member hosts retain only its pinned locator.
use crate::engine_registry::InstanceRef;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};
use uuid::Uuid;

pub const FLEET_SCHEMA: &str = "ginfer-fleet-v1";
pub const MEMBERSHIP_SCHEMA: &str = "ginfer-fleet-membership-v1";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AuthorityLocator {
    pub host_id: Uuid,
    pub origins: Vec<String>,
    pub certificate_sha256: String,
}

impl AuthorityLocator {
    pub fn validate(&self) -> Result<(), String> {
        if self.host_id.is_nil() || self.origins.is_empty() || self.origins.len() > 16 {
            return Err("A fleet host needs its identity and 1–16 HTTPS origins".into());
        }
        let mut origins = BTreeSet::new();
        for origin in &self.origins {
            let url = reqwest::Url::parse(origin).map_err(|error| error.to_string())?;
            if url.scheme() != "https"
                || url.host_str().is_none()
                || !url.username().is_empty()
                || url.password().is_some()
                || url.path() != "/"
                || url.query().is_some()
                || url.fragment().is_some()
                || url.port() == Some(0)
                || !origins.insert(url.to_string())
            {
                return Err("Fleet host origins must be distinct HTTPS origins".into());
            }
        }
        if hex::decode(&self.certificate_sha256)
            .map_err(|_| "Invalid fleet certificate fingerprint")?
            .len()
            != 32
        {
            return Err("A fleet certificate fingerprint must contain 32 bytes".into());
        }
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct FleetMember {
    pub host: AuthorityLocator,
    pub display_name: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct FleetPoolMember {
    pub instance: InstanceRef,
    pub worker_limit: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct FleetPool {
    pub id: Uuid,
    pub name: String,
    /// Explicit order remains the allocator's tie breaker.
    pub members: Vec<FleetPoolMember>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ClientAssignment {
    /// Grant issued by the coordinator, independently of each member-host grant.
    pub client_id: Uuid,
    pub pool_ids: Vec<Uuid>,
    #[serde(default)]
    pub preferred_hosts: Vec<Uuid>,
    #[serde(default)]
    pub preferred_instances: Vec<InstanceRef>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct FleetSnapshot {
    pub schema: String,
    pub authority: AuthorityLocator,
    /// Durable configuration revision, independent of host boot/health counters.
    pub revision: u64,
    pub members: Vec<FleetMember>,
    pub pools: Vec<FleetPool>,
    pub assignments: Vec<ClientAssignment>,
    /// Opaque stable source hashes and completed UUIDs, including deleted pools.
    #[serde(default)]
    pub legacy_imports: BTreeMap<String, Vec<Uuid>>,
}

/// Read-only host projection; it cannot be used as a fleet catalog or allocator.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct HostMembershipProjection {
    pub schema: String,
    pub authority: AuthorityLocator,
    pub host_id: Uuid,
    pub revision: u64,
    pub pools: Vec<FleetPool>,
    pub assignments: Vec<ClientAssignment>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MembershipView {
    pub authority: Option<AuthorityLocator>,
    pub membership: Option<HostMembershipProjection>,
    /// Coordinator projections are derived from the canonical document on read.
    pub coordinator: bool,
}

impl HostMembershipProjection {
    pub fn validate(&self) -> Result<(), String> {
        self.authority.validate()?;
        if self.schema != MEMBERSHIP_SCHEMA || self.host_id.is_nil() || self.revision == 0 {
            return Err("Unsupported host membership identity, schema or revision".into());
        }
        validate_placement(
            &self.pools,
            &self.assignments,
            &BTreeSet::from([self.host_id]),
        )?;
        Ok(())
    }

    pub fn matches_authority(&self, authority: &AuthorityLocator) -> bool {
        self.authority.host_id == authority.host_id
            && self.authority.certificate_sha256 == authority.certificate_sha256
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum FleetView {
    #[default]
    Unconfigured,
    Coordinator {
        fleet: FleetSnapshot,
    },
    Member {
        authority: AuthorityLocator,
    },
}

/// The persisted and public forms are identical and contain no credentials.
pub type FleetState = FleetView;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct FleetUpdate {
    pub expected_revision: u64,
    #[serde(flatten)]
    pub operation: FleetOperation,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "operation", rename_all = "snake_case", deny_unknown_fields)]
pub enum FleetOperation {
    SavePool {
        pool: FleetPool,
    },
    DeletePool {
        pool_id: Uuid,
    },
    SetClientAssignment {
        assignment: ClientAssignment,
    },
    EnrollMember {
        member: FleetMember,
    },
    RemoveMember {
        host_id: Uuid,
    },
    ImportLegacyPools {
        source_id: String,
        pools: Vec<FleetPool>,
    },
}

#[derive(Debug, PartialEq, Eq)]
pub enum FleetError {
    Conflict { current_revision: u64 },
    NotCoordinator,
    Invalid(String),
}

fn name_valid(name: &str) -> bool {
    !name.trim().is_empty() && name.chars().count() <= 80
}

fn unique<T: Ord>(values: impl IntoIterator<Item = T>) -> bool {
    let mut seen = BTreeSet::new();
    values.into_iter().all(|value| seen.insert(value))
}

fn validate_placement(
    pool_list: &[FleetPool],
    assignments: &[ClientAssignment],
    hosts: &BTreeSet<Uuid>,
) -> Result<(), String> {
    if pool_list.len() > 128 || !unique(pool_list.iter().map(|pool| pool.id)) {
        return Err("Fleet supports up to 128 distinct pools".into());
    }
    for pool in pool_list {
        if pool.id.is_nil()
            || !name_valid(&pool.name)
            || pool.members.is_empty()
            || pool.members.len() > 64
            || !unique(pool.members.iter().map(|member| &member.instance))
        {
            return Err("Pool needs a UUID, a name and 1–64 distinct ordered instances".into());
        }
        for member in &pool.members {
            if !hosts.contains(&member.instance.host_id)
                || member.instance.instance_id.is_nil()
                || !(1..=8).contains(&member.worker_limit)
            {
                return Err("Pool instances must belong to enrolled hosts with worker limits between 1 and 8".into());
            }
        }
    }
    let pools: BTreeSet<_> = pool_list.iter().map(|pool| pool.id).collect();
    if !unique(assignments.iter().map(|assignment| assignment.client_id)) {
        return Err("Fleet client assignments must be distinct".into());
    }
    for assignment in assignments {
        if assignment.client_id.is_nil()
            || !unique(assignment.pool_ids.iter())
            || !unique(assignment.preferred_hosts.iter())
            || !unique(assignment.preferred_instances.iter())
            || assignment.pool_ids.iter().any(|id| !pools.contains(id))
            || assignment
                .preferred_hosts
                .iter()
                .any(|id| !hosts.contains(id))
            || assignment
                .preferred_instances
                .iter()
                .any(|instance| !hosts.contains(&instance.host_id) || instance.instance_id.is_nil())
        {
            return Err(
                "Client placement must use distinct existing pools and enrolled hosts/instances"
                    .into(),
            );
        }
    }
    Ok(())
}

impl FleetSnapshot {
    /// Project identities/configuration only, never remote inference credentials.
    pub fn membership(&self, host_id: Uuid) -> Result<HostMembershipProjection, String> {
        self.validate()?;
        if host_id.is_nil() {
            return Err("Host membership needs a valid host identity".into());
        }
        let pools: Vec<_> = self
            .pools
            .iter()
            .filter_map(|pool| {
                let members: Vec<_> = pool
                    .members
                    .iter()
                    .filter(|member| member.instance.host_id == host_id)
                    .cloned()
                    .collect();
                (!members.is_empty()).then(|| FleetPool {
                    members,
                    ..pool.clone()
                })
            })
            .collect();
        let pool_ids: BTreeSet<_> = pools.iter().map(|pool| pool.id).collect();
        let assignments = self
            .assignments
            .iter()
            .filter_map(|assignment| {
                let assignment = ClientAssignment {
                    client_id: assignment.client_id,
                    pool_ids: assignment
                        .pool_ids
                        .iter()
                        .filter(|id| pool_ids.contains(id))
                        .copied()
                        .collect(),
                    preferred_hosts: assignment
                        .preferred_hosts
                        .iter()
                        .filter(|id| **id == host_id)
                        .copied()
                        .collect(),
                    preferred_instances: assignment
                        .preferred_instances
                        .iter()
                        .filter(|instance| instance.host_id == host_id)
                        .cloned()
                        .collect(),
                };
                (!assignment.pool_ids.is_empty()
                    || !assignment.preferred_hosts.is_empty()
                    || !assignment.preferred_instances.is_empty())
                .then_some(assignment)
            })
            .collect();
        Ok(HostMembershipProjection {
            schema: MEMBERSHIP_SCHEMA.into(),
            authority: self.authority.clone(),
            host_id,
            revision: self.revision,
            pools,
            assignments,
        })
    }

    pub fn validate(&self) -> Result<(), String> {
        self.authority.validate()?;
        if self.schema != FLEET_SCHEMA || self.revision == 0 {
            return Err("Unsupported fleet schema or revision".into());
        }
        if self.members.is_empty()
            || self.members.len() > 256
            || !unique(self.members.iter().map(|member| member.host.host_id))
            || !self
                .members
                .iter()
                .any(|member| member.host == self.authority)
        {
            return Err("Fleet hosts must be distinct and include the coordinator".into());
        }
        for member in &self.members {
            member.host.validate()?;
            if !name_valid(&member.display_name) {
                return Err("Fleet host names must contain 1–80 characters".into());
            }
        }
        let hosts: BTreeSet<_> = self
            .members
            .iter()
            .map(|member| member.host.host_id)
            .collect();
        validate_placement(&self.pools, &self.assignments, &hosts)?;
        if self.legacy_imports.iter().any(|(source, ids)| {
            source.len() != 64
                || !source.bytes().all(|byte| byte.is_ascii_hexdigit())
                || !unique(ids.iter())
                || ids.iter().any(Uuid::is_nil)
        }) {
            return Err(
                "Legacy import receipts require opaque SHA256 source IDs and distinct pool UUIDs"
                    .into(),
            );
        }
        Ok(())
    }

    /// Compute a candidate only. The host atomically persists it before publishing.
    pub fn updated(&self, request: FleetUpdate) -> Result<Self, FleetError> {
        if request.expected_revision != self.revision {
            return Err(FleetError::Conflict {
                current_revision: self.revision,
            });
        }
        let mut next = self.clone();
        match request.operation {
            FleetOperation::SavePool { mut pool } => {
                pool.name = pool.name.trim().to_owned();
                if let Some(saved) = next.pools.iter_mut().find(|saved| saved.id == pool.id) {
                    *saved = pool;
                } else {
                    next.pools.push(pool);
                }
            }
            FleetOperation::DeletePool { pool_id } => {
                next.pools.retain(|pool| pool.id != pool_id);
                for assignment in &mut next.assignments {
                    assignment.pool_ids.retain(|id| *id != pool_id);
                }
            }
            FleetOperation::SetClientAssignment { assignment } => {
                if let Some(saved) = next
                    .assignments
                    .iter_mut()
                    .find(|saved| saved.client_id == assignment.client_id)
                {
                    *saved = assignment;
                } else {
                    next.assignments.push(assignment);
                }
            }
            FleetOperation::EnrollMember { mut member } => {
                member.display_name = member.display_name.trim().to_owned();
                if member.host.host_id == self.authority.host_id && member.host != self.authority {
                    return Err(FleetError::Invalid(
                        "Update the coordinator locator through fleet/authority".into(),
                    ));
                }
                if let Some(saved) = next
                    .members
                    .iter_mut()
                    .find(|saved| saved.host.host_id == member.host.host_id)
                {
                    *saved = member;
                } else {
                    next.members.push(member);
                }
            }
            FleetOperation::RemoveMember { host_id } => {
                if host_id == self.authority.host_id {
                    return Err(FleetError::Invalid(
                        "The coordinator cannot remove itself".into(),
                    ));
                }
                next.members.retain(|member| member.host.host_id != host_id);
            }
            FleetOperation::ImportLegacyPools { source_id, pools } => {
                let receipt = next.legacy_imports.entry(source_id).or_default();
                for mut pool in pools {
                    if receipt.contains(&pool.id) {
                        continue;
                    }
                    pool.name = pool.name.trim().to_owned();
                    if let Some(saved) = next.pools.iter().find(|saved| saved.id == pool.id) {
                        if saved != &pool {
                            return Err(FleetError::Invalid(format!("Legacy pool {} conflicts with an existing fleet pool; review its mapping before import", pool.id)));
                        }
                    } else {
                        next.pools.push(pool.clone());
                    }
                    receipt.push(pool.id);
                }
            }
        }
        next.revision = self
            .revision
            .checked_add(1)
            .ok_or_else(|| FleetError::Invalid("Fleet revision exhausted".into()))?;
        next.validate().map_err(FleetError::Invalid)?;
        Ok(next)
    }
}

impl FleetView {
    pub fn authority(&self) -> Option<&AuthorityLocator> {
        match self {
            Self::Coordinator { fleet } => Some(&fleet.authority),
            Self::Member { authority } => Some(authority),
            Self::Unconfigured => None,
        }
    }

    pub fn validate_owner(&self, host_id: Uuid, certificate_sha256: &str) -> Result<(), String> {
        match self {
            Self::Coordinator { fleet } => {
                fleet.validate()?;
                if fleet.authority.host_id != host_id
                    || fleet.authority.certificate_sha256 != certificate_sha256
                {
                    return Err("Fleet coordinator identity does not match its owning host".into());
                }
            }
            Self::Member { authority } => {
                authority.validate()?;
                if authority.host_id == host_id {
                    return Err("A member cannot refer to itself as coordinator".into());
                }
            }
            Self::Unconfigured => (),
        }
        Ok(())
    }

    pub fn configured(
        &self,
        authority: AuthorityLocator,
        host_id: Uuid,
        name: &str,
        certificate_sha256: &str,
    ) -> Result<Self, String> {
        authority.validate()?;
        if authority.host_id == host_id {
            if authority.certificate_sha256 != certificate_sha256 {
                return Err("Coordinator certificate must match this host".into());
            }
            let fleet = match self {
                Self::Coordinator { fleet } => {
                    let mut next = fleet.clone();
                    if next.authority == authority {
                        return Ok(self.clone());
                    }
                    next.authority = authority.clone();
                    next.members
                        .iter_mut()
                        .find(|member| member.host.host_id == host_id)
                        .ok_or("Coordinator member is missing")?
                        .host = authority;
                    next.revision = next
                        .revision
                        .checked_add(1)
                        .ok_or("Fleet revision exhausted")?;
                    next
                }
                _ => FleetSnapshot {
                    schema: FLEET_SCHEMA.into(),
                    authority: authority.clone(),
                    revision: 1,
                    members: vec![FleetMember {
                        host: authority,
                        display_name: name.into(),
                    }],
                    pools: vec![],
                    assignments: vec![],
                    legacy_imports: BTreeMap::new(),
                },
            };
            fleet.validate()?;
            Ok(Self::Coordinator { fleet })
        } else {
            if let Self::Coordinator { fleet } = self {
                if !fleet.pools.is_empty()
                    || !fleet.assignments.is_empty()
                    || fleet.members.len() > 1
                    || !fleet.legacy_imports.is_empty()
                {
                    return Err("This host owns a populated fleet catalog. Its current ownership must be preserved until an explicit catalog migration is completed".into());
                }
            }
            Ok(Self::Member { authority })
        }
    }

    pub fn updated(&self, update: FleetUpdate) -> Result<Self, FleetError> {
        let Self::Coordinator { fleet } = self else {
            return Err(FleetError::NotCoordinator);
        };
        Ok(Self::Coordinator {
            fleet: fleet.updated(update)?,
        })
    }

    /// Grant revocation and placement removal share the host's durable transaction.
    pub fn remove_client(&mut self, client_id: Uuid) -> Result<bool, String> {
        let Self::Coordinator { fleet } = self else {
            return Ok(false);
        };
        if !fleet
            .assignments
            .iter()
            .any(|assignment| assignment.client_id == client_id)
        {
            return Ok(false);
        }
        let revision = fleet
            .revision
            .checked_add(1)
            .ok_or("Fleet revision exhausted")?;
        fleet
            .assignments
            .retain(|assignment| assignment.client_id != client_id);
        fleet.revision = revision;
        Ok(true)
    }
}
