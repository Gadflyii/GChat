//! Cua owns iteration; this boundary journals and authorizes every guest effect.
use std::{
    collections::BTreeMap, future::Future, path::PathBuf, pin::Pin, process::Stdio, sync::Arc,
};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tokio::{
    io::{AsyncBufReadExt, AsyncWriteExt, BufReader},
    process::{Child, Command},
    sync::watch,
};
use uuid::Uuid;

use crate::{
    contract::*, service::ServiceError, ssh::desktop_model_result, store::Store,
    workspace::WorkspaceRuntime,
};

type Result<T> = std::result::Result<T, ExecutorError>;
pub type ApprovalFuture<'a> = Pin<Box<dyn Future<Output = bool> + Send + 'a>>;

pub trait ToolApproval: Send + Sync {
    fn approve<'a>(&'a self, task: Uuid, request: &'a GuestRequest) -> ApprovalFuture<'a>;
}

#[derive(Debug)]
pub enum ExecutorError {
    State(ServiceError),
    Io(std::io::Error),
    InvalidMessage,
    NeedsReview,
    Denied,
    ChildFailed,
    Cancelled,
}
impl std::fmt::Display for ExecutorError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::State(e) => e.fmt(f),
            Self::Io(e) => e.fmt(f),
            Self::InvalidMessage => f.write_str("invalid Cua task message"),
            Self::NeedsReview => {
                f.write_str("task has an unresolved effect; review before resuming")
            }
            Self::Denied => f.write_str("guest action was not approved"),
            Self::ChildFailed => f.write_str("Cua executor stopped before task completion"),
            Self::Cancelled => f.write_str("Cua task cancelled"),
        }
    }
}
impl std::error::Error for ExecutorError {}
impl From<ServiceError> for ExecutorError {
    fn from(e: ServiceError) -> Self {
        Self::State(e)
    }
}
impl From<std::io::Error> for ExecutorError {
    fn from(e: std::io::Error) -> Self {
        Self::Io(e)
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct FunctionTool {
    pub name: String,
    pub description: String,
    pub parameters: Value,
    pub binding: ToolBinding,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ToolBinding {
    Desktop { name: String },
    Fixed { operation: GuestOperationKind },
    Shell { cwd: GuestPath },
    ReadFile,
    WriteFile,
    CuaGuide,
}

impl FunctionTool {
    fn schema(&self) -> Value {
        json!({"name":self.name,"description":self.description,"parameters":self.parameters})
    }
    fn operation(&self, args: &Value) -> Result<GuestOperationKind> {
        let object = args.as_object().ok_or(ExecutorError::InvalidMessage)?;
        let text = |name: &str| {
            object
                .get(name)
                .and_then(Value::as_str)
                .map(str::to_owned)
                .ok_or(ExecutorError::InvalidMessage)
        };
        let kind = match &self.binding {
            ToolBinding::Desktop { name } => GuestOperationKind::Desktop {
                tool: name.clone(),
                arguments: args.clone(),
            },
            ToolBinding::Fixed { operation } if object.is_empty() => operation.clone(),
            ToolBinding::Fixed { .. } => return Err(ExecutorError::InvalidMessage),
            ToolBinding::Shell { cwd } => GuestOperationKind::Exec {
                program: "/bin/sh".into(),
                args: vec!["-c".into(), text("command")?],
                cwd: cwd.clone(),
                env: BTreeMap::new(),
            },
            ToolBinding::ReadFile => GuestOperationKind::Read {
                path: GuestPath(text("path")?),
                offset: object
                    .get("offset")
                    .and_then(Value::as_u64)
                    .ok_or(ExecutorError::InvalidMessage)?,
                length: object
                    .get("length")
                    .and_then(Value::as_u64)
                    .ok_or(ExecutorError::InvalidMessage)?,
            },
            ToolBinding::CuaGuide => return Err(ExecutorError::InvalidMessage),
            ToolBinding::WriteFile => GuestOperationKind::Write {
                path: GuestPath(text("path")?),
                offset: 0,
                data: text("content")?.into_bytes(),
                truncate: true,
            },
        };
        kind.validate().map_err(|_| ExecutorError::InvalidMessage)?;
        Ok(kind)
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TaskState {
    Ready,
    Running,
    Completed,
    Interrupted,
    NeedsReview,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct TaskCall {
    pub call_id: String,
    pub name: String,
    pub arguments: Value,
    pub request: GuestRequest,
    pub reply: Option<GuestReply>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct TaskRecord {
    pub id: Uuid,
    pub identity: SessionIdentity,
    pub state: TaskState,
    pub messages: Vec<Value>,
    pub tools: Vec<FunctionTool>,
    pub calls: Vec<TaskCall>,
    pub model_replies: Vec<Value>,
    pub context: Vec<Value>,
}

pub struct CuaTask {
    store: Arc<Store>,
    record: TaskRecord,
}

pub struct Assignment {
    pub api_base: String,
    pub api_key: Option<String>,
    pub model: String,
    pub context_tokens: u64,
}
#[derive(Clone)]
pub struct ProcessSpec {
    pub program: PathBuf,
    pub args: Vec<String>,
}
pub struct ExecutorProcesses {
    pub python: ProcessSpec,
    pub context: ProcessSpec,
}

impl ProcessSpec {
    fn spawn(&self, extra: &[&str], key: Option<&str>) -> Result<Child> {
        let mut command = Command::new(&self.program);
        command
            .args(&self.args)
            .args(extra)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .env("CUA_TELEMETRY_ENABLED", "false")
            .env("DO_NOT_TRACK", "1")
            .env("LITELLM_LOCAL_MODEL_COST_MAP", "True")
            .env_remove("GBOT_MODEL_API_KEY")
            .kill_on_drop(true);
        if let Some(key) = key {
            command.env("GBOT_MODEL_API_KEY", key);
        }
        Ok(command.spawn()?)
    }
}

impl CuaTask {
    pub async fn create(
        path: PathBuf,
        identity: SessionIdentity,
        mut messages: Vec<Value>,
        mut tools: Vec<FunctionTool>,
    ) -> Result<Self> {
        identity
            .validate()
            .map_err(|_| ExecutorError::InvalidMessage)?;
        let store = Arc::new(Store::open(path).await?);
        if store.load::<TaskRecord>().await?.is_some() {
            return Err(ExecutorError::InvalidMessage);
        }
        crate::cua_skill::install(&mut messages, &mut tools)?;
        let record = TaskRecord {
            id: Uuid::new_v4(),
            identity,
            state: TaskState::Ready,
            messages,
            tools,
            calls: vec![],
            model_replies: vec![],
            context: vec![],
        };
        store.save(&record).await?;
        Ok(Self { store, record })
    }
    pub async fn open(path: PathBuf) -> Result<Self> {
        let store = Arc::new(Store::open(path).await?);
        let mut record = store
            .load::<TaskRecord>()
            .await?
            .ok_or(ExecutorError::InvalidMessage)?;
        if record.state == TaskState::Running {
            record.state = if record
                .calls
                .iter()
                .any(|call| call.reply.is_none() || call.reply.as_ref().is_some_and(uncertain))
            {
                TaskState::NeedsReview
            } else {
                TaskState::Interrupted
            };
            store.save(&record).await?;
        }
        Ok(Self { store, record })
    }
    pub fn snapshot(&self) -> &TaskRecord {
        &self.record
    }
    async fn save(&self) -> Result<()> {
        Ok(self.store.save(&self.record).await?)
    }

    pub async fn run(
        &mut self,
        runtime: &WorkspaceRuntime,
        approval: &dyn ToolApproval,
        assignment: &Assignment,
        processes: &ExecutorProcesses,
        mut cancel: watch::Receiver<bool>,
    ) -> Result<()> {
        if self.record.state == TaskState::NeedsReview {
            return Err(ExecutorError::NeedsReview);
        }
        if self.record.state == TaskState::Completed {
            return Ok(());
        }
        if *cancel.borrow() {
            return Err(ExecutorError::Cancelled);
        }
        self.record.state = TaskState::Running;
        self.save().await?;
        let result = async {
            tokio::select! { biased;
                _=wait_cancel(&mut cancel)=>return Err(ExecutorError::Cancelled),
                result=self.recover_tools(runtime,approval)=>result?,
            }
            self.run_children(runtime, approval, assignment, processes, &mut cancel)
                .await
        }
        .await;
        if result.is_err() {
            self.record.state = if self
                .record
                .calls
                .iter()
                .any(|c| c.reply.is_none() || c.reply.as_ref().is_some_and(uncertain))
            {
                TaskState::NeedsReview
            } else {
                TaskState::Interrupted
            };
            self.save().await?;
        }
        result
    }

    async fn run_children(
        &mut self,
        runtime: &WorkspaceRuntime,
        approval: &dyn ToolApproval,
        assignment: &Assignment,
        processes: &ExecutorProcesses,
        cancel: &mut watch::Receiver<bool>,
    ) -> Result<()> {
        let mut context = processes
            .context
            .spawn(&[], assignment.api_key.as_deref())?;
        let mut python = match processes
            .python
            .spawn(&["-u", "-c", include_str!("../cua/bridge.py")], None)
        {
            Ok(child) => child,
            Err(error) => {
                stop(&mut context).await;
                return Err(error);
            }
        };
        let result=async {
            let mut input=python.stdin.take().ok_or(ExecutorError::ChildFailed)?;
            let mut output=BufReader::new(python.stdout.take().ok_or(ExecutorError::ChildFailed)?).lines();
            let mut context_input=context.stdin.take().ok_or(ExecutorError::ChildFailed)?;
            let mut context_output=BufReader::new(context.stdout.take().ok_or(ExecutorError::ChildFailed)?).lines();
            let start=json!({"model":assignment.model,"api_base":assignment.api_base,"api_key":assignment.api_key,
                "messages":self.record.messages,"tools":self.record.tools.iter().map(FunctionTool::schema).collect::<Vec<_>>()});
            send(&mut input,&start).await?;
            loop {
                let line=tokio::select! { biased;
                    changed=cancel.changed()=> { if changed.is_err() || *cancel.borrow() { return Err(ExecutorError::Cancelled); } continue; },
                    line=output.next_line()=>line?.ok_or(ExecutorError::ChildFailed)?,
                };
                let event:Value=serde_json::from_str(&line).map_err(|_| ExecutorError::InvalidMessage)?;
                let method=event["method"].as_str().ok_or(ExecutorError::InvalidMessage)?;
                let payload=&event["payload"];
                let effect=async {
                    match method {
                        "prepare"=> {
                            let messages=payload["messages"].as_array().ok_or(ExecutorError::InvalidMessage)?;
                            let tools:Vec<Value>=self.record.tools.iter().map(|tool|json!({"type":"function","function":tool.schema()})).collect();
                            let request=json!({"url":format!("{}/chat/completions",assignment.api_base.trim_end_matches('/')),
                                "threadId":self.record.id,"contextTokens":assignment.context_tokens,
                                "body":{"model":assignment.model,"messages":messages,"tools":tools,"tool_choice":"auto"}});
                            send(&mut context_input,&request).await?;
                            let prepared:Value=serde_json::from_str(&context_output.next_line().await?.ok_or(ExecutorError::ChildFailed)?).map_err(|_|ExecutorError::InvalidMessage)?;
                            let body:Value=serde_json::from_str(prepared["body"].as_str().ok_or(ExecutorError::InvalidMessage)?).map_err(|_|ExecutorError::InvalidMessage)?;
                            self.record.messages=body["messages"].as_array().ok_or(ExecutorError::InvalidMessage)?.clone();
                            self.record.context.push(prepared);
                            self.save().await?;
                            Ok(Value::Array(self.record.messages.clone()))
                        },
                        "model"=> {
                            let message=payload["choices"][0]["message"].clone();
                            if message["role"]!="assistant" { return Err(ExecutorError::InvalidMessage); }
                            self.record.messages.push(message);
                            self.record.model_replies.push(payload.clone());
                            self.save().await?;Ok(Value::Null)
                        },
                        "tool"=>self.tool(runtime,approval,payload).await,
                        "done"=> Ok(Value::Null),
                        "failed"=>Err(ExecutorError::ChildFailed),
                        _=>Err(ExecutorError::InvalidMessage),
                    }
                };
                let value=tokio::select! { biased;
                    _=wait_cancel(cancel)=>return Err(ExecutorError::Cancelled),
                    result=effect=>result?,
                };
                send(&mut input,&json!({"ok":value})).await?;
                if method=="done" {
                    drop(input);
                    let status=tokio::select! { biased;
                        _=wait_cancel(cancel)=>return Err(ExecutorError::Cancelled),
                        status=python.wait()=>status?,
                    };
                    if !status.success() { return Err(ExecutorError::ChildFailed); }
                    self.record.state=TaskState::Completed;
                    self.save().await?;
                    return Ok(());
                }
            }
        }.await;
        stop(&mut python).await;
        stop(&mut context).await;
        result
    }

    async fn tool(
        &mut self,
        runtime: &WorkspaceRuntime,
        approval: &dyn ToolApproval,
        payload: &Value,
    ) -> Result<Value> {
        let call_id = payload["call_id"]
            .as_str()
            .filter(|id| !id.is_empty())
            .ok_or(ExecutorError::InvalidMessage)?
            .to_owned();
        let name = payload["name"]
            .as_str()
            .ok_or(ExecutorError::InvalidMessage)?
            .to_owned();
        let args = payload["arguments"].clone();
        if let Some(call) = self.record.calls.iter().find(|c| c.call_id == call_id) {
            if call.name != name || call.arguments != args {
                return Err(ExecutorError::InvalidMessage);
            }
            let reply = call.reply.clone().ok_or(ExecutorError::NeedsReview)?;
            if uncertain(&reply) {
                return Err(ExecutorError::NeedsReview);
            }
            let result = project(&reply);
            self.record_tool_message(&call_id, &result);
            self.save().await?;
            return Ok(result);
        }
        let tool = self
            .record
            .tools
            .iter()
            .find(|tool| tool.name == name)
            .ok_or(ExecutorError::InvalidMessage)?;
        if matches!(tool.binding, ToolBinding::CuaGuide) {
            let result = crate::cua_skill::read(&args)?;
            self.record_tool_message(&call_id, &result);
            self.save().await?;
            return Ok(result);
        }
        let request = GuestRequest {
            identity: self.record.identity,
            operation_id: OperationId::new(),
            operation: tool.operation(&args)?,
        };
        if !approval.approve(self.record.id, &request).await {
            return Err(ExecutorError::Denied);
        }
        self.record.calls.push(TaskCall {
            call_id: call_id.clone(),
            name,
            arguments: args,
            request: request.clone(),
            reply: None,
        });
        self.save().await?;
        let reply = runtime
            .request(request)
            .await
            .map_err(|_| ExecutorError::NeedsReview)?;
        let result = project(&reply);
        self.record
            .calls
            .last_mut()
            .ok_or(ExecutorError::InvalidMessage)?
            .reply = Some(reply.clone());
        self.record_tool_message(&call_id, &result);
        self.save().await?;
        if uncertain(&reply) {
            return Err(ExecutorError::NeedsReview);
        }
        Ok(result)
    }

    fn record_tool_message(&mut self, call_id: &str, result: &Value) {
        if !self
            .record
            .messages
            .iter()
            .any(|message| message["role"] == "tool" && message["tool_call_id"] == call_id)
        {
            self.record
                .messages
                .push(json!({"role":"tool","tool_call_id":call_id,"content":result.to_string()}));
        }
    }

    async fn recover_tools(
        &mut self,
        runtime: &WorkspaceRuntime,
        approval: &dyn ToolApproval,
    ) -> Result<()> {
        let mut pending = Vec::new();
        for message in &self.record.messages {
            if let Some(calls) = message["tool_calls"].as_array() {
                for call in calls {
                    let id = call["id"].as_str().ok_or(ExecutorError::InvalidMessage)?;
                    if !self
                        .record
                        .messages
                        .iter()
                        .any(|message| message["role"] == "tool" && message["tool_call_id"] == id)
                    {
                        let arguments = call["function"]["arguments"]
                            .as_str()
                            .ok_or(ExecutorError::InvalidMessage)?;
                        pending.push(json!({"call_id":id,"name":call["function"]["name"],"arguments":serde_json::from_str::<Value>(arguments).map_err(|_|ExecutorError::InvalidMessage)?}));
                    }
                }
            }
        }
        for call in pending {
            self.tool(runtime, approval, &call).await?;
        }
        Ok(())
    }
}

fn uncertain(reply: &GuestReply) -> bool {
    matches!(
        &reply.outcome,
        GuestOutcome::Success {
            result: GuestResult::Started
        } | GuestOutcome::Error {
            error: GuestError {
                code: GuestErrorCode::OutcomeUnknown | GuestErrorCode::Unavailable,
                ..
            }
        }
    )
}
fn project(reply: &GuestReply) -> Value {
    match &reply.outcome {
        GuestOutcome::Success {
            result: GuestResult::Desktop { result },
        } => desktop_model_result(result),
        GuestOutcome::Success {
            result: GuestResult::Read { data },
        } => json!({"text":String::from_utf8_lossy(data)}),
        GuestOutcome::Success {
            result:
                GuestResult::ExecFinished {
                    exit_code,
                    stdout,
                    stderr,
                },
        } => {
            json!({"exit_code":exit_code,"stdout":String::from_utf8_lossy(stdout),"stderr":String::from_utf8_lossy(stderr)})
        }
        _ => serde_json::to_value(&reply.outcome).expect("guest outcome is serializable"),
    }
}
async fn send(writer: &mut (impl AsyncWriteExt + Unpin), value: &Value) -> Result<()> {
    writer.write_all(format!("{value}\n").as_bytes()).await?;
    writer.flush().await?;
    Ok(())
}
async fn wait_cancel(cancel: &mut watch::Receiver<bool>) {
    while !*cancel.borrow() {
        if cancel.changed().await.is_err() {
            break;
        }
    }
}
async fn stop(child: &mut Child) {
    let _ = child.start_kill();
    let _ = child.wait().await;
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{service::Service, vault::NativeVault};
    use tokio::sync::Notify;

    struct Deny;
    impl ToolApproval for Deny {
        fn approve<'a>(&'a self, _: Uuid, _: &'a GuestRequest) -> ApprovalFuture<'a> {
            Box::pin(async { false })
        }
    }
    struct WaitApproval(Notify);
    impl ToolApproval for WaitApproval {
        fn approve<'a>(&'a self, _: Uuid, _: &'a GuestRequest) -> ApprovalFuture<'a> {
            Box::pin(async {
                self.0.notify_one();
                std::future::pending().await
            })
        }
    }
    async fn fixture(directory: &std::path::Path) -> (CuaTask, WorkspaceRuntime) {
        let identity = SessionIdentity {
            workspace_id: WorkspaceId::new(),
            session_id: SessionId::new(),
        };
        let task=CuaTask::create(directory.join("task.json"),identity,vec![json!({"role":"assistant","tool_calls":[{"id":"call-1","type":"function","function":{"name":"command","arguments":"{\"command\":\"true\"}"}}]})],vec![FunctionTool{name:"command".into(),description:"run a command".into(),parameters:json!({"type":"object","properties":{"command":{"type":"string"}},"required":["command"]}),binding:ToolBinding::Shell {cwd:GuestPath("/tmp".into())}}]).await.unwrap();
        let service = Arc::new(Service::open(directory.join("service.json")).await.unwrap());
        (task, WorkspaceRuntime::new(service, Arc::new(NativeVault)))
    }
    fn recorded_call(identity: SessionIdentity, reply: bool) -> TaskCall {
        let request = GuestRequest {
            identity,
            operation_id: OperationId::new(),
            operation: GuestOperationKind::Exec {
                program: "/bin/sh".into(),
                args: vec!["-c".into(), "true".into()],
                cwd: GuestPath("/tmp".into()),
                env: BTreeMap::new(),
            },
        };
        let reply = reply.then(|| GuestReply {
            identity,
            operation_id: request.operation_id,
            outcome: GuestOutcome::Success {
                result: GuestResult::ExecFinished {
                    exit_code: 0,
                    stdout: b"done".to_vec(),
                    stderr: vec![],
                },
            },
        });
        TaskCall {
            call_id: "call-1".into(),
            name: "command".into(),
            arguments: json!({"command":"true"}),
            request,
            reply,
        }
    }
    #[tokio::test]
    async fn recovered_known_result_is_restored_without_approval_or_execution() {
        let dir = tempfile::tempdir().unwrap();
        let (mut task, runtime) = fixture(dir.path()).await;
        task.record.state = TaskState::Running;
        task.record
            .calls
            .push(recorded_call(task.record.identity, true));
        task.save().await.unwrap();
        drop(task);
        let mut task = CuaTask::open(dir.path().join("task.json")).await.unwrap();
        assert_eq!(task.snapshot().state, TaskState::Interrupted);
        task.recover_tools(&runtime, &Deny).await.unwrap();
        task.recover_tools(&runtime, &Deny).await.unwrap();
        assert_eq!(task.snapshot().calls.len(), 1);
        assert_eq!(task.snapshot().messages.len(), 3);
        let output: Value =
            serde_json::from_str(task.snapshot().messages[2]["content"].as_str().unwrap()).unwrap();
        assert_eq!(output["stdout"], "done");
    }
    #[tokio::test]
    async fn recovered_unknown_effect_requires_review_and_is_never_replayed() {
        let dir = tempfile::tempdir().unwrap();
        let (mut task, runtime) = fixture(dir.path()).await;
        task.record.state = TaskState::Running;
        task.record
            .calls
            .push(recorded_call(task.record.identity, false));
        task.save().await.unwrap();
        drop(task);
        let mut task = CuaTask::open(dir.path().join("task.json")).await.unwrap();
        assert_eq!(task.snapshot().state, TaskState::NeedsReview);
        assert!(matches!(
            task.recover_tools(&runtime, &Deny).await,
            Err(ExecutorError::NeedsReview)
        ));
        assert_eq!(task.snapshot().messages.len(), 2);
    }
    #[tokio::test]
    async fn recovered_unstarted_call_still_requires_approval() {
        let dir = tempfile::tempdir().unwrap();
        let (mut task, runtime) = fixture(dir.path()).await;
        assert!(matches!(
            task.recover_tools(&runtime, &Deny).await,
            Err(ExecutorError::Denied)
        ));
        assert!(task.snapshot().calls.is_empty());
    }
    #[tokio::test]
    async fn guide_read_survives_restart_without_guest_access_or_approval() {
        let dir = tempfile::tempdir().unwrap();
        let (mut task, runtime) = fixture(dir.path()).await;
        task.record
            .messages
            .retain(|message| message["role"] == "system");
        task.record.messages.push(json!({"role":"assistant","tool_calls":[{"id":"guide-1","type":"function","function":{"name":"read_cua_guide","arguments":"{\"file\":\"LINUX.md\"}"}}]}));
        task.save().await.unwrap();
        drop(task);
        let mut task = CuaTask::open(dir.path().join("task.json")).await.unwrap();
        task.recover_tools(&runtime, &Deny).await.unwrap();
        assert!(task.snapshot().calls.is_empty());
        drop(task);
        let mut task = CuaTask::open(dir.path().join("task.json")).await.unwrap();
        task.recover_tools(&runtime, &Deny).await.unwrap();
        let messages = &task.snapshot().messages;
        assert_eq!(messages.len(), 3);
        let guide: Value = serde_json::from_str(messages[2]["content"].as_str().unwrap()).unwrap();
        assert_eq!(guide["file"], "LINUX.md");
        assert!(guide["content"]
            .as_str()
            .unwrap()
            .contains("dedicated guest transport and real foreground input"));
        assert!(messages[0]["content"]
            .as_str()
            .unwrap()
            .contains("Never use\nAT-SPI DoAction"));
    }
    #[tokio::test]
    async fn cancellation_during_approval_leaves_no_effect_and_can_resume() {
        let dir = tempfile::tempdir().unwrap();
        let (mut task, runtime) = fixture(dir.path()).await;
        let approval = WaitApproval(Notify::new());
        let (sender, receiver) = watch::channel(false);
        let assignment = Assignment {
            api_base: "http://unused/v1".into(),
            api_key: None,
            model: "fixture".into(),
            context_tokens: 131072,
        };
        let process = ProcessSpec {
            program: PathBuf::from("must-not-start"),
            args: vec![],
        };
        let processes = ExecutorProcesses {
            python: process.clone(),
            context: process,
        };
        let cancel = async {
            approval.0.notified().await;
            sender.send(true).unwrap();
        };
        let (result, ()) = tokio::join!(
            task.run(&runtime, &approval, &assignment, &processes, receiver),
            cancel
        );
        assert!(matches!(result, Err(ExecutorError::Cancelled)));
        assert_eq!(task.snapshot().state, TaskState::Interrupted);
        assert!(task.snapshot().calls.is_empty());
        drop(task);
        assert_eq!(
            CuaTask::open(dir.path().join("task.json"))
                .await
                .unwrap()
                .snapshot()
                .state,
            TaskState::Interrupted
        );
    }
}
