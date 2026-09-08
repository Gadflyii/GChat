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
    current: String,
    images: bool,
    affinity: Mutex<HashMap<String, (String, String)>>,
    allocator: Arc<Allocator>,
}

#[cfg(all(test, unix))]
mod tests {
    use super::super::test_support::ScriptedGinferServer;
    use super::super::worker_pools::{PoolMember, RoleAssignment};
    use super::*;
    use tauri_plugin_ginfer::state::{GinferSession, SessionInfo};

    #[tokio::test]
    async fn real_dispatch_queues_cancels_releases_and_rejects_session_substitution() {
        let server = ScriptedGinferServer::start(Vec::new()).await;
        let GinferConnection::Local { port, .. } = server.client().target().connection else {
            unreachable!()
        };
        let child = tokio::process::Command::new("sleep")
            .arg("30")
            .kill_on_drop(true)
            .spawn()
            .unwrap();
        let pid = child.id().unwrap() as i32;
        let info: SessionInfo = serde_json::from_value(serde_json::json!({
            "pid":pid,"port":port,"model_id":"scripted-test-model","model_path":"test.ginfer",
            "is_embedding":false,"vision":true,"api_key":"","max_concurrency":1,"max_context":32768
        }))
        .unwrap();
        let state = GinferState::default();
        state
            .ginfer_process
            .lock()
            .await
            .insert(pid, GinferSession { child, info });
        let app = tauri::test::mock_builder()
            .manage(state)
            .build(tauri::test::mock_context(tauri::test::noop_assets()))
            .unwrap();
        let dir = tempfile::tempdir().unwrap();
        let pool = worker_pools::save(
            dir.path(),
            WorkerPool {
                id: String::new(),
                name: "Vision workers".into(),
                members: vec![PoolMember {
                    instance_id: "scripted-test-model".into(),
                    worker_limit: 1,
                }],
            },
        )
        .unwrap();
        let assignments = ["worker:one", "worker:two"]
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
        let mut dispatcher = Dispatcher::new(
            app.handle().clone(),
            assignments,
            dir.path(),
            "unused".into(),
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
        assert_eq!(first.route.instance_id, "scripted-test-model");
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
        assert_eq!(dispatcher.allocator.usage()["scripted-test-model"], 1);
        drop(first);
        let second = dispatcher
            .select("worker:two", "unused", &cancellation)
            .await
            .unwrap();
        drop(second);
        assert!(dispatcher.allocator.usage().is_empty());
        app.state::<GinferState>()
            .ginfer_process
            .lock()
            .await
            .get_mut(&pid)
            .unwrap()
            .info
            .pid += 1;
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
        let data = data.to_path_buf();
        let pools = tokio::task::spawn_blocking(move || worker_pools::list(&data))
            .await
            .map_err(|e| e.to_string())??;
        for assignment in assignments.values() {
            if let WorkerTarget::Pool { id } = &assignment.target {
                if !pools.iter().any(|p| &p.id == id) {
                    return Err(format!(
                        "Worker pool `{id}` no longer exists. Choose another pool before running."
                    ));
                }
            }
        }
        Ok(Self {
            app,
            assignments,
            pools,
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
                if affinity.as_ref().is_some_and(|(chosen, _)| chosen != id) {
                    continue;
                }
                let target = match find_session_by_model_id(id, &ginfer).await {
                    Ok(target) => target,
                    Err(_) => continue,
                };
                let (session_id, concurrency, context) = match &target.connection {
                    GinferConnection::Local { port, .. } => {
                        let sessions = ginfer.ginfer_process.lock().await;
                        let Some(session) = sessions.values().find(|s| s.info.port as i32 == *port)
                        else {
                            continue;
                        };
                        (
                            format!("{}:{}", session.info.pid, port),
                            session.info.max_concurrency,
                            session.info.max_context,
                        )
                    }
                    GinferConnection::Paired { session_id, .. } => {
                        let Some(instance) = remote_instances.iter().find(|i| &i.id == id) else {
                            continue;
                        };
                        (
                            session_id.to_string(),
                            instance.concurrency,
                            instance.max_context,
                        )
                    }
                };
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
                    .filter(|m| &m.instance_id == id)
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
                    instance_id: id.clone(),
                    session_id,
                    concurrency,
                    worker_limit,
                    vision: target.has_vision,
                    context,
                });
                routes.insert(
                    id.clone(),
                    Arc::new(AgentModelRoute {
                        instance_id: id.clone(),
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
