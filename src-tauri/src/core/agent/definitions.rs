//! Versioned Agent Studio definitions and built-in templates.

use std::collections::{HashMap, HashSet, VecDeque};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Runtime};

use crate::core::app::commands::get_jan_data_folder_path;

use super::runner::MAX_STEPS;

pub const AGENT_DEFINITION_SCHEMA_VERSION: u32 = 2;
const AGENT_DEFINITIONS_FILE: &str = "agent-definitions.json";
const MAX_DEFINITIONS: usize = 128;
const MAX_COMPOSITE_NODES: usize = 8;
const MAX_SKILLS: usize = super::skills::loaded::LOADED_SKILLS_CAP;
const MAX_NAME_CHARS: usize = 80;
const MAX_DESCRIPTION_CHARS: usize = 500;
const MAX_INSTRUCTIONS_CHARS: usize = 24_000;
const MAX_MODEL_INSTANCE_ID_CHARS: usize = 256;
static DEFINITION_STORE_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AgentDefinition {
    pub schema_version: u32,
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub instructions: String,
    #[serde(default)]
    pub skills: Vec<String>,
    #[serde(default = "default_max_steps")]
    pub max_steps: u32,
    #[serde(default)]
    pub output_contract: String,
    /// Stable registered model ID. `None` binds the run's active chat model.
    #[serde(default)]
    pub model_instance_id: Option<String>,
    #[serde(flatten)]
    pub strategy: AgentStrategy,
    #[serde(default)]
    pub built_in: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(
    tag = "kind",
    rename_all = "snake_case",
    rename_all_fields = "camelCase"
)]
pub enum AgentStrategy {
    Standard,
    GoalLoop {
        max_cycles: u32,
        success_criteria: String,
        evaluator_instructions: String,
        #[serde(default)]
        evaluator_model_instance_id: Option<String>,
    },
    Coordinator {
        max_parallel: usize,
        coordinator_instructions: String,
        synthesis_instructions: String,
        #[serde(default)]
        synthesis_model_instance_id: Option<String>,
        workers: Vec<AgentRole>,
    },
    Workflow {
        nodes: Vec<WorkflowNode>,
        edges: Vec<WorkflowEdge>,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AgentRole {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub instructions: String,
    #[serde(default)]
    pub skills: Vec<String>,
    #[serde(default = "default_role_max_steps")]
    pub max_steps: u32,
    /// `None` inherits the owning definition's resolved model instance.
    #[serde(default)]
    pub model_instance_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowNode {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub instructions: String,
    #[serde(default)]
    pub skills: Vec<String>,
    #[serde(default = "default_role_max_steps")]
    pub max_steps: u32,
    #[serde(default)]
    pub workspace: StageWorkspace,
    /// `None` inherits the owning definition's resolved model instance.
    #[serde(default)]
    pub model_instance_id: Option<String>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
pub enum StageWorkspace {
    #[default]
    Isolated,
    Shared,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct WorkflowEdge {
    pub from: String,
    pub to: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AgentTemplate {
    pub id: String,
    pub name: String,
    pub description: String,
    pub definition: AgentDefinition,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct DefinitionStore {
    schema_version: u32,
    definitions: Vec<AgentDefinition>,
}

fn default_max_steps() -> u32 {
    MAX_STEPS
}

fn default_role_max_steps() -> u32 {
    12
}

pub fn general_agent() -> AgentDefinition {
    AgentDefinition {
        schema_version: AGENT_DEFINITION_SCHEMA_VERSION,
        id: "general".into(),
        name: "General Agent".into(),
        description: "A capable autonomous agent for everyday local tasks.".into(),
        instructions: String::new(),
        skills: Vec::new(),
        max_steps: MAX_STEPS,
        output_contract: String::new(),
        model_instance_id: None,
        strategy: AgentStrategy::Standard,
        built_in: true,
    }
}

pub fn editable_general_agent() -> AgentDefinition {
    AgentDefinition {
        id: String::new(),
        name: "Untitled Agent".into(),
        description: String::new(),
        built_in: false,
        ..general_agent()
    }
}

pub fn built_in_templates() -> Vec<AgentTemplate> {
    vec![
        template(
            "standard-agent",
            "Standard Agent",
            "One autonomous agent with its own role, skills, limits, and output contract.",
            AgentStrategy::Standard,
        ),
        template(
            "goal-loop",
            "Goal Loop",
            "An executor repeatedly improves its result against an explicit evaluator.",
            AgentStrategy::GoalLoop {
                max_cycles: 3,
                success_criteria: "The requested outcome is complete, correct, and directly usable."
                    .into(),
                evaluator_instructions:
                    "Evaluate the executor result against the success criteria. Return PASS only when every criterion is met; otherwise return REVISE followed by concrete corrective feedback."
                        .into(),
                evaluator_model_instance_id: None,
            },
        ),
        template(
            "research-team",
            "Coordinator Research Team",
            "A coordinator plans the work, parallel specialists investigate it, and a synthesizer produces one answer.",
            AgentStrategy::Coordinator {
                max_parallel: 3,
                coordinator_instructions:
                    "Decompose the goal into a concise investigation plan for the specialist roles."
                        .into(),
                synthesis_instructions:
                    "Reconcile the specialist reports, resolve conflicts, and return one evidence-based final result."
                        .into(),
                synthesis_model_instance_id: None,
                workers: vec![
                    role("researcher", "Researcher", "Gather the primary facts and evidence."),
                    role("critic", "Critic", "Challenge assumptions and identify gaps or risks."),
                    role("practitioner", "Practitioner", "Translate the goal into an implementable result."),
                ],
            },
        ),
        template(
            "implementation-review",
            "Implementation + Review",
            "A practical workflow that analyzes, implements, reviews, and then delivers.",
            AgentStrategy::Workflow {
                nodes: vec![
                    node("analyze", "Analyze", "Inspect the task and produce a precise implementation plan."),
                    shared_node("implement", "Implement", "Implement the plan and run focused checks."),
                    node("review", "Review", "Review the implementation for correctness, regressions, and missing requirements."),
                    shared_node("deliver", "Deliver", "Resolve review findings and provide the final result."),
                ],
                edges: vec![
                    edge("analyze", "implement"),
                    edge("implement", "review"),
                    edge("review", "deliver"),
                ],
            },
        ),
    ]
}

fn template(id: &str, name: &str, description: &str, strategy: AgentStrategy) -> AgentTemplate {
    AgentTemplate {
        id: id.into(),
        name: name.into(),
        description: description.into(),
        definition: AgentDefinition {
            schema_version: AGENT_DEFINITION_SCHEMA_VERSION,
            id: String::new(),
            name: name.into(),
            description: description.into(),
            instructions: String::new(),
            skills: Vec::new(),
            max_steps: MAX_STEPS,
            output_contract: String::new(),
            model_instance_id: None,
            strategy,
            built_in: false,
        },
    }
}

fn role(id: &str, name: &str, instructions: &str) -> AgentRole {
    AgentRole {
        id: id.into(),
        name: name.into(),
        instructions: instructions.into(),
        skills: Vec::new(),
        max_steps: 12,
        model_instance_id: None,
    }
}

fn node(id: &str, name: &str, instructions: &str) -> WorkflowNode {
    WorkflowNode {
        id: id.into(),
        name: name.into(),
        instructions: instructions.into(),
        skills: Vec::new(),
        max_steps: 12,
        workspace: StageWorkspace::Isolated,
        model_instance_id: None,
    }
}

fn shared_node(id: &str, name: &str, instructions: &str) -> WorkflowNode {
    WorkflowNode {
        workspace: StageWorkspace::Shared,
        ..node(id, name, instructions)
    }
}

fn edge(from: &str, to: &str) -> WorkflowEdge {
    WorkflowEdge {
        from: from.into(),
        to: to.into(),
    }
}

pub fn definitions_path(data_folder: &Path) -> PathBuf {
    data_folder.join(AGENT_DEFINITIONS_FILE)
}

pub fn list_definitions(data_folder: &Path) -> Result<Vec<AgentDefinition>, String> {
    let mut definitions = read_store(data_folder)?.definitions;
    definitions.sort_by(|left, right| left.name.to_lowercase().cmp(&right.name.to_lowercase()));
    Ok(definitions)
}

pub fn get_definition(data_folder: &Path, id: &str) -> Result<AgentDefinition, String> {
    if id == general_agent().id {
        return Ok(general_agent());
    }
    list_definitions(data_folder)?
        .into_iter()
        .find(|definition| definition.id == id)
        .ok_or_else(|| format!("Agent definition `{id}` was not found"))
}

pub fn save_definition(
    data_folder: &Path,
    mut definition: AgentDefinition,
) -> Result<AgentDefinition, String> {
    let _guard = DEFINITION_STORE_LOCK
        .get_or_init(|| Mutex::new(()))
        .lock()
        .map_err(|_| "Agent definition store lock is poisoned".to_string())?;
    definition.built_in = false;
    validate_definition(&definition)?;
    if definition.id == general_agent().id {
        return Err("The built-in General Agent cannot be replaced".into());
    }

    let mut store = read_store(data_folder)?;
    if let Some(existing) = store
        .definitions
        .iter_mut()
        .find(|existing| existing.id == definition.id)
    {
        *existing = definition.clone();
    } else {
        if store.definitions.len() >= MAX_DEFINITIONS {
            return Err(format!(
                "Agent Studio supports at most {MAX_DEFINITIONS} saved definitions"
            ));
        }
        store.definitions.push(definition.clone());
    }
    write_store(data_folder, &store)?;
    Ok(definition)
}

pub fn delete_definition(data_folder: &Path, id: &str) -> Result<(), String> {
    let _guard = DEFINITION_STORE_LOCK
        .get_or_init(|| Mutex::new(()))
        .lock()
        .map_err(|_| "Agent definition store lock is poisoned".to_string())?;
    if id == general_agent().id {
        return Err("The built-in General Agent cannot be deleted".into());
    }
    let mut store = read_store(data_folder)?;
    let original_len = store.definitions.len();
    store.definitions.retain(|definition| definition.id != id);
    if store.definitions.len() == original_len {
        return Err(format!("Agent definition `{id}` was not found"));
    }
    write_store(data_folder, &store)
}

pub fn validate_definition(definition: &AgentDefinition) -> Result<(), String> {
    if definition.schema_version != AGENT_DEFINITION_SCHEMA_VERSION {
        return Err(format!(
            "Unsupported Agent definition schema version {}",
            definition.schema_version
        ));
    }
    validate_id("Agent definition", &definition.id)?;
    validate_common(
        &definition.name,
        &definition.description,
        &definition.instructions,
        &definition.skills,
        definition.max_steps,
    )?;
    if definition.output_contract.chars().count() > MAX_INSTRUCTIONS_CHARS {
        return Err("Agent output contract is too long".into());
    }
    validate_model_instance_id("Agent default", &definition.model_instance_id)?;

    match &definition.strategy {
        AgentStrategy::Standard => {}
        AgentStrategy::GoalLoop {
            max_cycles,
            success_criteria,
            evaluator_instructions,
            evaluator_model_instance_id,
        } => {
            if !(1..=8).contains(max_cycles) {
                return Err("Goal loops require between 1 and 8 cycles".into());
            }
            validate_required_text("Goal-loop success criteria", success_criteria)?;
            validate_required_text("Goal-loop evaluator instructions", evaluator_instructions)?;
            validate_model_instance_id("Goal-loop evaluator", evaluator_model_instance_id)?;
        }
        AgentStrategy::Coordinator {
            max_parallel,
            coordinator_instructions,
            synthesis_instructions,
            synthesis_model_instance_id,
            workers,
        } => {
            if workers.is_empty() || workers.len() > MAX_COMPOSITE_NODES {
                return Err("Coordinator teams require between 1 and 8 workers".into());
            }
            if *max_parallel == 0 || *max_parallel > workers.len() || *max_parallel > 8 {
                return Err(
                    "Coordinator parallelism must be between 1 and the worker count".into(),
                );
            }
            validate_required_text("Coordinator instructions", coordinator_instructions)?;
            validate_required_text("Synthesis instructions", synthesis_instructions)?;
            validate_model_instance_id("Coordinator synthesis", synthesis_model_instance_id)?;
            validate_roles(workers)?;
        }
        AgentStrategy::Workflow { nodes, edges } => {
            validate_workflow(nodes, edges)?;
        }
    }
    Ok(())
}

fn validate_common(
    name: &str,
    description: &str,
    instructions: &str,
    skills: &[String],
    max_steps: u32,
) -> Result<(), String> {
    validate_required_text("Agent name", name)?;
    if name.chars().count() > MAX_NAME_CHARS {
        return Err(format!(
            "Agent names may contain at most {MAX_NAME_CHARS} characters"
        ));
    }
    if description.chars().count() > MAX_DESCRIPTION_CHARS {
        return Err(format!(
            "Agent descriptions may contain at most {MAX_DESCRIPTION_CHARS} characters"
        ));
    }
    if instructions.chars().count() > MAX_INSTRUCTIONS_CHARS {
        return Err("Agent instructions are too long".into());
    }
    if !(1..=MAX_STEPS).contains(&max_steps) {
        return Err(format!("Agent max steps must be between 1 and {MAX_STEPS}"));
    }
    validate_skills(skills)
}

fn validate_roles(workers: &[AgentRole]) -> Result<(), String> {
    let mut ids = HashSet::new();
    for worker in workers {
        validate_id("Worker", &worker.id)?;
        if !ids.insert(worker.id.as_str()) {
            return Err(format!("Duplicate worker id `{}`", worker.id));
        }
        validate_common(
            &worker.name,
            "",
            &worker.instructions,
            &worker.skills,
            worker.max_steps,
        )?;
        validate_model_instance_id("Worker", &worker.model_instance_id)?;
    }
    Ok(())
}

fn validate_workflow(nodes: &[WorkflowNode], edges: &[WorkflowEdge]) -> Result<(), String> {
    if nodes.is_empty() || nodes.len() > MAX_COMPOSITE_NODES {
        return Err("Workflows require between 1 and 8 nodes".into());
    }
    let mut ids = HashSet::new();
    for node in nodes {
        validate_id("Workflow node", &node.id)?;
        if !ids.insert(node.id.as_str()) {
            return Err(format!("Duplicate workflow node id `{}`", node.id));
        }
        validate_common(
            &node.name,
            "",
            &node.instructions,
            &node.skills,
            node.max_steps,
        )?;
        validate_model_instance_id("Workflow node", &node.model_instance_id)?;
    }
    if edges.len() > MAX_COMPOSITE_NODES * MAX_COMPOSITE_NODES {
        return Err("Workflow contains too many edges".into());
    }
    let mut unique_edges = HashSet::new();
    for edge in edges {
        if edge.from == edge.to {
            return Err(format!(
                "Workflow node `{}` cannot depend on itself",
                edge.from
            ));
        }
        if !ids.contains(edge.from.as_str()) || !ids.contains(edge.to.as_str()) {
            return Err(format!(
                "Workflow edge `{} -> {}` references an unknown node",
                edge.from, edge.to
            ));
        }
        if !unique_edges.insert((edge.from.as_str(), edge.to.as_str())) {
            return Err(format!(
                "Duplicate workflow edge `{} -> {}`",
                edge.from, edge.to
            ));
        }
    }
    let levels = workflow_levels(nodes, edges)?;
    let sources = edges
        .iter()
        .map(|edge| edge.from.as_str())
        .collect::<HashSet<_>>();
    let sink_count = nodes
        .iter()
        .filter(|node| !sources.contains(node.id.as_str()))
        .count();
    if sink_count != 1 {
        return Err("A workflow must have exactly one final node".into());
    }
    for level in levels {
        let shared_count = level
            .iter()
            .filter(|id| {
                nodes
                    .iter()
                    .find(|node| &node.id == *id)
                    .is_some_and(|node| node.workspace == StageWorkspace::Shared)
            })
            .count();
        if shared_count > 0 && level.len() > 1 {
            return Err(
                "A shared-workspace workflow stage must be the only node in its execution level"
                    .into(),
            );
        }
    }
    Ok(())
}

fn validate_model_instance_id(label: &str, value: &Option<String>) -> Result<(), String> {
    let Some(value) = value else {
        return Ok(());
    };
    if value.trim().is_empty() {
        return Err(format!("{label} model instance ID must not be blank"));
    }
    if value.chars().count() > MAX_MODEL_INSTANCE_ID_CHARS {
        return Err(format!(
            "{label} model instance IDs may contain at most {MAX_MODEL_INSTANCE_ID_CHARS} characters"
        ));
    }
    Ok(())
}

pub fn workflow_levels(
    nodes: &[WorkflowNode],
    edges: &[WorkflowEdge],
) -> Result<Vec<Vec<String>>, String> {
    let mut indegree = nodes
        .iter()
        .map(|node| (node.id.clone(), 0usize))
        .collect::<HashMap<_, _>>();
    let mut outgoing = nodes
        .iter()
        .map(|node| (node.id.clone(), Vec::new()))
        .collect::<HashMap<_, _>>();
    for edge in edges {
        *indegree
            .get_mut(&edge.to)
            .ok_or_else(|| format!("Unknown workflow node `{}`", edge.to))? += 1;
        outgoing
            .get_mut(&edge.from)
            .ok_or_else(|| format!("Unknown workflow node `{}`", edge.from))?
            .push(edge.to.clone());
    }
    let mut ready = VecDeque::from_iter(
        nodes
            .iter()
            .filter(|node| indegree[&node.id] == 0)
            .map(|node| node.id.clone()),
    );
    let mut levels = Vec::new();
    let mut visited = 0usize;
    while !ready.is_empty() {
        let level_len = ready.len();
        let mut level = Vec::with_capacity(level_len);
        for _ in 0..level_len {
            let id = ready.pop_front().expect("ready length was checked");
            visited += 1;
            level.push(id.clone());
            for target in &outgoing[&id] {
                let value = indegree
                    .get_mut(target)
                    .expect("validated workflow target exists");
                *value -= 1;
                if *value == 0 {
                    ready.push_back(target.clone());
                }
            }
        }
        levels.push(level);
    }
    if visited != nodes.len() {
        return Err("Workflow must be an acyclic graph".into());
    }
    Ok(levels)
}

fn validate_id(label: &str, value: &str) -> Result<(), String> {
    let valid = !value.is_empty()
        && value.len() <= 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-')
        && !value.starts_with('-')
        && !value.ends_with('-');
    if valid {
        Ok(())
    } else {
        Err(format!(
            "{label} id must be a lowercase kebab-case identifier"
        ))
    }
}

fn validate_required_text(label: &str, value: &str) -> Result<(), String> {
    if value.trim().is_empty() {
        Err(format!("{label} is required"))
    } else if value.chars().count() > MAX_INSTRUCTIONS_CHARS {
        Err(format!("{label} is too long"))
    } else {
        Ok(())
    }
}

fn validate_skills(skills: &[String]) -> Result<(), String> {
    if skills.len() > MAX_SKILLS {
        return Err(format!("An agent may load at most {MAX_SKILLS} skills"));
    }
    let mut unique = HashSet::new();
    for skill in skills {
        if skill.trim().is_empty() {
            return Err("Skill names cannot be empty".into());
        }
        if !unique.insert(skill.as_str()) {
            return Err(format!("Duplicate skill `{skill}`"));
        }
    }
    Ok(())
}

fn read_store(data_folder: &Path) -> Result<DefinitionStore, String> {
    let path = definitions_path(data_folder);
    if !path.exists() {
        return Ok(DefinitionStore {
            schema_version: AGENT_DEFINITION_SCHEMA_VERSION,
            definitions: Vec::new(),
        });
    }
    let bytes = std::fs::read(&path)
        .map_err(|error| format!("Failed to read Agent definitions: {error}"))?;
    let store: DefinitionStore = serde_json::from_slice(&bytes)
        .map_err(|error| format!("Failed to parse Agent definitions: {error}"))?;
    if store.schema_version != AGENT_DEFINITION_SCHEMA_VERSION {
        return Err(format!(
            "Unsupported Agent definition store schema version {}",
            store.schema_version
        ));
    }
    if store.definitions.len() > MAX_DEFINITIONS {
        return Err("Agent definition store exceeds the supported definition limit".into());
    }
    for definition in &store.definitions {
        validate_definition(definition)?;
        if definition.built_in {
            return Err("Saved Agent definitions cannot claim built-in ownership".into());
        }
    }
    Ok(store)
}

fn write_store(data_folder: &Path, store: &DefinitionStore) -> Result<(), String> {
    std::fs::create_dir_all(data_folder)
        .map_err(|error| format!("Failed to create GChat data folder: {error}"))?;
    let bytes = serde_json::to_vec_pretty(store)
        .map_err(|error| format!("Failed to serialize Agent definitions: {error}"))?;
    super::storage::atomic_write(&definitions_path(data_folder), &bytes, "Agent definitions")
}

#[tauri::command]
pub async fn agent_list_definitions<R: Runtime>(
    app_handle: AppHandle<R>,
) -> Result<Vec<AgentDefinition>, String> {
    list_definitions(&get_jan_data_folder_path(app_handle))
}

#[tauri::command]
pub async fn agent_new_definition() -> Result<AgentDefinition, String> {
    Ok(editable_general_agent())
}

#[tauri::command]
pub async fn agent_get_definition<R: Runtime>(
    app_handle: AppHandle<R>,
    id: String,
) -> Result<AgentDefinition, String> {
    get_definition(&get_jan_data_folder_path(app_handle), &id)
}

#[tauri::command]
pub async fn agent_save_definition<R: Runtime>(
    app_handle: AppHandle<R>,
    definition: AgentDefinition,
) -> Result<AgentDefinition, String> {
    save_definition(&get_jan_data_folder_path(app_handle), definition)
}

#[tauri::command]
pub async fn agent_delete_definition<R: Runtime>(
    app_handle: AppHandle<R>,
    id: String,
) -> Result<(), String> {
    delete_definition(&get_jan_data_folder_path(app_handle), &id)
}

#[tauri::command]
pub async fn agent_list_templates() -> Result<Vec<AgentTemplate>, String> {
    Ok(built_in_templates())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn custom_standard(id: &str) -> AgentDefinition {
        AgentDefinition {
            schema_version: AGENT_DEFINITION_SCHEMA_VERSION,
            id: id.into(),
            name: "Custom".into(),
            description: String::new(),
            instructions: "Do the work.".into(),
            skills: vec!["code".into()],
            max_steps: 10,
            output_contract: String::new(),
            model_instance_id: None,
            strategy: AgentStrategy::Standard,
            built_in: false,
        }
    }

    #[test]
    fn lists_only_saved_definitions_and_keeps_general_as_an_internal_fallback() {
        let root = tempfile::tempdir().unwrap();
        assert!(list_definitions(root.path()).unwrap().is_empty());
        let general = get_definition(root.path(), "general").unwrap();
        assert!(general.built_in);

        save_definition(root.path(), custom_standard("my-agent")).unwrap();
        let definitions = list_definitions(root.path()).unwrap();
        assert_eq!(definitions.len(), 1);
        assert_eq!(definitions[0].id, "my-agent");
        assert!(!definitions[0].built_in);
        assert_eq!(
            get_definition(root.path(), "my-agent").unwrap().name,
            "Custom"
        );

        delete_definition(root.path(), "my-agent").unwrap();
        assert!(list_definitions(root.path()).unwrap().is_empty());
    }

    #[test]
    fn creates_an_editable_draft_from_the_hidden_general_agent() {
        let draft = editable_general_agent();
        assert_eq!(draft.id, "");
        assert_eq!(draft.name, "Untitled Agent");
        assert!(!draft.built_in);
        assert_eq!(draft.strategy, AgentStrategy::Standard);
        assert_eq!(draft.max_steps, MAX_STEPS);
        assert_eq!(draft.schema_version, 2);
        assert_eq!(draft.model_instance_id, None);
    }

    #[test]
    fn validates_explicit_model_instance_bindings() {
        let mut definition = custom_standard("routed-agent");
        definition.model_instance_id = Some("qwen-instance".into());
        validate_definition(&definition).unwrap();

        definition.model_instance_id = Some("   ".into());
        assert!(validate_definition(&definition)
            .unwrap_err()
            .contains("must not be blank"));
    }

    #[test]
    fn rejects_cycles_and_unknown_workflow_edges() {
        let nodes = vec![node("one", "One", "First"), node("two", "Two", "Second")];
        assert!(
            validate_workflow(&nodes, &[edge("one", "two"), edge("two", "one")])
                .unwrap_err()
                .contains("acyclic")
        );
        assert!(validate_workflow(&nodes, &[edge("one", "missing")])
            .unwrap_err()
            .contains("unknown node"));
    }

    #[test]
    fn returns_parallel_topological_levels() {
        let nodes = vec![
            node("research", "Research", "Research"),
            node("audit", "Audit", "Audit"),
            node("deliver", "Deliver", "Deliver"),
        ];
        let levels = workflow_levels(
            &nodes,
            &[edge("research", "deliver"), edge("audit", "deliver")],
        )
        .unwrap();
        assert_eq!(levels, vec![vec!["research", "audit"], vec!["deliver"]]);
    }

    #[test]
    fn rejects_shared_workspace_stages_in_parallel_levels() {
        let nodes = vec![
            shared_node("write", "Write", "Write"),
            node("read", "Read", "Read"),
            node("deliver", "Deliver", "Deliver"),
        ];
        let error = validate_workflow(&nodes, &[edge("write", "deliver"), edge("read", "deliver")])
            .unwrap_err();
        assert!(error.contains("only node"));
    }

    #[test]
    fn validates_every_builtin_template() {
        for template in built_in_templates() {
            let mut definition = template.definition;
            definition.id = format!("test-{}", template.id);
            validate_definition(&definition).unwrap();
        }
    }
}
