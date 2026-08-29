//! Bounded compositions over the existing Agent executor.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::time::Instant;

use futures::{stream, StreamExt};
use tokio_util::sync::CancellationToken;

use super::definitions::{
    workflow_levels, AgentDefinition, AgentStrategy, StageWorkspace, WorkflowEdge, WorkflowNode,
};
use super::llm_client::LlamaServerClient;
use super::model_profile::AgentModelProfile;
use super::path_policy::EditableRoots;
use super::prompt::{
    build_stable_prefix_for_profile, compose_agent_persona, CapabilitiesSummary, SkillDescriptor,
    DEFAULT_MAX_PARALLEL_TOOL_CALLS, ITERATION_ONE_TOOLS,
};
use super::runner::{
    run_turn_with_options, AgentTurnOutcome, RunTurnInput, RunTurnOptions, MAX_STEPS,
};
use super::session::AgentSessionState;
use super::skills::SkillRegistry;
use super::tools::{ApprovalHook, DesktopServices, FolderAccessHook};
use super::types::AgentEvent;

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
    pub model_profile: AgentModelProfile,
    pub working_dir: &'a Path,
    pub editable_roots: &'a EditableRoots,
    pub external_read_only_roots: &'a [PathBuf],
    pub trusted_read_roots: &'a [PathBuf],
    pub max_steps_override: Option<u32>,
    pub client: &'a LlamaServerClient,
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
    model_profile: AgentModelProfile,
    working_dir: &'a Path,
    editable_roots: &'a EditableRoots,
    external_read_only_roots: &'a [PathBuf],
    trusted_read_roots: &'a [PathBuf],
    client: &'a LlamaServerClient,
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
}

struct StageResult {
    id: String,
    name: String,
    outcome: AgentTurnOutcome,
    duration_ms: u64,
}

pub async fn run_definition(
    input: OrchestrationInput<'_>,
    mut emit: impl FnMut(AgentEvent) -> Result<(), String>,
) -> Result<AgentTurnOutcome, String> {
    let kind = strategy_name(&input.definition.strategy);
    if !matches!(input.definition.strategy, AgentStrategy::Standard) {
        emit(AgentEvent::TurnStarted {
            run_id: input.run_id.to_owned(),
            session_id: input.session_id.to_owned(),
        })?;
    }
    emit(AgentEvent::OrchestrationStarted {
        definition_id: input.definition.id.clone(),
        definition_name: input.definition.name.clone(),
        kind: kind.into(),
    })?;

    let run_root = input.data_folder.join("agent-runs").join(input.storage_id);
    if !matches!(input.definition.strategy, AgentStrategy::Standard) {
        tokio::fs::create_dir_all(&run_root)
            .await
            .map_err(|error| format!("Failed to create Agent run workspace: {error}"))?;
    }
    let stage_context = StageContext {
        run_id: input.run_id,
        capabilities: input.capabilities,
        skill_descriptors: input.skill_descriptors,
        model_profile: input.model_profile,
        working_dir: input.working_dir,
        editable_roots: input.editable_roots,
        external_read_only_roots: input.external_read_only_roots,
        trusted_read_roots: input.trusted_read_roots,
        client: input.client,
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
            let persona = compose_agent_persona(
                &input.definition.instructions,
                &input.definition.output_contract,
            );
            let stable_prefix = build_stable_prefix_for_profile(
                ITERATION_ONE_TOOLS,
                input.skill_descriptors,
                input.capabilities,
                DEFAULT_MAX_PARALLEL_TOOL_CALLS,
                Some(&persona),
                input.model_profile,
            );
            run_turn_with_options(
                RunTurnInput {
                    run_id: input.run_id,
                    session_id: input.session_id,
                    user_message: input.user_message,
                    selected_skill: None,
                    stable_prefix: &stable_prefix,
                    model_profile: input.model_profile,
                    working_dir: input.working_dir,
                    editable_roots: input.editable_roots,
                    external_read_only_roots: input.external_read_only_roots,
                    trusted_read_roots: input.trusted_read_roots,
                    max_steps: input
                        .max_steps_override
                        .unwrap_or(input.definition.max_steps),
                    client: input.client,
                    approval: input.approval,
                    folder_access: input.folder_access,
                    desktop: input.desktop,
                    cancellation: input.cancellation,
                    session: input.session,
                    skill_registry: input.skill_registry,
                    bundled_script_runtime: input.bundled_script_runtime,
                },
                RunTurnOptions {
                    slot_id: 0,
                    additional_skills: &skills,
                },
                &mut emit,
            )
            .await?
        }
        AgentStrategy::GoalLoop {
            max_cycles,
            success_criteria,
            evaluator_instructions,
        } => {
            run_goal_loop(
                &stage_context,
                input.definition,
                input.user_message,
                &skills,
                *max_cycles,
                success_criteria,
                evaluator_instructions,
                &mut emit,
            )
            .await?
        }
        AgentStrategy::Coordinator {
            max_parallel,
            coordinator_instructions,
            synthesis_instructions,
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
        emit(AgentEvent::TurnFinished {
            reason: outcome.reason.clone(),
            step_count: outcome.step_count,
        })?;
    }
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
    emit: &mut impl FnMut(AgentEvent) -> Result<(), String>,
) -> Result<AgentTurnOutcome, String> {
    let mut feedback = String::new();
    let mut last_executor = None;
    let mut total_steps = 0;
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
        };
        emit_stage_started(&executor, emit)?;
        let executor_result = execute_stage(context, executor, 0).await?;
        total_steps += executor_result.outcome.step_count;
        emit_stage_finished(&executor_result, emit)?;
        if executor_result.outcome.reason == "cancelled" {
            return Ok(executor_result.outcome);
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
        };
        emit_stage_started(&evaluator, emit)?;
        let evaluator_result = execute_stage(context, evaluator, 1).await?;
        total_steps += evaluator_result.outcome.step_count;
        emit_stage_finished(&evaluator_result, emit)?;
        if evaluator_result.outcome.reason == "cancelled" {
            return Ok(evaluator_result.outcome);
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
    };
    emit_stage_started(&plan, emit)?;
    let plan_result = execute_stage(context, plan, 0).await?;
    emit_stage_finished(&plan_result, emit)?;
    if plan_result.outcome.reason == "cancelled" {
        return Ok(plan_result.outcome);
    }
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
        })
        .collect::<Vec<_>>();
    for worker in &worker_specs {
        emit_stage_started(worker, emit)?;
    }
    let mut worker_results = stream::iter(worker_specs.into_iter().enumerate().map(
        |(index, worker)| async move {
            let result = execute_stage(context, worker, index as i32).await;
            (index, result)
        },
    ))
    .buffer_unordered(max_parallel)
    .collect::<Vec<_>>()
    .await;
    worker_results.sort_by_key(|(index, _)| *index);
    let mut reports = Vec::with_capacity(worker_results.len());
    let mut total_steps = plan_result.outcome.step_count;
    for (_, result) in worker_results {
        let result = result?;
        total_steps += result.outcome.step_count;
        emit_stage_finished(&result, emit)?;
        if result.outcome.reason == "cancelled" {
            return Ok(AgentTurnOutcome {
                reply: None,
                reason: "cancelled".into(),
                step_count: total_steps,
            });
        }
        reports.push((result.name, result.outcome.reply.unwrap_or_default()));
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
    };
    emit_stage_started(&synthesis, emit)?;
    let synthesis_result = execute_stage(context, synthesis, 0).await?;
    total_steps += synthesis_result.outcome.step_count;
    emit_stage_finished(&synthesis_result, emit)?;
    Ok(AgentTurnOutcome {
        reply: synthesis_result.outcome.reply,
        reason: synthesis_result.outcome.reason,
        step_count: total_steps,
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
                }
            })
            .collect::<Vec<_>>();
        for spec in &specs {
            emit_stage_started(spec, emit)?;
        }
        let mut level_results = stream::iter(specs.into_iter().enumerate().map(
            |(index, spec)| async move {
                let result = execute_stage(context, spec, index as i32).await;
                (index, result)
            },
        ))
        .buffer_unordered(level.len())
        .collect::<Vec<_>>()
        .await;
        level_results.sort_by_key(|(index, _)| *index);
        for (_, result) in level_results {
            let result = result?;
            total_steps += result.outcome.step_count;
            emit_stage_finished(&result, emit)?;
            if result.outcome.reason == "cancelled" {
                return Ok(AgentTurnOutcome {
                    reply: None,
                    reason: "cancelled".into(),
                    step_count: total_steps,
                });
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
    }
    let mut outcome = last_outcome.ok_or_else(|| "Workflow produced no result".to_string())?;
    outcome.step_count = total_steps;
    Ok(outcome)
}

async fn execute_stage(
    context: &StageContext<'_>,
    spec: StageSpec,
    slot_id: i32,
) -> Result<StageResult, String> {
    if context.cancellation.is_cancelled() {
        return Err("Agent run was cancelled".into());
    }
    let started = Instant::now();
    let persona = compose_agent_persona(&spec.instructions, &spec.output_contract);
    let stable_prefix = build_stable_prefix_for_profile(
        ITERATION_ONE_TOOLS,
        context.skill_descriptors,
        context.capabilities,
        DEFAULT_MAX_PARALLEL_TOOL_CALLS,
        Some(&persona),
        context.model_profile,
    );
    let mut session = AgentSessionState::new(format!("{}:{}", context.run_id, spec.id));

    let outcome = match spec.workspace {
        StageWorkspace::Shared => {
            run_stage_with_workspace(
                context,
                &spec,
                slot_id,
                &stable_prefix,
                context.working_dir,
                context.editable_roots,
                context.external_read_only_roots,
                context.trusted_read_roots,
                &mut session,
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
                slot_id,
                &stable_prefix,
                &scratch,
                &editable_roots,
                &trusted_read_roots,
                &trusted_read_roots,
                &mut session,
            )
            .await?
        }
    };

    Ok(StageResult {
        id: spec.id,
        name: spec.name,
        outcome,
        duration_ms: started.elapsed().as_millis().min(u64::MAX as u128) as u64,
    })
}

#[allow(clippy::too_many_arguments)]
async fn run_stage_with_workspace(
    context: &StageContext<'_>,
    spec: &StageSpec,
    slot_id: i32,
    stable_prefix: &str,
    working_dir: &Path,
    editable_roots: &EditableRoots,
    external_read_only_roots: &[PathBuf],
    trusted_read_roots: &[PathBuf],
    session: &mut AgentSessionState,
) -> Result<AgentTurnOutcome, String> {
    run_turn_with_options(
        RunTurnInput {
            run_id: context.run_id,
            session_id: &session.session_id.clone(),
            user_message: &spec.message,
            selected_skill: None,
            stable_prefix,
            model_profile: context.model_profile,
            working_dir,
            editable_roots,
            external_read_only_roots,
            trusted_read_roots,
            max_steps: spec.max_steps.clamp(1, MAX_STEPS),
            client: context.client,
            approval: context.approval,
            folder_access: context.folder_access,
            desktop: context.desktop,
            cancellation: context.cancellation,
            session,
            skill_registry: context.skill_registry,
            bundled_script_runtime: context.bundled_script_runtime,
        },
        RunTurnOptions {
            slot_id,
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
    })
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
}
