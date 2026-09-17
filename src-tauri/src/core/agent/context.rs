//! Per-worker exact context budgeting, safe checkpoints, and durable run artifacts.
use super::{
    ginfer_client::{CompletionRequest, GinferClient},
    session::{AgentSessionState, AgentSessionTurn},
    types::AgentEvent,
};
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex, OnceLock,
    },
};
use tokio::io::AsyncWriteExt;
use tokio_util::sync::CancellationToken;

static ACTIVE: OnceLock<Mutex<HashMap<String, Arc<AtomicBool>>>> = OnceLock::new();

pub fn request_compaction(id: &str) -> Result<(), String> {
    let active = ACTIVE
        .get_or_init(Default::default)
        .lock()
        .map_err(|e| e.to_string())?;
    let flag = active.get(id).ok_or("Worker is no longer running")?;
    flag.store(true, Ordering::Release);
    Ok(())
}

pub struct WorkerContext {
    id: String,
    manual: Arc<AtomicBool>,
    pub archive_dir: Option<PathBuf>,
    transcript: Option<tokio::fs::File>,
    compactions: u32,
    usage: (usize, usize, usize),
}

impl Drop for WorkerContext {
    fn drop(&mut self) {
        if let Ok(mut active) = ACTIVE.get_or_init(Default::default).lock() {
            active.remove(&self.id);
        }
    }
}

impl WorkerContext {
    pub fn report_failure(
        &self,
        emit: &mut impl FnMut(AgentEvent) -> Result<(), String>,
    ) -> Result<(), String> {
        emit(self.status(self.usage.0, self.usage.1, self.usage.2, "blocked"))
    }
    pub fn compact_at_next_boundary(&self) {
        self.manual.store(true, Ordering::Release);
    }

    pub async fn save_working_state(&self, session: &AgentSessionState) -> Result<(), String> {
        if let Some(directory) = &self.archive_dir {
            let temporary = directory.join("working-state.tmp");
            let mut file = tokio::fs::File::create(&temporary)
                .await
                .map_err(|e| e.to_string())?;
            file.write_all(&serde_json::to_vec(session).map_err(|e| e.to_string())?)
                .await
                .map_err(|e| e.to_string())?;
            file.sync_data().await.map_err(|e| e.to_string())?;
            drop(file);
            super::session::atomic_replace(&temporary, &directory.join("working-state.json"))
                .await
                .map_err(|e| e.to_string())?;
        }
        Ok(())
    }
    pub async fn new(directory: Option<&Path>) -> Result<Self, String> {
        let archive_dir = if let Some(directory) = directory {
            tokio::fs::create_dir_all(directory)
                .await
                .map_err(|e| e.to_string())?;
            Some(
                tokio::fs::canonicalize(directory)
                    .await
                    .map_err(|e| e.to_string())?,
            )
        } else {
            None
        };
        let transcript = if let Some(directory) = &archive_dir {
            Some(
                tokio::fs::OpenOptions::new()
                    .create(true)
                    .append(true)
                    .open(directory.join("transcript.jsonl"))
                    .await
                    .map_err(|e| e.to_string())?,
            )
        } else {
            None
        };
        let id = uuid::Uuid::new_v4().to_string();
        let manual = Arc::new(AtomicBool::new(false));
        ACTIVE
            .get_or_init(Default::default)
            .lock()
            .map_err(|e| e.to_string())?
            .insert(id.clone(), manual.clone());
        Ok(Self {
            id,
            manual,
            archive_dir,
            transcript,
            compactions: 0,
            usage: (0, 0, 0),
        })
    }

    pub async fn record(&mut self, value: Value) -> Result<(), String> {
        if let Some(file) = &mut self.transcript {
            let mut bytes = serde_json::to_vec(&value).map_err(|e| e.to_string())?;
            bytes.push(b'\n');
            file.write_all(&bytes)
                .await
                .map_err(|e| format!("Could not archive worker transcript: {e}"))?;
            file.sync_data().await.map_err(|e| e.to_string())?;
        }
        Ok(())
    }

    pub async fn artifact(
        &self,
        step: u32,
        index: usize,
        value: &Value,
    ) -> Result<Option<PathBuf>, String> {
        let Some(directory) = &self.archive_dir else {
            return Ok(None);
        };
        let path = directory.join(format!("step-{step}-tool-{index}.json"));
        tokio::fs::write(&path, serde_json::to_vec(value).map_err(|e| e.to_string())?)
            .await
            .map_err(|e| e.to_string())?;
        Ok(Some(path))
    }

    fn status(&self, input: usize, capacity: usize, reserved: usize, status: &str) -> AgentEvent {
        AgentEvent::ContextStatus {
            context_id: self.id.clone(),
            input_tokens: input,
            context_tokens: capacity,
            reserved_tokens: reserved,
            compactions: self.compactions,
            status: status.into(),
            archive_path: self
                .archive_dir
                .as_ref()
                .map(|p| p.to_string_lossy().into_owned()),
        }
    }

    /// Called only before inference, after all calls in the previous batch have completed.
    pub async fn prepare(
        &mut self,
        session: &mut AgentSessionState,
        client: &GinferClient,
        cancellation: &CancellationToken,
        build: impl Fn(&AgentSessionState) -> CompletionRequest,
        emit: &mut impl FnMut(AgentEvent) -> Result<(), String>,
    ) -> Result<(CompletionRequest, super::ginfer_client::CompletionTiming), String> {
        let capacity = client
            .fetch_context_window(cancellation)
            .await
            .map_err(|e| e.to_string())?
            .ok_or("The assigned engine did not report its context capacity")?;
        let mut request = build(session);
        let preferred = match request.reasoning_effort {
            Some(super::definitions::AgentReasoningEffort::Max | super::definitions::AgentReasoningEffort::Xhigh) => 32768,
            Some(super::definitions::AgentReasoningEffort::High) => 16384,
            _ => 8192,
        };
        let output = request.output_limit_override.map(|value| value as usize)
            .unwrap_or_else(|| (capacity / 4).clamp(256, preferred));
        let headroom = (capacity / 8).clamp(512, 4096);
        let reserved = output + headroom;
        let budget = capacity
            .checked_sub(reserved)
            .ok_or("Context is too small for a worker response")?;
        request.max_tokens = output as u32;
        let before = client
            .count_input_tokens(&request, cancellation)
            .await
            .map_err(|e| e.to_string())?;
        self.usage = (before, capacity, reserved);
        let manual = self.manual.swap(false, Ordering::AcqRel);
        let mut timing = super::ginfer_client::CompletionTiming::default();
        if before <= budget && !manual {
            emit(self.status(before, capacity, reserved, "ready"))?;
            return Ok((request, timing));
        }
        let boundaries = safe_boundaries(&session.turns);
        // Keep two recent exchanges when possible, then one if necessary to fit.
        let cuts = [
            boundaries.len().saturating_sub(2),
            boundaries.len().saturating_sub(1),
        ];
        let mut previous_cut = 0;
        let mut checkpoint = session.checkpoint.clone();
        let mut offset = 0;
        for index in cuts {
            if index == 0 {
                continue;
            }
            let cut = boundaries[index - 1];
            if cut <= previous_cut {
                continue;
            }
            previous_cut = cut;
            emit(self.status(before, capacity, reserved, "compacting"))?;
            while offset < cut {
                let ends = boundaries
                    .iter()
                    .copied()
                    .filter(|end| *end > offset && *end <= cut)
                    .collect::<Vec<_>>();
                let mut low = 0;
                let mut high = ends.len();
                let mut best = None;
                while low < high {
                    let mid = (low + high) / 2;
                    let source = render_slice(session, offset, ends[mid]);
                    let mut candidate = checkpoint_request(checkpoint.as_deref(), &source);
                    candidate.max_tokens = (capacity / 8).clamp(256, 3072) as u32;
                    let tokens = client
                        .count_input_tokens(&candidate, cancellation)
                        .await
                        .map_err(|e| e.to_string())?;
                    if tokens + candidate.max_tokens as usize + 512 <= capacity {
                        best = Some((ends[mid], candidate));
                        low = mid + 1;
                    } else {
                        high = mid;
                    }
                }
                let Some((end, candidate)) = best else {
                    return Err("Context checkpoint cannot fit a complete exchange. The transcript is preserved; reduce the task or retrieve a smaller artifact excerpt.".into());
                };
                let completion = client
                    .complete(&candidate, cancellation)
                    .await
                    .map_err(|e| e.to_string())?;
                self.record(
                    json!({"type":"checkpoint_completion", "content":completion.content,
                    "finish_reason":completion.finish_reason}),
                )
                .await?;
                if completion.content.trim().is_empty()
                    || !matches!(
                        completion.finish_reason.as_str(),
                        "stop_token" | "stop_string"
                    )
                {
                    return Err(format!("Context checkpoint did not complete ({}). Original working state and transcript are preserved.", completion.finish_reason));
                }
                timing.prompt_tokens += completion.timing.prompt_tokens;
                timing.predicted_tokens += completion.timing.predicted_tokens;
                timing.prompt_ms += completion.timing.prompt_ms;
                timing.predicted_ms += completion.timing.predicted_ms;
                checkpoint = Some(completion.content.trim().to_owned());
                offset = end;
            }
            let mut candidate = session.clone();
            candidate.turns.drain(..cut);
            candidate.checkpoint = checkpoint.clone();
            let mut next = build(&candidate);
            next.max_tokens = output as u32;
            let after = client
                .count_input_tokens(&next, cancellation)
                .await
                .map_err(|e| e.to_string())?;
            if after > budget || after >= before {
                continue;
            }
            self.record(
                json!({"type":"checkpoint", "input_before":before, "input_after":after,
                "checkpoint":candidate.checkpoint, "removed_entries":cut}),
            )
            .await?;
            *session = candidate;
            self.save_working_state(session).await?;
            self.compactions += 1;
            self.usage = (after, capacity, reserved);
            emit(self.status(after, capacity, reserved, "ready"))?;
            return Ok((next, timing));
        }
        if manual && before <= budget {
            emit(self.status(before, capacity, reserved, "nothing_to_compact"))?;
            return Ok((request, timing));
        }
        emit(self.status(before, capacity, reserved, "blocked"))?;
        Err("Worker context cannot fit the task, instructions, and recent exchanges. Transcript and workspace are preserved; revise the task or loaded context before continuing.".into())
    }
}

pub fn safe_boundaries(turns: &[AgentSessionTurn]) -> Vec<usize> {
    let mut boundaries = Vec::new();
    for (index, turn) in turns.iter().enumerate() {
        match turn {
            AgentSessionTurn::ToolResult { .. } | AgentSessionTurn::AssistantReply { .. } => {
                boundaries.push(index + 1)
            }
            AgentSessionTurn::User { .. }
                if index > 0
                    && !matches!(turns[index - 1], AgentSessionTurn::AssistantToolCall { .. })
                    && boundaries.last() != Some(&index) =>
            {
                boundaries.push(index);
            }
            _ => {}
        }
    }
    boundaries
}

fn render_slice(session: &AgentSessionState, start: usize, end: usize) -> String {
    session.turns[start..end]
        .iter()
        .map(super::session::render_turn)
        .collect::<Vec<_>>()
        .join("\n")
}

fn checkpoint_request(existing: Option<&str>, source: &str) -> CompletionRequest {
    CompletionRequest::checkpoint(format!(
        "Existing checkpoint:\n{}\n\nCompleted exchanges:\n{source}",
        existing.unwrap_or("None")
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::agent::test_support::{ScriptedGinferServer, ScriptedResponse};
    use crate::core::agent::types::{ToolCallPayload, ToolOutcome};

    fn history(pairs: usize) -> AgentSessionState {
        let mut session = AgentSessionState::new("worker");
        session.push_user("Keep the original goal");
        for index in 0..pairs {
            session.push_tool_observations(
                &[ToolCallPayload {
                    tool: "os.fs.write".into(),
                    args: json!({"path":format!("file-{index}"), "content":"x".repeat(6000)}),
                }],
                &[ToolOutcome::ok(format!("Wrote file-{index}"))],
            );
        }
        session
    }
    fn build(state: &AgentSessionState) -> CompletionRequest {
        CompletionRequest::tool_call(
            format!(
                "Pinned goal: Keep the original goal\n{}",
                state.render_conversation()
            ),
            None,
        )
    }
    async fn server(responses: Vec<ScriptedResponse>, capacity: usize) -> ScriptedGinferServer {
        ScriptedGinferServer::start_with_model(
            responses,
            json!({"id":"scripted-test-model","max_model_len":capacity}),
        )
        .await
    }

    #[tokio::test]
    async fn compacts_inside_one_task_and_preserves_recent_pairs_and_archive() {
        let server = server(vec![ScriptedResponse::completion("## Completed work\nWrote file-0 and file-1.\n## Pending work\nContinue the original goal.")], 8192).await;
        let directory = tempfile::tempdir().unwrap();
        let mut context = WorkerContext::new(Some(directory.path())).await.unwrap();
        let mut session = history(4);
        session.turn_count = 7;
        let original = session.clone();
        context
            .record(json!({"type":"original", "session":session}))
            .await
            .unwrap();
        let mut events = Vec::new();
        let (request, _) = context
            .prepare(
                &mut session,
                &server.client(),
                &CancellationToken::new(),
                build,
                &mut |e| {
                    events.push(e);
                    Ok(())
                },
            )
            .await
            .unwrap();
        assert!(request
            .prompt
            .contains("Pinned goal: Keep the original goal"));
        assert!(request.prompt.contains("file-3"));
        assert_eq!(session.turns, original.turns[5..]);
        assert_eq!(session.turn_count, 7);
        assert_eq!(context.compactions, 1);
        let transcript = tokio::fs::read_to_string(directory.path().join("transcript.jsonl"))
            .await
            .unwrap();
        let first: Value = serde_json::from_str(transcript.lines().next().unwrap()).unwrap();
        assert_eq!(first["session"], serde_json::to_value(original).unwrap());
        assert!(
            matches!(events.last(), Some(AgentEvent::ContextStatus { status, .. }) if status == "ready")
        );
    }

    #[tokio::test]
    async fn checkpoints_oversized_history_in_fitting_chunks() {
        let server = server(
            vec![
                ScriptedResponse::completion("First checkpoint"),
                ScriptedResponse::completion("Merged checkpoint"),
            ],
            8192,
        )
        .await;
        let mut context = WorkerContext::new(None).await.unwrap();
        let mut session = history(8);
        context
            .prepare(
                &mut session,
                &server.client(),
                &CancellationToken::new(),
                build,
                &mut |_| Ok(()),
            )
            .await
            .unwrap();
        assert_eq!(server.requests().len(), 2);
        assert_eq!(session.checkpoint.as_deref(), Some("Merged checkpoint"));
        for request in server.requests() {
            let tokens = request["messages"]
                .as_array()
                .unwrap()
                .iter()
                .map(|m| m["content"].as_str().unwrap().len())
                .sum::<usize>()
                / 4
                + 32;
            assert!(tokens + request["max_tokens"].as_u64().unwrap() as usize + 512 <= 8192);
        }
    }

    #[tokio::test]
    async fn failed_checkpoint_does_not_discard_or_replace_working_state() {
        let response = ScriptedResponse::completion("Incomplete checkpoint")
            .with_finish_reason("output_limit");
        let server = server(vec![response], 8192).await;
        let mut context = WorkerContext::new(None).await.unwrap();
        let mut session = history(4);
        let before = session.clone();
        assert!(context
            .prepare(
                &mut session,
                &server.client(),
                &CancellationToken::new(),
                build,
                &mut |_| Ok(())
            )
            .await
            .is_err());
        assert_eq!(session, before);
        assert_eq!(context.compactions, 0);
    }

    #[tokio::test]
    async fn manual_requests_are_worker_local_and_do_not_require_another_user_turn() {
        let server = server(
            vec![ScriptedResponse::completion("Completed earlier writes")],
            131072,
        )
        .await;
        let mut context = WorkerContext::new(None).await.unwrap();
        let other = WorkerContext::new(None).await.unwrap();
        request_compaction(&context.id).unwrap();
        assert!(!other.manual.load(Ordering::Acquire));
        context
            .prepare(
                &mut history(4),
                &server.client(),
                &CancellationToken::new(),
                build,
                &mut |_| Ok(()),
            )
            .await
            .unwrap();
        assert_eq!(context.compactions, 1);
        let id = context.id.clone();
        drop(context);
        assert!(request_compaction(&id).is_err());
    }

    #[tokio::test]
    async fn large_context_has_no_fixed_32k_conversation_ceiling() {
        let server = server(vec![], 131072).await;
        let mut context = WorkerContext::new(None).await.unwrap();
        let mut session = AgentSessionState::new("worker");
        session.push_user(&"x".repeat(160_000));
        let (request, _) = context
            .prepare(
                &mut session,
                &server.client(),
                &CancellationToken::new(),
                build,
                &mut |_| Ok(()),
            )
            .await
            .unwrap();
        assert!(request.prompt.len() > 160_000);
        assert_eq!(context.compactions, 0);
        assert!(server.requests().is_empty());
    }
}
