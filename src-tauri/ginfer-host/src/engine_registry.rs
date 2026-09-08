//! Durable selection identity and reconciliation for registered LAN hosts.
//! Discovery never inserts a trusted host; pairing must register it explicitly.

use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};
use uuid::Uuid;

pub const HOST_PROTOCOL_VERSION: u32 = 1;

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub struct InstanceRef {
    pub host_id: Uuid,
    pub instance_id: Uuid,
}

impl InstanceRef {
    /// Stable public alias; display names and upstream model IDs are independent.
    pub fn model_alias(&self) -> String {
        format!("ginfer/{}/{}", self.host_id, self.instance_id)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum InstanceStatus {
    Starting,
    Ready,
    Stopping,
    Stopped,
    Failed,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct InstanceSnapshot {
    pub instance_id: Uuid,
    pub session_id: Option<Uuid>,
    pub display_name: String,
    pub upstream_model_id: String,
    pub status: InstanceStatus,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct HostSnapshot {
    pub protocol_version: u32,
    pub host_id: Uuid,
    /// Changes on host-service restart; revisions are ordered within a boot.
    pub boot_id: Uuid,
    pub revision: u64,
    pub display_name: String,
    pub instances: Vec<InstanceSnapshot>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RegisteredHost {
    pub host_id: Uuid,
    pub display_name: String,
    /// Reference into the native credential store, never the credential itself.
    pub credential_ref: String,
    pub certificate_sha256: String,
}

/// Native connection identity. Never accepted from a network snapshot.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct HostConnection {
    host_id: Uuid,
    generation: Uuid,
}

#[derive(Default)]
pub struct EngineRegistry {
    hosts: BTreeMap<Uuid, RegisteredHost>,
    snapshots: BTreeMap<Uuid, HostSnapshot>,
    online: BTreeSet<Uuid>,
    connections: BTreeMap<Uuid, Uuid>,
}

impl EngineRegistry {
    pub fn forget(&mut self, host_id: Uuid) {
        self.hosts.remove(&host_id);
        self.snapshots.remove(&host_id);
        self.connections.remove(&host_id);
        self.online.remove(&host_id);
    }
    /// Caller must have completed certificate-bound pairing before this call.
    pub fn register_paired(&mut self, host: RegisteredHost) {
        let id = host.host_id;
        self.hosts.insert(id, host);
        // Re-pairing must not inherit a prior connection's live routing state.
        self.mark_offline(id);
        self.connections.remove(&id);
        self.snapshots.remove(&id);
    }

    /// Start a new authenticated connection, invalidating callbacks from its predecessor.
    pub fn connect(&mut self, host_id: Uuid) -> Result<HostConnection, String> {
        if !self.hosts.contains_key(&host_id) {
            return Err("host has not been paired".into());
        }
        let generation = Uuid::new_v4();
        self.connections.insert(host_id, generation);
        self.mark_offline(host_id);
        Ok(HostConnection {
            host_id,
            generation,
        })
    }

    pub fn disconnect(&mut self, connection: HostConnection) {
        if self.connections.get(&connection.host_id) == Some(&connection.generation) {
            self.connections.remove(&connection.host_id);
            self.mark_offline(connection.host_id);
        }
    }

    /// A snapshot poll on an established connection must not interrupt routing.
    pub fn poll_connection(&mut self, host_id: Uuid) -> Result<HostConnection, String> {
        if !self.hosts.contains_key(&host_id) {
            return Err("host has not been paired".into());
        }
        let generation = Uuid::new_v4();
        self.connections.insert(host_id, generation);
        Ok(HostConnection {
            host_id,
            generation,
        })
    }

    /// Apply a full snapshot from the current authenticated connection.
    pub fn reconcile(
        &mut self,
        connection: HostConnection,
        snapshot: HostSnapshot,
    ) -> Result<(), String> {
        let expected_host = connection.host_id;
        if self.connections.get(&expected_host) != Some(&connection.generation) {
            return Err("host connection has been superseded or disconnected".into());
        }
        if snapshot.host_id != expected_host {
            return Err("snapshot host identity does not match the paired host".into());
        }
        if snapshot.protocol_version != HOST_PROTOCOL_VERSION {
            return Err("unsupported host protocol version".into());
        }
        let mut ids = BTreeSet::new();
        for instance in &snapshot.instances {
            if !ids.insert(instance.instance_id) {
                return Err("snapshot contains duplicate instance IDs".into());
            }
            if instance.status == InstanceStatus::Ready
                && (instance.session_id.is_none() || instance.upstream_model_id.trim().is_empty())
            {
                return Err("ready instance requires a session and upstream model identity".into());
            }
        }
        if let Some(previous) = self.snapshots.get(&expected_host) {
            if previous.boot_id == snapshot.boot_id {
                if snapshot.revision < previous.revision {
                    return Err("stale host snapshot".into());
                }
                if snapshot.revision == previous.revision && previous != &snapshot {
                    return Err("host snapshot changed without a revision change".into());
                }
            }
        }
        self.snapshots.insert(expected_host, snapshot);
        self.online.insert(expected_host);
        Ok(())
    }

    pub fn mark_offline(&mut self, host_id: Uuid) {
        self.online.remove(&host_id);
    }

    pub fn resolve(&self, selection: &InstanceRef) -> Result<&InstanceSnapshot, String> {
        if !self.hosts.contains_key(&selection.host_id) {
            return Err("selected host is not registered".into());
        }
        if !self.online.contains(&selection.host_id) {
            return Err("selected host is offline".into());
        }
        self.snapshots
            .get(&selection.host_id)
            .and_then(|snapshot| {
                snapshot
                    .instances
                    .iter()
                    .find(|i| i.instance_id == selection.instance_id)
            })
            .filter(|instance| instance.status == InstanceStatus::Ready)
            .ok_or_else(|| "selected instance is not ready".into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn apply(
        registry: &mut EngineRegistry,
        host_id: Uuid,
        snapshot: HostSnapshot,
    ) -> Result<(), String> {
        let connection = match registry.connections.get(&host_id) {
            Some(generation) => HostConnection {
                host_id,
                generation: *generation,
            },
            None => registry.connect(host_id)?,
        };
        registry.reconcile(connection, snapshot)
    }

    fn paired(registry: &mut EngineRegistry) -> (InstanceRef, HostSnapshot) {
        let selection = InstanceRef {
            host_id: Uuid::new_v4(),
            instance_id: Uuid::new_v4(),
        };
        registry.register_paired(RegisteredHost {
            host_id: selection.host_id,
            display_name: "Server".into(),
            credential_ref: "vault-reference".into(),
            certificate_sha256: "test-pin".into(),
        });
        let snapshot = HostSnapshot {
            protocol_version: 1,
            host_id: selection.host_id,
            boot_id: Uuid::new_v4(),
            revision: 1,
            display_name: "Server".into(),
            instances: vec![InstanceSnapshot {
                instance_id: selection.instance_id,
                session_id: Some(Uuid::new_v4()),
                display_name: "Muse".into(),
                upstream_model_id: "muse".into(),
                status: InstanceStatus::Ready,
            }],
        };
        (selection, snapshot)
    }

    #[test]
    fn polling_keeps_live_routes_and_supersedes_delayed_refreshes() {
        let mut registry = EngineRegistry::default();
        let (selection, snapshot) = paired(&mut registry);
        apply(&mut registry, selection.host_id, snapshot.clone()).unwrap();
        let old = registry.poll_connection(selection.host_id).unwrap();
        assert!(registry.resolve(&selection).is_ok());
        let current = registry.poll_connection(selection.host_id).unwrap();
        registry.disconnect(old);
        assert!(registry.resolve(&selection).is_ok());
        assert!(registry.reconcile(old, snapshot.clone()).is_err());
        registry.reconcile(current, snapshot).unwrap();
        registry.disconnect(current);
        assert!(registry.resolve(&selection).is_err());
    }

    #[test]
    fn duplicate_model_names_route_independently_and_offline_does_not_fail_over() {
        let mut registry = EngineRegistry::default();
        let (a, sa) = paired(&mut registry);
        let (b, sb) = paired(&mut registry);
        apply(&mut registry, a.host_id, sa).unwrap();
        apply(&mut registry, b.host_id, sb).unwrap();
        assert_ne!(a.model_alias(), b.model_alias());
        assert_eq!(registry.resolve(&a).unwrap().upstream_model_id, "muse");
        registry.mark_offline(a.host_id);
        assert_eq!(
            registry.resolve(&a).unwrap_err(),
            "selected host is offline"
        );
        assert!(registry.resolve(&b).is_ok());
        assert!(registry.hosts.contains_key(&a.host_id));
    }

    #[test]
    fn full_snapshots_remove_stopped_instances_and_restart_resets_revision() {
        let mut registry = EngineRegistry::default();
        let (selection, mut snapshot) = paired(&mut registry);
        apply(&mut registry, selection.host_id, snapshot.clone()).unwrap();
        snapshot.instances.clear();
        snapshot.revision += 1;
        apply(&mut registry, selection.host_id, snapshot.clone()).unwrap();
        assert!(registry.resolve(&selection).is_err());
        snapshot.revision = 0;
        assert!(apply(&mut registry, selection.host_id, snapshot.clone()).is_err());
        snapshot.boot_id = Uuid::new_v4();
        apply(&mut registry, selection.host_id, snapshot).unwrap();
    }

    #[test]
    fn invalid_identity_and_duplicate_instances_do_not_replace_live_state() {
        let mut registry = EngineRegistry::default();
        let (selection, mut snapshot) = paired(&mut registry);
        apply(&mut registry, selection.host_id, snapshot.clone()).unwrap();
        snapshot.host_id = Uuid::new_v4();
        assert!(apply(&mut registry, selection.host_id, snapshot.clone()).is_err());
        snapshot.host_id = selection.host_id;
        snapshot.revision += 1;
        snapshot.instances.push(snapshot.instances[0].clone());
        assert!(apply(&mut registry, selection.host_id, snapshot).is_err());
        assert!(registry.resolve(&selection).is_ok());
    }

    #[test]
    fn old_connection_cannot_overwrite_restart_or_disconnect_replacement() {
        let mut registry = EngineRegistry::default();
        let (selection, old_snapshot) = paired(&mut registry);
        let old = registry.connect(selection.host_id).unwrap();
        registry.reconcile(old, old_snapshot.clone()).unwrap();
        let replacement = registry.connect(selection.host_id).unwrap();
        assert!(registry.resolve(&selection).is_err());
        let mut current = old_snapshot.clone();
        current.boot_id = Uuid::new_v4();
        current.instances[0].session_id = Some(Uuid::new_v4());
        registry.reconcile(replacement, current.clone()).unwrap();
        assert!(registry.reconcile(old, old_snapshot).is_err());
        registry.disconnect(old);
        assert_eq!(
            registry.resolve(&selection).unwrap().session_id,
            current.instances[0].session_id
        );
        registry.disconnect(replacement);
        assert!(registry.reconcile(replacement, current).is_err());
        assert!(registry.resolve(&selection).is_err());
    }
}
