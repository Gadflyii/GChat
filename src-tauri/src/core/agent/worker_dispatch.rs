use std::collections::HashMap;
use std::path::Path;
use std::sync::Arc;
use tauri::{AppHandle, Manager, Runtime};
use tauri_plugin_ginfer::state::GinferState;
use tokio::sync::Mutex;
use tokio_util::sync::CancellationToken;

use super::ginfer_client::{find_session_by_model_id, GinferClient, GinferConnection};
use super::orchestrator::{AgentModelRoute, SelectedWorker, WorkerDispatcher};
use super::worker_pools::{self, Allocator, Candidate, RoleAssignments, WorkerPool, WorkerTarget};

pub struct Dispatcher<R: Runtime> {
    app: AppHandle<R>,
    assignments: RoleAssignments,
    pools: Vec<WorkerPool>,
    aliases: std::collections::BTreeMap<String, String>,
    fleet_targets: Vec<String>,
    pub fleet_revision: Option<u64>,
    current: String,
    images: bool,
    affinity: Mutex<HashMap<String, (String, String)>>,
    allocator: Arc<Allocator>,
}

#[cfg(all(test, unix))]
mod tests {
    use super::super::test_support::{ScriptedGinferServer, TestFleet};
    use super::super::worker_pools::{PoolMember, RoleAssignment};
    use super::*;
    use tauri_plugin_ginfer::state::{GinferSession, SessionInfo};

    #[tokio::test]
    async fn stop_cancels_real_fleet_metadata_preflight_before_inference() {
        use super::super::{
            commands,
            types::{AgentEvent, AgentTurnRequest},
        };
        use crate::{core::state::AppState, test_support::TestDataRoot};
        let fleet = TestFleet::start().await;
        fleet.pause_fleet_reads();
        let data = tempfile::tempdir().unwrap();
        let app = tauri::test::mock_builder()
            .manage(AppState::default())
            .manage(GinferState::default())
            .manage(TestDataRoot(data.path().to_owned()))
            .manage(fleet.client.clone())
            .build(tauri::test::mock_context(tauri::test::noop_assets()))
            .unwrap();
        let run_id = uuid::Uuid::new_v4().to_string();
        let request: AgentTurnRequest = serde_json::from_value(serde_json::json!({
            "run_id":run_id,"session_id":uuid::Uuid::new_v4().to_string(),"model_id":"never-infer",
            "user_message":"Stop while fleet metadata is pending","working_dir":data.path(),
        }))
        .unwrap();
        let events = Arc::new(std::sync::Mutex::new(Vec::new()));
        let captured = events.clone();
        let run = commands::run_turn_with_sink(
            app.handle().clone(),
            request,
            Arc::new(move |event| {
                captured.lock().unwrap().push(event);
                Ok(())
            }),
        );
        let stop = async {
            fleet.wait_for_fleet_read().await;
            assert!(app
                .state::<AppState>()
                .tool_call_cancellations
                .lock()
                .await
                .contains_key(&run_id));
            commands::agent_cancel_turn(app.state(), run_id.clone())
                .await
                .unwrap();
        };
        let (result, ()) = tokio::time::timeout(std::time::Duration::from_secs(2), async {
            tokio::join!(run, stop)
        })
        .await
        .expect(
            "Stop must cancel the pending metadata request, not wait for its 10-second timeout",
        );
        result.unwrap();
        let recorded = super::super::runs::list_runs(data.path()).unwrap();
        let record = recorded
            .iter()
            .find(|record| record.run_id == run_id)
            .unwrap();
        assert_eq!(record.status, "cancelled");
        assert_eq!(record.total_steps, 0);
        assert_eq!(record.fleet_revision, None);
        assert!(
            matches!(events.lock().unwrap().as_slice(),[AgentEvent::TurnFinished {reason,step_count:0}] if reason=="cancelled")
        );
        assert!(!app
            .state::<AppState>()
            .tool_call_cancellations
            .lock()
            .await
            .contains_key(&run_id));
    }

    #[tokio::test]
    async fn real_dispatch_queues_cancels_releases_and_rejects_session_substitution() {
        let server = ScriptedGinferServer::start(Vec::new()).await;
        let GinferConnection::Local { port, .. } = server.client().target().connection else {
            unreachable!()
        };
        let pid = 1;
        let fleet = TestFleet::start().await;
        let owner = tauri_plugin_ginfer::state::SessionOwner {
            control: Arc::new(
                ginfer_host::launcher::LocalControl::open(
                    &fleet.directory.path().join("host"),
                    &fleet.origin,
                )
                .unwrap(),
            ),
            connection: ginfer_host::launcher::LocalConnection {
                instance_id: uuid::Uuid::new_v4(),
                session_id: uuid::Uuid::new_v4(),
                model_id: "scripted-test-model".into(),
                port: port.try_into().unwrap(),
                api_key: String::new(),
            },
        };
        let canonical = ginfer_host::engine_registry::InstanceRef {
            host_id: owner.control.host_id(),
            instance_id: owner.connection.instance_id,
        }
        .model_alias();
        let info: SessionInfo = serde_json::from_value(serde_json::json!({
            "pid":pid,"port":port,"model_id":"scripted-test-model","model_path":"test.ginfer",
            "is_embedding":false,"vision":true,"api_key":"","max_concurrency":3,"max_context":32768
        }))
        .unwrap();
        let state = GinferState::default();
        state.ginfer_process.lock().await.insert(
            pid,
            GinferSession {
                owner,
                info,
                endpoint: None,
            },
        );
        let app = tauri::test::mock_builder()
            .manage(state)
            .manage(fleet.client.clone())
            .build(tauri::test::mock_context(tauri::test::noop_assets()))
            .unwrap();
        let dir = tempfile::tempdir().unwrap();
        let pool = WorkerPool {
            id: uuid::Uuid::new_v4().to_string(),
            name: "Vision workers".into(),
            members: vec![PoolMember {
                instance_id: "scripted-test-model".into(),
                worker_limit: 1,
            }],
        };
        let original = serde_json::to_vec(&vec![pool.clone()]).unwrap();
        std::fs::write(dir.path().join("agent-worker-pools.json"), &original).unwrap();
        let mut assignments: RoleAssignments = ["worker:one", "worker:two"]
            .into_iter()
            .map(|role| {
                (
                    role.into(),
                    RoleAssignment {
                        target: WorkerTarget::Pool {
                            id: pool.id.clone(),
                        },
                        vision: true,
                        minimum_context: 8192,
                    },
                )
            })
            .collect();
        assignments.insert("current".into(), RoleAssignment::default());
        assignments.insert(
            "legacy".into(),
            RoleAssignment {
                target: WorkerTarget::Instance {
                    id: "scripted-test-model".into(),
                },
                ..Default::default()
            },
        );
        let mut dispatcher = Dispatcher::new(
            app.handle().clone(),
            assignments,
            dir.path(),
            "scripted-test-model".into(),
            false,
        )
        .await
        .unwrap();
        dispatcher.allocator = Arc::new(Allocator::default());
        let cancellation = CancellationToken::new();
        let first = dispatcher
            .select("worker:one", "unused", &cancellation)
            .await
            .unwrap();
        assert_eq!(first.route.instance_id, canonical);
        assert!(dispatcher.fleet_revision.is_some());
        assert_eq!(
            std::fs::read(dir.path().join("agent-worker-pools.json")).unwrap(),
            original
        );
        for role in ["current", "legacy"] {
            let cancel = CancellationToken::new();
            let pending = dispatcher.select(role, "unused", &cancel);
            tokio::pin!(pending);
            assert!(
                tokio::time::timeout(std::time::Duration::from_millis(30), &mut pending)
                    .await
                    .is_err(),
                "{role} must share the canonical pool limit even with engine C3"
            );
            cancel.cancel();
            assert!(pending.await.err().unwrap().contains("cancelled"));
        }
        let queued_cancel = CancellationToken::new();
        let queued = dispatcher.select("worker:two", "unused", &queued_cancel);
        tokio::pin!(queued);
        assert!(
            tokio::time::timeout(std::time::Duration::from_millis(30), &mut queued)
                .await
                .is_err()
        );
        queued_cancel.cancel();
        assert!(queued.await.err().unwrap().contains("cancelled"));
        assert_eq!(dispatcher.allocator.usage()[&canonical], 1);
        drop(first);
        let direct = dispatcher
            .select("current", "unused", &cancellation)
            .await
            .unwrap();
        assert_eq!(direct.route.instance_id, canonical);
        drop(direct);
        let second = dispatcher
            .select("worker:two", "unused", &cancellation)
            .await
            .unwrap();
        drop(second);
        assert!(dispatcher.allocator.usage().is_empty());
        let service = ginfer_host::fleet_client::FleetClient::new(fleet.client.clone());
        let report = service.read().await.unwrap();
        service
            .update(ginfer_host::fleet::FleetUpdate {
                expected_revision: report.snapshot.unwrap().revision,
                operation: ginfer_host::fleet::FleetOperation::SetClientAssignment {
                    assignment: ginfer_host::fleet::ClientAssignment {
                        client_id: report.client_id.unwrap(),
                        pool_ids: vec![pool.id.parse().unwrap()],
                        preferred_hosts: vec![],
                        preferred_instances: vec![crate::core::engine_hosts::parse_alias(
                            &canonical,
                        )
                        .unwrap()],
                    },
                },
            })
            .await
            .unwrap();
        let fleet_assignments = std::collections::BTreeMap::from([(
            "agent".into(),
            RoleAssignment {
                target: WorkerTarget::Fleet,
                ..Default::default()
            },
        )]);
        let assigned = Dispatcher::new(
            app.handle().clone(),
            fleet_assignments.clone(),
            dir.path(),
            "unused".into(),
            false,
        )
        .await
        .unwrap();
        let selected = assigned
            .select("agent", "unused", &cancellation)
            .await
            .unwrap();
        assert_eq!(selected.route.instance_id, canonical);
        drop(selected);
        fleet.stop();
        tokio::task::yield_now().await;
        assert!(Dispatcher::new(
            app.handle().clone(),
            fleet_assignments,
            dir.path(),
            "unused".into(),
            false
        )
        .await
        .err()
        .unwrap()
        .contains("unavailable"));
        let direct = Dispatcher::new(
            app.handle().clone(),
            std::collections::BTreeMap::new(),
            dir.path(),
            "scripted-test-model".into(),
            false,
        )
        .await
        .unwrap();
        let selected = direct
            .select("agent", "scripted-test-model", &cancellation)
            .await
            .unwrap();
        assert_eq!(selected.route.instance_id, canonical);
        drop(selected);
        app.state::<GinferState>()
            .ginfer_process
            .lock()
            .await
            .get_mut(&pid)
            .unwrap()
            .owner
            .connection
            .session_id = uuid::Uuid::new_v4();
        assert!(dispatcher
            .select("worker:one", "unused", &cancellation)
            .await
            .err()
            .unwrap()
            .contains("lost its assigned model session"));
        assert!(dispatcher.allocator.usage().is_empty());
    }
}

impl<R: Runtime> Dispatcher<R> {
    pub async fn new(
        app: AppHandle<R>,
        assignments: RoleAssignments,
        data: &Path,
        current: String,
        images: bool,
    ) -> Result<Self, String> {
        let catalog = match worker_pools::catalog(&app, data).await {
            Ok(catalog) => catalog,
            Err(error)
                if !assignments.values().any(|assignment| {
                    matches!(
                        assignment.target,
                        WorkerTarget::Pool { .. } | WorkerTarget::Fleet
                    )
                }) =>
            {
                worker_pools::Catalog {
                    fleet: worker_pools::FleetStatus {
                        error: Some(error),
                        ..Default::default()
                    },
                    ..Default::default()
                }
            }
            Err(error) => return Err(error),
        };
        Self::with_catalog(app, assignments, catalog, current, images)
    }

    pub(crate) fn with_catalog(
        app: AppHandle<R>,
        assignments: RoleAssignments,
        catalog: worker_pools::Catalog,
        current: String,
        images: bool,
    ) -> Result<Self, String> {
        catalog.validate_assignments(&assignments)?;
        Ok(Self {
            app,
            assignments,
            pools: catalog.all_pools,
            aliases: catalog.aliases,
            fleet_targets: catalog.fleet_targets,
            fleet_revision: catalog.fleet.revision,
            current,
            images,
            affinity: Mutex::new(HashMap::new()),
            allocator: Allocator::shared(),
        })
    }
}

#[async_trait::async_trait]
impl<R: Runtime> WorkerDispatcher for Dispatcher<R> {
    fn queue_reason(&self, role: &str) -> String {
        let requirement = self.assignments.get(role).cloned().unwrap_or_default();
        let vision = requirement.vision || (self.images && matches!(role, "agent" | "executor"));
        format!(
            "Waiting for {}instance with a free worker slot{}",
            if vision {
                "a Vision-capable "
            } else {
                "an available "
            },
            if requirement.minimum_context > 0 {
                format!(
                    " and at least {} context tokens",
                    requirement.minimum_context
                )
            } else {
                String::new()
            }
        )
    }
    async fn select(
        &self,
        role: &str,
        default_instance: &str,
        cancellation: &CancellationToken,
    ) -> Result<SelectedWorker, String> {
        let mut requirement = self.assignments.get(role).cloned().unwrap_or_default();
        requirement.vision |= self.images && matches!(role, "agent" | "executor");
        let ids: Vec<String> = match self.assignments.get(role).map(|a| &a.target) {
            None => vec![default_instance.into()],
            Some(WorkerTarget::Current) => vec![self.current.clone()],
            Some(WorkerTarget::Fleet) => self.fleet_targets.clone(),
            Some(WorkerTarget::Instance { id }) => vec![id.clone()],
            Some(WorkerTarget::Pool { id }) => self
                .pools
                .iter()
                .find(|p| &p.id == id)
                .ok_or("Worker pool missing")?
                .members
                .iter()
                .map(|m| m.instance_id.clone())
                .collect(),
        };
        let ids: Vec<_> = ids
            .into_iter()
            .map(|id| self.aliases.get(&id).cloned().unwrap_or(id))
            .collect();
        let affinity = self.affinity.lock().await.get(role).cloned();
        loop {
            if cancellation.is_cancelled() {
                return Err("Agent run was cancelled while waiting for worker capacity".into());
            }
            let ginfer = self.app.state::<GinferState>();
            let mut candidates = Vec::new();
            let mut routes = HashMap::new();
            let remote_instances = if ids.iter().any(|id| id.starts_with("ginfer/")) {
                crate::core::engine_hosts::agent_instances().await
            } else {
                Vec::new()
            };
            for id in &ids {
                if id.starts_with("ginfer/")
                    && affinity.as_ref().is_some_and(|(chosen, _)| chosen != id)
                {
                    continue;
                }
                let target = match find_session_by_model_id(id, &ginfer).await {
                    Ok(target) => target,
                    Err(_) => continue,
                };
                let (instance_id, session_id, concurrency, context) = match &target.connection {
                    GinferConnection::Local { port, .. } => {
                        let sessions = ginfer.ginfer_process.lock().await;
                        let Some(session) = sessions.values().find(|s| s.info.port as i32 == *port)
                        else {
                            continue;
                        };
                        (
                            ginfer_host::engine_registry::InstanceRef {
                                host_id: session.owner.control.host_id(),
                                instance_id: session.owner.connection.instance_id,
                            }
                            .model_alias(),
                            session.owner.connection.session_id.to_string(),
                            session.info.max_concurrency,
                            session.info.max_context,
                        )
                    }
                    GinferConnection::Paired { session_id, .. } => {
                        let Some(instance) = remote_instances.iter().find(|i| &i.id == id) else {
                            continue;
                        };
                        (
                            id.clone(),
                            session_id.to_string(),
                            instance.concurrency,
                            instance.max_context,
                        )
                    }
                };
                if affinity
                    .as_ref()
                    .is_some_and(|(chosen, _)| chosen != &instance_id)
                {
                    continue;
                }
                if affinity
                    .as_ref()
                    .is_some_and(|(_, session)| session != &session_id)
                {
                    return Err(format!("Worker `{role}` lost its assigned model session. The run will not silently move or replay its tools."));
                }
                // An instance's lowest configured pool limit is a process-wide
                // ceiling, even when multiple pools reference it.
                let worker_limit = self
                    .pools
                    .iter()
                    .flat_map(|p| &p.members)
                    .filter(|m| {
                        self.aliases.get(&m.instance_id).unwrap_or(&m.instance_id) == &instance_id
                    })
                    .map(|m| m.worker_limit)
                    .min()
                    .unwrap_or(concurrency);
                let client = GinferClient::new(&target).map_err(|e| e.to_string())?;
                let context = if context == 0 && requirement.minimum_context > 0 {
                    match tokio::time::timeout(
                        std::time::Duration::from_secs(3),
                        client.fetch_context_window(cancellation),
                    )
                    .await
                    {
                        Ok(Ok(Some(context))) => context.min(u32::MAX as usize) as u32,
                        _ => continue,
                    }
                } else {
                    context
                };
                candidates.push(Candidate {
                    instance_id: instance_id.clone(),
                    session_id,
                    concurrency,
                    worker_limit,
                    vision: target.has_vision,
                    context,
                });
                routes.insert(
                    instance_id.clone(),
                    Arc::new(AgentModelRoute {
                        instance_id,
                        model_id: target.model_id,
                        client,
                    }),
                );
            }
            if let Some(lease) = self.allocator.try_acquire(
                &candidates,
                &requirement,
                affinity
                    .as_ref()
                    .map(|(id, session)| (id.as_str(), session.as_str())),
            ) {
                let route = routes
                    .remove(&lease.candidate.instance_id)
                    .ok_or("Selected worker route missing")?;
                // Validate actual readiness and context before any tool/model work.
                let context = route
                    .client
                    .fetch_context_window(cancellation)
                    .await
                    .map_err(|e| e.to_string())?
                    .unwrap_or(0);
                if context < requirement.minimum_context as usize {
                    return Err(format!("Worker `{role}` requires {} context tokens; selected engine reports {context}", requirement.minimum_context));
                }
                self.affinity.lock().await.insert(
                    role.into(),
                    (
                        lease.candidate.instance_id.clone(),
                        lease.candidate.session_id.clone(),
                    ),
                );
                return Ok(SelectedWorker {
                    route,
                    _lease: Some(lease),
                });
            }
            tokio::select! {
                _ = cancellation.cancelled() => return Err("Agent run was cancelled while waiting for worker capacity".into()),
                _ = self.allocator.changed.notified() => (),
                _ = tokio::time::sleep(std::time::Duration::from_secs(2)) => (),
            }
        }
    }
}
