//! Durable schedule/occurrence ownership; execution stays in the existing TaskRunner.
use std::{
    path::PathBuf,
    sync::Arc,
    time::{SystemTime, UNIX_EPOCH},
};

use serde::{Deserialize, Serialize};
use tokio::sync::Mutex;
use uuid::Uuid;

use crate::{
    contract::{SessionIdentity, WorkspaceId},
    executor::TaskState,
    service::{ModelAssignment, Service, ServiceError},
    store::Store,
    tasks::{TaskRunner, TaskRunnerError},
    workspace::{WorkspaceError, WorkspaceRuntime},
};

pub fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum Timing {
    Once { at: u64 },
    Interval { first_at: u64, every_seconds: u64 },
}
impl Timing {
    fn first(&self) -> u64 {
        match self {
            Self::Once { at } => *at,
            Self::Interval { first_at, .. } => *first_at,
        }
    }
    fn valid(&self) -> bool {
        self.first() > 0
            && !matches!(
                self,
                Self::Interval {
                    every_seconds: 0,
                    ..
                }
            )
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MissedRunPolicy {
    SkipMissed,
    RunLatest,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CreateSchedule {
    pub workspace_id: WorkspaceId,
    pub prompt: String,
    pub timing: Timing,
    pub missed_run_policy: MissedRunPolicy,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SetEnabled {
    pub id: Uuid,
    pub enabled: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum OccurrenceState {
    Queued,
    Dispatching,
    Dispatched,
    Completed,
    NeedsReview,
    Skipped,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Occurrence {
    /// The task ID is reserved in the schedule journal before dispatch.
    pub task_id: Uuid,
    pub due_at: u64,
    pub state: OccurrenceState,
    pub note: Option<String>,
    pub retry_at: Option<u64>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Schedule {
    pub id: Uuid,
    pub workspace_id: WorkspaceId,
    pub prompt: String,
    /// The explicit bot-owned assignment at creation; never includes the secret.
    pub assignment: ModelAssignment,
    pub timing: Timing,
    pub missed_run_policy: MissedRunPolicy,
    pub enabled: bool,
    pub enabled_since: u64,
    pub next_at: Option<u64>,
    pub occurrences: Vec<Occurrence>,
}

#[derive(Clone, Default, Serialize, Deserialize)]
struct Journal {
    schedules: Vec<Schedule>,
}
struct State {
    journal: Journal,
    fault: bool,
    stopped: Option<String>,
}
#[derive(Serialize)]
pub struct ScheduleListing {
    pub schedules: Vec<Schedule>,
    pub stopped: Option<String>,
}
pub struct Schedules {
    store: Arc<Store>,
    state: Mutex<State>,
    recovered_before: u64,
    revision: std::sync::atomic::AtomicU64,
}

impl Schedules {
    pub async fn open(path: PathBuf) -> Result<Self, WorkspaceError> {
        Self::open_at(path, now()).await
    }
    async fn open_at(path: PathBuf, at: u64) -> Result<Self, WorkspaceError> {
        let store = Arc::new(Store::open(path).await?);
        let journal: Journal = store.load().await?.unwrap_or_default();
        let mut ids = std::collections::BTreeSet::new();
        let mut tasks = std::collections::BTreeSet::new();
        for schedule in &journal.schedules {
            if schedule.id.is_nil()
                || !ids.insert(schedule.id)
                || schedule.prompt.trim().is_empty()
                || !schedule.timing.valid()
                || schedule.assignment.workspace_id != schedule.workspace_id
                || schedule.assignment.validate().is_err()
                || schedule.occurrences.iter().any(|occurrence| {
                    occurrence.task_id.is_nil() || !tasks.insert(occurrence.task_id)
                })
            {
                return Err(ServiceError::InvalidState.into());
            }
        }
        Ok(Self {
            store,
            state: Mutex::new(State {
                journal,
                fault: false,
                stopped: None,
            }),
            recovered_before: at,
            revision: std::sync::atomic::AtomicU64::new(0),
        })
    }

    async fn publish(&self, state: &mut State, journal: Journal) -> Result<(), WorkspaceError> {
        if state.fault {
            return Err(ServiceError::Persistence.into());
        }
        // Any uncertain publication freezes this owner until reopen. A stale in-memory
        // cursor must never dispatch another occurrence after an unconfirmed write.
        if let Err(error) = self.store.save(&journal).await {
            state.fault = true;
            return Err(error.into());
        }
        state.journal = journal;
        self.revision
            .fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        Ok(())
    }

    pub async fn list_for_client(&self) -> ScheduleListing {
        let state = self.state.lock().await;
        ScheduleListing {
            schedules: state.journal.schedules.clone(),
            stopped: state.stopped.clone().or_else(|| {
                state
                    .fault
                    .then(|| "Schedule journal publication could not be confirmed".into())
            }),
        }
    }

    pub(crate) async fn mark_stopped(&self, reason: String) {
        self.state.lock().await.stopped = Some(reason);
        self.revision
            .fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    }

    pub async fn list(&self) -> Vec<Schedule> {
        self.state.lock().await.journal.schedules.clone()
    }

    pub async fn create(
        &self,
        input: CreateSchedule,
        assignment: ModelAssignment,
    ) -> Result<Schedule, WorkspaceError> {
        self.create_at(input, assignment, now()).await
    }

    async fn create_at(
        &self,
        input: CreateSchedule,
        assignment: ModelAssignment,
        at: u64,
    ) -> Result<Schedule, WorkspaceError> {
        if input.prompt.trim().is_empty()
            || !input.timing.valid()
            || input.workspace_id != assignment.workspace_id
        {
            return Err(ServiceError::InvalidState.into());
        }
        assignment.validate()?;
        let schedule = Schedule {
            id: Uuid::new_v4(),
            workspace_id: input.workspace_id,
            prompt: input.prompt,
            next_at: Some(input.timing.first()),
            timing: input.timing,
            missed_run_policy: input.missed_run_policy,
            assignment,
            enabled: true,
            enabled_since: at,
            occurrences: vec![],
        };
        let mut state = self.state.lock().await;
        let mut next = state.journal.clone();
        next.schedules.push(schedule.clone());
        self.publish(&mut state, next).await?;
        Ok(schedule)
    }

    pub async fn set_enabled(&self, input: SetEnabled) -> Result<Schedule, WorkspaceError> {
        self.set_enabled_at(input, now()).await
    }

    async fn set_enabled_at(&self, input: SetEnabled, at: u64) -> Result<Schedule, WorkspaceError> {
        let mut state = self.state.lock().await;
        let mut next = state.journal.clone();
        let schedule = next
            .schedules
            .iter_mut()
            .find(|schedule| schedule.id == input.id)
            .ok_or(WorkspaceError::NotFound)?;
        if input.enabled && !schedule.enabled {
            schedule.enabled_since = at;
        }
        schedule.enabled = input.enabled;
        if !input.enabled {
            for occurrence in &mut schedule.occurrences {
                if occurrence.state == OccurrenceState::Queued {
                    occurrence.state = OccurrenceState::Skipped;
                    occurrence.note = Some("Schedule disabled before dispatch".into());
                    occurrence.retry_at = None;
                }
            }
        }
        let saved = schedule.clone();
        self.publish(&mut state, next).await?;
        Ok(saved)
    }

    async fn plan_due(&self, at: u64) -> Result<(), WorkspaceError> {
        let mut state = self.state.lock().await;
        if state.fault {
            return Err(ServiceError::Persistence.into());
        }
        let mut next = state.journal.clone();
        let mut changed = false;
        for schedule in &mut next.schedules {
            let Some(due) = schedule.next_at.filter(|due| *due <= at) else {
                continue;
            };
            if !schedule.enabled
                || schedule.occurrences.iter().any(|occurrence| {
                    !matches!(
                        occurrence.state,
                        OccurrenceState::Completed | OccurrenceState::Skipped
                    )
                })
            {
                continue;
            }
            let (latest, following, multiple) = match schedule.timing {
                Timing::Once { .. } => (due, None, false),
                Timing::Interval { every_seconds, .. } => {
                    let count = (at - due) / every_seconds;
                    let latest = due + count * every_seconds;
                    (latest, latest.checked_add(every_seconds), count > 0)
                }
            };
            // Disabled time and restart are missed runs. A multi-slot backlog (for
            // example after sleep) is never replayed; skip_missed discards it all.
            let skip = schedule.missed_run_policy == MissedRunPolicy::SkipMissed
                && (due < self.recovered_before.max(schedule.enabled_since) || multiple);
            schedule.occurrences.push(Occurrence {
                task_id: Uuid::new_v4(),
                due_at: latest,
                state: if skip {
                    OccurrenceState::Skipped
                } else {
                    OccurrenceState::Queued
                },
                note: if skip {
                    Some("Missed occurrences skipped".into())
                } else {
                    None
                },
                retry_at: None,
            });
            schedule.next_at = following;
            changed = true;
        }
        if changed {
            self.publish(&mut state, next).await?;
        }
        Ok(())
    }

    async fn update(
        &self,
        task_id: Uuid,
        status: OccurrenceState,
        note: Option<String>,
    ) -> Result<(), WorkspaceError> {
        let mut state = self.state.lock().await;
        let mut next = state.journal.clone();
        let occurrence = next
            .schedules
            .iter_mut()
            .flat_map(|schedule| &mut schedule.occurrences)
            .find(|occurrence| occurrence.task_id == task_id)
            .ok_or(WorkspaceError::NotFound)?;
        if occurrence.state == status && occurrence.note == note && occurrence.retry_at.is_none() {
            return Ok(());
        }
        occurrence.state = status;
        occurrence.note = note;
        occurrence.retry_at = None;
        self.publish(&mut state, next).await
    }

    async fn delay_retry(
        &self,
        task_id: Uuid,
        at: u64,
        note: String,
    ) -> Result<(), WorkspaceError> {
        let mut state = self.state.lock().await;
        let mut next = state.journal.clone();
        let occurrence = next
            .schedules
            .iter_mut()
            .flat_map(|schedule| &mut schedule.occurrences)
            .find(|occurrence| occurrence.task_id == task_id)
            .ok_or(WorkspaceError::NotFound)?;
        if occurrence.state != OccurrenceState::Queued {
            return Ok(());
        }
        // Retry failed connection/readiness once per 30 seconds, including after
        // restart. The service's one-second wake must not become an SSH retry loop.
        occurrence.retry_at = Some(at.saturating_add(30));
        occurrence.note = Some(note);
        self.publish(&mut state, next).await
    }

    async fn begin_dispatch(&self, task_id: Uuid) -> Result<bool, WorkspaceError> {
        let mut state = self.state.lock().await;
        let mut next = state.journal.clone();
        for schedule in &mut next.schedules {
            let blocked = schedule
                .occurrences
                .iter()
                .any(|occurrence| occurrence.state == OccurrenceState::NeedsReview);
            if let Some(occurrence) = schedule
                .occurrences
                .iter_mut()
                .find(|occurrence| occurrence.task_id == task_id)
            {
                if blocked || !schedule.enabled || occurrence.state != OccurrenceState::Queued {
                    return Ok(false);
                }
                occurrence.state = OccurrenceState::Dispatching;
                self.publish(&mut state, next).await?;
                return Ok(true);
            }
        }
        Err(WorkspaceError::NotFound)
    }

    pub async fn tick(
        &self,
        at: u64,
        tasks: &TaskRunner,
        service: &Service,
        runtime: &WorkspaceRuntime,
    ) -> Result<(), WorkspaceError> {
        let revision = self.revision.load(std::sync::atomic::Ordering::Relaxed);
        // Reconcile first: unknown prior dispatch holds the schedule before planning
        // another occurrence. Completed tasks release the next interval.
        for schedule in self.list().await {
            for occurrence in &schedule.occurrences {
                if matches!(
                    occurrence.state,
                    OccurrenceState::Skipped | OccurrenceState::Completed
                ) {
                    continue;
                }
                match tasks.snapshot(occurrence.task_id).await {
                    Ok(record) => {
                        // Reattach the existing task; never auto-resume an interrupted
                        // Cua loop or repeat a potentially completed external action.
                        let review = matches!(
                            record.state,
                            TaskState::Ready
                                | TaskState::NeedsReview
                                | TaskState::Interrupted
                                | TaskState::Cancelled
                                | TaskState::Paused
                        );
                        let status = if review {
                            OccurrenceState::NeedsReview
                        } else if record.state == TaskState::Completed {
                            OccurrenceState::Completed
                        } else {
                            OccurrenceState::Dispatched
                        };
                        if occurrence.state != status {
                            self.update(occurrence.task_id, status,
                                review.then(|| "Review the saved task before resuming; future occurrences are held".into())).await?;
                        }
                        continue;
                    }
                    Err(TaskRunnerError::NotFound) => {}
                    Err(error) => return Err(WorkspaceError::Connector(error.to_string())),
                }
                if occurrence.state == OccurrenceState::NeedsReview {
                    continue;
                }
                if matches!(
                    occurrence.state,
                    OccurrenceState::Dispatching | OccurrenceState::Dispatched
                ) {
                    self.update(occurrence.task_id, OccurrenceState::NeedsReview,
                        Some("Dispatch outcome is unknown; this occurrence will not be retried automatically".into())).await?;
                    continue;
                }
            }
        }
        self.plan_due(at).await?;
        for schedule in self.list().await {
            for occurrence in &schedule.occurrences {
                if !schedule.enabled
                    || occurrence.state != OccurrenceState::Queued
                    || occurrence.retry_at.is_some_and(|retry| retry > at)
                {
                    continue;
                }
                let current = match service.model_assignment(schedule.workspace_id).await {
                    Ok(assignment) => assignment,
                    Err(error) => {
                        self.update(
                            occurrence.task_id,
                            OccurrenceState::NeedsReview,
                            Some(error.to_string()),
                        )
                        .await?;
                        continue;
                    }
                };
                if current.as_ref() != Some(&schedule.assignment) {
                    self.update(occurrence.task_id, OccurrenceState::NeedsReview,
                        Some("Bot inference assignment changed; create a schedule for the new assignment".into())).await?;
                    continue;
                }
                let Some(identity) = service
                    .live_sessions()
                    .await
                    .into_iter()
                    .find(|identity| identity.workspace_id == schedule.workspace_id)
                else {
                    // A new session identity is explicit and persists only in the task
                    // after SSH verifies the dedicated registered workspace.
                    let identity = SessionIdentity {
                        workspace_id: schedule.workspace_id,
                        session_id: crate::contract::SessionId::new(),
                    };
                    if let Err(error) = runtime.connect(identity).await {
                        self.delay_retry(occurrence.task_id, at, error.to_string())
                            .await?;
                        continue;
                    }
                    // Retry next tick after the live-session owner publishes readiness.
                    self.update(occurrence.task_id, OccurrenceState::Queued, None)
                        .await?;
                    continue;
                };
                // Resolve credentials and control readiness before the dispatch marker.
                // No secret enters the schedule journal.
                let assignment = match runtime
                    .resolve_model_assignment(schedule.workspace_id)
                    .await
                {
                    Ok(value) => value,
                    Err(error) => {
                        self.delay_retry(occurrence.task_id, at, error.to_string())
                            .await?;
                        continue;
                    }
                };
                // Bind the saved identity even if the user edits inference while the
                // vault is unlocking. A changed assignment must never receive this run.
                if assignment.api_base != schedule.assignment.api_base
                    || assignment.model != schedule.assignment.model
                    || assignment.context_tokens != schedule.assignment.context_tokens
                    || service
                        .model_assignment(schedule.workspace_id)
                        .await?
                        .as_ref()
                        != Some(&schedule.assignment)
                {
                    self.update(
                        occurrence.task_id,
                        OccurrenceState::NeedsReview,
                        Some("Bot inference assignment changed before dispatch".into()),
                    )
                    .await?;
                    continue;
                }
                if let Err(error) = runtime.desktop_tools(identity).await {
                    self.delay_retry(occurrence.task_id, at, error.to_string())
                        .await?;
                    continue;
                }
                if !self.begin_dispatch(occurrence.task_id).await? {
                    continue;
                }
                match tasks
                    .start_with_id(
                        occurrence.task_id,
                        identity,
                        schedule.prompt.clone(),
                        Some(assignment),
                    )
                    .await
                {
                    Ok(_) => {
                        self.update(occurrence.task_id, OccurrenceState::Dispatched, None)
                            .await?
                    }
                    Err(error) => {
                        self.update(
                            occurrence.task_id,
                            OccurrenceState::NeedsReview,
                            Some(error.to_string()),
                        )
                        .await?
                    }
                }
            }
        }
        if revision != self.revision.load(std::sync::atomic::Ordering::Relaxed) {
            tasks.notify();
        }
        Ok(())
    }
}

#[cfg(all(test, target_os = "linux"))]
mod tests {
    use super::*;
    use crate::{
        contract::{GuestRequest, SessionId},
        executor::{
            ApprovalFuture, Assignment, CuaTask, ExecutorProcesses, ProcessSpec, ToolApproval,
        },
        vault::{NativeVault, Secret, Vault, VaultError, VaultFuture},
    };
    use serde_json::json;

    fn assignment() -> ModelAssignment {
        ModelAssignment {
            workspace_id: WorkspaceId::new(),
            api_base: "http://unused/v1".into(),
            model: "fixture".into(),
            context_tokens: 131072,
            credential_ref: None,
        }
    }
    fn input(
        assignment: &ModelAssignment,
        timing: Timing,
        policy: MissedRunPolicy,
    ) -> CreateSchedule {
        CreateSchedule {
            workspace_id: assignment.workspace_id,
            prompt: "Scheduled fixture".into(),
            timing,
            missed_run_policy: policy,
        }
    }
    fn fake_processes(effect: &std::path::Path) -> ExecutorProcesses {
        // Same JSON subprocess protocol used by TaskRunner's existing hermetic executor.
        ExecutorProcesses {
            python: ProcessSpec { program: "/bin/sh".into(), args: vec!["-c".into(), "IFS= read -r start\nprintf 'effect\\n' >> \"$1\"\nprintf '%s\\n' '{\"method\":\"done\",\"payload\":{}}'\nIFS= read -r reply".into(), "fixture".into(), effect.display().to_string()] },
            context: ProcessSpec { program: "/bin/sh".into(), args: vec!["-c".into(), "while IFS= read -r line; do :; done".into()] },
        }
    }
    struct Deny;
    impl ToolApproval for Deny {
        fn approve<'a>(&'a self, _: Uuid, _: &'a GuestRequest) -> ApprovalFuture<'a> {
            Box::pin(async { false })
        }
    }

    struct LockedConnectionVault(std::sync::atomic::AtomicUsize);
    impl Vault for LockedConnectionVault {
        fn get(&self, _: Uuid) -> VaultFuture<'_, Option<Secret>> {
            self.0.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
            Box::pin(async { Err(VaultError::AccessDenied) })
        }
        fn put(&self, _: Uuid, _: Secret) -> VaultFuture<'_, ()> {
            Box::pin(async { Err(VaultError::AccessDenied) })
        }
        fn delete(&self, _: Uuid) -> VaultFuture<'_, ()> {
            Box::pin(async { Err(VaultError::AccessDenied) })
        }
    }

    #[tokio::test]
    async fn connection_failure_retry_deadline_survives_restart_and_bounds_attempts() {
        use crate::contract::{
            BotPc, ServicePc, SshConnection, SshEndpoint, SshHostPublicKey, VaultCredentialRef,
            WorkspaceConfig, WorkspaceConnection,
        };
        use russh::keys::{Algorithm, PrivateKey};
        let dir = tempfile::tempdir().unwrap();
        let assignment = assignment();
        let service = Arc::new(
            Service::open(dir.path().join("service.json"))
                .await
                .unwrap(),
        );
        let private =
            PrivateKey::random(&mut russh::keys::key::safe_rng(), Algorithm::Ed25519).unwrap();
        let public = private.public_key().to_openssh().unwrap();
        let (algorithm, public_key) = public.split_once(' ').unwrap();
        service
            .register_workspace(WorkspaceConfig {
                id: assignment.workspace_id,
                name: "Dedicated retry fixture".into(),
                service_pc: ServicePc::Local,
                bot_pc: BotPc::Lan {
                    computer_id: Uuid::new_v4(),
                },
                connection: WorkspaceConnection::Ssh(SshConnection {
                    endpoint: SshEndpoint {
                        hostname: "127.0.0.1".into(),
                        port: 2222,
                        user: "fixture".into(),
                    },
                    pinned_host_key: SshHostPublicKey {
                        algorithm: algorithm.into(),
                        public_key: public_key.into(),
                    },
                    credential_ref: VaultCredentialRef::new(),
                }),
            })
            .await
            .unwrap();
        service
            .save_model_assignment(assignment.clone())
            .await
            .unwrap();
        let vault = Arc::new(LockedConnectionVault(std::sync::atomic::AtomicUsize::new(
            0,
        )));
        let runtime = Arc::new(WorkspaceRuntime::new(service.clone(), vault.clone()));
        let runner = TaskRunner::new(
            dir.path().join("tasks"),
            runtime.clone(),
            fake_processes(&dir.path().join("effects")),
        )
        .await
        .unwrap();
        let path = dir.path().join("schedules.json");
        let schedules = Schedules::open_at(path.clone(), 90).await.unwrap();
        schedules
            .create_at(
                input(
                    &assignment,
                    Timing::Once { at: 100 },
                    MissedRunPolicy::RunLatest,
                ),
                assignment,
                90,
            )
            .await
            .unwrap();
        for at in [100, 101, 129] {
            schedules
                .tick(at, &runner, &service, &runtime)
                .await
                .unwrap();
        }
        assert_eq!(vault.0.load(std::sync::atomic::Ordering::Relaxed), 1);
        assert_eq!(schedules.list().await[0].occurrences[0].retry_at, Some(130));
        drop(schedules);
        let schedules = Schedules::open_at(path, 129).await.unwrap();
        schedules
            .tick(129, &runner, &service, &runtime)
            .await
            .unwrap();
        assert_eq!(vault.0.load(std::sync::atomic::Ordering::Relaxed), 1);
        schedules
            .tick(130, &runner, &service, &runtime)
            .await
            .unwrap();
        assert_eq!(vault.0.load(std::sync::atomic::Ordering::Relaxed), 2);
        assert_eq!(schedules.list().await[0].occurrences[0].retry_at, Some(160));
        assert!(runner.list().await.unwrap().is_empty());
        runner.close().await.unwrap();
    }

    #[tokio::test]
    async fn due_occurrence_is_persisted_before_fake_executor_and_reattaches_after_restart() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("schedules.json");
        let schedules = Schedules::open_at(path.clone(), 90).await.unwrap();
        let assignment = assignment();
        schedules
            .create_at(
                input(
                    &assignment,
                    Timing::Once { at: 100 },
                    MissedRunPolicy::RunLatest,
                ),
                assignment.clone(),
                90,
            )
            .await
            .unwrap();
        schedules.plan_due(100).await.unwrap();
        let occurrence = schedules.list().await[0].occurrences[0].clone();
        let persisted: Journal =
            serde_json::from_slice(&tokio::fs::read(&path).await.unwrap()).unwrap();
        assert_eq!(
            persisted.schedules[0].occurrences[0].task_id,
            occurrence.task_id
        );
        assert_eq!(occurrence.state, OccurrenceState::Queued);
        schedules.begin_dispatch(occurrence.task_id).await.unwrap();
        let root = dir.path().join("tasks");
        let service = Arc::new(
            Service::open(dir.path().join("service.json"))
                .await
                .unwrap(),
        );
        let runtime = Arc::new(WorkspaceRuntime::new(
            service.clone(),
            Arc::new(NativeVault),
        ));
        let effect = dir.path().join("effects");
        let processes = fake_processes(&effect);
        let identity = SessionIdentity {
            workspace_id: assignment.workspace_id,
            session_id: SessionId::new(),
        };
        let mut task = CuaTask::create_with_id(
            root.join(format!("{}.json", occurrence.task_id)),
            occurrence.task_id,
            identity,
            vec![json!({"role":"user","content":"fixture"})],
            vec![],
        )
        .await
        .unwrap();
        let (_keep_alive, cancel) = tokio::sync::watch::channel(false);
        tokio::time::timeout(
            std::time::Duration::from_secs(5),
            task.run(
                &runtime,
                &Deny,
                &Assignment {
                    api_base: assignment.api_base,
                    api_key: None,
                    model: assignment.model,
                    context_tokens: assignment.context_tokens,
                },
                &processes,
                cancel,
            ),
        )
        .await
        .unwrap()
        .unwrap();
        drop(task);
        drop(schedules);
        let schedules = Schedules::open_at(path, 150).await.unwrap();
        let runner = TaskRunner::new(root, runtime.clone(), processes)
            .await
            .unwrap();
        for at in [150, 200] {
            schedules
                .tick(at, &runner, &service, &runtime)
                .await
                .unwrap();
        }
        assert_eq!(
            schedules.list().await[0].occurrences[0].state,
            OccurrenceState::Completed
        );
        assert_eq!(runner.list().await.unwrap().len(), 1);
        assert_eq!(tokio::fs::read_to_string(effect).await.unwrap(), "effect\n");
        runner.close().await.unwrap();
    }

    #[tokio::test]
    async fn disabled_schedule_never_dispatches_and_disable_cancels_queued_occurrence() {
        let dir = tempfile::tempdir().unwrap();
        let schedules = Schedules::open_at(dir.path().join("schedules.json"), 90)
            .await
            .unwrap();
        let assignment = assignment();
        let schedule = schedules
            .create_at(
                input(
                    &assignment,
                    Timing::Interval {
                        first_at: 100,
                        every_seconds: 10,
                    },
                    MissedRunPolicy::RunLatest,
                ),
                assignment,
                90,
            )
            .await
            .unwrap();
        schedules.plan_due(100).await.unwrap();
        let id = schedules.list().await[0].occurrences[0].task_id;
        schedules
            .set_enabled(SetEnabled {
                id: schedule.id,
                enabled: false,
            })
            .await
            .unwrap();
        schedules.plan_due(200).await.unwrap();
        assert!(!schedules.begin_dispatch(id).await.unwrap());
        let saved = schedules.list().await;
        assert_eq!(saved[0].occurrences.len(), 1);
        assert_eq!(saved[0].occurrences[0].state, OccurrenceState::Skipped);
        let assignment = self::assignment();
        let skip = schedules
            .create_at(
                input(
                    &assignment,
                    Timing::Interval {
                        first_at: 100,
                        every_seconds: 10,
                    },
                    MissedRunPolicy::SkipMissed,
                ),
                assignment,
                90,
            )
            .await
            .unwrap();
        schedules
            .set_enabled_at(
                SetEnabled {
                    id: skip.id,
                    enabled: false,
                },
                95,
            )
            .await
            .unwrap();
        schedules
            .set_enabled_at(
                SetEnabled {
                    id: skip.id,
                    enabled: true,
                },
                105,
            )
            .await
            .unwrap();
        schedules.plan_due(105).await.unwrap();
        let saved = schedules.list().await;
        assert_eq!(saved[1].occurrences[0].state, OccurrenceState::Skipped);
        assert_eq!(saved[1].next_at, Some(110));
    }

    #[tokio::test]
    async fn restart_and_interval_backlog_follow_explicit_missed_run_policies() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("schedules.json");
        let schedules = Schedules::open_at(path.clone(), 90).await.unwrap();
        for policy in [MissedRunPolicy::SkipMissed, MissedRunPolicy::RunLatest] {
            let assignment = assignment();
            schedules
                .create_at(
                    input(
                        &assignment,
                        Timing::Interval {
                            first_at: 100,
                            every_seconds: 10,
                        },
                        policy,
                    ),
                    assignment,
                    90,
                )
                .await
                .unwrap();
        }
        drop(schedules);
        let schedules = Schedules::open_at(path, 136).await.unwrap();
        schedules.plan_due(136).await.unwrap();
        let saved = schedules.list().await;
        assert_eq!(saved[0].occurrences[0].state, OccurrenceState::Skipped);
        assert_eq!(saved[1].occurrences[0].state, OccurrenceState::Queued);
        for schedule in &saved {
            assert_eq!(schedule.occurrences.len(), 1);
            assert_eq!(schedule.occurrences[0].due_at, 130);
            assert_eq!(schedule.next_at, Some(140));
        }
        schedules.plan_due(136).await.unwrap();
        assert_eq!(schedules.list().await[1].occurrences.len(), 1);
        schedules.plan_due(140).await.unwrap();
        // An offline/pending occurrence is retained, not multiplied every interval.
        assert_eq!(schedules.list().await[1].occurrences.len(), 1);
        assert_eq!(
            schedules.list().await[0].occurrences[1].state,
            OccurrenceState::Queued
        );
    }

    #[tokio::test]
    async fn ambiguous_dispatch_after_restart_needs_review_and_holds_future_occurrences() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("schedules.json");
        let schedules = Schedules::open_at(path.clone(), 90).await.unwrap();
        let assignment = assignment();
        schedules
            .create_at(
                input(
                    &assignment,
                    Timing::Interval {
                        first_at: 100,
                        every_seconds: 10,
                    },
                    MissedRunPolicy::RunLatest,
                ),
                assignment,
                90,
            )
            .await
            .unwrap();
        schedules.plan_due(100).await.unwrap();
        let id = schedules.list().await[0].occurrences[0].task_id;
        schedules.begin_dispatch(id).await.unwrap();
        drop(schedules);
        let schedules = Schedules::open_at(path, 100).await.unwrap();
        let service = Arc::new(
            Service::open(dir.path().join("service.json"))
                .await
                .unwrap(),
        );
        let runtime = Arc::new(WorkspaceRuntime::new(
            service.clone(),
            Arc::new(NativeVault),
        ));
        let effect = dir.path().join("effects");
        let runner = TaskRunner::new(
            dir.path().join("tasks"),
            runtime.clone(),
            fake_processes(&effect),
        )
        .await
        .unwrap();
        schedules
            .tick(100, &runner, &service, &runtime)
            .await
            .unwrap();
        schedules
            .tick(140, &runner, &service, &runtime)
            .await
            .unwrap();
        let saved = schedules.list().await;
        assert_eq!(saved[0].occurrences.len(), 1);
        assert_eq!(saved[0].occurrences[0].state, OccurrenceState::NeedsReview);
        assert!(runner.list().await.unwrap().is_empty());
        assert!(!effect.exists());
        runner.close().await.unwrap();
    }

    #[tokio::test]
    async fn unconfirmed_occurrence_publication_freezes_dispatch_until_recovery() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("schedules.json");
        let schedules = Schedules::open_at(path.clone(), 90).await.unwrap();
        let assignment = assignment();
        schedules
            .create_at(
                input(
                    &assignment,
                    Timing::Once { at: 100 },
                    MissedRunPolicy::RunLatest,
                ),
                assignment,
                90,
            )
            .await
            .unwrap();
        schedules.plan_due(100).await.unwrap();
        let id = schedules.list().await[0].occurrences[0].task_id;
        schedules
            .store
            .fail_after_publish
            .store(true, std::sync::atomic::Ordering::Release);
        assert!(schedules.begin_dispatch(id).await.is_err());
        assert!(schedules.begin_dispatch(id).await.is_err());
        assert!(schedules.list_for_client().await.stopped.is_some());
        drop(schedules);
        let recovered = Schedules::open_at(path, 110).await.unwrap();
        assert_eq!(
            recovered.list().await[0].occurrences[0].state,
            OccurrenceState::Dispatching
        );
    }
}
