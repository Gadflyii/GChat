//! Service-owned task actors reuse CuaTask; credentials never enter the journal.
use std::{
    collections::BTreeMap,
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex as SyncMutex,
    },
};

use serde::Serialize;
use serde_json::{json, Value};
use tokio::{
    sync::{oneshot, watch, Mutex},
    task::JoinHandle,
};
use uuid::Uuid;

use crate::{
    connectors::ConnectorRequest,
    contract::{GuestRequest, SessionIdentity},
    executor::{
        ApprovalFuture, Assignment, CuaTask, ExecutorError, ExecutorProcesses, FunctionTool,
        TaskRecord, ToolApproval, ToolBinding,
    },
    workspace::{WorkspaceError, WorkspaceRuntime},
};

type Result<T> = std::result::Result<T, TaskRunnerError>;

#[derive(Debug)]
pub enum TaskRunnerError {
    NotFound,
    AlreadyRunning,
    Closed,
    InvalidPrompt,
    ActorFailed,
    Executor(ExecutorError),
    Workspace(WorkspaceError),
    Io(std::io::Error),
}
impl std::fmt::Display for TaskRunnerError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::NotFound => f.write_str("task or approval decision was not found"),
            Self::AlreadyRunning => f.write_str("task is already running"),
            Self::Closed => f.write_str("task runner is stopping"),
            Self::InvalidPrompt => {
                f.write_str("task needs a prompt and a configured model assignment")
            }
            Self::ActorFailed => f.write_str("task actor stopped unexpectedly"),
            Self::Executor(error) => error.fmt(f),
            Self::Workspace(error) => error.fmt(f),
            Self::Io(error) => error.fmt(f),
        }
    }
}
impl std::error::Error for TaskRunnerError {}
impl From<ExecutorError> for TaskRunnerError {
    fn from(error: ExecutorError) -> Self {
        Self::Executor(error)
    }
}
impl From<WorkspaceError> for TaskRunnerError {
    fn from(error: WorkspaceError) -> Self {
        Self::Workspace(error)
    }
}
impl From<std::io::Error> for TaskRunnerError {
    fn from(error: std::io::Error) -> Self {
        Self::Io(error)
    }
}

#[derive(Clone, Debug, Serialize)]
pub struct PendingApproval {
    pub id: Uuid,
    pub task_id: Uuid,
    pub request: Value,
}

struct Decision {
    pending: PendingApproval,
    reply: oneshot::Sender<bool>,
}

struct ApprovalQueue {
    entries: SyncMutex<BTreeMap<Uuid, Decision>>,
    revision: watch::Sender<u64>,
    closed: AtomicBool,
    #[cfg(test)]
    changed: tokio::sync::Notify,
}
impl ApprovalQueue {
    fn touch(&self) {
        self.revision.send_modify(|revision| *revision += 1);
        #[cfg(test)]
        self.changed.notify_one();
    }
}

// Dropping an approval future on cancellation removes its UI decision as well.
struct PendingDecision<'a> {
    queue: &'a ApprovalQueue,
    id: Uuid,
}
impl Drop for PendingDecision<'_> {
    fn drop(&mut self) {
        if self
            .queue
            .entries
            .lock()
            .expect("approval queue poisoned")
            .remove(&self.id)
            .is_some()
        {
            self.queue.touch();
        }
    }
}
impl ApprovalQueue {
    fn decide(&self, task_id: Uuid, request: Value) -> ApprovalFuture<'_> {
        Box::pin(async move {
            let id = Uuid::new_v4();
            let (reply, answer) = oneshot::channel();
            {
                let mut entries = self.entries.lock().expect("approval queue poisoned");
                if self.closed.load(Ordering::Acquire) {
                    return false;
                }
                entries.insert(
                    id,
                    Decision {
                        pending: PendingApproval {
                            id,
                            task_id,
                            request,
                        },
                        reply,
                    },
                );
            }
            let _pending = PendingDecision { queue: self, id };
            self.touch();
            answer.await.unwrap_or(false)
        })
    }
}
impl ToolApproval for ApprovalQueue {
    fn approve<'a>(&'a self, task_id: Uuid, request: &'a GuestRequest) -> ApprovalFuture<'a> {
        self.decide(task_id, json!(request))
    }
    fn approve_connector<'a>(
        &'a self,
        task_id: Uuid,
        request: &'a ConnectorRequest,
    ) -> ApprovalFuture<'a> {
        self.decide(task_id, json!(request))
    }
}

struct Actor {
    cancel: watch::Sender<bool>,
    paused: Arc<AtomicBool>,
    record: watch::Receiver<TaskRecord>,
    join: JoinHandle<std::result::Result<(), ExecutorError>>,
}
struct State {
    closed: bool,
    records: BTreeMap<Uuid, TaskRecord>,
    actors: BTreeMap<Uuid, Actor>,
}

pub struct TaskRunner {
    root: PathBuf,
    runtime: Arc<WorkspaceRuntime>,
    processes: ExecutorProcesses,
    state: Mutex<State>,
    approvals: Arc<ApprovalQueue>,
    pub schedules: Arc<crate::schedules::Schedules>,
}

impl TaskRunner {
    pub async fn new(
        root: PathBuf,
        runtime: Arc<WorkspaceRuntime>,
        processes: ExecutorProcesses,
    ) -> Result<Self> {
        tokio::fs::create_dir_all(&root).await?;
        let schedules = Arc::new(
            crate::schedules::Schedules::open(root.join("schedules.json"))
                .await
                .map_err(TaskRunnerError::Workspace)?,
        );
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            tokio::fs::set_permissions(&root, std::fs::Permissions::from_mode(0o700)).await?;
        }
        let mut records = BTreeMap::new();
        let mut files = tokio::fs::read_dir(&root).await?;
        while let Some(file) = files.next_entry().await? {
            let path = file.path();
            if path.extension().and_then(|value| value.to_str()) != Some("json") {
                continue;
            }
            let Some(id) = path
                .file_stem()
                .and_then(|value| value.to_str())
                .and_then(|value| Uuid::parse_str(value).ok())
            else {
                continue;
            };
            let task = CuaTask::open(path).await?;
            if task.snapshot().id != id {
                return Err(ExecutorError::InvalidMessage.into());
            }
            records.insert(id, task.snapshot().clone());
        }
        let (revision, _) = watch::channel(0);
        Ok(Self {
            root,
            runtime,
            processes,
            schedules,
            state: Mutex::new(State {
                closed: false,
                records,
                actors: BTreeMap::new(),
            }),
            approvals: Arc::new(ApprovalQueue {
                entries: SyncMutex::new(BTreeMap::new()),
                revision,
                closed: AtomicBool::new(false),
                #[cfg(test)]
                changed: tokio::sync::Notify::new(),
            }),
        })
    }

    pub fn subscribe(&self) -> watch::Receiver<u64> {
        self.approvals.revision.subscribe()
    }

    pub(crate) fn notify(&self) {
        self.approvals.touch();
    }

    pub async fn start(
        &self,
        identity: SessionIdentity,
        prompt: String,
        assignment: Option<Assignment>,
    ) -> Result<TaskRecord> {
        self.start_with_id(Uuid::new_v4(), identity, prompt, assignment.map(Into::into))
            .await
    }

    /// A scheduler reserves and persists this identity before any execution.
    pub(crate) async fn start_with_id(
        &self,
        id: Uuid,
        identity: SessionIdentity,
        prompt: String,
        assignment: Option<crate::inference::ResolvedAssignment>,
    ) -> Result<TaskRecord> {
        if prompt.trim().is_empty() {
            return Err(TaskRunnerError::InvalidPrompt);
        }
        let assignment = match assignment {
            Some(assignment) => assignment,
            None => {
                self.runtime
                    .resolve_model_assignment(identity.workspace_id)
                    .await?
            }
        };
        if !valid_assignment(&assignment) {
            return Err(TaskRunnerError::InvalidPrompt);
        }
        let mut state = self.state.lock().await;
        if state.closed {
            return Err(TaskRunnerError::Closed);
        }
        if let Some(record) = state.records.get(&id) {
            return Ok(state
                .actors
                .get(&id)
                .map_or_else(|| record.clone(), |actor| actor.record.borrow().clone()));
        }
        let mut tools: Vec<_> = self
            .runtime
            .desktop_tools(identity)
            .await?
            .into_iter()
            .map(|tool| FunctionTool {
                binding: ToolBinding::Desktop {
                    name: tool.name.clone(),
                },
                name: tool.name,
                description: tool.description,
                parameters: tool.input_schema,
            })
            .collect();
        tools.extend(self.runtime.connector_tools(identity.workspace_id).await?);
        let task = CuaTask::create_with_id(
            self.path(id),
            id,
            identity,
            vec![json!({"role":"user","content":prompt})],
            tools,
        )
        .await?;
        let record = task.snapshot().clone();
        self.launch(&mut state, task, assignment);
        Ok(record)
    }

    pub async fn resume(&self, id: Uuid, assignment: Option<Assignment>) -> Result<TaskRecord> {
        let mut state = self.state.lock().await;
        if state.closed {
            return Err(TaskRunnerError::Closed);
        }
        if !state.records.contains_key(&id) {
            return Err(TaskRunnerError::NotFound);
        }
        if let Some(actor) = state.actors.get(&id) {
            if !actor.join.is_finished() {
                return Err(TaskRunnerError::AlreadyRunning);
            }
        }
        self.reap(&mut state, id).await?;
        let mut task = CuaTask::open(self.path(id)).await?;
        if task.snapshot().state == crate::executor::TaskState::NeedsReview {
            return Err(ExecutorError::NeedsReview.into());
        }
        let assignment = match assignment {
            Some(assignment) => assignment.into(),
            None => {
                self.runtime
                    .resolve_model_assignment(task.snapshot().identity.workspace_id)
                    .await?
            }
        };
        if !valid_assignment(&assignment) {
            return Err(TaskRunnerError::InvalidPrompt);
        }
        // Resolve the exact live session before launching a model process.
        self.runtime.desktop_tools(task.snapshot().identity).await?;
        task.replace_connector_tools(
            self.runtime
                .connector_tools(task.snapshot().identity.workspace_id)
                .await?,
        )
        .await?;
        let record = task.snapshot().clone();
        self.launch(&mut state, task, assignment);
        Ok(record)
    }

    fn launch(
        &self,
        state: &mut State,
        mut task: CuaTask,
        assignment: crate::inference::ResolvedAssignment,
    ) {
        let id = task.snapshot().id;
        state.records.insert(id, task.snapshot().clone());
        let record = task.subscribe();
        let mut updates = record.clone();
        let (cancel, cancelled) = watch::channel(false);
        let paused = Arc::new(AtomicBool::new(false));
        let pause_flag = paused.clone();
        let runtime = self.runtime.clone();
        let processes = self.processes.clone();
        let approvals = self.approvals.clone();
        let join = tokio::spawn(async move {
            let result = {
                let execution = task.run(
                    &runtime,
                    approvals.as_ref(),
                    &assignment,
                    &processes,
                    cancelled,
                );
                tokio::pin!(execution);
                loop {
                    tokio::select! {
                        result = &mut execution => break result,
                        changed = updates.changed() => { if changed.is_ok() { approvals.touch(); } }
                    }
                }
            };
            let result = if pause_flag.load(Ordering::Acquire) {
                task.pause().await
            } else {
                result
            };
            approvals.touch();
            result
        });
        state.actors.insert(
            id,
            Actor {
                cancel,
                paused,
                record,
                join,
            },
        );
        self.approvals.touch();
    }

    pub async fn list(&self) -> Result<Vec<TaskRecord>> {
        let state = self.state.lock().await;
        Ok(state
            .records
            .iter()
            .map(|(id, record)| {
                state
                    .actors
                    .get(id)
                    .map_or_else(|| record.clone(), |actor| actor.record.borrow().clone())
            })
            .collect())
    }

    #[cfg(target_os = "linux")]
    pub(crate) async fn remove_computer(
        self: &Arc<Self>,
        setup: Arc<crate::kvm_setup::KvmSetup>,
        id: crate::contract::WorkspaceId,
    ) -> std::result::Result<crate::kvm_setup::SetupRecord, crate::kvm_setup::SetupIssue> {
        let owner = self.clone();
        tokio::spawn(async move {
            let state = owner.state.lock().await;
            if state.records.iter().any(|(task_id, saved)| {
                let record = state.actors.get(task_id)
                    .map_or_else(|| saved.clone(), |actor| actor.record.borrow().clone());
                record.identity.workspace_id == id
                    && !matches!(record.state, crate::executor::TaskState::Completed | crate::executor::TaskState::Cancelled)
            }) {
                return Err(crate::kvm_setup::SetupIssue::new("workspace_in_use", "This bot has unfinished tasks.", "Finish or cancel its tasks before removing this computer."));
            }
            let _schedules = owner.schedules.guard_workspace_removal(id).await
                .map_err(|error| crate::kvm_setup::SetupIssue::new("workspace_in_use", error.to_string(), "Disable its schedules and resolve pending runs before removing this computer."))?;
            setup.remove(id).await
        }).await.map_err(|error| crate::kvm_setup::SetupIssue::new("removal_failed", error.to_string(), "Retry removal of this same computer."))?
    }

    pub async fn snapshot(&self, id: Uuid) -> Result<TaskRecord> {
        let state = self.state.lock().await;
        if let Some(actor) = state.actors.get(&id) {
            return Ok(actor.record.borrow().clone());
        }
        state
            .records
            .get(&id)
            .cloned()
            .ok_or(TaskRunnerError::NotFound)
    }

    pub async fn cancel(&self, id: Uuid) -> Result<TaskRecord> {
        let mut state = self.state.lock().await;
        if state.closed {
            return Err(TaskRunnerError::Closed);
        }
        if !state.records.contains_key(&id) {
            return Err(TaskRunnerError::NotFound);
        }
        if let Some(actor) = state.actors.get(&id) {
            actor.cancel.send_replace(true);
        }
        self.reap(&mut state, id).await?;
        let mut task = CuaTask::open(self.path(id)).await?;
        task.cancel().await?;
        let record = task.snapshot().clone();
        state.records.insert(id, record.clone());
        self.approvals.touch();
        Ok(record)
    }

    pub async fn pause(&self, identity: SessionIdentity) -> Result<()> {
        let mut state = self.state.lock().await;
        let ids: Vec<_> = state
            .actors
            .iter()
            .filter(|(_, actor)| actor.record.borrow().identity == identity)
            .map(|(id, actor)| {
                actor.paused.store(true, Ordering::Release);
                actor.cancel.send_replace(true);
                *id
            })
            .collect();
        for id in ids {
            self.reap(&mut state, id).await?;
        }
        // An interrupted task can also contain old, unadmitted model proposals.
        let ids: Vec<_> = state
            .records
            .iter()
            .filter(|(_, record)| record.identity == identity)
            .map(|(id, _)| *id)
            .collect();
        for id in ids {
            let mut task = CuaTask::open(self.path(id)).await?;
            task.pause().await?;
            state.records.insert(id, task.snapshot().clone());
        }
        self.approvals.touch();
        Ok(())
    }

    pub async fn approvals(&self) -> Result<Vec<PendingApproval>> {
        Ok(self
            .approvals
            .entries
            .lock()
            .expect("approval queue poisoned")
            .values()
            .map(|decision| decision.pending.clone())
            .collect())
    }

    pub async fn decide(&self, id: Uuid, allow: bool) -> Result<()> {
        let decision = self
            .approvals
            .entries
            .lock()
            .expect("approval queue poisoned")
            .remove(&id)
            .ok_or(TaskRunnerError::NotFound)?;
        decision
            .reply
            .send(allow)
            .map_err(|_| TaskRunnerError::NotFound)?;
        self.approvals.touch();
        Ok(())
    }

    pub async fn answer_help(
        &self,
        id: Uuid,
        request_id: Uuid,
        response: Option<String>,
    ) -> Result<TaskRecord> {
        let mut state = self.state.lock().await;
        if state.closed {
            return Err(TaskRunnerError::Closed);
        }
        let record = state
            .actors
            .get(&id)
            .map(|actor| actor.record.borrow().clone())
            .or_else(|| state.records.get(&id).cloned())
            .ok_or(TaskRunnerError::NotFound)?;
        if record.state != crate::executor::TaskState::WaitingForHuman {
            return Err(ExecutorError::InvalidMessage.into());
        }
        self.reap(&mut state, id).await?;
        let mut task = CuaTask::open(self.path(id)).await?;
        task.answer_help(request_id, response).await?;
        state.records.insert(id, task.snapshot().clone());
        self.approvals.touch();
        // Save the answer before resolving a connection; a failed reconnect cannot lose it.
        let assignment = self
            .runtime
            .resolve_model_assignment(task.snapshot().identity.workspace_id)
            .await?;
        if !valid_assignment(&assignment) {
            return Err(TaskRunnerError::InvalidPrompt);
        }
        self.runtime.desktop_tools(task.snapshot().identity).await?;
        let record = task.snapshot().clone();
        self.launch(&mut state, task, assignment);
        Ok(record)
    }

    pub async fn close(&self) -> Result<()> {
        let mut state = self.state.lock().await;
        state.closed = true;
        self.approvals.closed.store(true, Ordering::Release);
        for actor in state.actors.values() {
            actor.cancel.send_replace(true);
        }
        self.approvals
            .entries
            .lock()
            .expect("approval queue poisoned")
            .clear();
        let ids: Vec<_> = state.actors.keys().copied().collect();
        let mut error = None;
        for id in ids {
            if let Err(failure) = self.reap(&mut state, id).await {
                error.get_or_insert(failure);
            }
        }
        self.approvals.touch();
        error.map_or(Ok(()), Err)
    }

    async fn reap(&self, state: &mut State, id: Uuid) -> Result<()> {
        let Some(actor) = state.actors.remove(&id) else {
            return Ok(());
        };
        let result = actor.join.await.map_err(|_| TaskRunnerError::ActorFailed);
        state.records.insert(id, actor.record.borrow().clone());
        match result? {
            Ok(())
            | Err(
                ExecutorError::Cancelled
                | ExecutorError::AwaitingHuman
                | ExecutorError::Denied
                | ExecutorError::NeedsReview
                | ExecutorError::ChildFailed
                | ExecutorError::InvalidMessage,
            ) => Ok(()),
            Err(ExecutorError::State(crate::service::ServiceError::BotPaused)) => Ok(()),
            Err(error) => Err(error.into()),
        }
    }

    fn path(&self, id: Uuid) -> PathBuf {
        self.root.join(format!("{id}.json"))
    }
}

fn valid_assignment(assignment: &Assignment) -> bool {
    !assignment.api_base.trim().is_empty()
        && !assignment.model.trim().is_empty()
        && assignment.context_tokens > 0
}

#[cfg(all(test, target_os = "linux"))]
mod tests {
    use super::*;
    use crate::{
        contract::{GuestOperationKind, GuestPath, SessionId, WorkspaceId},
        executor::{ProcessSpec, TaskState},
        service::Service,
        vault::NativeVault,
    };

    fn assignment() -> Assignment {
        Assignment {
            api_base: "http://unused/v1".into(),
            api_key: Some("memory-only-fixture-secret".into()),
            model: "fixture".into(),
            context_tokens: 131072,
        }
    }

    #[cfg(target_os = "linux")]
    #[tokio::test]
    async fn computer_removal_requires_finished_tasks() {
        let dir = tempfile::tempdir().unwrap();
        let service = Arc::new(
            Service::open(dir.path().join("service.json"))
                .await
                .unwrap(),
        );
        let vault = Arc::new(NativeVault);
        let runtime = Arc::new(WorkspaceRuntime::new(service.clone(), vault.clone()));
        let setup = Arc::new(
            crate::kvm_setup::KvmSetup::open(
                dir.path().join("setup"),
                service,
                vault,
                Arc::downgrade(&runtime),
            )
            .await
            .unwrap(),
        );
        let processes = ExecutorProcesses {
            python: ProcessSpec {
                program: "/bin/false".into(),
                args: vec![],
            },
            context: ProcessSpec {
                program: "/bin/false".into(),
                args: vec![],
            },
        };
        let runner = Arc::new(
            TaskRunner::new(dir.path().join("tasks"), runtime, processes)
                .await
                .unwrap(),
        );
        let id = Uuid::new_v4();
        let identity = SessionIdentity {
            workspace_id: WorkspaceId::new(),
            session_id: SessionId::new(),
        };
        let task = CuaTask::create_with_id(
            runner.path(id),
            id,
            identity,
            vec![json!({"role":"user","content":"fixture"})],
            vec![],
        )
        .await
        .unwrap();
        for state in [
            TaskState::Ready,
            TaskState::Running,
            TaskState::WaitingForHuman,
            TaskState::Interrupted,
            TaskState::Paused,
            TaskState::NeedsReview,
            TaskState::Completed,
            TaskState::Cancelled,
        ] {
            let mut record = task.snapshot().clone();
            record.state = state;
            runner.state.lock().await.records.insert(id, record);
            let issue = runner
                .remove_computer(setup.clone(), identity.workspace_id)
                .await
                .unwrap_err();
            assert_eq!(
                issue.code,
                if matches!(state, TaskState::Completed | TaskState::Cancelled) {
                    "setup_missing"
                } else {
                    "workspace_in_use"
                }
            );
        }
    }

    async fn next_approval(
        runner: &TaskRunner,
        changes: &mut watch::Receiver<u64>,
    ) -> PendingApproval {
        tokio::time::timeout(std::time::Duration::from_secs(10), async {
            loop {
                if let Some(pending) = runner.approvals().await.unwrap().into_iter().next() {
                    break pending;
                }
                changes.changed().await.unwrap();
            }
        })
        .await
        .expect("actor did not publish approval")
    }

    #[tokio::test]
    async fn human_help_releases_children_and_retains_reply_when_reconnect_fails() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("tasks");
        let service = Arc::new(
            Service::open(dir.path().join("service.json"))
                .await
                .unwrap(),
        );
        let runtime = Arc::new(WorkspaceRuntime::new(service, Arc::new(NativeVault)));
        let model = json!({"method":"model","payload":{"choices":[{"message":{"role":"assistant","tool_calls":[{"id":"help-1","type":"function","function":{"name":"ask_human","arguments":"{\"question\":\"Which folder?\"}"}}]}}]}});
        let tool = json!({"method":"tool","payload":{"call_id":"help-1","name":"ask_human","arguments":{"question":"Which folder?"}}});
        let python_pid = dir.path().join("python.pid");
        let context_pid = dir.path().join("context.pid");
        let processes = ExecutorProcesses {
            python: ProcessSpec { program: "/bin/sh".into(), args: vec!["-c".into(), format!("printf '%s\n' $$ > \"$1\"\nIFS= read -r start\nprintf '%s\n' '{model}'\nIFS= read -r reply\nprintf '%s\n' '{tool}'\nIFS= read -r reply\n"), "fixture".into(), python_pid.display().to_string()] },
            context: ProcessSpec { program: "/bin/sh".into(), args: vec!["-c".into(), "printf '%s\n' $$ > \"$1\"\nwhile IFS= read -r line; do :; done".into(), "fixture".into(), context_pid.display().to_string()] },
        };
        let identity = SessionIdentity {
            workspace_id: WorkspaceId::new(),
            session_id: SessionId::new(),
        };
        let id = Uuid::new_v4();
        let runner = TaskRunner::new(root.clone(), runtime.clone(), processes.clone())
            .await
            .unwrap();
        let mut changes = runner.subscribe();
        let task = CuaTask::create_with_id(
            runner.path(id),
            id,
            identity,
            vec![json!({"role":"user","content":"fixture"})],
            vec![],
        )
        .await
        .unwrap();
        runner.launch(&mut *runner.state.lock().await, task, assignment().into());
        let request = tokio::time::timeout(std::time::Duration::from_secs(10), async {
            loop {
                let record = runner.snapshot(id).await.unwrap();
                if record.state == TaskState::WaitingForHuman {
                    break record.help_requests[0].clone();
                }
                changes.changed().await.unwrap();
            }
        })
        .await
        .unwrap();
        runner.close().await.unwrap();
        for path in [python_pid, context_pid] {
            let pid = tokio::fs::read_to_string(path).await.unwrap();
            assert!(
                !std::path::Path::new(&format!("/proc/{}", pid.trim())).exists(),
                "child outlived human hand-off"
            );
        }
        drop(runner);
        let runner = TaskRunner::new(root, runtime, processes).await.unwrap();
        assert_eq!(
            runner.snapshot(id).await.unwrap().state,
            TaskState::WaitingForHuman
        );
        assert!(runner
            .answer_help(id, request.id, Some("Documents".into()))
            .await
            .is_err());
        let record = runner.snapshot(id).await.unwrap();
        assert_eq!(record.state, TaskState::Interrupted);
        assert_eq!(
            record.help_requests[0].response.as_deref(),
            Some("Documents")
        );
        assert!(matches!(
            runner
                .answer_help(id, request.id, Some("Desktop".into()))
                .await,
            Err(TaskRunnerError::Executor(ExecutorError::InvalidMessage))
        ));
        assert_eq!(
            CuaTask::open(runner.path(id))
                .await
                .unwrap()
                .snapshot()
                .help_requests[0]
                .response
                .as_deref(),
            Some("Documents")
        );
        runner.close().await.unwrap();
    }

    #[tokio::test]
    async fn actors_pause_replan_restore_and_shutdown_without_replaying_old_actions() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("tasks");
        let service = Arc::new(
            Service::open(dir.path().join("service.json"))
                .await
                .unwrap(),
        );
        let runtime = Arc::new(WorkspaceRuntime::new(service, Arc::new(NativeVault)));
        // The existing JSON-lines process boundary exercises real child lifetime,
        // but no model or guest request is dispatched in this case.
        let model = json!({"method":"model","payload":{"choices":[{"message":{"role":"assistant","tool_calls":[{"id":"old-action","type":"function","function":{"name":"command","arguments":"{\"command\":\"true\"}"}}]}}]}});
        let tool = json!({"method":"tool","payload":{"call_id":"old-action","name":"command","arguments":{"command":"true"}}});
        let python_pid = dir.path().join("python.pid");
        let context_pid = dir.path().join("context.pid");
        let processes = ExecutorProcesses {
            python: ProcessSpec { program: "/bin/sh".into(), args: vec!["-c".into(), format!("printf '%s\\n' $$ > \"$1\"\nIFS= read -r start\nprintf '%s\\n' '{model}'\nIFS= read -r reply\nprintf '%s\\n' '{tool}'\nIFS= read -r reply\n"), "fixture".into(), python_pid.display().to_string()] },
            context: ProcessSpec { program: "/bin/sh".into(), args: vec!["-c".into(), "printf '%s\\n' $$ > \"$1\"\nwhile IFS= read -r line; do :; done".into(), "fixture".into(), context_pid.display().to_string()] },
        };
        let identity = SessionIdentity {
            workspace_id: WorkspaceId::new(),
            session_id: SessionId::new(),
        };
        let id = Uuid::new_v4();
        let runner = TaskRunner::new(root.clone(), runtime.clone(), processes.clone())
            .await
            .unwrap();
        let mut changes = runner.subscribe();
        let task = CuaTask::create_with_id(
            runner.path(id),
            id,
            identity,
            vec![json!({"role":"user","content":"fixture"})],
            vec![
                FunctionTool {
                    name: "command".into(),
                    description: "fixture".into(),
                    parameters: json!({"type":"object"}),
                    binding: ToolBinding::Shell {
                        cwd: GuestPath("/tmp".into()),
                    },
                },
                FunctionTool {
                    name: "get_desktop_state".into(),
                    description: "fresh desktop".into(),
                    parameters: json!({"type":"object"}),
                    binding: ToolBinding::Desktop {
                        name: "get_desktop_state".into(),
                    },
                },
            ],
        )
        .await
        .unwrap();
        runner.launch(&mut *runner.state.lock().await, task, assignment().into());
        let pending = next_approval(&runner, &mut changes).await;
        assert!(matches!(
            serde_json::from_value::<GuestRequest>(pending.request.clone())
                .unwrap()
                .operation,
            GuestOperationKind::Exec { .. }
        ));
        runner.pause(identity).await.unwrap();
        assert!(runner.approvals().await.unwrap().is_empty());
        assert!(matches!(
            runner.decide(pending.id, true).await,
            Err(TaskRunnerError::NotFound)
        ));
        let paused = runner.snapshot(id).await.unwrap();
        assert_eq!(paused.state, TaskState::Paused);
        assert!(paused.calls.is_empty());
        for path in [python_pid, context_pid] {
            let pid = tokio::fs::read_to_string(path).await.unwrap();
            assert!(
                !std::path::Path::new(&format!("/proc/{}", pid.trim())).exists(),
                "child outlived pause"
            );
        }
        runner.close().await.unwrap();
        drop(runner);

        let runner = TaskRunner::new(root.clone(), runtime.clone(), processes.clone())
            .await
            .unwrap();
        assert_eq!(runner.list().await.unwrap()[0].state, TaskState::Paused);
        let mut changes = runner.subscribe();
        let task = CuaTask::open(runner.path(id)).await.unwrap();
        runner.launch(&mut *runner.state.lock().await, task, assignment().into());
        let refresh = next_approval(&runner, &mut changes).await;
        assert!(refresh.request["operation"]["tool"] == "get_desktop_state");
        let record = runner.snapshot(id).await.unwrap();
        let skipped = record
            .messages
            .iter()
            .find(|message| message["role"] == "tool" && message["tool_call_id"] == "old-action")
            .unwrap();
        let skipped: serde_json::Value =
            serde_json::from_str(skipped["content"].as_str().unwrap()).unwrap();
        assert_eq!(skipped["effect"], "none");
        assert_eq!(skipped["status"], "skipped");
        runner.close().await.unwrap();
        assert!(runner.approvals().await.unwrap().is_empty());
        assert!(matches!(
            runner.decide(refresh.id, true).await,
            Err(TaskRunnerError::NotFound)
        ));
        assert_eq!(
            runner.snapshot(id).await.unwrap().state,
            TaskState::Cancelled
        );
        assert!(runner.snapshot(id).await.unwrap().calls.is_empty());
        drop(runner);
        let runner = TaskRunner::new(root, runtime, processes).await.unwrap();
        let restored = runner.snapshot(id).await.unwrap();
        assert_eq!(restored.state, TaskState::Cancelled);
        assert!(restored.replan_after_takeover);
        assert!(restored
            .history
            .iter()
            .any(|event| event.state == TaskState::Paused));
        assert!(!tokio::fs::read_to_string(runner.path(id))
            .await
            .unwrap()
            .contains("memory-only-fixture-secret"));
        runner.close().await.unwrap();
    }
}
