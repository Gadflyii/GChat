//! Agent run loop: `prompt -> decide -> run -> observe -> repeat`.

use std::{
    path::{Path, PathBuf},
    sync::Mutex,
    time::Duration,
};

use tokio_util::sync::CancellationToken;

use super::batch_executor::{execute_batch, PlannedCall};
use super::context::WorkerContext;
use super::definitions::AgentReasoningEffort;
use super::ginfer_client::{
    looks_like_atem_tool_calls, parse_tool_calls, CompletionRequest, CompletionTiming,
    GinferClient, GinferClientError, ParsedToolCalls,
};
use super::loop_guard::{
    format_forced_loop_reply, format_repeat_notice, format_veto_instruction,
    format_wandering_redirect, LoopCheckLevel, ToolLoopTracker,
};
use super::path_policy::EditableRoots;
use super::prompt::{build_prompt_with_workspace, format_workspace};
use super::resource_class::{is_batchable, resource_class_for, ResourceClass};
use super::session::AgentSessionState;
use super::skills::{loaded::LoadedSkills, SkillRegistry};
use super::tools::{self, ApprovalHook, DesktopServices, FolderAccessHook, ToolContext};
use super::types::{
    AgentEvent, AgentInferenceMetrics, LoopLevel, ToolCallPayload, ToolExecution, ToolOutcome,
    ToolStatus,
};

pub const MAX_STEPS: u32 = 25;
pub const MAX_PARALLEL_TOOL_CALLS: usize = 8;

const AUTHORING_PROMPT: &str = "You are GChat's Agent Builder. Collaborate with the user to author a reusable definition; never execute its future task. Ask necessary clarification questions with reply. Inspect the Studio catalog first: it provides native templates, exact registered instances, and the actual local model directory. Use that directory for requests about GChat's local models rather than guessing a path. Start from a template and preserve its schema. Set a concrete defaultGoal. Use null modelInstanceId and empty roleAssignments for the current model unless the user requests specific placement. Call studio_inspect with action validate_definition and the complete definition object in args (not a JSON string or definition wrapper). Correct validation errors before calling studio_manage with action save_definition and that same object. Saving presents user approval; do not claim success unless the save result confirms it. If declined, ask what should change. Use exact function names advertised in the native tool schemas; never add a namespace or append action to a name. Use reply for clarification and the final saved-agent summary. Do not use filesystem or shell tools, invent IDs, or run the agent. The user starts it later from Agent Studio.";

fn authoring_call_allowed(call: &ToolCallPayload) -> bool {
    match call.tool.as_str() {
        "reply" | "finish" => true,
        "tool.view" => matches!(call.args["name"].as_str(), Some("studio.inspect" | "studio.manage" | "reply")),
        "studio.inspect" => matches!(call.args["action"].as_str(), Some("catalog" | "get_definition" | "validate_definition" | "capacity" | "pools")),
        "studio.manage" => call.args["action"] == "save_definition",
        _ => false,
    }
}
#[cfg(not(test))]
const TOOL_STEP_COMPLETION_DEADLINE: Duration = Duration::from_secs(600);
#[cfg(test)]
const TOOL_STEP_COMPLETION_DEADLINE: Duration = Duration::from_millis(100);

pub struct RunTurnInput<'a> {
    pub run_id: &'a str,
    pub session_id: &'a str,
    pub user_message: &'a str,
    pub selected_skill: Option<&'a str>,
    pub stable_prefix: &'a str,
    pub reasoning_effort: Option<AgentReasoningEffort>,
    pub working_dir: &'a Path,
    pub editable_roots: &'a EditableRoots,
    pub external_read_only_roots: &'a [PathBuf],
    pub trusted_read_roots: &'a [PathBuf],
    pub max_steps: u32,
    pub client: &'a GinferClient,
    pub approval: &'a dyn ApprovalHook,
    pub folder_access: &'a dyn FolderAccessHook,
    pub desktop: &'a dyn DesktopServices,
    pub cancellation: &'a CancellationToken,
    pub session: &'a mut AgentSessionState,
    pub skill_registry: &'a SkillRegistry,
    pub bundled_script_runtime: Option<&'a Path>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct AgentTurnOutcome {
    pub reply: Option<String>,
    pub reason: String,
    pub step_count: u32,
    pub inference: AgentInferenceMetrics,
}

#[derive(Default)]
pub struct RunTurnOptions<'a> {
    pub max_output_tokens: Option<u32>,
    pub additional_skills: &'a [String],
    pub archive_dir: Option<&'a Path>,
}


pub async fn run_turn(
    input: RunTurnInput<'_>,
    emit: impl FnMut(AgentEvent) -> Result<(), String>,
) -> Result<(), String> {
    run_turn_with_options(input, RunTurnOptions::default(), emit)
        .await
        .map(|_| ())
}

pub async fn run_turn_with_options(
    mut input: RunTurnInput<'_>,
    options: RunTurnOptions<'_>,
    emit: impl FnMut(AgentEvent) -> Result<(), String>,
) -> Result<AgentTurnOutcome, String> {
    let mut context = WorkerContext::new(options.archive_dir).await?;
    let result = run_turn_inner(&mut input, options, emit, &mut context).await;
    context.save_working_state(input.session).await?;
    context
        .record(serde_json::json!({"type":"run_finished",
        "reason":result.as_ref().ok().map(|r| r.reason.as_str()),
        "error":result.as_ref().err(), "turn_count":input.session.turn_count}))
        .await?;
    result
}

async fn run_turn_inner(
    input: &mut RunTurnInput<'_>,
    options: RunTurnOptions<'_>,
    mut emit: impl FnMut(AgentEvent) -> Result<(), String>,
    context: &mut WorkerContext,
) -> Result<AgentTurnOutcome, String> {
    let reasoning_effort = Some(input.reasoning_effort.unwrap_or(AgentReasoningEffort::High));
    let authoring = input.selected_skill == Some("agent-builder")
        || options.additional_skills.iter().any(|name| name == "agent-builder");
    context
        .record(
            serde_json::json!({"type":"start", "goal":input.user_message,
        "instructions":input.stable_prefix, "session":input.session}),
        )
        .await?;
    let mut trusted_roots = input.trusted_read_roots.to_vec();
    trusted_roots.extend(input.session.archive_roots.iter().cloned());
    if let Some(path) = &context.archive_dir {
        trusted_roots.push(path.clone());
        if !input.session.archive_roots.contains(path) {
            input.session.archive_roots.push(path.clone());
        }
    }
    emit(AgentEvent::TurnStarted {
        run_id: input.run_id.to_owned(),
        session_id: input.session_id.to_owned(),
    })?;
    let max_steps = input.max_steps.clamp(1, MAX_STEPS);
    let mut notice: Option<String> = None;
    let mut tracker = ToolLoopTracker::default();
    let mut inference = AgentInferenceMetrics::default();
    let tool_inference = Mutex::new(AgentInferenceMetrics::default());
    let loaded_tools = tools::tool_view::LoadedTools::restore(&input.session.loaded_tools);
    let retained_skills = input.session.loaded_skills.iter()
        .filter(|skill| if authoring { skill.name == "agent-builder" } else { skill.name != "agent-builder" })
        .cloned().collect::<Vec<_>>();
    let loaded_skills = LoadedSkills::restore(&retained_skills, input.skill_registry);
    if let Some(selected_skill) = input.selected_skill {
        let outcome = loaded_skills
            .view(selected_skill, input.skill_registry)
            .await;
        if outcome.status != ToolStatus::Ok {
            let message = outcome.summary;
            emit(AgentEvent::StepError {
                message: message.clone(),
                category: "skill".into(),
            })?;
            emit(AgentEvent::TurnFinished {
                reason: "failed".into(),
                step_count: 0,
            })?;
            return Err(message);
        }
    }
    for selected_skill in options.additional_skills {
        let outcome = loaded_skills
            .view(selected_skill, input.skill_registry)
            .await;
        if outcome.status != ToolStatus::Ok {
            let message = outcome.summary;
            emit(AgentEvent::StepError {
                message: message.clone(),
                category: "skill".into(),
            })?;
            emit(AgentEvent::TurnFinished {
                reason: "failed".into(),
                step_count: 0,
            })?;
            return Err(message);
        }
    }
    input.session.push_user(input.user_message);
    for step_index in 0..max_steps {
        if input.cancellation.is_cancelled() {
            finish_session(input.session, &loaded_tools, &loaded_skills, None).await;
            return finish_cancelled(
                step_index,
                combined_inference(inference, &tool_inference),
                &mut emit,
            );
        }
        emit(AgentEvent::StepStarted { step_index })?;
        let loaded_tool_names = loaded_tools.snapshot().await;
        let loaded_skill_entries = loaded_skills.snapshot().await;
        let editable_roots = input.editable_roots.snapshot().await;
        let primary_root = editable_roots
            .first()
            .map(PathBuf::as_path)
            .unwrap_or(input.working_dir);
        let workspace = format_workspace(
            primary_root,
            &editable_roots,
            input.external_read_only_roots,
        );
        let prepared = context.prepare(input.session, input.client, input.cancellation, |session| {
            let archive_guidance = if authoring { "" } else {
                "\n\nArchived tool results are readable with os.fs.read; use bounded excerpts when needed."
            };
            let conversation = format!("Current task (preserve verbatim):\n{}\n\n{}\n\n{}{archive_guidance}",
                input.user_message, input.approval.permission_summary().unwrap_or_default(), session.render_conversation());
            let mut request = CompletionRequest::tool_call(build_prompt_with_workspace(
                if authoring { AUTHORING_PROMPT } else { input.stable_prefix }, &loaded_tool_names, &loaded_skill_entries,
                Some(&workspace), &conversation, notice.as_deref(),
            ), reasoning_effort);
            request.authoring = authoring;
            request.output_limit_override = options.max_output_tokens;
            if authoring {
                request.system_prompt = Some(AUTHORING_PROMPT.into());
            }
            request
        }, &mut emit).await;
        let (request, checkpoint_timing) = match prepared {
            Ok(result) => result,
            Err(_) if input.cancellation.is_cancelled() => {
                finish_session(input.session, &loaded_tools, &loaded_skills, None).await;
                return finish_cancelled(
                    step_index,
                    combined_inference(inference, &tool_inference),
                    &mut emit,
                );
            }
            Err(error) => {
                context.record(serde_json::json!({"type":"context_error", "error":error, "session":input.session})).await?;
                context.report_failure(&mut emit)?;
                emit(AgentEvent::StepError {
                    message: error.clone(),
                    category: "context".into(),
                })?;
                return Err(error);
            }
        };
        record_completion(&mut inference, &checkpoint_timing);
        notice = None;
        let completion = complete_with_budget_recovery(input.client, &request, input.cancellation, &mut emit, step_index).await;
        if let Ok(result) = &completion {
            context
                .record(serde_json::json!({"type":"completion", "step":step_index,
                "content":result.content, "reasoning":result.reasoning_content,
                "finish_reason":result.finish_reason}))
                .await?;
        }
        let mut previous_output = String::new();
        let mut parsed = match completion {
            Ok(completion) => {
                record_completion(&mut inference, &completion.timing);
                if completion.finish_reason == "output_limit" {
                    let message = "The model exhausted its output budget before completing a tool call. Your progress is preserved; revise the request or increase the available output/context budget.";
                    emit(AgentEvent::StepError { message: message.into(), category: "output_budget".into() })?;
                    emit(AgentEvent::TurnFinished { reason: "failed".into(), step_count: step_index + 1 })?;
                    finish_session(input.session, &loaded_tools, &loaded_skills, None).await;
                    return Ok(AgentTurnOutcome { reply: None, reason: "failed".into(), step_count: step_index + 1, inference: combined_inference(inference, &tool_inference) });
                }
                previous_output.clone_from(&completion.content);
                if !completion.reasoning_content.is_empty() {
                    emit(AgentEvent::ReasoningDelta {
                        step_index,
                        text: completion.reasoning_content.clone(),
                    })?;
                }
                match parse_tool_calls(&completion.content).or_else(|error| {
                    if authoring { recover_authoring_reply(&completion.content).ok_or(error) }
                    else { Err(error) }
                }) {
                    Ok(parsed) => parsed,
                    Err(error) => {
                        emit(AgentEvent::ParseRetry {
                            step_index,
                            reason: error.to_string(),
                        })?;
                        match repair_tool_calls(
                            input.client,
                            &request,
                            &completion.content,
                            &error.to_string(),
                            input.cancellation,
                            context,
                        )
                        .await
                        {
                            Ok((parsed, timing)) => {
                                record_completion(&mut inference, &timing);
                                parsed
                            }
                            Err(GinferClientError::Cancelled) => {
                                finish_session(input.session, &loaded_tools, &loaded_skills, None)
                                    .await;
                                return finish_cancelled(
                                    step_index,
                                    combined_inference(inference, &tool_inference),
                                    &mut emit,
                                );
                            }
                            Err(error) => {
                                let message = error.to_string();
                                emit(AgentEvent::StepError {
                                    message: message.clone(),
                                    category: repair_error_category(&error).into(),
                                })?;
                                emit(AgentEvent::TurnFinished {
                                    reason: "failed".into(),
                                    step_count: step_index + 1,
                                })?;
                                finish_session(input.session, &loaded_tools, &loaded_skills, None)
                                    .await;
                                return Err(message);
                            }
                        }
                    }
                }
            }
            Err(GinferClientError::TimedOut) => {
                emit(AgentEvent::ParseRetry {
                    step_index,
                    reason: "Tool-step completion exceeded the 600-second deadline".into(),
                })?;
                match repair_tool_calls(
                    input.client,
                    &request,
                    "",
                    "Tool-step completion exceeded the 600-second deadline",
                    input.cancellation,
                    context,
                )
                .await
                {
                    Ok((parsed, timing)) => {
                        record_completion(&mut inference, &timing);
                        parsed
                    }
                    Err(GinferClientError::Cancelled) => {
                        finish_session(input.session, &loaded_tools, &loaded_skills, None).await;
                        return finish_cancelled(
                            step_index,
                            combined_inference(inference, &tool_inference),
                            &mut emit,
                        );
                    }
                    Err(error) => {
                        let message = error.to_string();
                        emit(AgentEvent::StepError {
                            message: message.clone(),
                            category: repair_error_category(&error).into(),
                        })?;
                        emit(AgentEvent::TurnFinished {
                            reason: "failed".into(),
                            step_count: step_index + 1,
                        })?;
                        finish_session(input.session, &loaded_tools, &loaded_skills, None).await;
                        return Err(message);
                    }
                }
            }
            Err(GinferClientError::Cancelled) => {
                finish_session(input.session, &loaded_tools, &loaded_skills, None).await;
                return finish_cancelled(
                    step_index,
                    combined_inference(inference, &tool_inference),
                    &mut emit,
                );
            }
            Err(error) => {
                emit(AgentEvent::StepError {
                    message: error.to_string(),
                    category: "llm".into(),
                })?;
                emit(AgentEvent::TurnFinished {
                    reason: "failed".into(),
                    step_count: step_index,
                })?;
                finish_session(input.session, &loaded_tools, &loaded_skills, None).await;
                return Err(error.to_string());
            }
        };
        emit(AgentEvent::InferenceMeasured {
            inference: combined_inference(inference, &tool_inference),
        })?;
        if let Some(reasoning) = parsed.reasoning.filter(|value| !value.is_empty()) {
            emit(AgentEvent::ReasoningDelta {
                step_index,
                text: reasoning,
            })?;
        }
        if let Err(error) = validate_batch(&parsed.calls) {
            if error.is_approval_only() {
                let (trimmed, dropped_tools) = trim_to_first_approval_gated(&parsed.calls);
                let kept_tool = trimmed[0].tool.clone();
                let reason = error.to_string();
                emit(AgentEvent::BatchTrimmed {
                    step_index,
                    reason: reason.clone(),
                    kept_tool: kept_tool.clone(),
                    dropped_tools: dropped_tools.clone(),
                })?;
                notice = Some(format_batch_trim_notice(&kept_tool, &dropped_tools));
                parsed.calls = trimmed;
            } else {
                emit(AgentEvent::ParseRetry {
                    step_index,
                    reason: error.to_string(),
                })?;
                match repair_tool_calls(
                    input.client,
                    &request,
                    &previous_output,
                    &error.to_string(),
                    input.cancellation,
                    context,
                )
                .await
                {
                    Ok((repaired, timing)) => {
                        record_completion(&mut inference, &timing);
                        parsed = repaired;
                    }
                    Err(GinferClientError::Cancelled) => {
                        finish_session(input.session, &loaded_tools, &loaded_skills, None).await;
                        return finish_cancelled(
                            step_index,
                            combined_inference(inference, &tool_inference),
                            &mut emit,
                        );
                    }
                    Err(error) => {
                        let message = error.to_string();
                        emit(AgentEvent::StepError {
                            message: message.clone(),
                            category: repair_error_category(&error).into(),
                        })?;
                        emit(AgentEvent::TurnFinished {
                            reason: "failed".into(),
                            step_count: step_index + 1,
                        })?;
                        finish_session(input.session, &loaded_tools, &loaded_skills, None).await;
                        return Err(message);
                    }
                }
            }
        }
        let batch_size = parsed.calls.len();
        for (batch_index, call) in parsed.calls.iter().enumerate() {
            emit(AgentEvent::ToolCallParsed {
                call: call.clone(),
                batch_index,
                batch_size,
            })?;
        }

        let mut planned = Vec::with_capacity(batch_size);
        let mut breaker: Option<(String, usize, super::types::LoopDetector)> = None;
        for call in &parsed.calls {
            if authoring && !authoring_call_allowed(call) {
                planned.push(PlannedCall::Denied(ToolOutcome::denied(
                    "Agent Builder only authors definitions. Use studio.inspect, studio.manage/save_definition, tool.view or reply; do not execute the future task.",
                    "authoring-only",
                )));
                continue;
            }
            let verdict = tracker.check(&call.tool, &call.args);
            if tracker.is_wandering_escalated(&call.tool, &call.args) {
                breaker = Some((call.tool.clone(), verdict.count, verdict.detector));
                break;
            }
            match verdict.level {
                LoopCheckLevel::Ok => tracker.record_call(&call.tool, &call.args),
                LoopCheckLevel::Warn => {
                    let message = if verdict.detector == super::types::LoopDetector::Wandering {
                        format_wandering_redirect(&call.tool, verdict.count)
                    } else {
                        format_repeat_notice(&verdict)
                    };
                    if tracker.should_emit_warning(&verdict.warning_key, verdict.count) {
                        emit(AgentEvent::LoopDetected {
                            level: LoopLevel::Warn,
                            detector: verdict.detector,
                            message: message.clone(),
                        })?;
                        notice = Some(message);
                    }
                    tracker.record_call(&call.tool, &call.args);
                }
                LoopCheckLevel::Critical => {
                    let outcome = ToolOutcome::denied(
                        format_veto_instruction(&verdict),
                        super::loop_guard::LOOP_VETO_DENIED_REASON,
                    );
                    tracker.record_call(&call.tool, &call.args);
                    tracker.record_outcome(&call.tool, &call.args, &outcome);
                    emit(AgentEvent::LoopDetected {
                        level: LoopLevel::Critical,
                        detector: verdict.detector,
                        message: outcome.summary.clone(),
                    })?;
                    if tracker.is_breaker_tripped(&call.tool, &call.args) {
                        breaker = Some((call.tool.clone(), verdict.count, verdict.detector));
                        break;
                    }
                    planned.push(PlannedCall::Denied(outcome));
                }
            }
            if !matches!(verdict.level, LoopCheckLevel::Critical) {
                planned.push(PlannedCall::Execute);
            }
        }
        if let Some((tool, count, detector)) = breaker {
            let reply = format_forced_loop_reply(&tool, count);
            emit(AgentEvent::LoopDetected {
                level: LoopLevel::Breaker,
                detector,
                message: reply.clone(),
            })?;
            emit(AgentEvent::AssistantReply {
                text: reply.clone(),
            })?;
            emit(AgentEvent::TurnFinished {
                reason: "reply".into(),
                step_count: step_index + 1,
            })?;
            finish_session(input.session, &loaded_tools, &loaded_skills, Some(&reply)).await;
            return Ok(AgentTurnOutcome {
                reply: Some(reply),
                reason: "reply".into(),
                step_count: step_index + 1,
                inference: combined_inference(inference, &tool_inference),
            });
        }

        let tool_context = ToolContext {
            working_dir: input.working_dir,
            editable_roots: input.editable_roots,
            trusted_read_roots: &trusted_roots,
            client: Some(input.client),
            reasoning_effort,
            inference: Some(&tool_inference),
            approval: input.approval,
            folder_access: input.folder_access,
            cancellation: input.cancellation,
            loaded_tools: &loaded_tools,
            loaded_skills: &loaded_skills,
            skill_registry: input.skill_registry,
            bundled_script_runtime: input.bundled_script_runtime,
            desktop: input.desktop,
        };
        let has_terminal_tail = parsed
            .calls
            .last()
            .is_some_and(|call| resource_class_for(&call.tool) == ResourceClass::Terminal);
        let parallel_len = batch_size - usize::from(has_terminal_tail);
        let outcomes = execute_batch(&parsed.calls, &planned, &tool_context).await;
        let mut artifact_paths = Vec::new();
        for (index, (call, outcome)) in parsed.calls.iter().zip(&outcomes).enumerate() {
            let value = serde_json::json!({"type":"tool", "step":step_index, "call":call, "outcome":outcome});
            artifact_paths.push(context.artifact(step_index, index, &value).await?);
            context.record(value).await?;
        }
        let mut terminal: Option<(&str, String)> = None;
        for (batch_index, (call, outcome)) in parsed.calls.iter().zip(outcomes.iter()).enumerate() {
            tracker.record_outcome(&call.tool, &call.args, outcome);
            emit(AgentEvent::ToolCallExecuted {
                result: ToolExecution {
                    call: call.clone(),
                    outcome: outcome.clone(),
                    batch_index,
                    batch_size,
                },
            })?;
            if outcome.status == ToolStatus::Ok && matches!(call.tool.as_str(), "reply" | "finish")
            {
                terminal = Some((call.tool.as_str(), outcome.summary.clone()));
            }
        }
        if batch_size > 1 {
            let verdict = tracker.observe_batch_composite(&parsed.calls, &outcomes);
            if verdict.level != LoopCheckLevel::Ok
                && tracker.should_emit_warning(&verdict.warning_key, verdict.count)
            {
                let message = format_repeat_notice(&verdict);
                emit(AgentEvent::LoopDetected {
                    level: LoopLevel::Warn,
                    detector: verdict.detector,
                    message: message.clone(),
                })?;
                notice = Some(message);
            }
        }
        input
            .session
            .push_tool_observations(&parsed.calls[..parallel_len], &outcomes[..parallel_len]);
        let start = input.session.turns.len() - parallel_len * 2;
        for (index, path) in artifact_paths.iter().take(parallel_len).enumerate() {
            if let (Some(path), super::session::AgentSessionTurn::ToolResult { summary, .. }) =
                (path, &mut input.session.turns[start + index * 2 + 1])
            {
                if !authoring {
                    summary.push_str(&format!("\nFull result: {}", path.display()));
                }
            }
        }
        context.save_working_state(input.session).await?;
        if let Some((reason, text)) = terminal {
            emit(AgentEvent::AssistantDelta { text: text.clone() })?;
            emit(AgentEvent::AssistantReply { text: text.clone() })?;
            emit(AgentEvent::TurnFinished {
                reason: reason.into(),
                step_count: step_index + 1,
            })?;
            finish_session(input.session, &loaded_tools, &loaded_skills, Some(&text)).await;
            return Ok(AgentTurnOutcome {
                reply: Some(text),
                reason: reason.into(),
                step_count: step_index + 1,
                inference: combined_inference(inference, &tool_inference),
            });
        }
    }

    let text =
        "I reached the maximum number of agent steps before completing the request.".to_owned();
    emit(AgentEvent::AssistantReply { text: text.clone() })?;
    emit(AgentEvent::TurnFinished {
        reason: "max_steps".into(),
        step_count: max_steps,
    })?;
    finish_session(input.session, &loaded_tools, &loaded_skills, Some(&text)).await;
    Ok(AgentTurnOutcome {
        reply: Some(text),
        reason: "max_steps".into(),
        step_count: max_steps,
        inference: combined_inference(inference, &tool_inference),
    })
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum BatchValidationKind {
    Empty,
    Limit,
    Unknown,
    TerminalPosition,
    EmptyReply,
    ApprovalGatedSolo,
}

#[derive(Debug)]
struct BatchValidationIssue {
    kind: BatchValidationKind,
    message: String,
}

#[derive(Debug)]
struct BatchValidationError {
    issues: Vec<BatchValidationIssue>,
}

impl BatchValidationError {
    fn is_approval_only(&self) -> bool {
        !self.issues.is_empty()
            && self
                .issues
                .iter()
                .all(|issue| issue.kind == BatchValidationKind::ApprovalGatedSolo)
    }
}

impl std::fmt::Display for BatchValidationError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(
            &self
                .issues
                .iter()
                .map(|issue| issue.message.as_str())
                .collect::<Vec<_>>()
                .join("; "),
        )
    }
}

fn validate_batch(calls: &[ToolCallPayload]) -> Result<(), BatchValidationError> {
    let mut issues = Vec::new();
    if calls.is_empty() {
        issues.push(BatchValidationIssue {
            kind: BatchValidationKind::Empty,
            message: "Tool-call batch cannot be empty".into(),
        });
    }
    if calls.len() > MAX_PARALLEL_TOOL_CALLS {
        issues.push(BatchValidationIssue {
            kind: BatchValidationKind::Limit,
            message: format!("Tool-call batch exceeds the limit of {MAX_PARALLEL_TOOL_CALLS}"),
        });
    }
    let mut terminal_count = 0;
    for (index, call) in calls.iter().enumerate() {
        let class = resource_class_for(&call.tool);
        if class == ResourceClass::Unknown {
            issues.push(BatchValidationIssue {
                kind: BatchValidationKind::Unknown,
                message: format!("Unknown tool in batch: {}", call.tool),
            });
        }
        if calls.len() > 1 && class == ResourceClass::ApprovalGated {
            issues.push(BatchValidationIssue {
                kind: BatchValidationKind::ApprovalGatedSolo,
                message: format!("Tool must run solo: {}", call.tool),
            });
        } else if calls.len() > 1 && class != ResourceClass::Terminal && !is_batchable(class) {
            issues.push(BatchValidationIssue {
                kind: BatchValidationKind::Unknown,
                message: format!("Tool cannot run in a batch: {}", call.tool),
            });
        }
        if class == ResourceClass::Terminal {
            terminal_count += 1;
            if index + 1 != calls.len() || terminal_count > 1 {
                issues.push(BatchValidationIssue {
                    kind: BatchValidationKind::TerminalPosition,
                    message: "A terminal tool must be the single final terminal call".into(),
                });
            }
            if call.tool == "reply"
                && call
                    .args
                    .get("text")
                    .and_then(serde_json::Value::as_str)
                    .map_or(true, |text| text.trim().is_empty())
            {
                issues.push(BatchValidationIssue {
                    kind: BatchValidationKind::EmptyReply,
                    message: "reply.args.text must be a non-empty string".into(),
                });
            }
        }
    }
    if issues.is_empty() {
        Ok(())
    } else {
        Err(BatchValidationError { issues })
    }
}

fn trim_to_first_approval_gated(calls: &[ToolCallPayload]) -> (Vec<ToolCallPayload>, Vec<String>) {
    let kept_index = calls
        .iter()
        .position(|call| resource_class_for(&call.tool) == ResourceClass::ApprovalGated)
        .expect("approval-only validation requires an approval-gated call");
    let kept = calls[kept_index].clone();
    let dropped = calls
        .iter()
        .enumerate()
        .filter(|(index, _)| *index != kept_index)
        .map(|(_, call)| call.tool.clone())
        .collect();
    (vec![kept], dropped)
}

fn format_batch_trim_notice(kept_tool: &str, dropped_tools: &[String]) -> String {
    format!(
        "The previous batch contained a tool that must run alone in a length-1 array. Executed \
         `{kept_tool}` only; re-evaluate before calling the dropped tools: {}.",
        dropped_tools.join(", ")
    )
}

fn parse_and_validate(content: &str) -> Result<ParsedToolCalls, String> {
    let parsed = parse_tool_calls(content).map_err(|error| error.to_string())?;
    validate_batch(&parsed.calls).map_err(|error| error.to_string())?;
    Ok(parsed)
}

fn record_completion(metrics: &mut AgentInferenceMetrics, timing: &CompletionTiming) {
    metrics.record(
        timing.prompt_tokens,
        timing.predicted_tokens,
        timing.prompt_ms,
        timing.predicted_ms,
    );
}

fn combined_inference(
    mut completion: AgentInferenceMetrics,
    tool_inference: &Mutex<AgentInferenceMetrics>,
) -> AgentInferenceMetrics {
    if let Ok(tool) = tool_inference.lock() {
        completion.merge(*tool);
    }
    completion
}

async fn repair_tool_calls(
    client: &GinferClient,
    original_request: &CompletionRequest,
    invalid_output: &str,
    reason: &str,
    cancellation: &CancellationToken,
    context: &mut WorkerContext,
) -> Result<(ParsedToolCalls, CompletionTiming), GinferClientError> {
    let invalid_output = invalid_output.chars().take(4_000).collect::<String>();
    let repair_instruction = format!(
        "### tool-call-repair\nThe previous tool-call output was invalid: {reason}\n\
         Call the corrected function tools only. Approval-gated or dependent calls must run \
         alone. A terminal call may appear only once and only after all other work.\n\
         Previous output:\n{invalid_output}"
    );
    let repair_prompt = format!("{}\n\n{repair_instruction}", original_request.prompt);
    let mut request = original_request.clone();
    request.prompt = repair_prompt;
    request.max_tokens = original_request.max_tokens;
    let capacity = client
        .fetch_context_window(cancellation)
        .await?
        .ok_or_else(|| {
            GinferClientError::InvalidResponse("Missing context capacity for repair".into())
        })?;
    if client.count_input_tokens(&request, cancellation).await? + request.max_tokens as usize
        > capacity
    {
        return Err(GinferClientError::InvalidResponse(
            "Tool-call repair does not fit context; transcript is preserved".into(),
        ));
    }
    let completion = complete_with_deadline(client, &request, cancellation).await?;
    context
        .record(
            serde_json::json!({"type":"repair_completion", "content":completion.content,
        "reasoning":completion.reasoning_content, "finish_reason":completion.finish_reason}),
        )
        .await
        .map_err(GinferClientError::Transport)?;
    let parsed = match parse_and_validate(&completion.content) {
        Ok(parsed) => parsed,
        Err(error) => (if original_request.authoring { recover_authoring_reply(&completion.content) } else { recover_plain_text_reply(&completion.content) }).ok_or_else(|| {
            let excerpt = completion
                .content
                .split_whitespace()
                .collect::<Vec<_>>()
                .join(" ")
                .chars()
                .take(240)
                .collect::<String>();
            GinferClientError::InvalidResponse(format!(
                "Repair failed: {error}; GInfer returned {} non-whitespace characters{}",
                completion
                    .content
                    .chars()
                    .filter(|ch| !ch.is_whitespace())
                    .count(),
                if excerpt.is_empty() {
                    String::new()
                } else {
                    format!("; output excerpt: {excerpt}")
                }
            ))
        })?,
    };
    Ok((parsed, completion.timing))
}

fn recover_plain_text_reply(content: &str) -> Option<ParsedToolCalls> {
    let text = content.trim();
    if text.is_empty()
        || text.contains('{')
        || text.contains('[')
        || looks_like_atem_tool_calls(text)
    {
        return None;
    }
    Some(ParsedToolCalls {
        calls: vec![ToolCallPayload {
            tool: "reply".into(),
            args: serde_json::json!({"text": text}),
        }],
        reasoning: None,
    })
}

fn recover_authoring_reply(content: &str) -> Option<ParsedToolCalls> {
    let text = content.trim().strip_prefix("<|message|>").unwrap_or(content.trim()).trim();
    if text.is_empty() || text.starts_with(['{', '[', '<', '`']) || looks_like_atem_tool_calls(text) {
        return None;
    }
    Some(ParsedToolCalls {
        calls: vec![ToolCallPayload { tool: "reply".into(), args: serde_json::json!({"text": text}) }],
        reasoning: None,
    })
}

async fn complete_with_deadline(
    client: &GinferClient,
    request: &CompletionRequest,
    cancellation: &CancellationToken,
) -> Result<super::ginfer_client::CompletionResult, GinferClientError> {
    let deadline = TOOL_STEP_COMPLETION_DEADLINE;
    #[cfg(test)]
    let deadline = if std::env::var_os("GCHAT_BUILDER_LIVE_PORT").is_some() {
        Duration::from_secs(600)
    } else { deadline };
    tokio::select! {
        biased;
        _ = cancellation.cancelled() => Err(GinferClientError::Cancelled),
        result = tokio::time::timeout(
            deadline,
            client.complete(request, cancellation),
        ) => match result {
            Ok(result) => result,
            Err(_) => Err(GinferClientError::TimedOut),
        },
    }
}

async fn complete_with_budget_recovery(
    client: &GinferClient,
    request: &CompletionRequest,
    cancellation: &CancellationToken,
    emit: &mut impl FnMut(AgentEvent) -> Result<(), String>,
    step_index: u32,
) -> Result<super::ginfer_client::CompletionResult, GinferClientError> {
    let first = complete_with_deadline(client, request, cancellation).await?;
    if first.finish_reason != "output_limit" || request.output_limit_override.is_some() { return Ok(first); }
    let capacity = client.fetch_context_window(cancellation).await?.unwrap_or(0);
    let input = client.count_input_tokens(request, cancellation).await?;
    let available = capacity.saturating_sub(input).saturating_sub(512).min(u32::MAX as usize) as u32;
    let expanded = request.max_tokens.saturating_mul(2).min(available);
    if expanded <= request.max_tokens { return Ok(first); }
    emit(AgentEvent::ParseRetry { step_index, reason: format!("Output budget exhausted; retrying once with {expanded} tokens and unchanged reasoning effort. No tools are replayed.") }).map_err(GinferClientError::Transport)?;
    let mut retry = request.clone();
    retry.max_tokens = expanded;
    let mut result = complete_with_deadline(client, &retry, cancellation).await?;
    result.timing.prompt_ms += first.timing.prompt_ms;
    result.timing.predicted_ms += first.timing.predicted_ms;
    result.timing.prompt_tokens += first.timing.prompt_tokens;
    result.timing.predicted_tokens += first.timing.predicted_tokens;
    Ok(result)
}

fn repair_error_category(error: &GinferClientError) -> &'static str {
    match error {
        GinferClientError::InvalidResponse(_) | GinferClientError::ToolCallParse(_) => "tool_call",
        GinferClientError::Cancelled => "cancelled",
        GinferClientError::TimedOut => "timeout",
        _ => "llm",
    }
}

async fn finish_session(
    session: &mut AgentSessionState,
    loaded_tools: &tools::tool_view::LoadedTools,
    loaded_skills: &LoadedSkills,
    reply: Option<&str>,
) {
    if let Some(reply) = reply {
        session.push_reply(reply);
    }
    session.set_loaded_tools(loaded_tools.snapshot().await);
    session.set_loaded_skills(loaded_skills.snapshot().await);
    session.finish_turn();
}

fn finish_cancelled(
    step_count: u32,
    inference: AgentInferenceMetrics,
    emit: &mut impl FnMut(AgentEvent) -> Result<(), String>,
) -> Result<AgentTurnOutcome, String> {
    emit(AgentEvent::TurnFinished {
        reason: "cancelled".into(),
        step_count,
    })?;
    Ok(AgentTurnOutcome {
        reply: None,
        reason: "cancelled".into(),
        step_count,
        inference,
    })
}
