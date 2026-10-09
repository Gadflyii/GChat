//! Bounded compositions over the existing Agent executor.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Instant;

use futures::{stream, StreamExt};
use tokio_util::sync::CancellationToken;

use super::definitions::{
    workflow_levels, AgentDefinition, AgentReasoningEffort, AgentStrategy, StageWorkspace,
    WorkflowEdge, WorkflowNode,
};
use super::ginfer_client::GinferClient;
use super::path_policy::EditableRoots;
use super::prompt::{
    build_stable_prefix, compose_agent_persona, CapabilitiesSummary, SkillDescriptor,
    DEFAULT_MAX_PARALLEL_TOOL_CALLS, ITERATION_ONE_TOOLS,
};
use super::runner::{
    combine_turn_reason, turn_status,
    run_turn_with_options, AgentTurnOutcome, RunTurnInput, RunTurnOptions, MAX_STEPS,
};
use super::session::AgentSessionState;
use super::skills::SkillRegistry;
use super::tools::{ApprovalHook, DesktopServices, FolderAccessHook};
use super::types::{AgentEvent, AgentInferenceMetrics};

const STAGE_HANDOFF_CHARS: usize = 8_000;

pub struct OrchestrationInput<'a> {
    pub run_id: &'a str,
    pub storage_id: &'a str,
    pub session_id: &'a str,
    pub user_message: &'a str,
    pub selected_skill: Option<&'a str>,
    pub definition: &'a AgentDefinition,
    pub capabilities: &'a CapabilitiesSummary,
    pub skill_descriptors: &'a [SkillDescriptor],
    pub active_model_instance_id: &'a str,
    pub working_dir: &'a Path,
    pub editable_roots: &'a EditableRoots,
    pub external_read_only_roots: &'a [PathBuf],
    pub trusted_read_roots: &'a [PathBuf],
    pub max_steps_override: Option<u32>,
    pub model_routes: &'a AgentModelRoutes,
    pub approval: &'a dyn ApprovalHook,
    pub folder_access: &'a dyn FolderAccessHook,
    pub desktop: &'a dyn DesktopServices,
    pub cancellation: &'a CancellationToken,
    pub session: &'a mut AgentSessionState,
    pub skill_registry: &'a SkillRegistry,
    pub bundled_script_runtime: Option<&'a Path>,
    pub data_folder: &'a Path,
}

struct StageContext<'a> {
    max_output_tokens: Option<u32>,
    events: tokio::sync::mpsc::UnboundedSender<AgentEvent>,
    run_id: &'a str,
    capabilities: &'a CapabilitiesSummary,
    skill_descriptors: &'a [SkillDescriptor],
    default_model_instance_id: &'a str,
    working_dir: &'a Path,
    editable_roots: &'a EditableRoots,
    external_read_only_roots: &'a [PathBuf],
    trusted_read_roots: &'a [PathBuf],
    model_routes: &'a AgentModelRoutes,
    approval: &'a dyn ApprovalHook,
    folder_access: &'a dyn FolderAccessHook,
    desktop: &'a dyn DesktopServices,
    cancellation: &'a CancellationToken,
    skill_registry: &'a SkillRegistry,
    bundled_script_runtime: Option<&'a Path>,
    run_root: &'a Path,
}

#[derive(Clone)]
struct StageSpec {
    id: String,
    placement_role: String,
    name: String,
    role: String,
    instructions: String,
    output_contract: String,
    skills: Vec<String>,
    max_steps: u32,
    workspace: StageWorkspace,
    message: String,
    cycle: Option<u32>,
    model_instance_id: String,
    reasoning_effort: Option<AgentReasoningEffort>,
}

struct StageResult {
    id: String,
    name: String,
    outcome: AgentTurnOutcome,
    duration_ms: u64,
    model_instance_id: String,
    model_id: String,
    reasoning_effort: Option<AgentReasoningEffort>,
}

pub struct AgentModelRoute {
    pub instance_id: String,
    pub model_id: String,
    pub client: GinferClient,
}

pub struct AgentModelRoutes {
    routes: HashMap<String, AgentModelRoute>,
    pub dispatcher: Option<Arc<dyn WorkerDispatcher>>,
}

pub struct SelectedWorker {
    pub route: Arc<AgentModelRoute>,
    pub _lease: Option<super::worker_pools::WorkerLease>,
}

#[async_trait::async_trait]
pub trait WorkerDispatcher: Send + Sync {
    fn queue_reason(&self, _role: &str) -> String {
        "Waiting for a suitable instance and worker capacity".into()
    }
    async fn select(
        &self,
        role: &str,
        default_instance: &str,
        cancellation: &CancellationToken,
    ) -> Result<SelectedWorker, String>;
}

impl AgentModelRoutes {
    pub fn new(routes: Vec<AgentModelRoute>) -> Result<Self, String> {
        let mut by_instance = HashMap::with_capacity(routes.len());
        for route in routes {
            if by_instance
                .insert(route.instance_id.clone(), route)
                .is_some()
            {
                return Err("Duplicate Agent model-instance route".into());
            }
        }
        Ok(Self {
            routes: by_instance,
            dispatcher: None,
        })
    }

    pub fn route(&self, instance_id: &str) -> Result<&AgentModelRoute, String> {
        self.routes.get(instance_id).ok_or_else(|| {
            format!("Agent model instance `{instance_id}` was not resolved before execution")
        })
    }
}

pub async fn run_definition(
    input: OrchestrationInput<'_>,
    mut emit: impl FnMut(AgentEvent) -> Result<(), String>,
) -> Result<AgentTurnOutcome, String> {
    let (sender, mut receiver) = tokio::sync::mpsc::unbounded_channel();
    let cancellation = input.cancellation.clone();
    let forward = sender.clone();
    let execution = run_definition_inner(input, sender, move |event| {
        forward.send(event).map_err(|e| e.to_string())
    });
    tokio::pin!(execution);
    let mut completed_steps = 0u32;
    let mut completed_inference = AgentInferenceMetrics::default();
    let mut forward_event = |event: AgentEvent| {
        if let AgentEvent::StageFinished {
            step_count,
            inference,
            ..
        } = &event
        {
            completed_steps = completed_steps.saturating_add(*step_count);
            completed_inference.merge(*inference);
        }
        emit(event)
    };
    let result = loop {
        tokio::select! {
            event = receiver.recv() => if let Some(event) = event { forward_event(event)?; },
            result = &mut execution => break result,
        }
    };
    while let Ok(event) = receiver.try_recv() {
        forward_event(event)?;
    }
    if result.is_err() && cancellation.is_cancelled() {
        emit(AgentEvent::TurnFinished {
            reason: "cancelled".into(),
            step_count: completed_steps,
        })?;
        return Ok(AgentTurnOutcome {
            reply: None,
            reason: "cancelled".into(),
            step_count: completed_steps,
            inference: completed_inference,
        });
    }
    result
}

async fn run_definition_inner(
    input: OrchestrationInput<'_>,
    events: tokio::sync::mpsc::UnboundedSender<AgentEvent>,
    mut emit: impl FnMut(AgentEvent) -> Result<(), String>,
) -> Result<AgentTurnOutcome, String> {
    let kind = strategy_name(&input.definition.strategy);
    let approval = super::permissions::DefinitionApproval {
        permissions: &input.definition.permissions,
        inner: input.approval,
    };
    emit(AgentEvent::TurnStarted {
        run_id: input.run_id.to_owned(),
        session_id: input.session_id.to_owned(),
    })?;
    emit(AgentEvent::OrchestrationStarted {
        definition_id: input.definition.id.clone(),
        definition_name: input.definition.name.clone(),
        kind: kind.into(),
        default_model_instance_id: resolved_model_instance_id(
            input.definition.model_instance_id.as_deref(),
            input.active_model_instance_id,
        )
        .into(),
    })?;

    let mut run_root = input.data_folder.join("agent-runs").join(input.storage_id);
    if !matches!(input.definition.strategy, AgentStrategy::Standard) {
        tokio::fs::create_dir_all(&run_root)
            .await
            .map_err(|error| format!("Failed to create Agent run workspace: {error}"))?;
        run_root = tokio::fs::canonicalize(&run_root)
            .await
            .map_err(|error| format!("Failed to resolve Agent run workspace: {error}"))?;
    }
    let default_model_instance_id = resolved_model_instance_id(
        input.definition.model_instance_id.as_deref(),
        input.active_model_instance_id,
    );
    let stage_context = StageContext {
        max_output_tokens: input.definition.max_output_tokens,
        events,
        run_id: input.run_id,
        capabilities: input.capabilities,
        skill_descriptors: input.skill_descriptors,
        default_model_instance_id,
        working_dir: input.working_dir,
        editable_roots: input.editable_roots,
        external_read_only_roots: input.external_read_only_roots,
        trusted_read_roots: input.trusted_read_roots,
        model_routes: input.model_routes,
        approval: &approval,
        folder_access: input.folder_access,
        desktop: input.desktop,
        cancellation: input.cancellation,
        skill_registry: input.skill_registry,
        bundled_script_runtime: input.bundled_script_runtime,
        run_root: &run_root,
    };
    let skills = combined_skills(&input.definition.skills, input.selected_skill)?;

    let outcome = match &input.definition.strategy {
        AgentStrategy::Standard => {
            let selected = if let Some(dispatcher) = &input.model_routes.dispatcher {
                emit(AgentEvent::StageQueued {
                    stage_id: "agent".into(),
                    name: input.definition.name.clone(),
                    reason: dispatcher.queue_reason("agent"),
                })?;
                Some(
                    dispatcher
                        .select("agent", default_model_instance_id, input.cancellation)
                        .await?,
                )
            } else {
                None
            };
            let route = match &selected {
                Some(selected) => selected.route.as_ref(),
                None => input.model_routes.route(default_model_instance_id)?,
            };
            let persona = compose_agent_persona(
                &input.definition.instructions,
                &input.definition.output_contract,
            );
            let authoring = input.selected_skill == Some("agent-builder");
            let authoring_tools = ITERATION_ONE_TOOLS.iter().filter(|tool| matches!(tool.name, "studio.inspect" | "studio.manage" | "tool.view" | "reply" | "finish")).cloned().collect::<Vec<_>>();
            let mut stable_prefix = build_stable_prefix(
                if authoring { &authoring_tools } else { ITERATION_ONE_TOOLS },
                input.skill_descriptors,
                input.capabilities,
                DEFAULT_MAX_PARALLEL_TOOL_CALLS,
                Some(&persona),
            );
            stable_prefix.push_str(
                &input
                    .desktop
                    .memory_context(input.user_message, input.working_dir)
                    .await?,
            );
            let stage = StageSpec {
                id: "agent".into(),
                placement_role: "agent".into(),
                name: input.definition.name.clone(),
                role: "agent".into(),
                instructions: input.definition.instructions.clone(),
                output_contract: input.definition.output_contract.clone(),
                skills: skills.clone(),
                max_steps: input
                    .max_steps_override
                    .unwrap_or(input.definition.max_steps),
                workspace: StageWorkspace::Shared,
                message: input.user_message.into(),
                cycle: None,
                model_instance_id: route.instance_id.clone(),
                reasoning_effort: input.definition.reasoning_effort,
            };
            emit_stage_started(&stage, &mut emit)?;
            let started = Instant::now();
            let result = run_turn_with_options(
                RunTurnInput {
                    run_id: input.run_id,
                    session_id: input.session_id,
                    user_message: input.user_message,
                    selected_skill: None,
                    stable_prefix: &stable_prefix,
                    reasoning_effort: input.definition.reasoning_effort,
                    working_dir: input.working_dir,
                    editable_roots: input.editable_roots,
                    external_read_only_roots: input.external_read_only_roots,
                    trusted_read_roots: input.trusted_read_roots,
                    max_steps: input
                        .max_steps_override
                        .unwrap_or(input.definition.max_steps),
                    client: &route.client,
                    approval: &approval,
                    folder_access: input.folder_access,
                    desktop: input.desktop,
                    cancellation: input.cancellation,
                    session: input.session,
                    skill_registry: input.skill_registry,
                    bundled_script_runtime: input.bundled_script_runtime,
                },
                RunTurnOptions {
                    max_output_tokens: input.definition.max_output_tokens,
                    additional_skills: &skills,
                    archive_dir: Some(&stage_context.run_root.join("agent").join("context")),
                },
                |event| match event {
                    AgentEvent::TurnStarted { .. } | AgentEvent::TurnFinished { .. } => Ok(()),
                    event => {
                        emit(AgentEvent::StageActivity {
                            stage_id: "agent".into(),
                            event: Box::new(event.clone()),
                        })?;
                        emit(event)
                    }
                },
            )
            .await;
            match result {
                Ok(outcome) => {
                    emit_stage_finished(
                        &StageResult {
                            id: stage.id,
                            name: stage.name,
                            outcome: outcome.clone(),
                            duration_ms: elapsed_ms(started),
                            model_instance_id: route.instance_id.clone(),
                            model_id: route.model_id.clone(),
                            reasoning_effort: stage.reasoning_effort,
                        },
                        &mut emit,
                    )?;
                    outcome
                }
                Err(error) => {
                    emit_failed_stage(
                        &stage,
                        &route.model_id,
                        elapsed_ms(started),
                        &error,
                        &mut emit,
                    )?;
                    emit(AgentEvent::TurnFinished {
                        reason: "failed".into(),
                        step_count: 0,
                    })?;
                    return Err(error);
                }
            }
        }
        AgentStrategy::GoalLoop {
            max_cycles,
            success_criteria,
            evaluator_instructions,
            evaluator_model_instance_id,
            evaluator_reasoning_effort,
        } => {
            run_goal_loop(
                &stage_context,
                input.definition,
                input.user_message,
                &skills,
                *max_cycles,
                success_criteria,
                evaluator_instructions,
                evaluator_model_instance_id.as_deref(),
                *evaluator_reasoning_effort,
                &mut emit,
            )
            .await?
        }
        AgentStrategy::Coordinator {
            max_parallel,
            coordinator_instructions,
            synthesis_instructions,
            synthesis_model_instance_id,
            synthesis_reasoning_effort,
            workers,
        } => {
            run_coordinator(
                &stage_context,
                input.definition,
                input.user_message,
                &skills,
                *max_parallel,
                coordinator_instructions,
                synthesis_instructions,
                synthesis_model_instance_id.as_deref(),
                *synthesis_reasoning_effort,
                workers,
                &mut emit,
            )
            .await?
        }
        AgentStrategy::Workflow { nodes, edges } => {
            run_workflow(
                &stage_context,
                input.definition,
                input.user_message,
                &skills,
                nodes,
                edges,
                &mut emit,
            )
            .await?
        }
    };

    if !matches!(input.definition.strategy, AgentStrategy::Standard) {
        let reply = outcome.reply.clone().unwrap_or_default();
        input.session.push_user(input.user_message);
        if !reply.is_empty() {
            input.session.push_reply(&reply);
        }
        input.session.finish_turn();
        emit(AgentEvent::AssistantDelta {
            text: reply.clone(),
        })?;
        emit(AgentEvent::AssistantReply { text: reply })?;
    }
    emit(AgentEvent::TurnFinished {
        reason: outcome.reason.clone(),
        step_count: outcome.step_count,
    })?;
    Ok(outcome)
}

#[allow(clippy::too_many_arguments)]
async fn run_goal_loop(
    context: &StageContext<'_>,
    definition: &AgentDefinition,
    goal: &str,
    skills: &[String],
    max_cycles: u32,
    success_criteria: &str,
    evaluator_instructions: &str,
    evaluator_model_instance_id: Option<&str>,
    evaluator_reasoning_effort: Option<AgentReasoningEffort>,
    emit: &mut impl FnMut(AgentEvent) -> Result<(), String>,
) -> Result<AgentTurnOutcome, String> {
    let mut feedback = String::new();
    let mut last_executor = None;
    let mut total_steps = 0;
    let mut inference = AgentInferenceMetrics::default();
    for cycle in 1..=max_cycles {
        let message = if feedback.is_empty() {
            format!("Goal:\n{goal}")
        } else {
            format!(
                "Goal:\n{goal}\n\nEvaluator feedback from the previous cycle:\n{}\n\nRevise the result and complete the goal.",
                handoff(context.run_root, &format!("evaluate-{}", cycle - 1), &feedback)
            )
        };
        let executor = StageSpec {
            id: format!("execute-{cycle}"),
            placement_role: "executor".into(),
            name: format!("Execute cycle {cycle}"),
            role: "executor".into(),
            instructions: definition.instructions.clone(),
            output_contract: definition.output_contract.clone(),
            skills: skills.to_vec(),
            max_steps: definition.max_steps,
            workspace: StageWorkspace::Shared,
            message,
            cycle: Some(cycle),
            model_instance_id: context.default_model_instance_id.into(),
            reasoning_effort: definition.reasoning_effort,
        };
        let executor_result = execute_observed_stage(context, executor, 0, emit).await?;
        total_steps += executor_result.outcome.step_count;
        inference.merge(executor_result.outcome.inference);
        if matches!(
            executor_result.outcome.reason.as_str(),
            "cancelled" | "finish" | "max_steps" | "loop_detected" | "failed"
        ) {
            let mut outcome = executor_result.outcome;
            outcome.inference = inference;
            outcome.step_count = total_steps;
            return Ok(outcome);
        }
        let executor_reply = executor_result.outcome.reply.clone().unwrap_or_default();
        last_executor = Some(executor_reply.clone());

        let evaluator = StageSpec {
            id: format!("evaluate-{cycle}"),
            placement_role: "evaluator".into(),
            name: format!("Evaluate cycle {cycle}"),
            role: "evaluator".into(),
            instructions: evaluator_instructions.into(),
            output_contract: "The first line must be exactly PASS or REVISE. When revision is needed, follow REVISE with concrete feedback.".into(),
            skills: Vec::new(),
            max_steps: 6,
            workspace: StageWorkspace::Isolated,
            message: format!(
                "Success criteria:\n{success_criteria}\n\nGoal:\n{goal}\n\nExecutor result:\n{}",
                handoff(context.run_root, &format!("execute-{cycle}"), &executor_reply)
            ),
            cycle: Some(cycle),
            model_instance_id: resolved_model_instance_id(
                evaluator_model_instance_id,
                context.default_model_instance_id,
            )
            .into(),
            reasoning_effort: evaluator_reasoning_effort.or(definition.reasoning_effort),
        };
        let evaluator_result = execute_observed_stage(context, evaluator, 1, emit).await?;
        total_steps += evaluator_result.outcome.step_count;
        inference.merge(evaluator_result.outcome.inference);
        if matches!(
            evaluator_result.outcome.reason.as_str(),
            "cancelled" | "finish" | "failed"
        ) {
            let mut outcome = evaluator_result.outcome;
            outcome.inference = inference;
            outcome.step_count = total_steps;
            return Ok(outcome);
        }
        if turn_status(&evaluator_result.outcome.reason) == "incomplete" {
            return Ok(AgentTurnOutcome {
                reply: last_executor,
                reason: evaluator_result.outcome.reason,
                step_count: total_steps,
                inference,
            });
        }
        feedback = evaluator_result.outcome.reply.unwrap_or_default();
        if evaluator_passed(&feedback) {
            return Ok(AgentTurnOutcome {
                reply: last_executor,
                reason: "reply".into(),
                step_count: total_steps,
                inference,
            });
        }
        if cycle < max_cycles {
            emit(AgentEvent::Handoff {
                from: format!("evaluate-{cycle}"),
                to: format!("execute-{}", cycle + 1),
                summary: clip(&feedback),
            })?;
        }
    }
    Ok(AgentTurnOutcome {
        reply: last_executor,
        reason: "max_cycles".into(),
        step_count: total_steps,
        inference,
    })
}

#[allow(clippy::too_many_arguments)]
async fn run_coordinator(
    context: &StageContext<'_>,
    definition: &AgentDefinition,
    goal: &str,
    shared_skills: &[String],
    max_parallel: usize,
    coordinator_instructions: &str,
    synthesis_instructions: &str,
    synthesis_model_instance_id: Option<&str>,
    synthesis_reasoning_effort: Option<AgentReasoningEffort>,
    workers: &[super::definitions::AgentRole],
    emit: &mut impl FnMut(AgentEvent) -> Result<(), String>,
) -> Result<AgentTurnOutcome, String> {
    let plan = StageSpec {
        id: "coordinate".into(),
        placement_role: "coordinator".into(),
        name: "Coordinate".into(),
        role: "coordinator".into(),
        instructions: coordinator_instructions.into(),
        output_contract: "Produce a concise plan assigning useful, non-overlapping work to the declared specialist roles.".into(),
        skills: shared_skills.to_vec(),
        max_steps: definition.max_steps.min(8),
        workspace: StageWorkspace::Isolated,
        message: format!(
            "Goal:\n{goal}\n\nAvailable roles:\n{}",
            workers
                .iter()
                .map(|worker| format!("- {}: {}", worker.name, worker.instructions))
                .collect::<Vec<_>>()
                .join("\n")
        ),
        cycle: None,
        model_instance_id: context.default_model_instance_id.into(),
        reasoning_effort: definition.reasoning_effort,
    };
    let plan_result = execute_observed_stage(context, plan, 0, emit).await?;
    if matches!(plan_result.outcome.reason.as_str(), "cancelled" | "failed") {
        return Ok(plan_result.outcome);
    }
    let mut overall_reason = plan_result.outcome.reason.clone();
    let mut inference = plan_result.outcome.inference;
    let plan_text = plan_result.outcome.reply.unwrap_or_default();

    let worker_specs = workers
        .iter()
        .map(|worker| StageSpec {
            id: format!("worker-{}", worker.id),
            placement_role: format!("worker:{}", worker.id),
            name: worker.name.clone(),
            role: "worker".into(),
            instructions: worker.instructions.clone(),
            output_contract: "Return a self-contained specialist report for the coordinator.".into(),
            skills: merge_skill_lists(shared_skills, &worker.skills),
            max_steps: worker.max_steps,
            workspace: StageWorkspace::Isolated,
            message: format!(
                "Goal:\n{goal}\n\nCoordinator plan:\n{}\n\nComplete the part of the plan assigned to your role. The source workspace is available read-only; put any produced artifacts in your isolated run workspace.",
                handoff(context.run_root, "coordinate", &plan_text)
            ),
            cycle: None,
            model_instance_id: resolved_model_instance_id(
                worker.model_instance_id.as_deref(),
                context.default_model_instance_id,
            )
            .into(),
            reasoning_effort: worker.reasoning_effort.or(definition.reasoning_effort),
        })
        .collect::<Vec<_>>();
    let mut worker_results = stream::iter(worker_specs.into_iter().enumerate().map(
        |(index, worker)| async move {
            let failure_spec = worker.clone();
            let started = Instant::now();
            let result = execute_stage(context, worker, index as i32).await;
            (index, failure_spec, elapsed_ms(started), result)
        },
    ))
    .buffer_unordered(max_parallel)
    .collect::<Vec<_>>()
    .await;
    worker_results.sort_by_key(|(index, _, _, _)| *index);
    let mut reports = Vec::with_capacity(worker_results.len());
    let mut total_steps = plan_result.outcome.step_count;
    let mut first_error = None;
    let mut cancelled = false;
    for (_, spec, duration_ms, result) in worker_results {
        let result = match result {
            Ok(result) => result,
            Err(error) => {
                let model_id = context
                    .model_routes
                    .route(&spec.model_instance_id)
                    .map(|route| route.model_id.as_str())
                    .unwrap_or_default();
                emit_failed_stage(&spec, model_id, duration_ms, &error, emit)?;
                first_error.get_or_insert(error);
                continue;
            }
        };
        total_steps += result.outcome.step_count;
        inference.merge(result.outcome.inference);
        if result.outcome.reason == "cancelled" {
            cancelled = true;
            continue;
        }
        overall_reason = combine_turn_reason(&overall_reason, &result.outcome.reason);
        reports.push((result.name, handoff(context.run_root, &result.id, result.outcome.reply.as_deref().unwrap_or_default())));
    }
    if let Some(error) = first_error {
        return Err(error);
    }
    if cancelled {
        return Ok(AgentTurnOutcome {
            reply: None,
            reason: "cancelled".into(),
            step_count: total_steps,
            inference,
        });
    }

    let synthesis = StageSpec {
        id: "synthesize".into(),
        placement_role: "synthesizer".into(),
        name: "Synthesize".into(),
        role: "coordinator".into(),
        instructions: format!("{}\n\n{}", definition.instructions, synthesis_instructions),
        output_contract: definition.output_contract.clone(),
        skills: shared_skills.to_vec(),
        max_steps: definition.max_steps,
        workspace: StageWorkspace::Shared,
        message: format!(
            "Goal:\n{goal}\n\nCoordinator plan:\n{}\n\nSpecialist reports:\n{}",
            handoff(context.run_root, "coordinate", &plan_text),
            reports
                .iter()
                .map(|(name, report)| format!("## {name}\n{report}"))
                .collect::<Vec<_>>()
                .join("\n\n")
        ),
        cycle: None,
        model_instance_id: resolved_model_instance_id(
            synthesis_model_instance_id,
            context.default_model_instance_id,
        )
        .into(),
        reasoning_effort: synthesis_reasoning_effort.or(definition.reasoning_effort),
    };
    let synthesis_result = execute_observed_stage(context, synthesis, 0, emit).await?;
    total_steps += synthesis_result.outcome.step_count;
    inference.merge(synthesis_result.outcome.inference);
    Ok(AgentTurnOutcome {
        reply: synthesis_result.outcome.reply,
        reason: combine_turn_reason(&overall_reason, &synthesis_result.outcome.reason),
        step_count: total_steps,
        inference,
    })
}

#[allow(clippy::too_many_arguments)]
async fn run_workflow(
    context: &StageContext<'_>,
    definition: &AgentDefinition,
    goal: &str,
    shared_skills: &[String],
    nodes: &[WorkflowNode],
    edges: &[WorkflowEdge],
    emit: &mut impl FnMut(AgentEvent) -> Result<(), String>,
) -> Result<AgentTurnOutcome, String> {
    let levels = workflow_levels(nodes, edges)?;
    let by_id = nodes
        .iter()
        .map(|node| (node.id.as_str(), node))
        .collect::<HashMap<_, _>>();
    let mut results = HashMap::<String, String>::new();
    let mut total_steps = 0;
    let mut inference = AgentInferenceMetrics::default();
    let mut last_outcome = None;
    let mut overall_reason = "reply".to_owned();

    for level in levels {
        let specs = level
            .iter()
            .map(|id| {
                let node = by_id[id.as_str()];
                let predecessors = edges
                    .iter()
                    .filter(|edge| edge.to == node.id)
                    .filter_map(|edge| {
                        results
                            .get(&edge.from)
                            .map(|reply| format!("## {}\n{}", edge.from, handoff(context.run_root, &edge.from, reply)))
                    })
                    .collect::<Vec<_>>();
                StageSpec {
                    id: node.id.clone(),
                    placement_role: format!("workflow:{}", node.id),
                    name: node.name.clone(),
                    role: "workflow".into(),
                    instructions: format!("{}\n\n{}", definition.instructions, node.instructions),
                    output_contract: definition.output_contract.clone(),
                    skills: merge_skill_lists(shared_skills, &node.skills),
                    max_steps: node.max_steps,
                    workspace: node.workspace,
                    message: if predecessors.is_empty() {
                        format!("Goal:\n{goal}")
                    } else {
                        format!(
                            "Goal:\n{goal}\n\nUpstream handoffs:\n{}",
                            predecessors.join("\n\n")
                        )
                    },
                    cycle: None,
                    model_instance_id: resolved_model_instance_id(
                        node.model_instance_id.as_deref(),
                        context.default_model_instance_id,
                    )
                    .into(),
                    reasoning_effort: node.reasoning_effort.or(definition.reasoning_effort),
                }
            })
            .collect::<Vec<_>>();
        let mut level_results = stream::iter(specs.into_iter().enumerate().map(
            |(index, spec)| async move {
                let failure_spec = spec.clone();
                let started = Instant::now();
                let result = execute_stage(context, spec, index as i32).await;
                (index, failure_spec, elapsed_ms(started), result)
            },
        ))
        .buffer_unordered(level.len())
        .collect::<Vec<_>>()
        .await;
        level_results.sort_by_key(|(index, _, _, _)| *index);
        let mut first_error = None;
        let mut cancelled = false;
        for (_, spec, duration_ms, result) in level_results {
            let result = match result {
                Ok(result) => result,
                Err(error) => {
                    let model_id = context
                        .model_routes
                        .route(&spec.model_instance_id)
                        .map(|route| route.model_id.as_str())
                        .unwrap_or_default();
                    emit_failed_stage(&spec, model_id, duration_ms, &error, emit)?;
                    first_error.get_or_insert(error);
                    continue;
                }
            };
            total_steps += result.outcome.step_count;
            inference.merge(result.outcome.inference);
            if result.outcome.reason == "cancelled" {
                cancelled = true;
                continue;
            }
            let reply = result.outcome.reply.clone().unwrap_or_default();
            for edge in edges.iter().filter(|edge| edge.from == result.id) {
                emit(AgentEvent::Handoff {
                    from: edge.from.clone(),
                    to: edge.to.clone(),
                    summary: clip(&reply),
                })?;
            }
            results.insert(result.id.clone(), reply);
            overall_reason = combine_turn_reason(&overall_reason, &result.outcome.reason);
            last_outcome = Some(result.outcome);
        }
        if let Some(error) = first_error {
            return Err(error);
        }
        if cancelled {
            return Ok(AgentTurnOutcome {
                reply: None,
                reason: "cancelled".into(),
                step_count: total_steps,
                inference,
            });
        }
    }
    let mut outcome = last_outcome.ok_or_else(|| "Workflow produced no result".to_string())?;
    outcome.step_count = total_steps;
    outcome.inference = inference;
    outcome.reason = overall_reason;
    Ok(outcome)
}

async fn execute_stage(
    context: &StageContext<'_>,
    mut spec: StageSpec,
    _worker_index: i32,
) -> Result<StageResult, String> {
    if context.cancellation.is_cancelled() {
        return Err("Agent run was cancelled".into());
    }
    let started = Instant::now();
    let selected = if let Some(dispatcher) = &context.model_routes.dispatcher {
        let role = &spec.placement_role;
        context
            .events
            .send(AgentEvent::StageQueued {
                stage_id: spec.id.clone(),
                name: spec.name.clone(),
                reason: dispatcher.queue_reason(role),
            })
            .map_err(|e| e.to_string())?;
        Some(
            dispatcher
                .select(role, &spec.model_instance_id, context.cancellation)
                .await?,
        )
    } else {
        None
    };
    let route = match &selected {
        Some(selected) => selected.route.as_ref(),
        None => context.model_routes.route(&spec.model_instance_id)?,
    };
    spec.model_instance_id = route.instance_id.clone();
    emit_stage_started(&spec, &mut |event| {
        context.events.send(event).map_err(|e| e.to_string())
    })?;
    let persona = compose_agent_persona(&spec.instructions, &spec.output_contract);
    let mut stable_prefix = build_stable_prefix(
        ITERATION_ONE_TOOLS,
        context.skill_descriptors,
        context.capabilities,
        DEFAULT_MAX_PARALLEL_TOOL_CALLS,
        Some(&persona),
    );
    stable_prefix.push_str(
        &context
            .desktop
            .memory_context(&spec.message, context.working_dir)
            .await?,
    );
    let mut session = AgentSessionState::new(format!("{}:{}", context.run_id, spec.id));

    let outcome = match spec.workspace {
        StageWorkspace::Shared => {
            run_stage_with_workspace(
                context,
                &spec,
                &stable_prefix,
                context.working_dir,
                context.editable_roots,
                context.external_read_only_roots,
                context.trusted_read_roots,
                &mut session,
                route,
            )
            .await?
        }
        StageWorkspace::Isolated => {
            let scratch = context.run_root.join(&spec.id);
            tokio::fs::create_dir_all(&scratch)
                .await
                .map_err(|error| format!("Failed to create stage workspace: {error}"))?;
            let editable_roots = EditableRoots::new(&scratch, &[]).await?;
            let mut trusted_read_roots = context.trusted_read_roots.to_vec();
            if !trusted_read_roots
                .iter()
                .any(|root| root == context.working_dir)
            {
                trusted_read_roots.push(context.working_dir.to_path_buf());
            }
            run_stage_with_workspace(
                context,
                &spec,
                &stable_prefix,
                &scratch,
                &editable_roots,
                &trusted_read_roots,
                &trusted_read_roots,
                &mut session,
                route,
            )
            .await?
        }
    };

    tokio::fs::write(context.run_root.join(&spec.id).join("result.txt"), outcome.reply.as_deref().unwrap_or_default())
        .await.map_err(|e| format!("Could not preserve stage handoff: {e}"))?;
    let result = StageResult {
        id: spec.id,
        name: spec.name,
        outcome,
        duration_ms: started.elapsed().as_millis().min(u64::MAX as u128) as u64,
        model_instance_id: route.instance_id.clone(),
        model_id: route.model_id.clone(),
        reasoning_effort: spec.reasoning_effort,
    };
    emit_stage_finished(&result, &mut |event| {
        context.events.send(event).map_err(|e| e.to_string())
    })?;
    Ok(result)
}

async fn execute_observed_stage(
    context: &StageContext<'_>,
    mut spec: StageSpec,
    worker_index: i32,
    emit: &mut impl FnMut(AgentEvent) -> Result<(), String>,
) -> Result<StageResult, String> {
    if spec.reasoning_effort.is_none() {
        spec.reasoning_effort = Some(AgentReasoningEffort::High);
    }
    let failure_spec = spec.clone();
    let started = Instant::now();
    match execute_stage(context, spec, worker_index).await {
        Ok(result) => Ok(result),
        Err(error) => {
            let model_id = context
                .model_routes
                .route(&failure_spec.model_instance_id)
                .map(|route| route.model_id.as_str())
                .unwrap_or_default();
            emit_failed_stage(&failure_spec, model_id, elapsed_ms(started), &error, emit)?;
            Err(error)
        }
    }
}

#[allow(clippy::too_many_arguments)]
async fn run_stage_with_workspace(
    context: &StageContext<'_>,
    spec: &StageSpec,
    stable_prefix: &str,
    working_dir: &Path,
    editable_roots: &EditableRoots,
    external_read_only_roots: &[PathBuf],
    trusted_read_roots: &[PathBuf],
    session: &mut AgentSessionState,
    route: &AgentModelRoute,
) -> Result<AgentTurnOutcome, String> {
    let mut stage_read_roots = trusted_read_roots.to_vec();
    stage_read_roots.push(context.run_root.to_path_buf());
    run_turn_with_options(
        RunTurnInput {
            run_id: context.run_id,
            session_id: &session.session_id.clone(),
            user_message: &spec.message,
            selected_skill: None,
            stable_prefix,
            reasoning_effort: spec.reasoning_effort,
            working_dir,
            editable_roots,
            external_read_only_roots,
            trusted_read_roots: &stage_read_roots,
            max_steps: spec.max_steps.clamp(1, MAX_STEPS),
            client: &route.client,
            approval: context.approval,
            folder_access: context.folder_access,
            desktop: context.desktop,
            cancellation: context.cancellation,
            session,
            skill_registry: context.skill_registry,
            bundled_script_runtime: context.bundled_script_runtime,
        },
        RunTurnOptions {
            max_output_tokens: context.max_output_tokens,
            additional_skills: &spec.skills,
            archive_dir: Some(&context.run_root.join(&spec.id).join("context")),
        },
        |event| {
            context
                .events
                .send(AgentEvent::StageActivity {
                    stage_id: spec.id.clone(),
                    event: Box::new(event),
                })
                .map_err(|e| e.to_string())
        },
    )
    .await
}

fn emit_stage_started(
    spec: &StageSpec,
    emit: &mut impl FnMut(AgentEvent) -> Result<(), String>,
) -> Result<(), String> {
    emit(AgentEvent::StageStarted {
        stage_id: spec.id.clone(),
        name: spec.name.clone(),
        role: spec.role.clone(),
        cycle: spec.cycle,
        model_instance_id: spec.model_instance_id.clone(),
        reasoning_effort: spec.reasoning_effort,
    })
}

fn emit_stage_finished(
    result: &StageResult,
    emit: &mut impl FnMut(AgentEvent) -> Result<(), String>,
) -> Result<(), String> {
    emit(AgentEvent::StageFinished {
        stage_id: result.id.clone(),
        name: result.name.clone(),
        status: result.outcome.reason.clone(),
        summary: clip(result.outcome.reply.as_deref().unwrap_or_default()),
        step_count: result.outcome.step_count,
        duration_ms: result.duration_ms,
        model_instance_id: result.model_instance_id.clone(),
        model_id: result.model_id.clone(),
        reasoning_effort: result.reasoning_effort,
        inference: result.outcome.inference,
    })
}

fn emit_failed_stage(
    spec: &StageSpec,
    model_id: &str,
    duration_ms: u64,
    error: &str,
    emit: &mut impl FnMut(AgentEvent) -> Result<(), String>,
) -> Result<(), String> {
    emit(AgentEvent::StageFinished {
        stage_id: spec.id.clone(),
        name: spec.name.clone(),
        status: "failed".into(),
        summary: clip(error),
        step_count: 0,
        duration_ms,
        model_instance_id: spec.model_instance_id.clone(),
        model_id: model_id.to_owned(),
        reasoning_effort: spec.reasoning_effort,
        inference: AgentInferenceMetrics::default(),
    })
}

fn elapsed_ms(started: Instant) -> u64 {
    started.elapsed().as_millis().min(u64::MAX as u128) as u64
}

fn resolved_model_instance_id<'a>(binding: Option<&'a str>, inherited: &'a str) -> &'a str {
    binding.unwrap_or(inherited)
}

fn combined_skills(shared: &[String], selected: Option<&str>) -> Result<Vec<String>, String> {
    let mut skills = shared.to_vec();
    if let Some(selected) = selected {
        if !skills.iter().any(|skill| skill == selected) {
            skills.push(selected.to_owned());
        }
    }
    if skills.len() > super::skills::loaded::LOADED_SKILLS_CAP {
        return Err(format!(
            "An Agent stage may load at most {} skills",
            super::skills::loaded::LOADED_SKILLS_CAP
        ));
    }
    Ok(skills)
}

fn merge_skill_lists(left: &[String], right: &[String]) -> Vec<String> {
    let mut merged = left.to_vec();
    for skill in right {
        if !merged.contains(skill) {
            merged.push(skill.clone());
        }
    }
    merged
}

fn evaluator_passed(reply: &str) -> bool {
    reply
        .lines()
        .find(|line| !line.trim().is_empty())
        .is_some_and(|line| line.trim().eq_ignore_ascii_case("PASS"))
}

fn strategy_name(strategy: &AgentStrategy) -> &'static str {
    match strategy {
        AgentStrategy::Standard => "standard",
        AgentStrategy::GoalLoop { .. } => "goal_loop",
        AgentStrategy::Coordinator { .. } => "coordinator",
        AgentStrategy::Workflow { .. } => "workflow",
    }
}

fn clip(value: &str) -> String {
    if value.chars().count() <= STAGE_HANDOFF_CHARS {
        value.to_owned()
    } else {
        let mut clipped = value.chars().take(STAGE_HANDOFF_CHARS).collect::<String>();
        clipped.push_str("\n… [handoff truncated]");
        clipped
    }
}

fn handoff(root: &Path, stage: &str, text: &str) -> String {
    format!("{}\nFull stage result: {}", clip(text), root.join(stage).join("result.txt").display())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::agent::definitions::{general_agent, AgentRole};
    use crate::core::agent::test_support::{
        RecordingApproval, RecordingDesktop, RecordingFolderAccess, ScriptedGinferServer,
        ScriptedResponse, TestWorkspace,
    };
    use crate::core::agent::types::ToolStatus;
    use tokio_util::sync::CancellationToken;

    #[test]
    fn evaluator_requires_a_bare_pass_first_line() {
        assert!(evaluator_passed("PASS\nAll criteria met."));
        assert!(evaluator_passed("\npass"));
        assert!(!evaluator_passed("PASS: mostly"));
        assert!(!evaluator_passed("REVISE\nMissing tests"));
    }

    #[test]
    fn merges_selected_and_role_skills_without_duplicates() {
        let shared = vec!["code".into(), "research".into()];
        assert_eq!(
            combined_skills(&shared, Some("code")).unwrap(),
            vec!["code", "research"]
        );
        assert_eq!(
            merge_skill_lists(&shared, &["research".into(), "review".into()]),
            vec!["code", "research", "review"]
        );
    }

    #[tokio::test]
    async fn coordinator_handoffs_are_readable_without_external_folder_access() {
        let workspace = TestWorkspace::new();
        let run_root = workspace.path().join("agent-runs").join("coordinator-test");
        let canonical_run_root = tokio::fs::canonicalize(workspace.path())
            .await
            .unwrap()
            .join("agent-runs")
            .join("coordinator-test");
        let plan_result = canonical_run_root.join("coordinate/result.txt");
        let worker_result = canonical_run_root.join("worker-research/result.txt");
        let tool_call = |path: &Path| {
            ScriptedResponse::completion(
                serde_json::json!([{"tool":"os.fs.read","args":{"path":path}}]).to_string(),
            )
        };
        let reply = |text: &str| {
            ScriptedResponse::completion(
                serde_json::json!([{"tool":"reply","args":{"text":text}}]).to_string(),
            )
        };
        let server = ScriptedGinferServer::start(vec![
            reply("research the answer"),
            tool_call(&plan_result),
            reply("worker report"),
            tool_call(&worker_result),
            reply("final answer"),
        ])
        .await;
        let routes = AgentModelRoutes::new(vec![AgentModelRoute {
            instance_id: "active".into(),
            model_id: "active".into(),
            client: server.client(),
        }])
        .unwrap();
        let mut definition = general_agent();
        definition.max_steps = 3;
        definition.strategy = AgentStrategy::Coordinator {
            max_parallel: 1,
            coordinator_instructions: "Plan the work".into(),
            synthesis_instructions: "Combine the work".into(),
            synthesis_model_instance_id: None,
            synthesis_reasoning_effort: None,
            workers: vec![AgentRole {
                id: "research".into(),
                name: "Researcher".into(),
                instructions: "Read the plan".into(),
                skills: Vec::new(),
                max_steps: 3,
                model_instance_id: None,
                reasoning_effort: None,
            }],
        };
        let editable_roots = EditableRoots::new(workspace.path(), &[]).await.unwrap();
        let capabilities = CapabilitiesSummary {
            platform: std::env::consts::OS.into(),
            arch: std::env::consts::ARCH.into(),
            browser_channel: "none".into(),
            working_dir: workspace.path().display().to_string(),
            has_clipboard: false,
            has_wmctrl: false,
            has_notifications: false,
        };
        let approval = RecordingApproval::deny();
        let folder_access = RecordingFolderAccess::deny();
        let desktop = RecordingDesktop::default();
        let cancellation = CancellationToken::new();
        let skill_registry = workspace.skill_registry();
        let mut session = AgentSessionState::new("coordinator-session");
        let mut events = Vec::new();

        let outcome = run_definition(
            OrchestrationInput {
                run_id: "coordinator-test",
                storage_id: "coordinator-test",
                session_id: "coordinator-session",
                user_message: "Answer the question",
                selected_skill: None,
                definition: &definition,
                capabilities: &capabilities,
                skill_descriptors: &[],
                active_model_instance_id: "active",
                working_dir: workspace.path(),
                editable_roots: &editable_roots,
                external_read_only_roots: &[],
                trusted_read_roots: &[],
                max_steps_override: None,
                model_routes: &routes,
                approval: &approval,
                folder_access: &folder_access,
                desktop: &desktop,
                cancellation: &cancellation,
                session: &mut session,
                skill_registry: &skill_registry,
                bundled_script_runtime: None,
                data_folder: workspace.path(),
            },
            |event| {
                events.push(event);
                Ok(())
            },
        )
        .await
        .unwrap();

        assert_eq!(outcome.reply.as_deref(), Some("final answer"));
        assert_eq!(
            workspace.read("agent-runs/coordinator-test/coordinate/result.txt"),
            b"research the answer"
        );
        assert_eq!(
            workspace.read("agent-runs/coordinator-test/worker-research/result.txt"),
            b"worker report"
        );
        assert!(run_root.exists());
        assert!(folder_access.requests().is_empty());
        let reads = events
            .iter()
            .filter_map(|event| match event {
                AgentEvent::StageActivity { stage_id, event } => match event.as_ref() {
                    AgentEvent::ToolCallExecuted { result } if result.call.tool == "os.fs.read" => {
                        Some((stage_id.as_str(), result.outcome.status))
                    }
                    _ => None,
                },
                _ => None,
            })
            .collect::<Vec<_>>();
        assert_eq!(
            reads,
            vec![
                ("worker-research", ToolStatus::Ok),
                ("synthesize", ToolStatus::Ok)
            ]
        );

        let requests = server.requests();
        let prompt = |index: usize| {
            requests[index]["messages"][0]["content"]
                .as_str()
                .expect("coordinator stage prompt")
        };
        assert!(prompt(1).contains(&plan_result.to_string_lossy().to_string()));
        assert!(prompt(3).contains(&plan_result.to_string_lossy().to_string()));
        assert!(prompt(3).contains(&worker_result.to_string_lossy().to_string()));
    }

    #[tokio::test]
    async fn coordinator_preserves_synthesis_and_incomplete_stage_outcomes() {
        use crate::core::agent::runs::{list_runs, record_run, AgentRunRecord, CompletedRun};
        let reply = |text: &str| {
            ScriptedResponse::completion(
                serde_json::json!([{"tool":"reply","args":{"text":text}}]).to_string(),
            )
        };
        // A later reply must not erase the reason an earlier stage stopped.
        for limiting_stage in [
            "worker_steps",
            "worker_loop",
            "planning_steps",
            "worker_failed",
            "workflow_steps",
            "none",
        ] {
            let workspace = TestWorkspace::new();
            workspace.write("fixture.txt", "unchanging");
            let read = || {
                ScriptedResponse::completion(
                serde_json::json!([{"tool":"os.fs.read","args":{"path":workspace.path().join("fixture.txt")}}]).to_string()
            )
            };
            let mut responses = vec![if limiting_stage == "planning_steps" {
                read()
            } else {
                reply("plan")
            }];
            responses.extend(match limiting_stage {
                "worker_steps" => vec![read()],
                "worker_loop" => vec![read(); 7],
                "worker_failed" => vec![
                    ScriptedResponse::completion("unfinished")
                        .with_finish_reason("output_limit");
                    2
                ],
                "workflow_steps" => vec![read()],
                _ => vec![reply("report")],
            });
            responses.push(reply("completed synthesis"));
            let server = ScriptedGinferServer::start(responses).await;
            let routes = AgentModelRoutes::new(vec![AgentModelRoute {
                instance_id: "active".into(),
                model_id: "active".into(),
                client: server.client(),
            }])
            .unwrap();
            let mut definition = general_agent();
            definition.max_steps = 1;
            definition.strategy = AgentStrategy::Coordinator {
                max_parallel: 1,
                coordinator_instructions: "Plan".into(),
                synthesis_instructions: "Combine".into(),
                synthesis_model_instance_id: None,
                synthesis_reasoning_effort: None,
                workers: vec![AgentRole {
                    id: "research".into(),
                    name: "Researcher".into(),
                    instructions: "Investigate".into(),
                    skills: vec![],
                    max_steps: if limiting_stage == "worker_loop" {
                        10
                    } else {
                        1
                    },
                    model_instance_id: None,
                    reasoning_effort: None,
                }],
            };
            if limiting_stage == "workflow_steps" {
                definition.strategy = AgentStrategy::Workflow {
                    nodes: ["coordinate", "worker-research", "synthesize"]
                        .iter()
                        .map(|id| WorkflowNode {
                            id: (*id).into(),
                            name: (*id).into(),
                            instructions: "Work".into(),
                            skills: vec![],
                            max_steps: 1,
                            workspace: StageWorkspace::Isolated,
                            model_instance_id: None,
                            reasoning_effort: None,
                        })
                        .collect(),
                    edges: vec![
                        WorkflowEdge {
                            from: "coordinate".into(),
                            to: "worker-research".into(),
                        },
                        WorkflowEdge {
                            from: "worker-research".into(),
                            to: "synthesize".into(),
                        },
                    ],
                };
            }
            let roots = EditableRoots::new(workspace.path(), &[]).await.unwrap();
            let caps = CapabilitiesSummary {
                platform: std::env::consts::OS.into(),
                arch: std::env::consts::ARCH.into(),
                browser_channel: "none".into(),
                working_dir: workspace.path().display().to_string(),
                has_clipboard: false,
                has_wmctrl: false,
                has_notifications: false,
            };
            let approval = RecordingApproval::deny();
            let folder = RecordingFolderAccess::deny();
            let desktop = RecordingDesktop::default();
            let cancellation = CancellationToken::new();
            let registry = workspace.skill_registry();
            let mut session = AgentSessionState::new("session");
            let mut events = vec![];
            let result = run_definition(
                OrchestrationInput {
                    run_id: "run",
                    storage_id: "record",
                    session_id: "session",
                    user_message: "goal",
                    selected_skill: None,
                    definition: &definition,
                    capabilities: &caps,
                    skill_descriptors: &[],
                    active_model_instance_id: "active",
                    working_dir: workspace.path(),
                    editable_roots: &roots,
                    external_read_only_roots: &[],
                    trusted_read_roots: &[],
                    max_steps_override: None,
                    model_routes: &routes,
                    approval: &approval,
                    folder_access: &folder,
                    desktop: &desktop,
                    cancellation: &cancellation,
                    session: &mut session,
                    skill_registry: &registry,
                    bundled_script_runtime: None,
                    data_folder: workspace.path(),
                },
                |event| {
                    events.push(event);
                    Ok(())
                },
            )
            .await;
            let outcome = result
                .as_ref()
                .unwrap_or_else(|error| panic!("{limiting_stage}: {error}"));
            let reason = match limiting_stage {
                "none" => "reply",
                "worker_loop" => "loop_detected",
                "worker_failed" => "failed",
                _ => "max_steps",
            };
            assert_eq!(outcome.reason, reason, "{limiting_stage}");
            assert_eq!(outcome.reply.as_deref(), Some("completed synthesis"));
            assert_eq!(
                outcome.step_count + u32::from(limiting_stage == "worker_failed"),
                server.requests().len() as u32
            );
            assert_eq!(
                workspace.read("agent-runs/record/synthesize/result.txt"),
                b"completed synthesis"
            );
            assert!(events.iter().any(|event| matches!(event, AgentEvent::TurnFinished { reason: actual, .. } if actual == reason)));
            let record = AgentRunRecord::completed(CompletedRun {
                id: "record",
                run_id: "run",
                session_id: "session",
                origin_session_id: None,
                user_message: "goal",
                definition: &definition,
                started_at_ms: 0,
                events: &events,
                result: &result,
            });
            record_run(workspace.path(), record).unwrap();
            let saved = list_runs(workspace.path()).unwrap().remove(0);
            assert_eq!(
                saved.status,
                if limiting_stage == "none" {
                    "finished"
                } else if limiting_stage == "worker_failed" {
                    "failed"
                } else {
                    "incomplete"
                }
            );
            assert_eq!(saved.finish_reason, reason);
            assert_eq!(saved.final_reply, "completed synthesis");
            assert_eq!(saved.stages.last().unwrap().status, "reply");
            assert_eq!(saved.stages.len(), 3);
            assert_eq!(
                saved.stages[if limiting_stage == "planning_steps" {
                    0
                } else {
                    1
                }]
                .status,
                reason
            );
        }
    }

    #[test]
    fn terminal_failure_and_cancellation_override_partial_outputs() {
        assert_eq!(combine_turn_reason("max_steps", "reply"), "max_steps");
        assert_eq!(
            combine_turn_reason("loop_detected", "max_steps"),
            "loop_detected"
        );
        assert_eq!(combine_turn_reason("max_steps", "failed"), "failed");
        assert_eq!(combine_turn_reason("failed", "cancelled"), "cancelled");
        assert_eq!(combine_turn_reason("cancelled", "reply"), "cancelled");
    }

    async fn run_test_goal_loop(
        executor_responses: Vec<ScriptedResponse>,
        evaluator_responses: Vec<ScriptedResponse>,
        max_steps: u32,
        max_cycles: u32,
    ) -> (AgentTurnOutcome, usize, usize) {
        let executor = ScriptedGinferServer::start(executor_responses).await;
        let evaluator = ScriptedGinferServer::start(evaluator_responses).await;
        let routes = AgentModelRoutes::new(vec![
            AgentModelRoute {
                instance_id: "executor-model".into(),
                model_id: "executor-model".into(),
                client: executor.client(),
            },
            AgentModelRoute {
                instance_id: "evaluator-model".into(),
                model_id: "evaluator-model".into(),
                client: evaluator.client(),
            },
        ])
        .unwrap();
        let mut definition = general_agent();
        definition.id = "test-loop".into();
        definition.permissions.insert(super::super::permissions::Capability::FileWrite, super::super::permissions::Permission::Deny);
        definition.max_steps = max_steps;
        definition.model_instance_id = Some("executor-model".into());
        definition.strategy = AgentStrategy::GoalLoop {
            max_cycles,
            success_criteria: "Complete".into(),
            evaluator_instructions: "Evaluate".into(),
            evaluator_model_instance_id: Some("evaluator-model".into()),
            evaluator_reasoning_effort: Some(AgentReasoningEffort::High),
        };
        let workspace = TestWorkspace::new();
        let editable_roots = EditableRoots::new(workspace.path(), &[]).await.unwrap();
        let capabilities = CapabilitiesSummary {
            platform: "linux".into(),
            arch: "x86_64".into(),
            browser_channel: "none".into(),
            working_dir: workspace.path().display().to_string(),
            has_clipboard: false,
            has_wmctrl: false,
            has_notifications: false,
        };
        let approval = RecordingApproval::deny();
        let folder_access = RecordingFolderAccess::deny();
        let desktop = RecordingDesktop::default();
        let cancellation = CancellationToken::new();
        let skill_registry = workspace.skill_registry();
        let mut session = AgentSessionState::new("session");

        let outcome = run_definition(
            OrchestrationInput {
                run_id: "run",
                storage_id: "storage",
                session_id: "session",
                user_message: "complete the goal",
                selected_skill: None,
                definition: &definition,
                capabilities: &capabilities,
                skill_descriptors: &[],
                active_model_instance_id: "active-model",
                working_dir: workspace.path(),
                editable_roots: &editable_roots,
                external_read_only_roots: &[],
                trusted_read_roots: &[],
                max_steps_override: None,
                model_routes: &routes,
                approval: &approval,
                folder_access: &folder_access,
                desktop: &desktop,
                cancellation: &cancellation,
                session: &mut session,
                skill_registry: &skill_registry,
                bundled_script_runtime: None,
                data_folder: workspace.path(),
            },
            |_| Ok(()),
        )
        .await
        .unwrap();

        assert!(!workspace.path().join("blocked-by-definition.txt").exists());
        for requests in [executor.requests(), evaluator.requests()] {
            if requests.len() > 1 && requests[1].to_string().contains("blocked-by-definition.txt") {
                assert!(requests[1].to_string().contains("Blocked by this agent definition"));
            }
        }
        (
            outcome,
            executor.requests().len(),
            evaluator.requests().len(),
        )
    }

    #[tokio::test]
    async fn goal_loop_executor_and_evaluator_inherit_definition_permissions() {
        let write = || ScriptedResponse::completion(r#"[{"tool":"os.fs.write","args":{"path":"blocked-by-definition.txt","content":"not permitted"}}]"#);
        let (outcome, executor_requests, evaluator_requests) = run_test_goal_loop(
            vec![write(), ScriptedResponse::completion(r#"[{"tool":"reply","args":{"text":"Complete without writing"}}]"#)],
            vec![write(), ScriptedResponse::completion(r#"[{"tool":"reply","args":{"text":"PASS"}}]"#)],
            3, 1,
        ).await;
        assert_eq!(outcome.reason, "reply");
        assert_eq!((executor_requests,evaluator_requests), (2,2));
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn every_composition_preserves_process_arguments_and_enforces_permissions() {
        use super::super::permissions::{Capability, Permission};
        for template in super::super::definitions::built_in_templates() {
            let mut definition = template.definition;
            definition.model_instance_id = None;
            definition.skills.clear();
            definition.permissions.insert(Capability::Shell, Permission::Allow);
            definition.permissions.insert(Capability::FileWrite, Permission::Deny);
            let stages = match &mut definition.strategy {
                AgentStrategy::Standard => 1,
                AgentStrategy::GoalLoop { max_cycles, .. } => { *max_cycles = 1; 2 },
                AgentStrategy::Coordinator { max_parallel, workers, .. } => { *max_parallel = 1; workers.len() + 2 },
                AgentStrategy::Workflow { nodes, .. } => nodes.len(),
            };
            let literal = "literal spaces | $VALUE & quoted \"text\"";
            let mut responses = Vec::new();
            for _ in 0..stages {
                for call in [
                    serde_json::json!({"tool":"os.shell.run","args":{"cmd":"printf","args":["%s",literal]}}),
                    serde_json::json!({"tool":"os.fs.write","args":{"path":"forbidden.txt","content":"blocked"}}),
                    serde_json::json!({"tool":"reply","args":{"text":"PASS"}}),
                ] { responses.push(ScriptedResponse::completion(serde_json::json!([call]).to_string())); }
            }
            let server = ScriptedGinferServer::start(responses).await;
            let routes = AgentModelRoutes::new(vec![AgentModelRoute { instance_id:"active".into(),model_id:"active".into(),client:server.client() }]).unwrap();
            let workspace = TestWorkspace::new();
            let roots = EditableRoots::new(workspace.path(), &[]).await.unwrap();
            let caps = CapabilitiesSummary { platform:"linux".into(),arch:"x86_64".into(),browser_channel:"none".into(),working_dir:workspace.path().display().to_string(),has_clipboard:false,has_wmctrl:false,has_notifications:false };
            let approval = RecordingApproval::deny();
            let registry = workspace.skill_registry();
            let mut session = AgentSessionState::new("matrix");
            let mut events = Vec::new();
            let outcome = run_definition(OrchestrationInput {
                run_id:"matrix",storage_id:"matrix",session_id:"matrix",user_message:"Exercise the process and permissions contract",selected_skill:None,
                definition:&definition,capabilities:&caps,skill_descriptors:&[],active_model_instance_id:"active",working_dir:workspace.path(),editable_roots:&roots,external_read_only_roots:&[],trusted_read_roots:&[],max_steps_override:None,model_routes:&routes,
                approval:&approval,folder_access:&RecordingFolderAccess::deny(),desktop:&RecordingDesktop::default(),cancellation:&CancellationToken::new(),session:&mut session,skill_registry:&registry,bundled_script_runtime:None,data_folder:workspace.path(),
            }, |event| { events.push(event); Ok(()) }).await.unwrap();
            assert_eq!(outcome.reason, "reply", "{}", definition.name);
            let activity = events.iter().filter_map(|event| match event { AgentEvent::StageActivity { event, .. } => Some(event.as_ref()), _ => None }).collect::<Vec<_>>();
            let shell_count = activity.iter().filter(|event|matches!(event,AgentEvent::ToolCallExecuted{result} if result.call.tool=="os.shell.run" && result.outcome.status==super::super::types::ToolStatus::Ok && result.outcome.summary==literal)).count();
            let blocked_count = activity.iter().filter(|event|matches!(event,AgentEvent::ToolCallExecuted{result} if result.call.tool=="os.fs.write" && result.outcome.status==super::super::types::ToolStatus::Denied)).count();
            assert_eq!((shell_count,blocked_count),(stages,stages),"{}",definition.name);
            assert!(approval.requests().is_empty());
        }
    }

    #[tokio::test]
    async fn goal_loop_stops_on_loop_fallback_without_evaluating_it() {
        let call = ScriptedResponse::completion(
            r#"[{"tool":"os.fs.read","args":{"path":"missing.txt"}}]"#,
        );
        let (outcome, executor_requests, evaluator_requests) =
            run_test_goal_loop(vec![call; 7], Vec::new(), 10, 3).await;
        assert_eq!(outcome.reason, "loop_detected");
        assert!(outcome.reply.unwrap().contains("no-progress loop"));
        assert_eq!(executor_requests, 7);
        assert_eq!(evaluator_requests, 0);
    }

    #[tokio::test]
    async fn goal_loop_stops_when_the_executor_exhausts_its_step_budget() {
        let (outcome, executor_requests, evaluator_requests) = run_test_goal_loop(
            vec![ScriptedResponse::completion(
                r#"[{"tool":"os.fs.list","args":{"path":"."}}]"#,
            )],
            Vec::new(),
            1,
            3,
        )
        .await;

        assert_eq!(outcome.reason, "max_steps");
        assert_eq!(executor_requests, 1);
        assert_eq!(evaluator_requests, 0);
    }

    #[tokio::test]
    async fn goal_loop_preserves_the_last_result_when_revision_cycles_expire() {
        let (outcome, executor_requests, evaluator_requests) = run_test_goal_loop(
            vec![ScriptedResponse::completion(
                r#"[{"tool":"reply","args":{"text":"best available"}}]"#,
            )],
            vec![ScriptedResponse::completion(
                r#"[{"tool":"reply","args":{"text":"REVISE\nNeeds more work"}}]"#,
            )],
            4,
            1,
        )
        .await;

        assert_eq!(outcome.reason, "max_cycles");
        assert_eq!(outcome.reply.as_deref(), Some("best available"));
        assert_eq!(executor_requests, 1);
        assert_eq!(evaluator_requests, 1);
    }

    #[tokio::test]
    async fn routes_goal_loop_stages_to_their_assigned_model_instances() {
        let executor = ScriptedGinferServer::start(vec![ScriptedResponse::completion(
            r#"[{"tool":"reply","args":{"text":"executor result"}}]"#,
        )])
        .await;
        let evaluator = ScriptedGinferServer::start(vec![ScriptedResponse::completion(
            r#"[{"tool":"reply","args":{"text":"PASS"}}]"#,
        )])
        .await;
        let routes = AgentModelRoutes::new(vec![
            AgentModelRoute {
                instance_id: "executor-model".into(),
                model_id: "executor-model".into(),
                client: executor.client(),
            },
            AgentModelRoute {
                instance_id: "evaluator-model".into(),
                model_id: "evaluator-model".into(),
                client: evaluator.client(),
            },
        ])
        .unwrap();
        let mut definition = general_agent();
        definition.id = "routed-loop".into();
        definition.model_instance_id = Some("executor-model".into());
        definition.strategy = AgentStrategy::GoalLoop {
            max_cycles: 1,
            success_criteria: "Complete".into(),
            evaluator_instructions: "Evaluate".into(),
            evaluator_model_instance_id: Some("evaluator-model".into()),
            evaluator_reasoning_effort: Some(AgentReasoningEffort::High),
        };
        let workspace = TestWorkspace::new();
        let editable_roots = EditableRoots::new(workspace.path(), &[]).await.unwrap();
        let capabilities = CapabilitiesSummary {
            platform: "linux".into(),
            arch: "x86_64".into(),
            browser_channel: "none".into(),
            working_dir: workspace.path().display().to_string(),
            has_clipboard: false,
            has_wmctrl: false,
            has_notifications: false,
        };
        let approval = RecordingApproval::deny();
        let folder_access = RecordingFolderAccess::deny();
        let desktop = RecordingDesktop::default();
        let cancellation = CancellationToken::new();
        let skill_registry = workspace.skill_registry();
        let mut session = AgentSessionState::new("session");
        let mut events = Vec::new();

        let outcome = run_definition(
            OrchestrationInput {
                run_id: "run",
                storage_id: "storage",
                session_id: "session",
                user_message: "complete the goal",
                selected_skill: None,
                definition: &definition,
                capabilities: &capabilities,
                skill_descriptors: &[],
                active_model_instance_id: "active-model",
                working_dir: workspace.path(),
                editable_roots: &editable_roots,
                external_read_only_roots: &[],
                trusted_read_roots: &[],
                max_steps_override: None,
                model_routes: &routes,
                approval: &approval,
                folder_access: &folder_access,
                desktop: &desktop,
                cancellation: &cancellation,
                session: &mut session,
                skill_registry: &skill_registry,
                bundled_script_runtime: None,
                data_folder: workspace.path(),
            },
            |event| {
                events.push(event);
                Ok(())
            },
        )
        .await
        .unwrap();

        assert_eq!(outcome.reply.as_deref(), Some("executor result"));
        assert_eq!(executor.requests().len(), 1);
        assert_eq!(evaluator.requests().len(), 1);
        assert_eq!(
            events
                .iter()
                .filter_map(|event| match event {
                    AgentEvent::StageStarted {
                        model_instance_id, ..
                    } => Some(model_instance_id.as_str()),
                    _ => None,
                })
                .collect::<Vec<_>>(),
            vec!["executor-model", "evaluator-model"]
        );
    }
}
