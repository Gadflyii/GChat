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
    /// A calendar rule in the service computer's local time zone.
    Calendar { rule: CalendarRule },
    /// Starts a task when something happens instead of at a time.
    Event { source: EventSource },
}

/// Calendar-style repetition, in the service computer's local time (daylight saving
/// included): the chosen days of the week, or the nth weekday of each month.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum CalendarRule {
    /// Days of the week, 0 = Monday to 6 = Sunday, at a local time.
    Days { days: Vec<u8>, hour: u8, minute: u8 },
    /// The nth (1 to 4) or last (5) given weekday of each month at a local time.
    MonthlyWeekday {
        nth: u8,
        weekday: u8,
        hour: u8,
        minute: u8,
    },
}

/// What starts an event schedule.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum EventSource {
    /// A new file appears in a folder on the bot's computer.
    FolderArrival { path: String },
    /// A new message file appears in a mail folder (Maildir or plain .eml files) on
    /// the service computer. Connected Google and Microsoft mailboxes are not
    /// watched yet.
    MailFolder { path: String },
    /// New mail in a connected Gmail or Outlook account linked to the bot, from the listed senders
    /// only. Read with the account's own mail tools by polling; no webhook or relay.
    ConnectedMail { account_id: String, senders: Vec<String> },
}

impl CalendarRule {
    fn valid(&self) -> bool {
        let time = |hour: u8, minute: u8| hour < 24 && minute < 60;
        match self {
            Self::Days { days, hour, minute } => {
                !days.is_empty()
                    && days.len() <= 7
                    && days.iter().all(|day| *day < 7)
                    && time(*hour, *minute)
            }
            Self::MonthlyWeekday {
                nth,
                weekday,
                hour,
                minute,
            } => (1..=5).contains(nth) && *weekday < 7 && time(*hour, *minute),
        }
    }

    /// The first run strictly after `after` (Unix seconds) in the given zone.
    pub fn next_after_in<Tz: chrono::TimeZone>(&self, zone: &Tz, after: u64) -> Option<u64> {
        use chrono::{Datelike, Duration, NaiveDate, NaiveTime, Weekday};
        if !self.valid() {
            return None;
        }
        let local_after = zone.timestamp_opt(i64::try_from(after).ok()?, 0).single()?;
        let start = local_after.date_naive();
        let (hour, minute) = match self {
            Self::Days { hour, minute, .. } | Self::MonthlyWeekday { hour, minute, .. } => {
                (u32::from(*hour), u32::from(*minute))
            }
        };
        let at_time = |date: NaiveDate| -> Option<u64> {
            // A time that does not exist (a daylight saving gap) moves to the next hour.
            for shift in 0..=2u32 {
                let naive = date.and_time(NaiveTime::from_hms_opt(hour + shift, minute, 0)?);
                let found = match zone.from_local_datetime(&naive) {
                    chrono::LocalResult::Single(value) => Some(value),
                    chrono::LocalResult::Ambiguous(first, _) => Some(first),
                    chrono::LocalResult::None => None,
                };
                if let Some(value) = found {
                    return u64::try_from(value.timestamp()).ok();
                }
            }
            None
        };
        let weekday = |index: u8| match index {
            0 => Weekday::Mon,
            1 => Weekday::Tue,
            2 => Weekday::Wed,
            3 => Weekday::Thu,
            4 => Weekday::Fri,
            5 => Weekday::Sat,
            _ => Weekday::Sun,
        };
        match self {
            Self::Days { days, .. } => (0..=8)
                .map(|offset| start + Duration::days(offset))
                .filter(|date| days.iter().any(|day| weekday(*day) == date.weekday()))
                .filter_map(at_time)
                .find(|candidate| *candidate > after),
            Self::MonthlyWeekday { nth, weekday: day, .. } => {
                let wanted = weekday(*day);
                let (mut year, mut month) = (start.year(), start.month());
                for _ in 0..16 {
                    let first = NaiveDate::from_ymd_opt(year, month, 1)?;
                    let lead = (7 + wanted.num_days_from_monday() as i64
                        - first.weekday().num_days_from_monday() as i64)
                        % 7;
                    let mut date = first + Duration::days(lead);
                    if *nth == 5 {
                        while (date + Duration::days(7)).month() == month {
                            date += Duration::days(7);
                        }
                    } else {
                        date += Duration::days(7 * i64::from(*nth - 1));
                    }
                    if date.month() == month {
                        if let Some(candidate) = at_time(date).filter(|c| *c > after) {
                            return Some(candidate);
                        }
                    }
                    if month == 12 {
                        year += 1;
                        month = 1;
                    } else {
                        month += 1;
                    }
                }
                None
            }
        }
    }

    pub fn next_after(&self, after: u64) -> Option<u64> {
        self.next_after_in(&chrono::Local, after)
    }
}

impl EventSource {
    fn valid(&self) -> bool {
        if let Self::ConnectedMail { account_id, senders } = self {
            return !account_id.trim().is_empty()
                && account_id.len() <= 256
                && (1..=20).contains(&senders.len())
                && senders.iter().all(|s| crate::triggers::sender_entry_valid(s));
        }
        let path = match self {
            Self::FolderArrival { path } | Self::MailFolder { path } => path,
            Self::ConnectedMail { .. } => unreachable!(),
        };
        let full = match self {
            Self::FolderArrival { .. } => path.starts_with('/'),
            Self::MailFolder { .. } => std::path::Path::new(path).is_absolute(),
            Self::ConnectedMail { .. } => unreachable!(),
        };
        full && !path.contains('\0') && path.len() <= 1024
    }
}

impl Timing {
    /// The first time to run, or None for an event schedule.
    fn initial(&self, now: u64) -> Option<u64> {
        match self {
            Self::Once { at } => Some(*at),
            Self::Interval { first_at, .. } => Some(*first_at),
            Self::Calendar { rule } => rule.next_after(now),
            Self::Event { .. } => None,
        }
    }
    fn valid(&self) -> bool {
        match self {
            Self::Once { at } => *at > 0,
            Self::Interval {
                first_at,
                every_seconds,
            } => *first_at > 0 && *every_seconds > 0,
            Self::Calendar { rule } => rule.valid(),
            Self::Event { source } => source.valid(),
        }
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
pub struct RunNow {
    pub id: Uuid,
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
    /// What happened, for an event schedule; added to the task's prompt.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub context: Option<String>,
    /// Started by the person with Run now, so it runs even while the schedule is off.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub manual: bool,
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
    /// What an event schedule has already seen, so each arrival starts one task.
    #[serde(default)]
    pub watch: WatchState,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct WatchState {
    /// Names present when watching began, and every arrival since.
    pub seen: Vec<String>,
    pub primed: bool,
    /// Why the last look failed, shown to the person.
    pub last_error: Option<String>,
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
#[derive(Default)]
struct Look {
    at: u64,
    sizes: std::collections::BTreeMap<String, u64>,
}

pub struct Schedules {
    store: Arc<Store>,
    state: Mutex<State>,
    looks: std::sync::Mutex<std::collections::BTreeMap<Uuid, Look>>,
    recovered_before: u64,
    revision: std::sync::atomic::AtomicU64,
}

pub(crate) struct WorkspaceRemovalGuard<'a> {
    _state: tokio::sync::MutexGuard<'a, State>,
}

impl Schedules {
    pub(crate) async fn guard_workspace_removal(
        &self,
        id: WorkspaceId,
    ) -> Result<WorkspaceRemovalGuard<'_>, WorkspaceError> {
        let state = self.state.lock().await;
        if state.journal.schedules.iter().any(|schedule| {
            schedule.workspace_id == id
                && ((schedule.enabled && schedule.next_at.is_some())
                    || schedule.occurrences.iter().any(|occurrence| {
                        !matches!(
                            occurrence.state,
                            OccurrenceState::Completed | OccurrenceState::Skipped
                        )
                    }))
        }) {
            return Err(WorkspaceError::State(
                crate::service::ServiceError::WorkspaceInUse,
            ));
        }
        Ok(WorkspaceRemovalGuard { _state: state })
    }

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
            looks: Default::default(),
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
            next_at: input.timing.initial(at),
            timing: input.timing,
            missed_run_policy: input.missed_run_policy,
            assignment,
            enabled: true,
            enabled_since: at,
            occurrences: vec![],
            watch: WatchState::default(),
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

    /// Starts one run now, whatever the timing and even while the schedule is off. Refused while an earlier
    /// run is still going or waiting for review, so runs never overlap.
    pub async fn run_now(&self, input: RunNow) -> Result<Schedule, WorkspaceError> {
        self.run_now_at(input, now()).await
    }

    async fn run_now_at(&self, input: RunNow, at: u64) -> Result<Schedule, WorkspaceError> {
        let mut state = self.state.lock().await;
        let mut next = state.journal.clone();
        let schedule = next
            .schedules
            .iter_mut()
            .find(|schedule| schedule.id == input.id)
            .ok_or(WorkspaceError::NotFound)?;
        if schedule
            .occurrences
            .iter()
            .any(|o| !matches!(o.state, OccurrenceState::Completed | OccurrenceState::Skipped))
        {
            return Err(WorkspaceError::Connector(
                "A run of this schedule is already going or needs your review.".into(),
            ));
        }
        schedule.occurrences.push(Occurrence {
            task_id: Uuid::new_v4(),
            due_at: at,
            state: OccurrenceState::Queued,
            note: Some("Started with Run now".into()),
            retry_at: None,
            context: None,
            manual: true,
        });
        let saved = schedule.clone();
        self.publish(&mut state, next).await?;
        Ok(saved)
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
            // Files that arrived while it was off are not new: start from what is there.
            schedule.watch.primed = false;
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
            let (latest, following, multiple) = match &schedule.timing {
                Timing::Once { .. } | Timing::Event { .. } => (due, None, false),
                Timing::Interval { every_seconds, .. } => {
                    let count = (at - due) / every_seconds;
                    let latest = due + count * every_seconds;
                    (latest, latest.checked_add(*every_seconds), count > 0)
                }
                Timing::Calendar { rule } => {
                    // Walk to the latest slot that is already due; more than one is a
                    // backlog (for example after sleep) and is never replayed.
                    let (mut latest, mut multiple) = (due, false);
                    let mut following = rule.next_after(latest);
                    for _ in 0..4096 {
                        match following {
                            Some(next) if next <= at => {
                                latest = next;
                                multiple = true;
                                following = rule.next_after(next);
                            }
                            _ => break,
                        }
                    }
                    (latest, following, multiple)
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
                context: None,
                manual: false,
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

    /// Looks at the folders event schedules watch and queues one task per new, finished
    /// arrival. The first look after a schedule is enabled only records what is already
    /// there. A folder that cannot be read right now (the bot's computer is off) is
    /// skipped quietly and looked at again later.
    async fn poll_events(
        &self,
        at: u64,
        service: &Service,
        runtime: &WorkspaceRuntime,
    ) -> Result<(), WorkspaceError> {
        use crate::triggers as t;
        for schedule in self.list().await {
            let Timing::Event { source } = &schedule.timing else {
                continue;
            };
            if !schedule.enabled {
                continue;
            }
            let due = self
                .looks
                .lock()
                .map_err(|_| ServiceError::InvalidState)?
                .get(&schedule.id)
                .is_none_or(|look| {
                    at >= look.at
                        + if matches!(source, EventSource::ConnectedMail { .. }) {
                            t::CONNECTED_POLL_SECONDS
                        } else {
                            t::POLL_SECONDS
                        }
                });
            if !due {
                continue;
            }
            if let EventSource::ConnectedMail { account_id, senders } = source {
                self.poll_connected_mail(&schedule, account_id, senders, at, runtime).await?;
                continue;
            }
            let listing: Result<Option<Vec<t::Entry>>, String> = match source {
                EventSource::FolderArrival { path } => {
                    let Some(identity) = service
                        .live_sessions()
                        .await
                        .into_iter()
                        .find(|identity| identity.workspace_id == schedule.workspace_id)
                    else {
                        continue;
                    };
                    let request = crate::contract::GuestRequest {
                        identity,
                        operation_id: crate::contract::OperationId::new(),
                        operation: crate::contract::GuestOperationKind::Exec {
                            program: "/usr/bin/find".into(),
                            args: vec![
                                path.clone(),
                                "-maxdepth".into(),
                                "1".into(),
                                "-type".into(),
                                "f".into(),
                                "-printf".into(),
                                "%f\\t%s\\0".into(),
                            ],
                            cwd: crate::contract::GuestPath("/".into()),
                            env: Default::default(),
                        },
                    };
                    match runtime.request(request).await {
                        Ok(reply) => match reply.outcome {
                            crate::contract::GuestOutcome::Success {
                                result:
                                    crate::contract::GuestResult::ExecFinished {
                                        exit_code: 0,
                                        stdout,
                                        ..
                                    },
                            } => Ok(Some(t::parse_find(&stdout))),
                            _ => Err(format!(
                                "The folder {path} could not be read on the bot's computer. Check that it exists."
                            )),
                        },
                        // The bot's computer is not reachable right now; look again later.
                        Err(_) => continue,
                    }
                }
                EventSource::MailFolder { path } => {
                    let directory = std::path::PathBuf::from(path);
                    tokio::task::spawn_blocking(move || {
                        let inbox = directory.join("new");
                        let directory = if inbox.is_dir() { inbox } else { directory };
                        let mut entries = Vec::new();
                        for item in std::fs::read_dir(&directory).map_err(|_| {
                            "The mail folder could not be read. Check that it exists.".to_owned()
                        })? {
                            let Ok(item) = item else { continue };
                            let Ok(meta) = item.metadata() else { continue };
                            let name = item.file_name().to_string_lossy().into_owned();
                            if meta.is_file() && !name.starts_with('.') {
                                entries.push(t::Entry {
                                    name,
                                    bytes: meta.len(),
                                });
                            }
                        }
                        Ok(Some(entries))
                    })
                    .await
                    .unwrap_or_else(|_| Err("The mail folder could not be read.".into()))
                }
                EventSource::ConnectedMail { .. } => unreachable!(),
            };
            let (entries, error) = match listing {
                Ok(Some(entries)) => (entries, None),
                Ok(None) => continue,
                Err(message) => (Vec::new(), Some(message)),
            };
            let before = {
                let mut looks = self.looks.lock().map_err(|_| ServiceError::InvalidState)?;
                let look = looks.entry(schedule.id).or_default();
                look.at = at;
                if error.is_some() {
                    look.sizes.clone()
                } else {
                    std::mem::replace(
                        &mut look.sizes,
                        entries.iter().map(|e| (e.name.clone(), e.bytes)).collect(),
                    )
                }
            };
            let mut seen = schedule.watch.seen.clone();
            let mut contexts: Vec<String> = Vec::new();
            let primed = schedule.watch.primed || error.is_none();
            if error.is_none() {
                if !schedule.watch.primed {
                    t::remember(&mut seen, entries.iter().map(|e| e.name.clone()));
                } else {
                    let outstanding = schedule
                        .occurrences
                        .iter()
                        .filter(|o| {
                            !matches!(o.state, OccurrenceState::Completed | OccurrenceState::Skipped)
                        })
                        .count();
                    let room = t::MAX_OUTSTANDING.saturating_sub(outstanding);
                    for entry in t::arrivals(&entries, &seen, &before, room) {
                        let context = match source {
                            EventSource::FolderArrival { path } => t::file_context(path, &entry),
                            EventSource::ConnectedMail { .. } => unreachable!(),
                            EventSource::MailFolder { path } => {
                                let location = std::path::Path::new(path);
                                let file = if location.join("new").is_dir() {
                                    location.join("new").join(&entry.name)
                                } else {
                                    location.join(&entry.name)
                                };
                                let raw = tokio::task::spawn_blocking(move || {
                                    use std::io::Read;
                                    let mut buffer = Vec::new();
                                    std::fs::File::open(file)
                                        .and_then(|f| f.take(64 * 1024).read_to_end(&mut buffer))
                                        .map(|_| buffer)
                                })
                                .await
                                .ok()
                                .and_then(Result::ok);
                                match raw {
                                    Some(raw) => t::mail_context(&raw),
                                    // Not readable yet: leave it unseen and look again.
                                    None => continue,
                                }
                            }
                        };
                        t::remember(&mut seen, [entry.name.clone()]);
                        contexts.push(context);
                    }
                }
            }
            self.apply_watch(schedule.id, seen, primed, error, contexts, at)
                .await?;
        }
        Ok(())
    }

    /// Looks at a connected mailbox through the account's own mail tools and queues one occurrence per new
    /// message from an allowed sender. The first look only records what is already there.
    async fn poll_connected_mail(
        &self,
        schedule: &Schedule,
        account_id: &str,
        senders: &[String],
        at: u64,
        runtime: &WorkspaceRuntime,
    ) -> Result<(), WorkspaceError> {
        use crate::triggers as t;
        self.looks
            .lock()
            .map_err(|_| ServiceError::InvalidState)?
            .entry(schedule.id)
            .or_default()
            .at = at;
        let primed = schedule.watch.primed;
        let listed = runtime
            .read_mail(schedule.workspace_id, account_id, &schedule.watch.seen, !primed)
            .await;
        let mut seen = schedule.watch.seen.clone();
        let mut contexts: Vec<String> = Vec::new();
        let (error, primed) = match listed {
            Err(message) => (Some(message), primed),
            Ok(mails) => {
                if !primed {
                    t::remember(&mut seen, mails.iter().map(|m| m.id.clone()));
                } else {
                    let outstanding = schedule
                        .occurrences
                        .iter()
                        .filter(|o| !matches!(o.state, OccurrenceState::Completed | OccurrenceState::Skipped))
                        .count();
                    let mut room = t::MAX_OUTSTANDING.saturating_sub(outstanding);
                    for mail in mails.iter().filter(|m| !seen.contains(&m.id)) {
                        if room == 0 {
                            break; // left unseen: it starts a task once there is room
                        }
                        t::remember(&mut seen, [mail.id.clone()]);
                        if t::sender_allowed(&mail.from, senders) {
                            contexts.push(t::connected_context(mail));
                            room -= 1;
                        }
                    }
                }
                (None, true)
            }
        };
        self.apply_watch(schedule.id, seen, primed, error, contexts, at).await
    }

    async fn apply_watch(
        &self,
        id: Uuid,
        seen: Vec<String>,
        primed: bool,
        error: Option<String>,
        contexts: Vec<String>,
        at: u64,
    ) -> Result<(), WorkspaceError> {
        let mut state = self.state.lock().await;
        let mut next = state.journal.clone();
        let Some(schedule) = next.schedules.iter_mut().find(|s| s.id == id) else {
            return Ok(());
        };
        if !schedule.enabled {
            return Ok(());
        }
        let watch = WatchState {
            seen,
            primed,
            last_error: error,
        };
        if watch == schedule.watch && contexts.is_empty() {
            return Ok(());
        }
        schedule.watch = watch;
        for context in contexts {
            schedule.occurrences.push(Occurrence {
                task_id: Uuid::new_v4(),
                due_at: at,
                state: OccurrenceState::Queued,
                note: None,
                retry_at: None,
                context: Some(context),
                manual: false,
            });
        }
        // Keep the history of a busy schedule bounded: forget the oldest finished runs.
        while schedule.occurrences.len() > 200 {
            let Some(position) = schedule.occurrences.iter().position(|o| {
                matches!(o.state, OccurrenceState::Completed | OccurrenceState::Skipped)
            }) else {
                break;
            };
            schedule.occurrences.remove(position);
        }
        self.publish(&mut state, next).await
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
        self.poll_events(at, service, runtime).await?;
        self.plan_due(at).await?;
        for schedule in self.list().await {
            for occurrence in &schedule.occurrences {
                if (!schedule.enabled && !occurrence.manual)
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
                if assignment.source.as_ref() != Some(&schedule.assignment)
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
                let prompt = match &occurrence.context {
                    Some(context) => format!("{}\n\n{context}", schedule.prompt),
                    None => schedule.prompt.clone(),
                };
                match tasks
                    .start_with_id(occurrence.task_id, identity, prompt, Some(assignment))
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

#[cfg(test)]
#[tokio::test]
async fn workspace_removal_requires_disabled_schedules_and_resolved_runs() {
    let dir = tempfile::tempdir().unwrap();
    let assignment = ModelAssignment {
        workspace_id: WorkspaceId::new(),
        connection: crate::inference::ModelConnection::Endpoint {
            api_base: "http://unused/v1".into(),
        },
        model: "fixture".into(),
        context_tokens: 131072,
        credential_ref: None,
    };
    let schedules = Schedules::open_at(dir.path().join("schedules.json"), 100)
        .await
        .unwrap();
    let schedule = schedules
        .create_at(
            CreateSchedule {
                workspace_id: assignment.workspace_id,
                prompt: "Scheduled fixture".into(),
                timing: Timing::Interval {
                    first_at: 200,
                    every_seconds: 60,
                },
                missed_run_policy: MissedRunPolicy::SkipMissed,
            },
            assignment.clone(),
            100,
        )
        .await
        .unwrap();
    assert!(schedules
        .guard_workspace_removal(assignment.workspace_id)
        .await
        .is_err());
    schedules
        .set_enabled_at(
            SetEnabled {
                id: schedule.id,
                enabled: false,
            },
            100,
        )
        .await
        .unwrap();
    drop(
        schedules
            .guard_workspace_removal(assignment.workspace_id)
            .await
            .unwrap(),
    );
    for state in [
        OccurrenceState::Queued,
        OccurrenceState::Dispatching,
        OccurrenceState::Dispatched,
        OccurrenceState::NeedsReview,
        OccurrenceState::Completed,
        OccurrenceState::Skipped,
    ] {
        schedules.state.lock().await.journal.schedules[0].occurrences = vec![Occurrence {
            task_id: Uuid::new_v4(),
            due_at: 100,
            state,
            note: None,
            retry_at: None,
            context: None,
                manual: false,
        }];
        assert_eq!(
            schedules
                .guard_workspace_removal(assignment.workspace_id)
                .await
                .is_ok(),
            matches!(state, OccurrenceState::Completed | OccurrenceState::Skipped)
        );
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
            connection: crate::inference::ModelConnection::Endpoint {
                api_base: "http://unused/v1".into(),
            },
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
                    api_base: match assignment.connection {
                        crate::inference::ModelConnection::Endpoint { api_base } => api_base,
                        _ => unreachable!(),
                    },
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
    fn utc(year: i32, month: u32, day: u32, hour: u32, minute: u32) -> u64 {
        use chrono::TimeZone;
        chrono::Utc
            .with_ymd_and_hms(year, month, day, hour, minute, 0)
            .unwrap()
            .timestamp() as u64
    }

    #[test]
    fn weekdays_at_nine_skip_the_weekend_and_follow_the_time_zone() {
        let rule = CalendarRule::Days { days: vec![0, 1, 2, 3, 4], hour: 9, minute: 0 };
        // Friday 2026-10-16 10:00 UTC: the next run is Monday the 19th at 09:00.
        assert_eq!(rule.next_after_in(&chrono::Utc, utc(2026, 10, 16, 10, 0)), Some(utc(2026, 10, 19, 9, 0)));
        // Before nine the same day, and exactly at nine the next day (strictly after).
        assert_eq!(rule.next_after_in(&chrono::Utc, utc(2026, 10, 19, 8, 59)), Some(utc(2026, 10, 19, 9, 0)));
        assert_eq!(rule.next_after_in(&chrono::Utc, utc(2026, 10, 19, 9, 0)), Some(utc(2026, 10, 20, 9, 0)));
        // Nine o'clock in UTC-5 is 14:00 UTC.
        let zone = chrono::FixedOffset::west_opt(5 * 3600).unwrap();
        assert_eq!(rule.next_after_in(&zone, utc(2026, 10, 19, 0, 0)), Some(utc(2026, 10, 19, 14, 0)));
    }

    #[test]
    fn the_first_monday_and_the_last_friday_of_each_month() {
        let first_monday = CalendarRule::MonthlyWeekday { nth: 1, weekday: 0, hour: 9, minute: 30 };
        // October 2026: the first Monday is the 5th; after it the next is November 2nd.
        assert_eq!(first_monday.next_after_in(&chrono::Utc, utc(2026, 10, 1, 0, 0)), Some(utc(2026, 10, 5, 9, 30)));
        assert_eq!(first_monday.next_after_in(&chrono::Utc, utc(2026, 10, 5, 9, 30)), Some(utc(2026, 11, 2, 9, 30)));
        // A year boundary: after December 7th 2026 the next first Monday is January 4th 2027.
        assert_eq!(first_monday.next_after_in(&chrono::Utc, utc(2026, 12, 8, 0, 0)), Some(utc(2027, 1, 4, 9, 30)));
        let last_friday = CalendarRule::MonthlyWeekday { nth: 5, weekday: 4, hour: 17, minute: 0 };
        assert_eq!(last_friday.next_after_in(&chrono::Utc, utc(2026, 10, 1, 0, 0)), Some(utc(2026, 10, 30, 17, 0)));
        assert_eq!(last_friday.next_after_in(&chrono::Utc, utc(2026, 10, 30, 17, 0)), Some(utc(2026, 11, 27, 17, 0)));
        // A fourth Monday exists every month; a rule with an impossible nth is invalid.
        assert!(!CalendarRule::MonthlyWeekday { nth: 6, weekday: 0, hour: 9, minute: 0 }.valid());
        assert!(!CalendarRule::Days { days: vec![], hour: 9, minute: 0 }.valid());
        assert!(!CalendarRule::Days { days: vec![7], hour: 9, minute: 0 }.valid());
        assert!(!CalendarRule::Days { days: vec![0], hour: 24, minute: 0 }.valid());
    }

    #[tokio::test]
    async fn a_calendar_schedule_runs_at_its_time_and_plans_the_following_one() {
        let dir = tempfile::tempdir().unwrap();
        let assignment = assignment();
        let schedules = Schedules::open_at(dir.path().join("schedules.json"), 0).await.unwrap();
        let rule = CalendarRule::Days { days: vec![0, 1, 2, 3, 4, 5, 6], hour: 9, minute: 0 };
        let created = schedules
            .create_at(
                input(&assignment, Timing::Calendar { rule: rule.clone() }, MissedRunPolicy::RunLatest),
                assignment.clone(),
                1_000_000,
            )
            .await
            .unwrap();
        let first = created.next_at.unwrap();
        assert!(first > 1_000_000);
        assert_eq!(Some(first), rule.next_after(1_000_000));
        // When due, an occurrence is planned and the next day is scheduled; a backlog of
        // several days (the computer slept) becomes one occurrence, not many.
        schedules.plan_due(first + 3 * 86_400 + 5).await.unwrap();
        let planned = &schedules.list().await[0];
        assert_eq!(planned.occurrences.len(), 1);
        assert!(planned.next_at.unwrap() > first + 3 * 86_400 + 5);
        assert_eq!(planned.occurrences[0].state, OccurrenceState::Queued);
    }

    #[tokio::test]
    async fn a_new_mail_in_a_mail_folder_starts_one_task_with_its_details() {
        let dir = tempfile::tempdir().unwrap();
        let mailbox = dir.path().join("mail");
        std::fs::create_dir_all(mailbox.join("new")).unwrap();
        std::fs::write(mailbox.join("new/old.eml"), "From: a@example.com\nSubject: Before\n\nalready here\n").unwrap();
        let assignment = assignment();
        let service = Arc::new(Service::open(dir.path().join("service.json")).await.unwrap());
        let runtime = WorkspaceRuntime::new(service.clone(), Arc::new(NativeVault));
        let schedules = Schedules::open_at(dir.path().join("schedules.json"), 0).await.unwrap();
        let source = EventSource::MailFolder { path: mailbox.display().to_string() };
        let created = schedules
            .create_at(
                input(&assignment, Timing::Event { source }, MissedRunPolicy::RunLatest),
                assignment.clone(),
                100,
            )
            .await
            .unwrap();
        assert_eq!(created.next_at, None);
        // The first look only records what is already there.
        schedules.poll_events(100, &service, &runtime).await.unwrap();
        let first = &schedules.list().await[0];
        assert!(first.watch.primed && first.occurrences.is_empty());
        // A new message is seen once it stops growing; one look later it starts one task.
        std::fs::write(mailbox.join("new/hello.eml"), "From: Ada <ada@example.com>\nSubject: Invoice 42\n\nPlease pay.\n").unwrap();
        schedules.poll_events(110, &service, &runtime).await.unwrap(); // too soon to look again
        schedules.poll_events(140, &service, &runtime).await.unwrap();
        assert!(schedules.list().await[0].occurrences.is_empty(), "too early to be sure it finished arriving");
        schedules.poll_events(170, &service, &runtime).await.unwrap();
        let listed = &schedules.list().await[0];
        assert_eq!(listed.occurrences.len(), 1);
        let context = listed.occurrences[0].context.clone().unwrap();
        assert!(context.contains("Ada <ada@example.com>") && context.contains("Invoice 42") && context.contains("Please pay."));
        // It is not started again, and the old message never was.
        schedules.poll_events(200, &service, &runtime).await.unwrap();
        schedules.poll_events(230, &service, &runtime).await.unwrap();
        assert_eq!(schedules.list().await[0].occurrences.len(), 1);
        // Disabling and re-enabling starts from what is there: nothing arrives twice.
        schedules.set_enabled_at(SetEnabled { id: created.id, enabled: false }, 240).await.unwrap();
        std::fs::write(mailbox.join("new/while-off.eml"), "Subject: Off\n\nx\n").unwrap();
        schedules.set_enabled_at(SetEnabled { id: created.id, enabled: true }, 250).await.unwrap();
        for at in [270, 300, 330, 360] {
            schedules.poll_events(at, &service, &runtime).await.unwrap();
        }
        assert_eq!(schedules.list().await[0].occurrences.len(), 1);
    }

    #[tokio::test]
    async fn an_unreadable_mail_folder_is_reported_and_a_busy_one_is_limited() {
        let dir = tempfile::tempdir().unwrap();
        let assignment = assignment();
        let service = Arc::new(Service::open(dir.path().join("service.json")).await.unwrap());
        let runtime = WorkspaceRuntime::new(service.clone(), Arc::new(NativeVault));
        let schedules = Schedules::open_at(dir.path().join("schedules.json"), 0).await.unwrap();
        let missing = dir.path().join("missing");
        schedules
            .create_at(
                input(&assignment, Timing::Event { source: EventSource::MailFolder { path: missing.display().to_string() } }, MissedRunPolicy::RunLatest),
                assignment.clone(),
                100,
            )
            .await
            .unwrap();
        schedules.poll_events(100, &service, &runtime).await.unwrap();
        assert!(schedules.list().await[0].watch.last_error.as_deref().unwrap().contains("mail folder"));
        // Once the folder exists and is primed, a flood starts at most five tasks at a time.
        std::fs::create_dir_all(&missing).unwrap();
        schedules.poll_events(130, &service, &runtime).await.unwrap();
        for n in 0..9 {
            std::fs::write(missing.join(format!("m{n}.eml")), format!("Subject: {n}\n\nbody\n")).unwrap();
        }
        schedules.poll_events(160, &service, &runtime).await.unwrap();
        schedules.poll_events(190, &service, &runtime).await.unwrap();
        let listed = &schedules.list().await[0];
        assert_eq!(listed.occurrences.len(), crate::triggers::MAX_OUTSTANDING);
        assert!(listed.watch.last_error.is_none());
    }

    #[test]
    fn event_sources_need_full_paths() {
        assert!(EventSource::FolderArrival { path: "/home/gbot/Inbox".into() }.valid());
        assert!(!EventSource::FolderArrival { path: "Inbox".into() }.valid());
        assert!(!EventSource::MailFolder { path: "relative/mail".into() }.valid());
        assert!(Timing::Event { source: EventSource::MailFolder { path: "/var/mail/me".into() } }.valid());
    }
    #[tokio::test]
    async fn run_now_queues_one_manual_run_even_when_the_schedule_is_off_and_never_overlaps() {
        let dir = tempfile::tempdir().unwrap();
        let assignment = assignment();
        let schedules = Schedules::open_at(dir.path().join("schedules.json"), 0).await.unwrap();
        let created = schedules
            .create_at(
                input(&assignment, Timing::Once { at: 4_000_000_000 }, MissedRunPolicy::RunLatest),
                assignment.clone(),
                100,
            )
            .await
            .unwrap();
        schedules.set_enabled_at(SetEnabled { id: created.id, enabled: false }, 110).await.unwrap();
        let started = schedules.run_now_at(RunNow { id: created.id }, 120).await.unwrap();
        assert_eq!(started.occurrences.len(), 1);
        let run = &started.occurrences[0];
        assert!(run.manual && run.state == OccurrenceState::Queued && run.due_at == 120);
        // A second press while that run is going is refused with a plain reason.
        let refused = schedules.run_now_at(RunNow { id: created.id }, 121).await.unwrap_err();
        assert!(refused.to_string().contains("already going"), "{refused}");
        // Once it has finished, it can run again; the scheduled time is unchanged.
        schedules.update(run.task_id, OccurrenceState::Completed, None).await.unwrap();
        let again = schedules.run_now_at(RunNow { id: created.id }, 130).await.unwrap();
        assert_eq!(again.occurrences.len(), 2);
        assert_eq!(again.next_at, created.next_at);
        assert!(matches!(
            schedules.run_now_at(RunNow { id: Uuid::new_v4() }, 140).await,
            Err(WorkspaceError::NotFound)
        ));
        // Turning the schedule on and off again skips a manual run that was still waiting.
        schedules.update(again.occurrences[1].task_id, OccurrenceState::Completed, None).await.unwrap();
        schedules.run_now_at(RunNow { id: created.id }, 150).await.unwrap();
        let off = schedules.set_enabled_at(SetEnabled { id: created.id, enabled: false }, 160).await.unwrap();
        assert_eq!(off.occurrences.last().unwrap().state, OccurrenceState::Skipped);
    }
    /// A scripted mailbox behind the connector boundary: only read tools exist and every call is recorded.
    struct MailHost {
        provider: &'static str,
        reconnect: bool,
        mail: std::sync::Mutex<Vec<(String, String, String, String)>>, // id, from, subject, preview
        calls: std::sync::Mutex<Vec<String>>,
    }
    impl crate::connectors::ConnectorHost for MailHost {
        fn accounts(&self) -> crate::connectors::ConnectorFuture<'_, Vec<crate::connectors::ConnectorAccount>> {
            Box::pin(async move {
                Ok(vec![crate::connectors::ConnectorAccount {
                    id: "acct-1".into(),
                    provider: self.provider.into(),
                    display_name: "Fixture".into(),
                    email: None,
                    services: vec!["mail".into()],
                    access: "read_only".into(),
                    granted_scopes: vec![],
                    needs_reconnect: self.reconnect,
                }])
            })
        }
        fn catalog<'a>(&'a self, _: &'a [String]) -> crate::connectors::ConnectorFuture<'a, Vec<crate::connectors::ConnectorTool>> {
            Box::pin(async { Ok(vec![]) })
        }
        fn prepare<'a>(&'a self, linked: &'a [String], name: &'a str, arguments: serde_json::Value) -> crate::connectors::ConnectorFuture<'a, crate::connectors::PreparedConnector> {
            Box::pin(async move {
                Ok(crate::connectors::PreparedConnector { name: name.into(), account_id: linked[0].clone(), arguments, write: false })
            })
        }
        fn execute<'a>(&'a self, request: &'a crate::connectors::PreparedConnector) -> crate::connectors::ConnectorFuture<'a, serde_json::Value> {
            Box::pin(async move {
                self.calls.lock().unwrap().push(request.name.clone());
                let mail = self.mail.lock().unwrap().clone();
                match request.name.as_str() {
                    "google.gmail.search" => Ok(json!({"messages": mail.iter().map(|m| json!({"id": m.0, "threadId": m.0})).collect::<Vec<_>>()})),
                    "google.gmail.read" => {
                        let id = request.arguments["message_id"].as_str().unwrap();
                        let m = mail.iter().find(|m| m.0 == id).unwrap();
                        Ok(json!({"id": m.0, "snippet": m.3, "payload": {"headers": [{"name": "From", "value": m.1}, {"name": "Subject", "value": m.2}]}}))
                    }
                    "microsoft.outlook.list_messages" => Ok(json!({"value": mail.iter().map(|m| json!({"id": m.0, "subject": m.2, "bodyPreview": m.3, "from": {"emailAddress": {"address": m.1}}})).collect::<Vec<_>>()})),
                    other => Err(format!("unexpected tool {other}")),
                }
            })
        }
    }

    async fn mail_trigger_fixture(
        provider: &'static str,
        reconnect: bool,
        linked: bool,
    ) -> (tempfile::TempDir, Arc<MailHost>, WorkspaceRuntime, Arc<Service>, Schedules, Schedule) {
        use crate::contract::{BotPc, ServicePc, SshConnection, SshEndpoint, SshHostPublicKey, VaultCredentialRef, WorkspaceConfig, WorkspaceConnection};
        use russh::keys::{Algorithm, PrivateKey};
        let dir = tempfile::tempdir().unwrap();
        let assignment = assignment();
        let service = Arc::new(Service::open(dir.path().join("service.json")).await.unwrap());
        let private = PrivateKey::random(&mut russh::keys::key::safe_rng(), Algorithm::Ed25519).unwrap();
        let public = private.public_key().to_openssh().unwrap();
        let (algorithm, public_key) = public.split_once(' ').unwrap();
        service
            .register_workspace(WorkspaceConfig {
                id: assignment.workspace_id,
                name: "Mail fixture".into(),
                service_pc: ServicePc::Local,
                bot_pc: BotPc::Lan { computer_id: Uuid::new_v4() },
                connection: WorkspaceConnection::Ssh(SshConnection {
                    endpoint: SshEndpoint { hostname: "127.0.0.1".into(), port: 2222, user: "fixture".into() },
                    pinned_host_key: SshHostPublicKey { algorithm: algorithm.into(), public_key: public_key.into() },
                    credential_ref: VaultCredentialRef::new(),
                }),
            })
            .await
            .unwrap();
        if linked {
            service
                .save_connector_accounts(crate::connectors::BotConnectorAccounts { workspace_id: assignment.workspace_id, account_ids: vec!["acct-1".into()] })
                .await
                .unwrap();
        }
        let host = Arc::new(MailHost {
            provider,
            reconnect,
            mail: std::sync::Mutex::new(vec![("m1".into(), "Old <old@example.com>".into(), "Before".into(), "already here".into())]),
            calls: Default::default(),
        });
        let runtime = WorkspaceRuntime::new(service.clone(), Arc::new(NativeVault)).with_connectors(host.clone());
        let schedules = Schedules::open_at(dir.path().join("schedules.json"), 0).await.unwrap();
        let source = EventSource::ConnectedMail { account_id: "acct-1".into(), senders: vec!["ada@example.com".into(), "@corp.test".into()] };
        let created = schedules
            .create_at(input(&assignment, Timing::Event { source }, MissedRunPolicy::RunLatest), assignment.clone(), 100)
            .await
            .unwrap();
        (dir, host, runtime, service, schedules, created)
    }

    #[tokio::test]
    async fn new_mail_from_an_allowed_sender_in_a_connected_account_starts_one_task_each() {
        for provider in ["google", "microsoft"] {
            let (_dir, host, runtime, service, schedules, _created) = mail_trigger_fixture(provider, false, true).await;
            // The first look records what is already there and reads no message bodies.
            schedules.poll_events(100, &service, &runtime).await.unwrap();
            assert!(schedules.list().await[0].watch.primed && schedules.list().await[0].occurrences.is_empty());
            assert!(!host.calls.lock().unwrap().iter().any(|c| c == "google.gmail.read"));
            {
                let mut mail = host.mail.lock().unwrap();
                mail.push(("m2".into(), "Ada <ADA@example.com>".into(), "Invoice 42".into(), "Please pay.".into()));
                mail.push(("m3".into(), "stranger@evil.test".into(), "Win a prize".into(), "click here".into()));
                mail.push(("m4".into(), "bob@corp.test".into(), "Lunch".into(), "Noon?".into()));
            }
            // Too soon to look again.
            schedules.poll_events(130, &service, &runtime).await.unwrap();
            assert!(schedules.list().await[0].occurrences.is_empty());
            schedules.poll_events(170, &service, &runtime).await.unwrap();
            let listed = schedules.list().await.remove(0);
            let contexts: Vec<_> = listed.occurrences.iter().map(|o| o.context.clone().unwrap()).collect();
            assert_eq!(contexts.len(), 2, "{provider}: allowed sender and allowed domain only");
            assert!(contexts.iter().any(|c| c.contains("Invoice 42") && c.contains("Please pay.") && c.contains("untrusted")));
            assert!(contexts.iter().any(|c| c.contains("Lunch")));
            assert!(contexts.iter().all(|c| !c.contains("Win a prize")));
            // Nothing starts twice, and only read tools were ever called.
            schedules.poll_events(240, &service, &runtime).await.unwrap();
            assert_eq!(schedules.list().await[0].occurrences.len(), 2);
            assert!(host.calls.lock().unwrap().iter().all(|c| c.ends_with("search") || c.ends_with("read") || c.ends_with("list_messages")));
        }
    }

    #[tokio::test]
    async fn an_unlinked_or_disconnected_mailbox_is_reported_in_plain_words_and_a_flood_is_limited() {
        let (_dir, _host, runtime, service, schedules, _) = mail_trigger_fixture("google", false, false).await;
        schedules.poll_events(100, &service, &runtime).await.unwrap();
        let error = schedules.list().await[0].watch.last_error.clone().unwrap();
        assert!(error.contains("not linked to this bot"), "{error}");
        let (_dir, _host, runtime, service, schedules, _) = mail_trigger_fixture("microsoft", true, true).await;
        schedules.poll_events(100, &service, &runtime).await.unwrap();
        assert!(schedules.list().await[0].watch.last_error.clone().unwrap().contains("reconnected"));
        let (_dir, host, runtime, service, schedules, _) = mail_trigger_fixture("microsoft", false, true).await;
        schedules.poll_events(100, &service, &runtime).await.unwrap();
        for n in 0..9 {
            host.mail.lock().unwrap().push((format!("n{n}"), "ada@example.com".into(), format!("Message {n}"), "x".into()));
        }
        schedules.poll_events(170, &service, &runtime).await.unwrap();
        assert_eq!(schedules.list().await[0].occurrences.len(), crate::triggers::MAX_OUTSTANDING);
        assert!(schedules.list().await[0].watch.last_error.is_none());
    }

    #[test]
    fn allowed_senders_are_full_addresses_or_whole_domains() {
        use crate::triggers::{sender_allowed, sender_entry_valid};
        assert!(sender_entry_valid("ada@example.com") && sender_entry_valid("@corp.test"));
        for bad in ["", "example.com", "@", "a@b", "ada@@example.com", "ada @example.com", "@.com"] {
            assert!(!sender_entry_valid(bad), "{bad:?}");
        }
        let allowed = vec!["ada@example.com".to_owned(), "@corp.test".to_owned()];
        assert!(sender_allowed("Ada Lovelace <Ada@Example.com>", &allowed));
        assert!(sender_allowed("bob@corp.test", &allowed));
        assert!(!sender_allowed("evil@corp.test.evil.net", &allowed));
        assert!(!sender_allowed("ada@example.com.evil.net", &allowed));
        assert!(!sender_allowed("not an address", &allowed));
        assert!(!Timing::Event { source: EventSource::ConnectedMail { account_id: "a".into(), senders: vec![] } }.valid(), "a sender is required");
    }
}