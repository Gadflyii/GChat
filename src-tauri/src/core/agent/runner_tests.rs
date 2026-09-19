use std::time::Duration;

use hyper::StatusCode;
use tokio_util::sync::CancellationToken;

use super::path_policy::EditableRoots;
use super::runner::{run_turn, RunTurnInput};
use super::session::AgentSessionState;
use super::test_support::{
    collect_event, RecordingApproval, RecordingDesktop, RecordingFolderAccess,
    ScriptedGinferServer, ScriptedResponse, TestWorkspace,
};
use super::types::{AgentEvent, LoopLevel, ToolStatus};

struct TestRun {
    result: Result<(), String>,
    events: Vec<AgentEvent>,
    requests: Vec<serde_json::Value>,
    session: AgentSessionState,
}

#[tokio::test]
#[ignore = "requires a live endpoint and explicit saved definition; executes local read-only inventory"]
async fn live_saved_disk_inventory_execution() {
    use super::{definitions, ginfer_client::{GinferClient, GinferConnection, GinferSessionTarget}, prompt};
    let saved: serde_json::Value = serde_json::from_slice(&std::fs::read(
        std::env::var("GCHAT_LIVE_DEFINITIONS").expect("saved definitions path")
    ).unwrap()).unwrap();
    let definition: definitions::AgentDefinition = serde_json::from_value(saved["definitions"].as_array().unwrap()
        .iter().find(|d|d["id"]=="local-disk-free-space-inventory").unwrap().clone()).unwrap();
    let workspace = TestWorkspace::new();
    let registry = super::skills::SkillRegistry::load(workspace.path().join(".agent-skills"), &Default::default(), &Default::default()).unwrap();
    let caps = prompt::CapabilitiesSummary { platform:"win32".into(), arch:"x64".into(), browser_channel:"none".into(), working_dir:workspace.path().display().to_string(), has_clipboard:false, has_wmctrl:false, has_notifications:false };
    let persona = prompt::compose_agent_persona(&definition.instructions, &definition.output_contract);
    let prefix = prompt::build_stable_prefix(prompt::ITERATION_ONE_TOOLS, &[], &caps, 8, Some(&persona));
    let client = GinferClient::new(&GinferSessionTarget {
        connection:GinferConnection::Local { port:std::env::var("GCHAT_BUILDER_LIVE_PORT").unwrap().parse().unwrap(), api_key:std::env::var("GCHAT_BUILDER_LIVE_KEY").unwrap_or_default() },
        model_id:std::env::var("GCHAT_BUILDER_LIVE_MODEL").unwrap(), has_vision:false,
    }).unwrap();
    let mut session = AgentSessionState::new("live-disk-inventory");
    let mut events = Vec::new();
    run_turn(RunTurnInput {
        run_id:"live-disk-inventory",session_id:"live-disk-inventory",user_message:&definition.default_goal,
        selected_skill:None,stable_prefix:&prefix,reasoning_effort:definition.reasoning_effort,
        working_dir:workspace.path(),editable_roots:&EditableRoots::for_test(workspace.path()),external_read_only_roots:&[],trusted_read_roots:&[],max_steps:definition.max_steps,
        client:&client,approval:&RecordingApproval::allow(),folder_access:&RecordingFolderAccess::deny(),desktop:&RecordingDesktop::default(),cancellation:&CancellationToken::new(),session:&mut session,skill_registry:&registry,bundled_script_runtime:None,
    }, |event| { eprintln!("{}",serde_json::json!(event)); collect_event(&mut events,event) }).await.unwrap();
    let serialized = serde_json::to_value(&events).unwrap();
    assert!(!serialized.to_string().contains("max_steps"), "must finish within original step limit");
    assert!(events.iter().any(|event|matches!(event,AgentEvent::ToolCallExecuted{result} if matches!(result.call.tool.as_str(), "reply" | "finish") && result.outcome.status==ToolStatus::Ok && result.call.args["text"].as_str().is_some_and(|text|text.lines().any(|line|line.starts_with('C') && line.contains('%'))))));
    assert!(events.iter().any(|event|matches!(event,AgentEvent::ToolCallExecuted{result} if result.call.tool=="os.shell.run" && result.outcome.status==ToolStatus::Ok && result.outcome.summary.contains("C:"))));
    assert!(!events.iter().any(|event|matches!(event,AgentEvent::ToolCallExecuted{result} if result.call.tool=="os.fs.write")));
    eprintln!("LIVE_DISK_RESULT {}",serialized);
}

#[tokio::test]
#[ignore = "requires an explicitly selected live Muse endpoint; writes only temporary test definitions"]
async fn live_builder_clarification_validation_and_approved_save() {
    run_live_builder_case("standard", &[
        "Use Agent Builder to create a Standard agent that inventories GChat's locally installed .ginfer model files. Before creating it, ask me whether to include a combined total. Do not inventory anything now.",
        "Yes, include each file's size and the combined total. Use GChat's default local model directory from the catalog and the current model. Create the reusable agent definition now, without running its inventory task."
    ]).await;
}

#[tokio::test]
#[ignore = "requires an explicitly selected live Muse endpoint"]
async fn live_builder_goal_loop() {
    run_live_builder_case("goal_loop", &[
        "Use Agent Builder to create and save a Goal Loop agent named Release Note Reviewer. It reads release-notes.md in the selected workspace and drafts an improved release note in its reply, never changing files. The executor revises the draft; the evaluator checks clear user-facing language, explicit breaking changes, and preservation of every factual claim. Use at most 3 cycles, PASS only when all criteria hold, otherwise REVISE with specific feedback. Use the current model for both roles. Include a ready-to-run default goal. Create only the reusable definition, do not perform the review now."
    ]).await;
}

#[tokio::test]
#[ignore = "requires an explicitly selected live Muse endpoint"]
async fn live_builder_coordinator() {
    run_live_builder_case("coordinator", &[
        "Use Agent Builder to create and save a Coordinator agent named Documentation Review Team. It reviews README.md in the selected workspace without changing files. Use exactly two parallel specialist workers: one checks clarity for beginners, one checks internal consistency of commands and instructions. A coordinator assigns their independent reviews and a synthesizer returns one prioritized report. Set maximum parallel workers to 2. Use the current model for all roles, without a pool or specific instance. Include a ready-to-run default goal. Create only the reusable definition, do not review files now."
    ]).await;
}

#[tokio::test]
#[ignore = "requires an explicitly selected live Muse endpoint"]
async fn live_builder_workflow() {
    run_live_builder_case("workflow", &[
        "Use Agent Builder to create and save a Workflow agent named Documentation Checklist. Use exactly three sequential stages: inventory markdown files in the selected workspace; read those files and extract explicit TODO items; produce a grouped checklist citing source paths. Each stage depends on the previous stage (two dependency edges). Do not modify source files. Use the current model for every stage and include a ready-to-run default goal. Create only the reusable definition, do not inventory or read files now."
    ]).await;
}

async fn run_live_builder_case(kind: &str, messages: &[&str]) {
    use super::{definitions, ginfer_client::{GinferClient, GinferConnection, GinferSessionTarget}, tools::DesktopServices};
    use serde_json::{json, Value};
    struct LiveStudio(std::path::PathBuf);
    #[async_trait::async_trait]
    impl DesktopServices for LiveStudio {
        async fn studio(&self, action: &str, args: Value) -> Result<Value, String> {
            match action {
                "catalog" => Ok(json!({"templates":definitions::built_in_templates(),"definitions":[],"instances":[],"pools":[],"localModelDirectory":r"C:\Users\Ron\AppData\Roaming\GChat\data\ginfer\models","definitionSchema":definitions::definition_json_schema()})),
                "validate_definition" => { let definition = serde_json::from_value(args).map_err(|e|e.to_string())?; definitions::validate_definition(&definition)?; Ok(json!({"valid":true})) },
                "save_definition" => Ok(json!(definitions::save_definition(&self.0, serde_json::from_value(args).map_err(|e|e.to_string())?)?)),
                _ => Err(format!("Unexpected operation: {action}")),
            }
        }
        async fn write_clipboard(&self, _: String) -> Result<(), String> { Err("Not allowed in authoring".into()) }
        async fn notify(&self, _: String, _: String) -> Result<(), String> { Err("Not allowed in authoring".into()) }
    }
    let port = std::env::var("GCHAT_BUILDER_LIVE_PORT").expect("explicit endpoint port").parse().unwrap();
    let client = GinferClient::new(&GinferSessionTarget {
        connection: GinferConnection::Local { port, api_key:std::env::var("GCHAT_BUILDER_LIVE_KEY").unwrap_or_default() },
        model_id:std::env::var("GCHAT_BUILDER_LIVE_MODEL").expect("explicit model identity"), has_vision:false,
    }).unwrap();
    let workspace = TestWorkspace::new();
    workspace.write(".agent-skills/agent-builder/SKILL.md", include_str!("../../../resources/agent-skills/agent-builder/SKILL.md"));
    let registry = super::skills::SkillRegistry::load(workspace.path().join(".agent-skills"), &std::collections::BTreeSet::new(), &super::prompt::ITERATION_ONE_TOOLS.iter().map(|tool|tool.name.to_owned()).collect()).unwrap();
    let mut session = AgentSessionState::new("live-builder-test");
    let approval = RecordingApproval::allow();
    let mut events = Vec::new();
    eprintln!("LIVE_CASE {kind}");
    for (index, message) in messages.iter().enumerate() {
        run_turn(RunTurnInput {
            run_id:"live-builder-test",session_id:"live-builder-test",user_message:message,selected_skill:Some("agent-builder"),stable_prefix:"",reasoning_effort:Some(definitions::AgentReasoningEffort::High),
            working_dir:workspace.path(),editable_roots:&EditableRoots::for_test(workspace.path()),external_read_only_roots:&[],trusted_read_roots:&[],max_steps:8,
            client:&client,approval:&approval,folder_access:&RecordingFolderAccess::deny(),desktop:&LiveStudio(workspace.path().to_owned()),cancellation:&CancellationToken::new(),session:&mut session,skill_registry:&registry,bundled_script_runtime:None,
        }, |event| { eprintln!("{}", json!(event)); collect_event(&mut events,event) }).await.unwrap();
        if messages.len() > 1 && index == 0 { assert!(approval.requests().is_empty(), "must clarify before save"); }
    }
    let saved = definitions::list_definitions(workspace.path()).unwrap().into_iter().filter(|d|!d.built_in).collect::<Vec<_>>();
    assert_eq!(saved.len(),1);
    assert_eq!(json!(saved[0])["kind"], kind);
    match &saved[0].strategy {
        definitions::AgentStrategy::GoalLoop { max_cycles, success_criteria, evaluator_instructions, .. } => {
            assert_eq!(*max_cycles, 3);
            assert!(!success_criteria.trim().is_empty() && !evaluator_instructions.trim().is_empty());
        }
        definitions::AgentStrategy::Coordinator { max_parallel, workers, .. } => {
            assert_eq!(*max_parallel, 2);
            assert_eq!(workers.len(), 2);
            assert!(workers.iter().all(|worker| worker.model_instance_id.is_none()));
        }
        definitions::AgentStrategy::Workflow { nodes, edges } => {
            assert_eq!(nodes.len(), 3);
            assert_eq!(edges.len(), 2);
            assert!(nodes.iter().all(|node| node.model_instance_id.is_none()));
        }
        definitions::AgentStrategy::Standard => {}
    }
    assert!(!saved[0].default_goal.trim().is_empty());
    assert!(saved[0].model_instance_id.is_none());
    assert_eq!(approval.requests().len(),1);
    assert!(events.iter().any(|e| matches!(e, AgentEvent::ToolCallExecuted { result } if result.call.tool == "studio.inspect" && result.call.args["action"] == "validate_definition" && result.outcome.status == ToolStatus::Ok)));
    assert!(!events.iter().any(|e| matches!(e, AgentEvent::ToolCallExecuted { result } if result.call.tool.starts_with("os."))));
    eprintln!("LIVE_SAVED_DEFINITION {}",json!(saved[0]));
}

#[tokio::test]
async fn builder_inventory_definition_is_saved_only_after_confirmation() {
    use super::definitions;
    use super::tools::DesktopServices;
    use serde_json::{json, Value};

    struct StudioDesktop(std::path::PathBuf);
    #[async_trait::async_trait]
    impl DesktopServices for StudioDesktop {
        async fn studio(&self, action: &str, args: Value) -> Result<Value, String> {
            match action {
                "catalog" => Ok(json!({"templates": definitions::built_in_templates()})),
                "validate_definition" => {
                    let definition = serde_json::from_value(args).map_err(|e| e.to_string())?;
                    definitions::validate_definition(&definition)?;
                    Ok(json!({"valid": true}))
                }
                "save_definition" => {
                    let definition = serde_json::from_value(args).map_err(|e| e.to_string())?;
                    Ok(json!(definitions::save_definition(&self.0, definition)?))
                }
                _ => Err("Unsupported Studio action".into()),
            }
        }
        async fn write_clipboard(&self, _: String) -> Result<(), String> { Err("Unavailable".into()) }
        async fn notify(&self, _: String, _: String) -> Result<(), String> { Err("Unavailable".into()) }
    }

    for approved in [false, true] {
        let workspace = TestWorkspace::new();
        workspace.write(".agent-skills/agent-builder/SKILL.md", include_str!("../../../resources/agent-skills/agent-builder/SKILL.md"));
        let mut definition = definitions::general_agent();
        definition.id = "local-model-inventory".into();
        definition.name = "Local model inventory".into();
        definition.built_in = false;
        definition.default_goal = "List installed local models with file sizes.".into();
        definition.instructions = "Inspect local installed models and report their file sizes without modifying files.".into();
        let wrapped = json!({"definition":definition}).to_string();
        let save = format!(r#"<atem:function_calls><atem:invoke name="studio_manage.studio_manage"><atem:parameter name="action">save_definition</atem:parameter><atem:parameter name="args">{wrapped}</atem:parameter></atem:invoke></atem:function_calls>"#);
        let server = ScriptedGinferServer::start(vec![
            ScriptedResponse::completion("<|message|>Should the inventory include a combined total?"),
            ScriptedResponse::completion(r#"[{"tool":"studio.inspect","args":{"action":"catalog","args":{}}}]"#),
            ScriptedResponse::tool_call("studio_inspect", json!({"action":"validate_definition","args":wrapped})),
            ScriptedResponse::completion(&save),
            ScriptedResponse::completion(r#"[{"tool":"reply","args":{"text":"Review complete."}}]"#),
        ]).await;
        let approval = if approved { RecordingApproval::allow() } else { RecordingApproval::deny() };
        let mut session = AgentSessionState::new("builder-save");
        let registry = super::skills::SkillRegistry::load(workspace.path().join(".agent-skills"), &std::collections::BTreeSet::new(), &super::prompt::ITERATION_ONE_TOOLS.iter().map(|tool| tool.name.to_owned()).collect()).unwrap();
        let mut events = Vec::new();
        run_turn(RunTurnInput {
            run_id: "builder-clarify", session_id: "builder-save", user_message: "Build an inventory agent", selected_skill: Some("agent-builder"), stable_prefix: "Do not ask for confirmation unless a tool is approval-gated", reasoning_effort: None,
            working_dir: workspace.path(), editable_roots: &EditableRoots::for_test(workspace.path()), external_read_only_roots: &[], trusted_read_roots: &[], max_steps: 4,
            client: &server.client(), approval: &approval, folder_access: &RecordingFolderAccess::deny(), desktop: &StudioDesktop(workspace.path().to_owned()), cancellation: &CancellationToken::new(), session: &mut session,
            skill_registry: &registry, bundled_script_runtime: None,
        }, |event| collect_event(&mut events, event)).await.unwrap();
        assert!(events.iter().any(|event| matches!(event, AgentEvent::AssistantReply { text } if text == "Should the inventory include a combined total?")));
        assert!(approval.requests().is_empty());
        assert!(!server.requests()[0].to_string().contains("Do not ask for confirmation"));
        run_turn(RunTurnInput {
            run_id: "builder-save", session_id: "builder-save", user_message: "Yes, include the combined total for local models", selected_skill: Some("agent-builder"), stable_prefix: "Author a definition", reasoning_effort: None,
            working_dir: workspace.path(), editable_roots: &EditableRoots::for_test(workspace.path()), external_read_only_roots: &[], trusted_read_roots: &[], max_steps: 4,
            client: &server.client(), approval: &approval, folder_access: &RecordingFolderAccess::deny(), desktop: &StudioDesktop(workspace.path().to_owned()), cancellation: &CancellationToken::new(), session: &mut session,
            skill_registry: &registry, bundled_script_runtime: None,
        }, |event| collect_event(&mut events, event)).await.unwrap();
        let saved = definitions::list_definitions(workspace.path()).unwrap();
        assert_eq!(saved.iter().any(|item| item.id == definition.id), approved);
        assert_eq!(approval.requests().len(), 1);
        assert_eq!(server.requests().len(), 5, "clarification and known wire forms need no repair calls");
        assert!(server.requests()[1].to_string().contains("Should the inventory include a combined total?"));
        assert!(server.requests()[2]["messages"].as_array().unwrap().iter().any(|message|
            message["content"].as_str().is_some_and(|content| content.contains("\"templates\""))));
        assert!(!workspace.path().join("inventory.txt").exists());
    }
}

#[tokio::test]
async fn output_exhaustion_gets_one_larger_retry_not_a_small_json_repair() {
    let run = run_script(&TestWorkspace::new(), vec![
        ScriptedResponse::completion("").with_finish_reason("output_limit"),
        ScriptedResponse::completion(r#"[{"tool":"reply","args":{"text":"ready"}}]"#),
    ], &RecordingApproval::deny(), &CancellationToken::new(), 2).await;
    run.result.unwrap();
    assert_eq!(run.requests.len(), 2);
    assert!(run.requests[1]["max_tokens"].as_u64().unwrap() > run.requests[0]["max_tokens"].as_u64().unwrap());
    assert_eq!(run.requests[0]["reasoning_effort"], run.requests[1]["reasoning_effort"]);
    assert!(!request_prompt(&run.requests[1]).contains("tool-call-repair"));
}

#[tokio::test]
async fn repeated_output_exhaustion_is_reported_without_executing_partial_calls() {
    let run = run_script(&TestWorkspace::new(), vec![
        ScriptedResponse::completion("").with_finish_reason("output_limit"),
        ScriptedResponse::completion(r#"[{"tool":"reply","args":{"text":"unfinished"}}]"#).with_finish_reason("output_limit"),
    ], &RecordingApproval::deny(), &CancellationToken::new(), 2).await;
    assert_eq!(run.requests.len(), 2);
    assert!(run.events.iter().any(|event| matches!(event, AgentEvent::StepError { category, .. } if category == "output_budget")));
    assert!(!run.events.iter().any(|event| matches!(event, AgentEvent::ToolCallExecuted { .. })));
}

#[tokio::test]
async fn builder_cannot_execute_the_inventory_it_is_asked_to_define() {
    let workspace = TestWorkspace::new();
    workspace.write(".agent-skills/agent-builder/SKILL.md", include_str!("../../../resources/agent-skills/agent-builder/SKILL.md"));
    let server = ScriptedGinferServer::start(vec![
        ScriptedResponse::completion(r#"[{"tool":"os.fs.write","args":{"path":"inventory.txt","content":"must not happen"}}]"#),
        ScriptedResponse::completion(r#"[{"tool":"reply","args":{"text":"Should the inventory include remote hosts or only this computer?"}}]"#),
    ]).await;
    let mut session = AgentSessionState::new("builder");
    let registry = super::skills::SkillRegistry::load(workspace.path().join(".agent-skills"), &std::collections::BTreeSet::new(), &super::prompt::ITERATION_ONE_TOOLS.iter().map(|tool| tool.name.to_owned()).collect()).unwrap();
    let mut events = Vec::new();
    run_turn(RunTurnInput {
        run_id: "builder", session_id: "builder", user_message: "Build a model inventory agent", selected_skill: Some("agent-builder"), stable_prefix: "Author a definition", reasoning_effort: None,
        working_dir: workspace.path(), editable_roots: &EditableRoots::for_test(workspace.path()), external_read_only_roots: &[], trusted_read_roots: &[], max_steps: 3,
        client: &server.client(), approval: &RecordingApproval::allow(), folder_access: &RecordingFolderAccess::deny(), desktop: &RecordingDesktop::default(), cancellation: &CancellationToken::new(), session: &mut session,
        skill_registry: &registry, bundled_script_runtime: None,
    }, |event| collect_event(&mut events, event)).await.unwrap();
    assert!(!workspace.path().join("inventory.txt").exists());
    assert!(events.iter().any(|event| matches!(event, AgentEvent::ToolCallExecuted { result } if result.outcome.status == ToolStatus::Denied)));
    let requests = server.requests();
    assert_eq!(requests[0]["messages"][0]["role"], "system");
    assert!(requests[0]["tools"].as_array().unwrap().iter().all(|tool| !tool["function"]["name"].as_str().unwrap().starts_with("os_")));
}

#[tokio::test]
async fn manual_worker_checkpoint_preserves_tool_step_budget_and_full_outputs() {
    let workspace = TestWorkspace::new();
    workspace.write("a.txt", "first result");
    workspace.write("b.txt", "second result");
    let server = ScriptedGinferServer::start(vec![
        ScriptedResponse::completion(r#"[{"tool":"os.fs.read","args":{"path":"a.txt"}}]"#),
        ScriptedResponse::completion("## Completed work\nEarlier file operations completed.\n## Pending work\nContinue the current task."),
        ScriptedResponse::completion(r#"[{"tool":"os.fs.read","args":{"path":"b.txt"}}]"#),
    ]).await;
    let mut session = AgentSessionState::new("test-session");
    session.push_user("Previous task");
    for _ in 0..3 {
        session.push_tool_observations(
            &[super::types::ToolCallPayload {
                tool: "os.fs.write".into(),
                args: serde_json::json!({"path":"old.txt", "content":"x".repeat(2000)}),
            }],
            &[super::types::ToolOutcome::ok("written")],
        );
    }
    let archive = workspace.path().join("archive");
    let roots = EditableRoots::new(workspace.path(), &[]).await.unwrap();
    let client = server.client();
    let skills = workspace.skill_registry();
    let mut events = Vec::new();
    let mut requested = false;
    let result = super::runner::run_turn_with_options(
        RunTurnInput {
            run_id: "test-run",
            session_id: "test-session",
            user_message: "Read both files, preserving this goal",
            selected_skill: None,
            stable_prefix: "TEST",
            reasoning_effort: None,
            working_dir: workspace.path(),
            editable_roots: &roots,
            external_read_only_roots: &[],
            trusted_read_roots: &[],
            max_steps: 2,
            client: &client,
            approval: &RecordingApproval::allow(),
            folder_access: &RecordingFolderAccess::deny(),
            desktop: &RecordingDesktop::default(),
            cancellation: &CancellationToken::new(),
            session: &mut session,
            skill_registry: &skills,
            bundled_script_runtime: None,
        },
        super::runner::RunTurnOptions {
            max_output_tokens: None,
            additional_skills: &[],
            archive_dir: Some(&archive),
        },
        |event| {
            if let AgentEvent::ContextStatus {
                context_id, status, ..
            } = &event
            {
                if status == "ready" && !requested {
                    super::context::request_compaction(context_id)?;
                    requested = true;
                }
            }
            events.push(event);
            Ok(())
        },
    )
    .await
    .unwrap();
    assert_eq!(result.reason, "max_steps");
    assert_eq!(result.step_count, 2);
    assert_eq!(server.requests().len(), 3);
    assert_eq!(executed(&events).len(), 2);
    assert!(events
        .iter()
        .any(|event| matches!(event, AgentEvent::ContextStatus { compactions: 1, .. })));
    assert!(request_prompt(&server.requests()[2]).contains("Read both files, preserving this goal"));
    let transcript = workspace.read("archive/transcript.jsonl");
    let records = String::from_utf8(transcript)
        .unwrap()
        .lines()
        .map(|line| serde_json::from_str::<serde_json::Value>(line).unwrap())
        .collect::<Vec<_>>();
    assert_eq!(records.iter().filter(|v| v["type"] == "tool").count(), 2);
    let full: serde_json::Value =
        serde_json::from_slice(&workspace.read("archive/step-0-tool-0.json")).unwrap();
    assert_eq!(full["call"]["args"]["path"], "a.txt");
    assert_eq!(records.last().unwrap()["reason"], "max_steps");
    let saved: AgentSessionState =
        serde_json::from_slice(&workspace.read("archive/working-state.json")).unwrap();
    assert_eq!(saved, session);
}

fn request_prompt(request: &serde_json::Value) -> &str {
    request
        .pointer("/messages/0/content")
        .and_then(serde_json::Value::as_str)
        .expect("GInfer chat-completions prompt")
}

async fn run_script(
    workspace: &TestWorkspace,
    responses: Vec<ScriptedResponse>,
    approval: &RecordingApproval,
    cancellation: &CancellationToken,
    max_steps: u32,
) -> TestRun {
    let server = ScriptedGinferServer::start(responses).await;
    let client = server.client();
    let desktop = RecordingDesktop::default();
    let mut events = Vec::new();
    let mut session = AgentSessionState::new("test-session");
    let skill_registry = workspace.skill_registry();
    let editable_roots = EditableRoots::new(workspace.path(), &[]).await.unwrap();
    let folder_access = RecordingFolderAccess::deny();
    let result = run_turn(
        RunTurnInput {
            run_id: "test-run",
            session_id: "test-session",
            user_message: "perform the fixture task",
            selected_skill: None,
            stable_prefix: "TEST_STABLE_PREFIX",
            reasoning_effort: None,
            working_dir: workspace.path(),
            editable_roots: &editable_roots,
            external_read_only_roots: &[],
            trusted_read_roots: &[],
            max_steps,
            client: &client,
            approval,
            folder_access: &folder_access,
            desktop: &desktop,
            cancellation,
            session: &mut session,
            skill_registry: &skill_registry,
            bundled_script_runtime: None,
        },
        |event| collect_event(&mut events, event),
    )
    .await;
    TestRun {
        result,
        events,
        requests: server.requests(),
        session,
    }
}

fn event_kind(event: &AgentEvent) -> &'static str {
    match event {
        AgentEvent::ContextStatus { .. } => "context_status",
        AgentEvent::StageQueued { .. } => "stage_queued",
        AgentEvent::StageActivity { .. } => "stage_activity",
        AgentEvent::InferenceMeasured { .. } => "inference_measured",
        AgentEvent::TurnStarted { .. } => "turn_started",
        AgentEvent::OrchestrationStarted { .. } => "orchestration_started",
        AgentEvent::StageStarted { .. } => "stage_started",
        AgentEvent::StageFinished { .. } => "stage_finished",
        AgentEvent::Handoff { .. } => "handoff",
        AgentEvent::StepStarted { .. } => "step_started",
        AgentEvent::ReasoningDelta { .. } => "reasoning_delta",
        AgentEvent::AssistantDelta { .. } => "assistant_delta",
        AgentEvent::ToolCallParsed { .. } => "tool_call_parsed",
        AgentEvent::ToolCallExecuted { .. } => "tool_call_executed",
        AgentEvent::ApprovalRequested { .. } => "approval_requested",
        AgentEvent::FolderAccessRequested { .. } => "folder_access_requested",
        AgentEvent::LoopDetected { .. } => "loop_detected",
        AgentEvent::ParseRetry { .. } => "parse_retry",
        AgentEvent::BatchTrimmed { .. } => "batch_trimmed",
        AgentEvent::AssistantReply { .. } => "assistant_reply",
        AgentEvent::StepError { .. } => "step_error",
        AgentEvent::TurnFinished { .. } => "turn_finished",
    }
}

fn finished_reason(events: &[AgentEvent]) -> Option<(&str, u32)> {
    events.iter().rev().find_map(|event| match event {
        AgentEvent::TurnFinished { reason, step_count } => Some((reason.as_str(), *step_count)),
        _ => None,
    })
}

fn executed(events: &[AgentEvent]) -> Vec<(&str, ToolStatus)> {
    events
        .iter()
        .filter_map(|event| match event {
            AgentEvent::ToolCallExecuted { result } => {
                Some((result.call.tool.as_str(), result.outcome.status))
            }
            _ => None,
        })
        .collect()
}

#[tokio::test]
async fn immediate_reply_preserves_event_order_and_completion_contract() {
    let workspace = TestWorkspace::new();
    let approval = RecordingApproval::deny();
    let cancellation = CancellationToken::new();
    let run = run_script(
        &workspace,
        vec![ScriptedResponse::completion(
            r#"[{"tool":"reply","args":{"text":"done"}}]"#,
        )],
        &approval,
        &cancellation,
        3,
    )
    .await;

    assert!(run.result.is_ok());
    assert_eq!(
        run.events.iter().map(event_kind).collect::<Vec<_>>(),
        [
            "turn_started",
            "step_started",
            "context_status",
            "inference_measured",
            "tool_call_parsed",
            "tool_call_executed",
            "assistant_delta",
            "assistant_reply",
            "turn_finished"
        ]
    );
    assert_eq!(finished_reason(&run.events), Some(("reply", 1)));
    assert_eq!(run.requests.len(), 1);
    let request = &run.requests[0];
    assert_eq!(request["model"], "scripted-test-model");
    assert_eq!(request["tool_choice"], "required");
    assert!(request["tools"]
        .as_array()
        .is_some_and(|tools| !tools.is_empty()));
    assert!(request.get("cache_prompt").is_none());
    assert!(request.get("slot_id").is_none());
    assert!(request.get("grammar").is_none());
    assert!(request_prompt(request)
        .contains("Current task (preserve verbatim):\nperform the fixture task"));
}

#[tokio::test]
async fn reasoning_effort_and_native_reasoning_use_ginfer_contract() {
    let workspace = TestWorkspace::new();
    let server = ScriptedGinferServer::start(vec![ScriptedResponse::reasoning_completion(
        r#"[{"tool":"reply","args":{"text":"done"}}]"#,
        "inspect first",
    )])
    .await;
    let client = server.client();
    let desktop = RecordingDesktop::default();
    let approval = RecordingApproval::deny();
    let cancellation = CancellationToken::new();
    let mut events = Vec::new();
    let mut session = AgentSessionState::new("gemma-session");
    let skill_registry = workspace.skill_registry();
    let editable_roots = EditableRoots::for_test(workspace.path());
    let folder_access = RecordingFolderAccess::deny();

    let result = run_turn(
        RunTurnInput {
            run_id: "gemma-run",
            session_id: "gemma-session",
            user_message: "perform the fixture task",
            selected_skill: None,
            stable_prefix: "TEST_STABLE_PREFIX",
            reasoning_effort: Some(super::definitions::AgentReasoningEffort::High),
            working_dir: workspace.path(),
            editable_roots: &editable_roots,
            external_read_only_roots: &[],
            trusted_read_roots: &[],
            max_steps: 1,
            client: &client,
            approval: &approval,
            folder_access: &folder_access,
            desktop: &desktop,
            cancellation: &cancellation,
            session: &mut session,
            skill_registry: &skill_registry,
            bundled_script_runtime: None,
        },
        |event| collect_event(&mut events, event),
    )
    .await;

    assert!(result.is_ok());
    let request = &server.requests()[0];
    assert_eq!(request["reasoning_effort"], "high");
    assert!(request.get("grammar").is_none());
    assert!(events.iter().any(|event| matches!(
        event,
        AgentEvent::ReasoningDelta { text, .. } if text == "inspect first"
    )));
    assert_eq!(finished_reason(&events), Some(("reply", 1)));
}

#[tokio::test]
async fn read_observation_is_visible_to_the_next_completion() {
    let workspace = TestWorkspace::new();
    workspace.write("fixture.txt", "SENTINEL_READ_73");
    let run = run_script(
        &workspace,
        vec![
            ScriptedResponse::completion(
                r#"[{"tool":"os.fs.read","args":{"path":"fixture.txt"}}]"#,
            ),
            ScriptedResponse::completion(r#"[{"tool":"reply","args":{"text":"observed"}}]"#),
        ],
        &RecordingApproval::deny(),
        &CancellationToken::new(),
        3,
    )
    .await;

    assert!(run.result.is_ok());
    assert_eq!(
        executed(&run.events),
        [("os.fs.read", ToolStatus::Ok), ("reply", ToolStatus::Ok)]
    );
    assert!(request_prompt(&run.requests[1]).contains("SENTINEL_READ_73"));
}

#[tokio::test]
async fn muse_atem_call_executes_instead_of_becoming_a_plain_text_reply() {
    let workspace = TestWorkspace::new();
    workspace.write("atem-visible.txt", "VISIBLE");
    let run = run_script(
        &workspace,
        vec![
            ScriptedResponse::completion(
                r#"atem:function_calls <atem:invoke name="os.fs.list"> <atem:parameter name="path">.</atem:parameter> </atem:invoke> </atem:function_calls>"#,
            ),
            ScriptedResponse::completion(r#"[{"tool":"reply","args":{"text":"observed"}}]"#),
        ],
        &RecordingApproval::deny(),
        &CancellationToken::new(),
        3,
    )
    .await;

    assert!(run.result.is_ok());
    assert_eq!(
        executed(&run.events),
        [("os.fs.list", ToolStatus::Ok), ("reply", ToolStatus::Ok)]
    );
    assert_eq!(run.requests.len(), 2, "ATEM must not trigger a repair call");
    assert!(request_prompt(&run.requests[1]).contains("atem-visible.txt"));
}

#[tokio::test]
async fn verbose_observation_is_compact_for_the_model_but_detailed_in_the_event() {
    let workspace = TestWorkspace::new();
    let detailed = (0..30)
        .map(|index| format!("EVENT_DETAIL_LINE_{index:02}"))
        .collect::<Vec<_>>()
        .join("\n");
    workspace.write("verbose.txt", &detailed);
    let run = run_script(
        &workspace,
        vec![
            ScriptedResponse::completion(
                r#"[{"tool":"os.fs.read","args":{"path":"verbose.txt"}}]"#,
            ),
            ScriptedResponse::completion(r#"[{"tool":"reply","args":{"text":"observed"}}]"#),
        ],
        &RecordingApproval::deny(),
        &CancellationToken::new(),
        3,
    )
    .await;

    assert!(run.result.is_ok());
    let event_summary = run
        .events
        .iter()
        .find_map(|event| match event {
            AgentEvent::ToolCallExecuted { result } if result.call.tool == "os.fs.read" => {
                Some(result.outcome.summary.as_str())
            }
            _ => None,
        })
        .expect("read execution event");
    assert_eq!(event_summary, detailed);
    let next_prompt = request_prompt(&run.requests[1]);
    assert!(next_prompt.contains("… [omitted 18 lines]"));
    assert!(next_prompt.contains("EVENT_DETAIL_LINE_29"));
    assert!(!next_prompt.contains("EVENT_DETAIL_LINE_00"));
}

#[tokio::test]
async fn sequential_runs_share_the_session_transcript() {
    let workspace = TestWorkspace::new();
    workspace.write("fixture.txt", "DURABLE_OBSERVATION");
    let server = ScriptedGinferServer::start(vec![
        ScriptedResponse::completion(r#"[{"tool":"os.fs.read","args":{"path":"fixture.txt"}}]"#),
        ScriptedResponse::completion(r#"[{"tool":"reply","args":{"text":"first reply"}}]"#),
        ScriptedResponse::completion(r#"[{"tool":"reply","args":{"text":"second reply"}}]"#),
    ])
    .await;
    let client = server.client();
    let approval = RecordingApproval::deny();
    let desktop = RecordingDesktop::default();
    let cancellation = CancellationToken::new();
    let mut session = AgentSessionState::new("shared-session");
    let skill_registry = workspace.skill_registry();
    let editable_roots = EditableRoots::for_test(workspace.path());
    let folder_access = RecordingFolderAccess::deny();

    for (run_id, user_message) in [("run-1", "first user"), ("run-2", "second user")] {
        run_turn(
            RunTurnInput {
                run_id,
                session_id: "shared-session",
                user_message,
                selected_skill: None,
                stable_prefix: "TEST_STABLE_PREFIX",
                reasoning_effort: None,
                working_dir: workspace.path(),
                editable_roots: &editable_roots,
                external_read_only_roots: &[],
                trusted_read_roots: &[],
                max_steps: 3,
                client: &client,
                approval: &approval,
                folder_access: &folder_access,
                desktop: &desktop,
                cancellation: &cancellation,
                session: &mut session,
                skill_registry: &skill_registry,
                bundled_script_runtime: None,
            },
            |_| Ok(()),
        )
        .await
        .expect("run shared session turn");
    }

    assert_eq!(session.turn_count, 2);
    let requests = server.requests();
    assert!({
        let prompt = request_prompt(&requests[2]);
        prompt.contains("USER: first user")
            && prompt.contains("DURABLE_OBSERVATION")
            && prompt.contains("ASSISTANT: first reply")
            && prompt.contains("USER: second user")
    });
}

#[tokio::test]
async fn pure_reads_complete_before_the_tail_terminal() {
    let workspace = TestWorkspace::new();
    workspace.write("a.txt", "ALPHA");
    workspace.write("b.txt", "BETA");
    let run = run_script(
        &workspace,
        vec![ScriptedResponse::completion(
            r#"[
                {"tool":"os.fs.read","args":{"path":"a.txt"}},
                {"tool":"os.fs.read","args":{"path":"b.txt"}},
                {"tool":"reply","args":{"text":"both read"}}
            ]"#,
        )],
        &RecordingApproval::deny(),
        &CancellationToken::new(),
        2,
    )
    .await;

    assert!(run.result.is_ok());
    let executions = run
        .events
        .iter()
        .filter_map(|event| match event {
            AgentEvent::ToolCallExecuted { result } => Some((
                result.call.tool.as_str(),
                result.batch_index,
                result.batch_size,
            )),
            _ => None,
        })
        .collect::<Vec<_>>();
    assert_eq!(
        executions,
        [("os.fs.read", 0, 3), ("os.fs.read", 1, 3), ("reply", 2, 3)]
    );
    assert_eq!(finished_reason(&run.events), Some(("reply", 1)));
}

#[tokio::test]
async fn safe_write_changes_the_workspace_without_approval() {
    let workspace = TestWorkspace::new();
    let approval = RecordingApproval::allow();
    let run = run_script(
        &workspace,
        vec![
            ScriptedResponse::completion(
                r#"[{"tool":"os.fs.write","args":{"path":"written.txt","content":"EXACT_BYTES"}}]"#,
            ),
            ScriptedResponse::completion(r#"[{"tool":"reply","args":{"text":"done"}}]"#),
        ],
        &approval,
        &CancellationToken::new(),
        3,
    )
    .await;

    assert!(run.result.is_ok());
    assert_eq!(workspace.read("written.txt"), b"EXACT_BYTES");
    assert!(approval.requests().is_empty());
    assert_eq!(executed(&run.events)[0].1, ToolStatus::Ok);
}

#[tokio::test]
async fn safe_write_is_not_blocked_by_a_denied_approval_policy() {
    let workspace = TestWorkspace::new();
    let approval = RecordingApproval::deny();
    let run = run_script(
        &workspace,
        vec![
            ScriptedResponse::completion(
                r#"[{"tool":"os.fs.write","args":{"path":"denied.txt","content":"forbidden"}}]"#,
            ),
            ScriptedResponse::completion(r#"[{"tool":"reply","args":{"text":"denied"}}]"#),
        ],
        &approval,
        &CancellationToken::new(),
        3,
    )
    .await;

    assert!(run.result.is_ok());
    assert_eq!(workspace.read("denied.txt"), b"forbidden");
    assert!(approval.requests().is_empty());
    assert_eq!(executed(&run.events)[0].1, ToolStatus::Ok);
}

#[tokio::test]
async fn malformed_completion_is_repaired_once() {
    let workspace = TestWorkspace::new();
    let run = run_script(
        &workspace,
        vec![
            ScriptedResponse::completion("not-json"),
            ScriptedResponse::completion(r#"[{"tool":"reply","args":{"text":"repaired"}}]"#),
        ],
        &RecordingApproval::deny(),
        &CancellationToken::new(),
        2,
    )
    .await;

    assert!(run.result.is_ok());
    assert_eq!(finished_reason(&run.events), Some(("reply", 1)));
    assert_eq!(
        run.events
            .iter()
            .filter(|event| matches!(event, AgentEvent::ParseRetry { .. }))
            .count(),
        1
    );
    assert_eq!(run.requests.len(), 2);
    assert_eq!(run.requests[0]["max_tokens"], 8192);
    assert_eq!(run.requests[1]["max_tokens"], run.requests[0]["max_tokens"]);
    assert!(request_prompt(&run.requests[1]).contains("### tool-call-repair"));
}

#[tokio::test]
async fn bare_reply_clarification_is_published_without_repair_or_execution() {
    let workspace = TestWorkspace::new();
    let question = r#"Where are your local .ginfer model objects? e.g. C:\Users\Ron\models"#;
    let output = serde_json::json!({"text": question}).to_string();
    for needs_repair in [false, true] {
        let mut responses = Vec::new();
        if needs_repair {
            responses.push(ScriptedResponse::completion("not-json"));
        }
        responses.push(ScriptedResponse::completion(&output));
        let approval = RecordingApproval::deny();
        let run = run_script(&workspace, responses, &approval, &CancellationToken::new(), 2).await;
        assert!(run.result.is_ok());
        assert_eq!(run.requests.len(), if needs_repair { 2 } else { 1 });
        assert!(approval.requests().is_empty());
        assert_eq!(finished_reason(&run.events), Some(("reply", 1)));
        assert_eq!(run.events.iter().find_map(|event| match event {
            AgentEvent::AssistantReply { text } => Some(text.as_str()),
            _ => None,
        }), Some(question));
    }
}

#[tokio::test]
async fn repaired_plain_text_becomes_a_terminal_reply() {
    let workspace = TestWorkspace::new();
    let run = run_script(
        &workspace,
        vec![
            ScriptedResponse::completion("not-json"),
            ScriptedResponse::completion("The requested work is complete."),
        ],
        &RecordingApproval::deny(),
        &CancellationToken::new(),
        2,
    )
    .await;

    assert!(run.result.is_ok());
    assert_eq!(
        run.events.iter().find_map(|event| match event {
            AgentEvent::AssistantReply { text } => Some(text.as_str()),
            _ => None,
        }),
        Some("The requested work is complete.")
    );
    assert_eq!(finished_reason(&run.events), Some(("reply", 1)));
}

#[tokio::test]
async fn timed_out_completion_is_repaired_once() {
    let workspace = TestWorkspace::new();
    let run = run_script(
        &workspace,
        vec![
            ScriptedResponse::completion("late").delayed(Duration::from_millis(250)),
            ScriptedResponse::completion(r#"[{"tool":"reply","args":{"text":"repaired"}}]"#),
        ],
        &RecordingApproval::deny(),
        &CancellationToken::new(),
        2,
    )
    .await;

    assert!(run.result.is_ok());
    assert_eq!(finished_reason(&run.events), Some(("reply", 1)));
    assert!(run.events.iter().any(|event| matches!(
        event,
        AgentEvent::ParseRetry { reason, .. }
            if reason.contains("600-second deadline")
    )));
    assert_eq!(run.requests.len(), 2);
    assert_eq!(run.requests[1]["max_tokens"], run.requests[0]["max_tokens"]);
    assert_eq!(run.requests[0]["tools"], run.requests[1]["tools"]);
}

#[tokio::test]
async fn timed_out_completion_and_repair_finish_as_timeout_failure() {
    let workspace = TestWorkspace::new();
    let run = run_script(
        &workspace,
        vec![
            ScriptedResponse::completion("late").delayed(Duration::from_millis(250)),
            ScriptedResponse::completion("also late").delayed(Duration::from_millis(250)),
        ],
        &RecordingApproval::deny(),
        &CancellationToken::new(),
        2,
    )
    .await;

    assert!(run.result.is_err());
    assert!(run.events.iter().any(|event| matches!(
        event,
        AgentEvent::StepError { category, message }
            if category == "timeout" && message.contains("600-second deadline")
    )));
    assert_eq!(finished_reason(&run.events), Some(("failed", 1)));
    assert_eq!(run.requests.len(), 2);
}

#[tokio::test]
async fn repeated_repair_failure_finishes_as_tool_call_failure() {
    let workspace = TestWorkspace::new();
    let run = run_script(
        &workspace,
        vec![
            ScriptedResponse::completion("not-json"),
            ScriptedResponse::completion(r#"{"tool":"reply""#),
        ],
        &RecordingApproval::deny(),
        &CancellationToken::new(),
        2,
    )
    .await;

    assert!(run.result.is_err());
    assert!(run.events.iter().any(|event| matches!(
        event,
        AgentEvent::StepError { category, .. } if category == "tool_call"
    )));
    assert_eq!(finished_reason(&run.events), Some(("failed", 1)));
    assert_eq!(run.requests.len(), 2);
}

#[tokio::test]
async fn malformed_atem_repair_is_not_published_as_a_reply() {
    let workspace = TestWorkspace::new();
    let run = run_script(
        &workspace,
        vec![
            ScriptedResponse::completion("not-json"),
            ScriptedResponse::completion(
                r#"atem:function_calls <atem:invoke name="os.fs.list"><atem:parameter name="path">."#,
            ),
        ],
        &RecordingApproval::deny(),
        &CancellationToken::new(),
        2,
    )
    .await;

    assert!(run.result.is_err());
    assert!(run.events.iter().any(|event| matches!(
        event,
        AgentEvent::StepError { category, .. } if category == "tool_call"
    )));
    assert!(!run
        .events
        .iter()
        .any(|event| matches!(event, AgentEvent::AssistantReply { .. })));
    assert_eq!(finished_reason(&run.events), Some(("failed", 1)));
}

#[tokio::test]
async fn safe_filesystem_writes_share_a_serial_batch_without_trimming() {
    let workspace = TestWorkspace::new();
    let run = run_script(
        &workspace,
        vec![
            ScriptedResponse::completion(
                r#"[
                    {"tool":"os.fs.write","args":{"path":"kept.txt","content":"KEPT"}},
                    {"tool":"os.fs.edit","args":{"path":"kept.txt","oldString":"KEPT","newString":"DROPPED"}}
                ]"#,
            ),
            ScriptedResponse::completion(r#"[{"tool":"reply","args":{"text":"done"}}]"#),
        ],
        &RecordingApproval::allow(),
        &CancellationToken::new(),
        3,
    )
    .await;

    assert!(run.result.is_ok());
    assert_eq!(workspace.read("kept.txt"), b"DROPPED");
    assert_eq!(
        executed(&run.events),
        [
            ("os.fs.write", ToolStatus::Ok),
            ("os.fs.edit", ToolStatus::Ok),
            ("reply", ToolStatus::Ok)
        ]
    );
    assert!(!run
        .events
        .iter()
        .any(|event| matches!(event, AgentEvent::ParseRetry { .. })));
    assert!(!run
        .events
        .iter()
        .any(|event| matches!(event, AgentEvent::BatchTrimmed { .. })));
    assert_eq!(run.requests.len(), 2);
}

#[tokio::test]
async fn mixed_read_and_safe_write_batch_executes_both_calls() {
    let workspace = TestWorkspace::new();
    workspace.write("edit.txt", "OLD");
    let run = run_script(
        &workspace,
        vec![
            ScriptedResponse::completion(
                r#"[
                    {"tool":"os.fs.read","args":{"path":"edit.txt"}},
                    {"tool":"os.fs.edit","args":{"path":"edit.txt","oldString":"OLD","newString":"NEW"}}
                ]"#,
            ),
            ScriptedResponse::completion(r#"[{"tool":"reply","args":{"text":"done"}}]"#),
        ],
        &RecordingApproval::allow(),
        &CancellationToken::new(),
        3,
    )
    .await;

    assert!(run.result.is_ok());
    assert_eq!(workspace.read("edit.txt"), b"NEW");
    assert_eq!(
        executed(&run.events),
        [
            ("os.fs.read", ToolStatus::Ok),
            ("os.fs.edit", ToolStatus::Ok),
            ("reply", ToolStatus::Ok)
        ]
    );
    assert!(!run
        .events
        .iter()
        .any(|event| matches!(event, AgentEvent::ParseRetry { .. })));
}

#[tokio::test]
async fn misplaced_terminal_and_empty_reply_are_repaired() {
    for invalid in [
        r#"[
            {"tool":"reply","args":{"text":"too early"}},
            {"tool":"os.fs.read","args":{"path":"missing.txt"}}
        ]"#,
        r#"[{"tool":"reply","args":{"text":"   "}}]"#,
    ] {
        let workspace = TestWorkspace::new();
        let run = run_script(
            &workspace,
            vec![
                ScriptedResponse::completion(invalid),
                ScriptedResponse::completion(r#"[{"tool":"reply","args":{"text":"fixed"}}]"#),
            ],
            &RecordingApproval::deny(),
            &CancellationToken::new(),
            2,
        )
        .await;

        assert!(run.result.is_ok());
        assert_eq!(finished_reason(&run.events), Some(("reply", 1)));
        assert_eq!(
            run.events
                .iter()
                .filter(|event| matches!(event, AgentEvent::ParseRetry { .. }))
                .count(),
            1
        );
        assert_eq!(run.requests.len(), 2);
    }
}

#[tokio::test]
async fn ginfer_http_error_is_reported_as_model_failure() {
    let workspace = TestWorkspace::new();
    let run = run_script(
        &workspace,
        vec![ScriptedResponse::http_error(
            StatusCode::SERVICE_UNAVAILABLE,
            "model unavailable",
        )],
        &RecordingApproval::deny(),
        &CancellationToken::new(),
        2,
    )
    .await;

    assert!(run.result.is_err());
    assert!(run.events.iter().any(|event| matches!(
        event,
        AgentEvent::StepError { category, message }
            if category == "llm" && message.contains("model unavailable")
    )));
    assert_eq!(finished_reason(&run.events), Some(("failed", 0)));
}

#[tokio::test]
async fn cancellation_interrupts_an_in_flight_completion() {
    let workspace = TestWorkspace::new();
    let server = ScriptedGinferServer::start(vec![ScriptedResponse::completion(
        r#"[{"tool":"reply","args":{"text":"late"}}]"#,
    )
    .delayed(Duration::from_secs(5))])
    .await;
    let client = server.client();
    let approval = RecordingApproval::deny();
    let desktop = RecordingDesktop::default();
    let cancellation = CancellationToken::new();
    let mut events = Vec::new();
    let mut session = AgentSessionState::new("cancel-session");
    let skill_registry = workspace.skill_registry();
    let editable_roots = EditableRoots::for_test(workspace.path());
    let folder_access = RecordingFolderAccess::deny();
    let cancel = cancellation.clone();
    let run = run_turn(
        RunTurnInput {
            run_id: "cancel-run",
            session_id: "cancel-session",
            user_message: "wait",
            selected_skill: None,
            stable_prefix: "TEST_STABLE_PREFIX",
            reasoning_effort: None,
            working_dir: workspace.path(),
            editable_roots: &editable_roots,
            external_read_only_roots: &[],
            trusted_read_roots: &[],
            max_steps: 2,
            client: &client,
            approval: &approval,
            folder_access: &folder_access,
            desktop: &desktop,
            cancellation: &cancellation,
            session: &mut session,
            skill_registry: &skill_registry,
            bundled_script_runtime: None,
        },
        |event| collect_event(&mut events, event),
    );
    let cancel_soon = async move {
        tokio::time::sleep(Duration::from_millis(30)).await;
        cancel.cancel();
    };
    let (result, ()) = tokio::join!(run, cancel_soon);

    assert!(result.is_ok());
    assert_eq!(finished_reason(&events), Some(("cancelled", 0)));
    assert!(executed(&events).is_empty());
    assert!(!events
        .iter()
        .any(|event| matches!(event, AgentEvent::ParseRetry { .. })));
    assert_eq!(server.requests().len(), 1);
}

#[tokio::test]
async fn max_steps_terminates_without_an_extra_completion() {
    let workspace = TestWorkspace::new();
    workspace.write("fixture.txt", "constant");
    let call =
        ScriptedResponse::completion(r#"[{"tool":"os.fs.read","args":{"path":"fixture.txt"}}]"#);
    let run = run_script(
        &workspace,
        vec![call.clone(), call],
        &RecordingApproval::deny(),
        &CancellationToken::new(),
        2,
    )
    .await;

    assert!(run.result.is_ok());
    assert_eq!(run.requests.len(), 2);
    assert_eq!(finished_reason(&run.events), Some(("max_steps", 2)));
}

#[tokio::test]
async fn repeated_no_progress_calls_trip_the_breaker() {
    let workspace = TestWorkspace::new();
    workspace.write("fixture.txt", "constant");
    let response =
        ScriptedResponse::completion(r#"[{"tool":"os.fs.read","args":{"path":"fixture.txt"}}]"#);
    let run = run_script(
        &workspace,
        vec![response; 8],
        &RecordingApproval::deny(),
        &CancellationToken::new(),
        10,
    )
    .await;

    assert!(run.result.is_ok());
    assert!(run.events.iter().any(|event| matches!(
        event,
        AgentEvent::LoopDetected {
            level: LoopLevel::Warn,
            ..
        }
    )));
    assert!(run.events.iter().any(|event| matches!(
        event,
        AgentEvent::LoopDetected {
            level: LoopLevel::Critical,
            ..
        }
    )));
    assert!(run.events.iter().any(|event| matches!(
        event,
        AgentEvent::LoopDetected {
            level: LoopLevel::Breaker,
            ..
        }
    )));
    assert_eq!(finished_reason(&run.events), Some(("reply", 7)));
}

#[tokio::test]
async fn repeated_identical_batches_emit_advisory_notice_and_still_reply() {
    let workspace = TestWorkspace::new();
    workspace.write("alpha.txt", "alpha");
    workspace.write("beta.txt", "beta");
    let batch = ScriptedResponse::completion(
        r#"[
            {"tool":"os.fs.read","args":{"path":"alpha.txt"}},
            {"tool":"os.fs.read","args":{"path":"beta.txt"}}
        ]"#,
    );
    let run = run_script(
        &workspace,
        vec![
            batch.clone(),
            batch.clone(),
            batch.clone(),
            batch,
            ScriptedResponse::completion(r#"[{"tool":"reply","args":{"text":"done"}}]"#),
        ],
        &RecordingApproval::deny(),
        &CancellationToken::new(),
        6,
    )
    .await;

    assert!(run.result.is_ok());
    assert_eq!(finished_reason(&run.events), Some(("reply", 5)));
    assert!(run.events.iter().any(|event| matches!(
        event,
        AgentEvent::LoopDetected {
            level: LoopLevel::Warn,
            message,
            ..
        } if message.contains("`<batch>`")
    )));
    let final_prompt = request_prompt(&run.requests[4]);
    assert!(final_prompt.contains("### notice"));
    assert!(final_prompt.contains("`<batch>`"));
    assert_eq!(
        executed(&run.events)
            .iter()
            .filter(|(tool, status)| *tool == "os.fs.read" && *status == ToolStatus::Ok)
            .count(),
        8
    );
}

#[tokio::test]
async fn permuted_batch_does_not_count_as_an_identical_composite() {
    let workspace = TestWorkspace::new();
    workspace.write("alpha.txt", "alpha");
    workspace.write("beta.txt", "beta");
    let original = ScriptedResponse::completion(
        r#"[
            {"tool":"os.fs.read","args":{"path":"alpha.txt"}},
            {"tool":"os.fs.read","args":{"path":"beta.txt"}}
        ]"#,
    );
    let permuted = ScriptedResponse::completion(
        r#"[
            {"tool":"os.fs.read","args":{"path":"beta.txt"}},
            {"tool":"os.fs.read","args":{"path":"alpha.txt"}}
        ]"#,
    );
    let run = run_script(
        &workspace,
        vec![
            original.clone(),
            original.clone(),
            original,
            permuted,
            ScriptedResponse::completion(r#"[{"tool":"reply","args":{"text":"done"}}]"#),
        ],
        &RecordingApproval::deny(),
        &CancellationToken::new(),
        6,
    )
    .await;

    assert!(run.result.is_ok());
    assert_eq!(finished_reason(&run.events), Some(("reply", 5)));
    assert!(!run.events.iter().any(|event| matches!(
        event,
        AgentEvent::LoopDetected { message, .. } if message.contains("`<batch>`")
    )));
}

#[tokio::test]
async fn tool_view_exposes_the_rare_schema_on_the_following_step() {
    let workspace = TestWorkspace::new();
    workspace.write("fixture.txt", "hash me");
    let run = run_script(
        &workspace,
        vec![
            ScriptedResponse::completion(r#"[{"tool":"tool.view","args":{"name":"os.fs.hash"}}]"#),
            ScriptedResponse::completion(
                r#"[{"tool":"os.fs.hash","args":{"path":"fixture.txt","algorithm":"sha256"}}]"#,
            ),
            ScriptedResponse::completion(r#"[{"tool":"reply","args":{"text":"hashed"}}]"#),
        ],
        &RecordingApproval::deny(),
        &CancellationToken::new(),
        4,
    )
    .await;

    assert!(run.result.is_ok());
    assert!(!request_prompt(&run.requests[0]).contains("### loaded-tools"));
    for request in &run.requests[1..] {
        let prompt = request_prompt(request);
        assert!(prompt.contains("### loaded-tools"));
        assert!(prompt.contains("- os.fs.hash { path: string, algorithm?:"));
    }
}

#[tokio::test]
async fn skill_view_loads_the_body_and_restores_it_on_the_next_turn() {
    let workspace = TestWorkspace::new();
    workspace.write(
        ".agent-skills/pdf/SKILL.md",
        "---\nname: pdf\ndescription: PDF workflow\nversion: 1.0.0\n---\n# Durable PDF instructions",
    );
    let first = run_script(
        &workspace,
        vec![
            ScriptedResponse::completion(r#"[{"tool":"skill.view","args":{"name":"pdf"}}]"#),
            ScriptedResponse::completion(r#"[{"tool":"reply","args":{"text":"loaded"}}]"#),
        ],
        &RecordingApproval::deny(),
        &CancellationToken::new(),
        3,
    )
    .await;
    assert!(first.result.is_ok());
    assert_eq!(first.session.loaded_skills[0].name, "pdf");
    let loaded_prompt = request_prompt(&first.requests[1]);
    assert!(loaded_prompt.contains("### loaded-skills\n# skill: pdf (v1.0.0)"));
    assert!(loaded_prompt.contains("This skill declares no bundled scripts"));
    assert!(loaded_prompt.contains("# Durable PDF instructions"));

    let server = ScriptedGinferServer::start(vec![ScriptedResponse::completion(
        r#"[{"tool":"reply","args":{"text":"restored"}}]"#,
    )])
    .await;
    let client = server.client();
    let desktop = RecordingDesktop::default();
    let approval = RecordingApproval::deny();
    let cancellation = CancellationToken::new();
    let registry = workspace.skill_registry();
    let mut restored_session: AgentSessionState =
        serde_json::from_slice(&serde_json::to_vec(&first.session).unwrap()).unwrap();
    let mut events = Vec::new();
    let editable_roots = EditableRoots::for_test(workspace.path());
    let folder_access = RecordingFolderAccess::deny();
    run_turn(
        RunTurnInput {
            run_id: "restore-run",
            session_id: "test-session",
            user_message: "use the loaded skill",
            selected_skill: None,
            stable_prefix: "TEST_STABLE_PREFIX",
            reasoning_effort: None,
            working_dir: workspace.path(),
            editable_roots: &editable_roots,
            external_read_only_roots: &[],
            trusted_read_roots: &[],
            max_steps: 2,
            client: &client,
            approval: &approval,
            folder_access: &folder_access,
            desktop: &desktop,
            cancellation: &cancellation,
            session: &mut restored_session,
            skill_registry: &registry,
            bundled_script_runtime: None,
        },
        |event| collect_event(&mut events, event),
    )
    .await
    .expect("restored turn");

    let restored_requests = server.requests();
    let restored_prompt = request_prompt(&restored_requests[0]);
    assert!(restored_prompt.contains("### loaded-skills\n# skill: pdf (v1.0.0)"));
    assert!(restored_prompt.contains("This skill declares no bundled scripts"));
    assert!(restored_prompt.contains("# Durable PDF instructions"));
}

#[tokio::test]
async fn selected_skill_is_loaded_into_the_first_prompt_without_skill_view() {
    let workspace = TestWorkspace::new();
    workspace.write(
        ".agent-skills/pdf/SKILL.md",
        "---\nname: pdf\ndescription: PDF workflow\nversion: 1.0.0\n---\n# Deterministic PDF instructions",
    );
    let server = ScriptedGinferServer::start(vec![ScriptedResponse::completion(
        r#"[{"tool":"reply","args":{"text":"loaded"}}]"#,
    )])
    .await;
    let client = server.client();
    let desktop = RecordingDesktop::default();
    let approval = RecordingApproval::deny();
    let cancellation = CancellationToken::new();
    let registry = workspace.skill_registry();
    let mut session = AgentSessionState::new("selected-skill-session");
    let mut events = Vec::new();
    let editable_roots = EditableRoots::for_test(workspace.path());
    let folder_access = RecordingFolderAccess::deny();

    run_turn(
        RunTurnInput {
            run_id: "selected-skill-run",
            session_id: "selected-skill-session",
            user_message: "use the selected workflow",
            selected_skill: Some("pdf"),
            stable_prefix: "TEST_STABLE_PREFIX",
            reasoning_effort: None,
            working_dir: workspace.path(),
            editable_roots: &editable_roots,
            external_read_only_roots: &[],
            trusted_read_roots: &[],
            max_steps: 2,
            client: &client,
            approval: &approval,
            folder_access: &folder_access,
            desktop: &desktop,
            cancellation: &cancellation,
            session: &mut session,
            skill_registry: &registry,
            bundled_script_runtime: None,
        },
        |event| collect_event(&mut events, event),
    )
    .await
    .expect("selected skill turn");

    let requests = server.requests();
    assert_eq!(requests.len(), 1);
    let first_prompt = request_prompt(&requests[0]);
    assert!(first_prompt.contains("### loaded-skills\n# skill: pdf (v1.0.0)"));
    assert!(first_prompt.contains("# Deterministic PDF instructions"));
    assert!(!events.iter().any(|event| {
        matches!(
            event,
            AgentEvent::ToolCallExecuted { result } if result.call.tool == "skill.view"
        )
    }));
    assert_eq!(session.loaded_skills[0].name, "pdf");
}

#[tokio::test]
async fn unknown_selected_skill_fails_before_completion() {
    let workspace = TestWorkspace::new();
    let server = ScriptedGinferServer::start(vec![ScriptedResponse::completion(
        r#"[{"tool":"reply","args":{"text":"must not run"}}]"#,
    )])
    .await;
    let client = server.client();
    let desktop = RecordingDesktop::default();
    let approval = RecordingApproval::deny();
    let cancellation = CancellationToken::new();
    let registry = workspace.skill_registry();
    let mut session = AgentSessionState::new("missing-skill-session");
    let mut events = Vec::new();
    let editable_roots = EditableRoots::for_test(workspace.path());
    let folder_access = RecordingFolderAccess::deny();

    let error = run_turn(
        RunTurnInput {
            run_id: "missing-skill-run",
            session_id: "missing-skill-session",
            user_message: "must not be persisted",
            selected_skill: Some("missing"),
            stable_prefix: "TEST_STABLE_PREFIX",
            reasoning_effort: None,
            working_dir: workspace.path(),
            editable_roots: &editable_roots,
            external_read_only_roots: &[],
            trusted_read_roots: &[],
            max_steps: 2,
            client: &client,
            approval: &approval,
            folder_access: &folder_access,
            desktop: &desktop,
            cancellation: &cancellation,
            session: &mut session,
            skill_registry: &registry,
            bundled_script_runtime: None,
        },
        |event| collect_event(&mut events, event),
    )
    .await
    .expect_err("missing selected skill must fail");

    assert!(error.contains("missing, disabled, incompatible, or unavailable"));
    assert!(server.requests().is_empty());
    assert!(session.turns.is_empty());
    assert_eq!(finished_reason(&events), Some(("failed", 0)));
}
