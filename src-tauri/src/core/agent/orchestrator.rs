//! Bounded compositions over the existing Agent executor.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
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
    let kind = strategy_name(&input.definition.strategy);
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

    let run_root = input.data_folder.join("agent-runs").join(input.storage_id);
    if !matches!(input.definition.strategy, AgentStrategy::Standard) {
        tokio::fs::create_dir_all(&run_root)
            .await
            .map_err(|error| format!("Failed to create Agent run workspace: {error}"))?;
    }
    let default_model_instance_id = resolved_model_instance_id(
        input.definition.model_instance_id.as_deref(),
        input.active_model_instance_id,
    );
    let stage_context = StageContext {
        run_id: input.run_id,
        capabilities: input.capabilities,
        skill_descriptors: input.skill_descriptors,
        default_model_instance_id,
        working_dir: input.working_dir,
        editable_roots: input.editable_roots,
        external_read_only_roots: input.external_read_only_roots,
        trusted_read_roots: input.trusted_read_roots,
        model_routes: input.model_routes,
        approval: input.approval,
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
            let route = input.model_routes.route(default_model_instance_id)?;
            let persona = compose_agent_persona(
                &input.definition.instructions,
                &input.definition.output_contract,
            );
            let stable_prefix = build_stable_prefix(
                ITERATION_ONE_TOOLS,
                input.skill_descriptors,
                input.capabilities,
                DEFAULT_MAX_PARALLEL_TOOL_CALLS,
                Some(&persona),
            );
            let stage = StageSpec {
                id: "agent".into(),
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
                model_instance_id: default_model_instance_id.into(),
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
                    approval: input.approval,
                    folder_access: input.folder_access,
                    desktop: input.desktop,
                    cancellation: input.cancellation,
                    session: input.session,
                    skill_registry: input.skill_registry,
                    bundled_script_runtime: input.bundled_script_runtime,
                },
                RunTurnOptions {
                    additional_skills: &skills,
                },
                |event| match event {
                    AgentEvent::TurnStarted { .. } | AgentEvent::TurnFinished { .. } => Ok(()),
                    event => emit(event),
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
                clip(&feedback)
            )
        };
        let executor = StageSpec {
            id: format!("execute-{cycle}"),
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
        if executor_result.outcome.reason == "cancelled" {
            let mut outcome = executor_result.outcome;
            outcome.inference = inference;
            return Ok(outcome);
        }
        let executor_reply = executor_result.outcome.reply.clone().unwrap_or_default();
        last_executor = Some(executor_reply.clone());

        let evaluator = StageSpec {
            id: format!("evaluate-{cycle}"),
            name: format!("Evaluate cycle {cycle}"),
            role: "evaluator".into(),
            instructions: evaluator_instructions.into(),
            output_contract: "The first line must be exactly PASS or REVISE. When revision is needed, follow REVISE with concrete feedback.".into(),
            skills: Vec::new(),
            max_steps: 6,
            workspace: StageWorkspace::Isolated,
            message: format!(
                "Success criteria:\n{success_criteria}\n\nGoal:\n{goal}\n\nExecutor result:\n{}",
                clip(&executor_reply)
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
        if evaluator_result.outcome.reason == "cancelled" {
            let mut outcome = evaluator_result.outcome;
            outcome.inference = inference;
            return Ok(outcome);
        }
        feedback = evaluator_result.outcome.reply.unwrap_or_default();
        if evaluator_passed(&feedback) {
            break;
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
        reason: "reply".into(),
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
    if plan_result.outcome.reason == "cancelled" {
        return Ok(plan_result.outcome);
    }
    let mut inference = plan_result.outcome.inference;
    let plan_text = plan_result.outcome.reply.unwrap_or_default();

    let worker_specs = workers
        .iter()
        .map(|worker| StageSpec {
            id: worker.id.clone(),
            name: worker.name.clone(),
            role: "worker".into(),
            instructions: worker.instructions.clone(),
            output_contract: "Return a self-contained specialist report for the coordinator.".into(),
            skills: merge_skill_lists(shared_skills, &worker.skills),
            max_steps: worker.max_steps,
            workspace: StageWorkspace::Isolated,
            message: format!(
                "Goal:\n{goal}\n\nCoordinator plan:\n{}\n\nComplete the part of the plan assigned to your role. The source workspace is available read-only; put any produced artifacts in your isolated run workspace.",
                clip(&plan_text)
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
    for worker in &worker_specs {
        emit_stage_started(worker, emit)?;
    }
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
        emit_stage_finished(&result, emit)?;
        if result.outcome.reason == "cancelled" {
            cancelled = true;
            continue;
        }
        reports.push((result.name, result.outcome.reply.unwrap_or_default()));
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
        name: "Synthesize".into(),
        role: "coordinator".into(),
        instructions: format!("{}\n\n{}", definition.instructions, synthesis_instructions),
        output_contract: definition.output_contract.clone(),
        skills: shared_skills.to_vec(),
        max_steps: definition.max_steps,
        workspace: StageWorkspace::Shared,
        message: format!(
            "Goal:\n{goal}\n\nCoordinator plan:\n{}\n\nSpecialist reports:\n{}",
            clip(&plan_text),
            reports
                .iter()
                .map(|(name, report)| format!("## {name}\n{}", clip(report)))
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
        reason: synthesis_result.outcome.reason,
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
                            .map(|reply| format!("## {}\n{}", edge.from, clip(reply)))
                    })
                    .collect::<Vec<_>>();
                StageSpec {
                    id: node.id.clone(),
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
        for spec in &specs {
            emit_stage_started(spec, emit)?;
        }
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
            emit_stage_finished(&result, emit)?;
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
    Ok(outcome)
}

async fn execute_stage(
    context: &StageContext<'_>,
    spec: StageSpec,
    _worker_index: i32,
) -> Result<StageResult, String> {
    if context.cancellation.is_cancelled() {
        return Err("Agent run was cancelled".into());
    }
    let started = Instant::now();
    let route = context.model_routes.route(&spec.model_instance_id)?;
    let persona = compose_agent_persona(&spec.instructions, &spec.output_contract);
    let stable_prefix = build_stable_prefix(
        ITERATION_ONE_TOOLS,
        context.skill_descriptors,
        context.capabilities,
        DEFAULT_MAX_PARALLEL_TOOL_CALLS,
        Some(&persona),
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

    Ok(StageResult {
        id: spec.id,
        name: spec.name,
        outcome,
        duration_ms: started.elapsed().as_millis().min(u64::MAX as u128) as u64,
        model_instance_id: route.instance_id.clone(),
        model_id: route.model_id.clone(),
        reasoning_effort: spec.reasoning_effort,
    })
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
    emit_stage_started(&spec, emit)?;
    let failure_spec = spec.clone();
    let started = Instant::now();
    match execute_stage(context, spec, worker_index).await {
        Ok(result) => {
            emit_stage_finished(&result, emit)?;
            Ok(result)
        }
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
            trusted_read_roots,
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
            additional_skills: &spec.skills,
        },
        |_| Ok(()),
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::agent::definitions::general_agent;
    use crate::core::agent::test_support::{
        RecordingApproval, RecordingDesktop, RecordingFolderAccess, ScriptedGinferServer,
        ScriptedResponse, TestWorkspace,
    };
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
