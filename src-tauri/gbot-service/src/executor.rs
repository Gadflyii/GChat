//! Cua owns iteration; this boundary journals and authorizes tool effects.
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
    connectors::ConnectorRequest,
    contract::*,
    service::ServiceError,
    ssh::desktop_model_result,
    store::Store,
    workspace::{WorkspaceError, WorkspaceRuntime},
};

type Result<T> = std::result::Result<T, ExecutorError>;
pub type ApprovalFuture<'a> = Pin<Box<dyn Future<Output = bool> + Send + 'a>>;

pub trait ToolApproval: Send + Sync {
    fn approve<'a>(&'a self, task: Uuid, request: &'a GuestRequest) -> ApprovalFuture<'a>;
    fn approve_connector<'a>(
        &'a self,
        _task: Uuid,
        _request: &'a ConnectorRequest,
    ) -> ApprovalFuture<'a> {
        Box::pin(async { false })
    }
}

#[derive(Debug)]
pub enum ExecutorError {
    State(ServiceError),
    Io(std::io::Error),
    InvalidMessage,
    AwaitingHuman,
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
            Self::AwaitingHuman => f.write_str("waiting for your reply"),
            Self::NeedsReview => {
                f.write_str("task has an unresolved effect; review before resuming")
            }
            Self::Denied => f.write_str("tool action was not approved"),
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
    AskHuman,
    Connector { name: String },
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
            ToolBinding::CuaGuide | ToolBinding::AskHuman | ToolBinding::Connector { .. } => {
                return Err(ExecutorError::InvalidMessage)
            }
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
    WaitingForHuman,
    Completed,
    Interrupted,
    Paused,
    Cancelled,
    NeedsReview,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct TaskEvent {
    pub state: TaskState,
    pub reason: String,
    pub at: u64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct TaskCall {
    pub call_id: String,
    pub name: String,
    pub arguments: Value,
    pub request: GuestRequest,
    pub reply: Option<GuestReply>,
    /// Admission refused the request, so the guest could not have executed it.
    #[serde(default)]
    pub not_executed: bool,
}

/// External effects are never represented as guest RPCs or retried without a known receipt.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ConnectorCall {
    pub call_id: String,
    pub name: String,
    pub arguments: Value,
    pub request: ConnectorRequest,
    pub reply: Option<Value>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum HelpStatus {
    Pending,
    Completed,
    Declined,
    Cancelled,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct HelpRequest {
    pub id: Uuid,
    pub call_id: String,
    pub question: String,
    pub status: HelpStatus,
    pub response: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct TaskRecord {
    pub id: Uuid,
    pub identity: SessionIdentity,
    pub state: TaskState,
    pub messages: Vec<Value>,
    pub tools: Vec<FunctionTool>,
    pub calls: Vec<TaskCall>,
    #[serde(default)]
    pub connector_calls: Vec<ConnectorCall>,
    #[serde(default)]
    pub help_requests: Vec<HelpRequest>,
    pub model_replies: Vec<Value>,
    pub context: Vec<Value>,
    #[serde(default)]
    pub history: Vec<TaskEvent>,
    #[serde(default)]
    pub replan_after_takeover: bool,
}

pub struct CuaTask {
    store: Arc<Store>,
    record: TaskRecord,
    updates: watch::Sender<TaskRecord>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
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
#[derive(Clone)]
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
        messages: Vec<Value>,
        tools: Vec<FunctionTool>,
    ) -> Result<Self> {
        Self::create_with_id(path, Uuid::new_v4(), identity, messages, tools).await
    }

    pub(crate) async fn create_with_id(
        path: PathBuf,
        id: Uuid,
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
        if tools.iter().any(|tool| tool.name == "ask_human") {
            return Err(ExecutorError::InvalidMessage);
        }
        tools.push(FunctionTool {
            name: "ask_human".into(),
            description: "Ask the user for missing information or a decision needed to complete the task. The task waits until they answer or decline. This does not grant permission to execute actions or take desktop control. Never ask for passwords or other credentials.".into(),
            parameters: json!({"type":"object","properties":{"question":{"type":"string"}},"required":["question"],"additionalProperties":false}),
            binding: ToolBinding::AskHuman,
        });
        let mut record = TaskRecord {
            id,
            identity,
            state: TaskState::Ready,
            messages,
            tools,
            calls: vec![],
            connector_calls: vec![],
            help_requests: vec![],
            model_replies: vec![],
            context: vec![],
            history: vec![],
            replan_after_takeover: false,
        };
        record.transition(TaskState::Ready, "created");
        store.save(&record).await?;
        let (updates, _) = watch::channel(record.clone());
        Ok(Self {
            store,
            record,
            updates,
        })
    }
    pub async fn open(path: PathBuf) -> Result<Self> {
        let store = Arc::new(Store::open(path).await?);
        let mut record = store
            .load::<TaskRecord>()
            .await?
            .ok_or(ExecutorError::InvalidMessage)?;
        if record.state == TaskState::Running {
            let state = if record
                .calls
                .iter()
                .any(|call| call.reply.is_none() || call.reply.as_ref().is_some_and(uncertain))
                || record
                    .connector_calls
                    .iter()
                    .any(|call| call.reply.is_none())
            {
                TaskState::NeedsReview
            } else if record
                .help_requests
                .iter()
                .any(|help| help.status == HelpStatus::Pending)
            {
                TaskState::WaitingForHuman
            } else {
                TaskState::Interrupted
            };
            record.transition(state, "executor restarted");
            store.save(&record).await?;
        }
        let (updates, _) = watch::channel(record.clone());
        Ok(Self {
            store,
            record,
            updates,
        })
    }
    pub fn snapshot(&self) -> &TaskRecord {
        &self.record
    }
    pub(crate) fn subscribe(&self) -> watch::Receiver<TaskRecord> {
        self.updates.subscribe()
    }
    async fn save(&self) -> Result<()> {
        self.store.save(&self.record).await?;
        self.updates.send_replace(self.record.clone());
        Ok(())
    }

    fn unresolved(&self) -> bool {
        self.record
            .calls
            .iter()
            .any(|call| call.reply.is_none() || call.reply.as_ref().is_some_and(uncertain))
            || self
                .record
                .connector_calls
                .iter()
                .any(|call| call.reply.is_none())
    }

    pub(crate) async fn replace_connector_tools(&mut self, tools: Vec<FunctionTool>) -> Result<()> {
        self.record
            .tools
            .retain(|tool| !matches!(tool.binding, ToolBinding::Connector { .. }));
        self.record.tools.extend(tools);
        self.save().await
    }

    pub(crate) async fn pause(&mut self) -> Result<()> {
        if self.record.state != TaskState::Completed {
            self.cancel_help();
            self.record.replan_after_takeover = true;
            let state = if self.unresolved() {
                TaskState::NeedsReview
            } else {
                TaskState::Paused
            };
            self.record.transition(state, "human take-over");
            self.save().await?;
        }
        Ok(())
    }

    pub(crate) async fn cancel(&mut self) -> Result<()> {
        if self.record.state != TaskState::Completed {
            self.cancel_help();
            let state = if self.unresolved() {
                TaskState::NeedsReview
            } else {
                TaskState::Cancelled
            };
            self.record.transition(state, "cancelled");
            self.save().await?;
        }
        Ok(())
    }

    fn cancel_help(&mut self) {
        for help in &mut self.record.help_requests {
            if help.status == HelpStatus::Pending {
                help.status = HelpStatus::Cancelled;
            }
        }
    }

    pub(crate) async fn answer_help(&mut self, id: Uuid, response: Option<String>) -> Result<()> {
        if self.record.state != TaskState::WaitingForHuman
            || response
                .as_ref()
                .is_some_and(|reply| reply.trim().is_empty())
        {
            return Err(ExecutorError::InvalidMessage);
        }
        let help = self
            .record
            .help_requests
            .iter_mut()
            .find(|help| help.id == id && help.status == HelpStatus::Pending)
            .ok_or(ExecutorError::InvalidMessage)?;
        help.status = if response.is_some() {
            HelpStatus::Completed
        } else {
            HelpStatus::Declined
        };
        help.response = response;
        let call_id = help.call_id.clone();
        let result = serde_json::json!({"status": help.status, "response": help.response});
        self.record_tool_message(&call_id, &result);
        self.record.transition(
            TaskState::Interrupted,
            "human reply saved; ready to continue",
        );
        self.save().await
    }

    async fn ask_human(&mut self, call_id: &str, args: &Value) -> Result<Value> {
        let object = args.as_object().ok_or(ExecutorError::InvalidMessage)?;
        let question = object
            .get("question")
            .and_then(Value::as_str)
            .filter(|question| !question.trim().is_empty())
            .ok_or(ExecutorError::InvalidMessage)?;
        if object.len() != 1 {
            return Err(ExecutorError::InvalidMessage);
        }
        if let Some(help) = self
            .record
            .help_requests
            .iter()
            .find(|help| help.call_id == call_id)
        {
            if help.question != question {
                return Err(ExecutorError::InvalidMessage);
            }
            if help.status == HelpStatus::Pending {
                return Err(ExecutorError::AwaitingHuman);
            }
            let result = json!({"status":help.status,"response":help.response});
            self.record_tool_message(call_id, &result);
            self.save().await?;
            return Ok(result);
        }
        self.record.help_requests.push(HelpRequest {
            id: Uuid::new_v4(),
            call_id: call_id.into(),
            question: question.into(),
            status: HelpStatus::Pending,
            response: None,
        });
        self.record
            .transition(TaskState::WaitingForHuman, "human assistance requested");
        self.save().await?;
        Err(ExecutorError::AwaitingHuman)
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
            self.cancel().await?;
            return Err(ExecutorError::Cancelled);
        }
        let paused = self.record.replan_after_takeover;
        self.record.transition(TaskState::Running, "started");
        self.save().await?;
        let result = async {
            if paused {
                tokio::select! { biased;
                    _=wait_cancel(&mut cancel)=>return Err(ExecutorError::Cancelled),
                    result=self.resume_observation(runtime,approval)=>result?,
                }
            }
            tokio::select! { biased;
                _=wait_cancel(&mut cancel)=>return Err(ExecutorError::Cancelled),
                result=self.recover_tools(runtime,approval)=>result?,
            }
            self.run_children(runtime, approval, assignment, processes, &mut cancel)
                .await
        }
        .await;
        if let Err(error) = &result {
            let state = if self.unresolved() {
                TaskState::NeedsReview
            } else if matches!(error, ExecutorError::AwaitingHuman) {
                TaskState::WaitingForHuman
            } else if matches!(error, ExecutorError::State(ServiceError::BotPaused)) {
                TaskState::Paused
            } else if matches!(error, ExecutorError::Cancelled) {
                TaskState::Cancelled
            } else {
                TaskState::Interrupted
            };
            self.record.transition(state, &error.to_string());
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
                    self.record.transition(TaskState::Completed,"completed");
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
        if let Some(call) = self
            .record
            .connector_calls
            .iter()
            .find(|call| call.call_id == call_id)
        {
            if call.name != name || call.arguments != args {
                return Err(ExecutorError::InvalidMessage);
            }
            let result = call.reply.clone().ok_or(ExecutorError::NeedsReview)?;
            self.record_tool_message(&call_id, &result);
            self.save().await?;
            return Ok(result);
        }
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
        if matches!(tool.binding, ToolBinding::AskHuman) {
            return self.ask_human(&call_id, &args).await;
        }
        if let ToolBinding::Connector {
            name: provider_name,
        } = &tool.binding
        {
            let provider_name = provider_name.clone();
            return self
                .connector_tool(runtime, approval, call_id, name, provider_name, args)
                .await;
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
            not_executed: false,
        });
        self.save().await?;
        let reply = match runtime.request(request.clone()).await {
            Ok(reply) => reply,
            Err(WorkspaceError::State(ServiceError::BotPaused)) => {
                self.record.replan_after_takeover = true;
                let call = self
                    .record
                    .calls
                    .last_mut()
                    .ok_or(ExecutorError::InvalidMessage)?;
                call.not_executed = true;
                call.reply = Some(GuestReply {
                    identity: request.identity,
                    operation_id: request.operation_id,
                    outcome: GuestOutcome::Error {
                        error: GuestError {
                            code: GuestErrorCode::Cancelled,
                            message: "Not executed: bot paused before guest admission".into(),
                        },
                    },
                });
                self.record_tool_message(
                    &call_id,
                    &json!({"status":"skipped","effect":"none","reason":"bot_paused"}),
                );
                self.save().await?;
                return Err(ExecutorError::State(ServiceError::BotPaused));
            }
            Err(_) => return Err(ExecutorError::NeedsReview),
        };
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

    async fn connector_tool(
        &mut self,
        runtime: &WorkspaceRuntime,
        approval: &dyn ToolApproval,
        call_id: String,
        name: String,
        provider_name: String,
        args: Value,
    ) -> Result<Value> {
        let request = match runtime
            .prepare_connector(self.record.identity, &provider_name, args.clone())
            .await
        {
            Ok(request) => request,
            Err(error) => {
                let result = json!({"error":error.to_string(),"effect":"none"});
                self.record_tool_message(&call_id, &result);
                self.save().await?;
                return Ok(result);
            }
        };
        if request.operation.write && !approval.approve_connector(self.record.id, &request).await {
            return Err(ExecutorError::Denied);
        }
        self.record.connector_calls.push(ConnectorCall {
            call_id: call_id.clone(),
            name,
            arguments: args,
            request: request.clone(),
            reply: None,
        });
        self.save().await?;
        let result = match runtime.execute_connector(&request).await {
            Ok(result) => result,
            Err(error @ (WorkspaceError::State(_) | WorkspaceError::ShuttingDown)) => {
                let result = json!({"status":"skipped","effect":"none","reason":error.to_string()});
                self.record
                    .connector_calls
                    .last_mut()
                    .ok_or(ExecutorError::InvalidMessage)?
                    .reply = Some(result.clone());
                self.record_tool_message(&call_id, &result);
                self.save().await?;
                if let WorkspaceError::State(error) = error {
                    return Err(ExecutorError::State(error));
                }
                return Err(ExecutorError::Cancelled);
            }
            // A provider transport error may follow a committed write. Retain the unresolved
            // receipt, just as an uncertain guest effect, rather than automatically retrying.
            Err(_) => return Err(ExecutorError::NeedsReview),
        };
        self.record
            .connector_calls
            .last_mut()
            .ok_or(ExecutorError::InvalidMessage)?
            .reply = Some(result.clone());
        self.record_tool_message(&call_id, &result);
        self.save().await?;
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

    async fn resume_observation(
        &mut self,
        runtime: &WorkspaceRuntime,
        approval: &dyn ToolApproval,
    ) -> Result<()> {
        // Proposals made before human control are obsolete. Preserve known receipts,
        // but never execute an unanswered old proposal while recovering this task.
        let pending: Vec<String> = self
            .record
            .messages
            .iter()
            .filter_map(|message| message["tool_calls"].as_array())
            .flatten()
            .filter_map(|call| call["id"].as_str().map(str::to_owned))
            .collect();
        for id in pending {
            let result = if let Some(call) = self
                .record
                .connector_calls
                .iter()
                .find(|call| call.call_id == id)
            {
                call.reply.clone().ok_or(ExecutorError::NeedsReview)?
            } else {
                match self.record.calls.iter().find(|call| call.call_id == id) {
                    Some(call) if !call.not_executed => {
                        project(call.reply.as_ref().ok_or(ExecutorError::NeedsReview)?)
                    }
                    _ => {
                        json!({"status":"skipped","effect":"none","reason":"human_takeover_replan"})
                    }
                }
            };
            self.record_tool_message(&id, &result);
        }
        self.save().await?;
        let observation = if let Some(reply) =
            runtime.resume_observation(self.record.identity).await
        {
            project(&reply)
        } else {
            let id = format!("resume-observation-{}", Uuid::new_v4());
            self.record.messages.push(json!({"role":"assistant","tool_calls":[{"id":id,"type":"function","function":{"name":"get_desktop_state","arguments":"{}"}}]}));
            self.save().await?;
            self.tool(
                runtime,
                approval,
                &json!({"call_id":id,"name":"get_desktop_state","arguments":{}}),
            )
            .await?
        };
        if observation["isError"] == true || observation["kind"] == "error" {
            return Err(ExecutorError::ChildFailed);
        }
        self.record.messages.push(json!({"role":"user","content":format!("Human control ended. Fresh desktop observation: {observation}\nReplan from the current desktop. All old unanswered actions were skipped. Read get_window_state before native input and get_browser_state before browser actions; old window tokens and browser refs are stale.")}));
        self.record.replan_after_takeover = false;
        self.save().await
    }
}

impl TaskRecord {
    fn transition(&mut self, state: TaskState, reason: &str) {
        self.state = state;
        self.history.push(TaskEvent {
            state,
            reason: reason.into(),
            at: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_secs(),
        });
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
    struct FakeConnectors {
        calls: std::sync::Mutex<Vec<crate::connectors::PreparedConnector>>,
        hold: std::sync::atomic::AtomicBool,
        started: Notify,
        cancelled: std::sync::atomic::AtomicBool,
    }
    impl Default for FakeConnectors {
        fn default() -> Self {
            Self {
                calls: Default::default(),
                hold: Default::default(),
                started: Notify::new(),
                cancelled: Default::default(),
            }
        }
    }
    impl crate::connectors::ConnectorHost for FakeConnectors {
        fn accounts(
            &self,
        ) -> crate::connectors::ConnectorFuture<'_, Vec<crate::connectors::ConnectorAccount>>
        {
            Box::pin(async {
                Ok([("a", "google", "calendar"), ("b", "microsoft", "mail")]
                    .into_iter()
                    .map(
                        |(id, provider, service)| crate::connectors::ConnectorAccount {
                            id: id.into(),
                            provider: provider.into(),
                            display_name: id.into(),
                            email: None,
                            services: vec![service.into()],
                            access: "read_write".into(),
                            granted_scopes: vec![],
                            needs_reconnect: false,
                        },
                    )
                    .collect())
            })
        }
        fn catalog<'a>(
            &'a self,
            linked: &'a [String],
        ) -> crate::connectors::ConnectorFuture<'a, Vec<crate::connectors::ConnectorTool>> {
            Box::pin(async move {
                Ok([
                    ("a", "google.calendar.list", false),
                    ("a", "google.calendar.create", true),
                    ("b", "microsoft.mail.list", false),
                ]
                .into_iter()
                .filter(|(id, _, _)| linked.iter().any(|linked| linked == id))
                .map(|(_, name, write)| crate::connectors::ConnectorTool {
                    name: name.into(),
                    description: name.into(),
                    input_schema: json!({"type":"object"}),
                    write,
                })
                .collect())
            })
        }
        fn prepare<'a>(
            &'a self,
            linked: &'a [String],
            name: &'a str,
            mut arguments: Value,
        ) -> crate::connectors::ConnectorFuture<'a, crate::connectors::PreparedConnector> {
            Box::pin(async move {
                let id = if name.starts_with("google.") {
                    "a"
                } else {
                    "b"
                };
                let requested = arguments
                    .get("account_id")
                    .and_then(Value::as_str)
                    .unwrap_or(id);
                if requested != id || !linked.iter().any(|linked| linked == requested) {
                    return Err("account is not linked to this bot".into());
                }
                arguments
                    .as_object_mut()
                    .ok_or("invalid arguments")?
                    .insert("account_id".into(), json!(id));
                Ok(crate::connectors::PreparedConnector {
                    name: name.into(),
                    account_id: id.into(),
                    arguments,
                    write: name.ends_with("create"),
                })
            })
        }
        fn execute<'a>(
            &'a self,
            request: &'a crate::connectors::PreparedConnector,
        ) -> crate::connectors::ConnectorFuture<'a, Value> {
            Box::pin(async move {
                self.calls.lock().unwrap().push(request.clone());
                if self.hold.load(std::sync::atomic::Ordering::Acquire) {
                    struct Cancelled<'a>(&'a std::sync::atomic::AtomicBool);
                    impl Drop for Cancelled<'_> {
                        fn drop(&mut self) {
                            self.0.store(true, std::sync::atomic::Ordering::Release);
                        }
                    }
                    let _cancel = Cancelled(&self.cancelled);
                    self.started.notify_one();
                    return std::future::pending().await;
                }
                Ok(json!({"account_id":request.account_id}))
            })
        }
    }
    #[derive(Default)]
    struct ConnectorApproval(std::sync::Mutex<Vec<ConnectorRequest>>);
    impl ToolApproval for ConnectorApproval {
        fn approve<'a>(&'a self, _: Uuid, _: &'a GuestRequest) -> ApprovalFuture<'a> {
            Box::pin(async { false })
        }
        fn approve_connector<'a>(
            &'a self,
            _: Uuid,
            request: &'a ConnectorRequest,
        ) -> ApprovalFuture<'a> {
            Box::pin(async move {
                self.0.lock().unwrap().push(request.clone());
                true
            })
        }
    }

    #[tokio::test]
    async fn bot_connector_isolation_approval_receipts_and_cancellation() {
        use crate::connectors::BotConnectorAccounts;
        let dir = tempfile::tempdir().unwrap();
        let service = Arc::new(
            Service::open(dir.path().join("service.json"))
                .await
                .unwrap(),
        );
        let host = Arc::new(FakeConnectors::default());
        let runtime = WorkspaceRuntime::new(service.clone(), Arc::new(NativeVault))
            .with_connectors(host.clone());
        let mut identities = Vec::new();
        for name in ["A", "B"] {
            let id = WorkspaceId::new();
            let identity = SessionIdentity {
                workspace_id: id,
                session_id: SessionId::new(),
            };
            service
                .register_workspace(WorkspaceConfig {
                    id,
                    name: name.into(),
                    service_pc: ServicePc::Local,
                    bot_pc: BotPc::LocalVm {
                        host_id: Uuid::new_v4(),
                        vm_id: name.into(),
                        hypervisor: Hypervisor::Kvm,
                    },
                    connection: WorkspaceConnection::Ssh(SshConnection {
                        endpoint: SshEndpoint {
                            hostname: "127.0.0.1".into(),
                            port: 22,
                            user: "fixture".into(),
                        },
                        pinned_host_key: SshHostPublicKey {
                            algorithm: "ssh-ed25519".into(),
                            public_key: "AAAA".into(),
                        },
                        credential_ref: VaultCredentialRef::new(),
                    }),
                })
                .await
                .unwrap();
            service
                .register_session(
                    identity,
                    GuestHello {
                        protocol_version: GUEST_PROTOCOL_VERSION,
                        identity,
                        capabilities: [GuestCapability::Exec].into(),
                        view: None,
                    },
                )
                .await
                .unwrap();
            assert!(runtime
                .bot_connectors(id)
                .await
                .unwrap()
                .account_ids
                .is_empty());
            assert!(runtime.connector_tools(id).await.unwrap().is_empty());
            identities.push(identity);
        }
        for (identity, account) in identities.iter().zip(["a", "b"]) {
            runtime
                .save_bot_connectors(BotConnectorAccounts {
                    workspace_id: identity.workspace_id,
                    account_ids: vec![account.into()],
                })
                .await
                .unwrap();
        }
        assert!(runtime
            .save_bot_connectors(BotConnectorAccounts {
                workspace_id: identities[0].workspace_id,
                account_ids: vec!["not-owned".into()]
            })
            .await
            .is_err());
        let mut a = CuaTask::create(
            dir.path().join("a.json"),
            identities[0],
            vec![],
            runtime
                .connector_tools(identities[0].workspace_id)
                .await
                .unwrap(),
        )
        .await
        .unwrap();
        let mut b = CuaTask::create(
            dir.path().join("b.json"),
            identities[1],
            vec![],
            runtime
                .connector_tools(identities[1].workspace_id)
                .await
                .unwrap(),
        )
        .await
        .unwrap();
        assert!(a
            .snapshot()
            .tools
            .iter()
            .all(|tool| !tool.name.starts_with("microsoft.")));
        assert!(b
            .snapshot()
            .tools
            .iter()
            .all(|tool| !tool.name.starts_with("google.")));
        let approval = ConnectorApproval::default();
        let read = json!({"call_id":"read-a","name":"google.calendar.list","arguments":{}});
        assert_eq!(
            a.tool(&runtime, &approval, &read).await.unwrap()["account_id"],
            "a"
        );
        assert_eq!(
            b.tool(
                &runtime,
                &approval,
                &json!({"call_id":"read-b","name":"microsoft.mail.list","arguments":{}})
            )
            .await
            .unwrap()["account_id"],
            "b"
        );
        assert!(approval.0.lock().unwrap().is_empty());
        let denied = json!({"call_id":"other-account","name":"google.calendar.list","arguments":{"account_id":"b"}});
        assert_eq!(
            a.tool(&runtime, &approval, &denied).await.unwrap()["effect"],
            "none"
        );
        assert_eq!(host.calls.lock().unwrap().len(), 2);
        let write = json!({"call_id":"write-a","name":"google.calendar.create","arguments":{"event":"fixture"}});
        assert!(matches!(
            a.tool(&runtime, &Deny, &write).await,
            Err(ExecutorError::Denied)
        ));
        assert_eq!(host.calls.lock().unwrap().len(), 2);
        a.tool(&runtime, &approval, &write).await.unwrap();
        assert_eq!(
            approval.0.lock().unwrap()[0].operation.arguments["account_id"],
            "a"
        );
        assert!(
            a.snapshot().calls.is_empty(),
            "connector must not enter guest RPC journal"
        );
        drop(a);
        let mut a = CuaTask::open(dir.path().join("a.json")).await.unwrap();
        a.tool(&runtime, &approval, &write).await.unwrap();
        assert_eq!(
            host.calls.lock().unwrap().len(),
            3,
            "known receipt must not execute twice"
        );
        runtime
            .save_bot_connectors(BotConnectorAccounts {
                workspace_id: identities[0].workspace_id,
                account_ids: vec![],
            })
            .await
            .unwrap();
        assert!(runtime
            .connector_tools(identities[0].workspace_id)
            .await
            .unwrap()
            .is_empty());
        assert_eq!(
            runtime
                .bot_connectors(identities[1].workspace_id)
                .await
                .unwrap()
                .account_ids,
            vec!["b"]
        );
        runtime
            .save_bot_connectors(BotConnectorAccounts {
                workspace_id: identities[0].workspace_id,
                account_ids: vec!["a".into()],
            })
            .await
            .unwrap();
        host.hold.store(true, std::sync::atomic::Ordering::Release);
        a.record.transition(TaskState::Running, "fixture running");
        let pending = json!({"call_id":"pending","name":"google.calendar.create","arguments":{}});
        {
            let effect = a.tool(&runtime, &approval, &pending);
            tokio::pin!(effect);
            tokio::select! {
                _ = host.started.notified() => {},
                _ = &mut effect => panic!("fixture should wait for cancellation"),
            }
        }
        assert!(host.cancelled.load(std::sync::atomic::Ordering::Acquire));
        a.cancel().await.unwrap();
        assert_eq!(a.snapshot().state, TaskState::NeedsReview);
        drop(a);
        let mut a = CuaTask::open(dir.path().join("a.json")).await.unwrap();
        assert!(matches!(
            a.tool(&runtime, &approval, &pending).await,
            Err(ExecutorError::NeedsReview)
        ));
        assert_eq!(
            host.calls.lock().unwrap().len(),
            4,
            "unknown receipt must not replay"
        );
        let saved = service.snapshot().await.connector_accounts;
        drop(runtime);
        drop(service);
        let recovered = Service::open(dir.path().join("service.json"))
            .await
            .unwrap();
        assert_eq!(recovered.snapshot().await.connector_accounts, saved);
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
            not_executed: false,
        }
    }
    #[tokio::test]
    async fn human_help_survives_restart_and_reply_does_not_approve_actions() {
        let dir = tempfile::tempdir().unwrap();
        let (mut task, runtime) = fixture(dir.path()).await;
        let call = json!({"call_id":"help-1","name":"ask_human","arguments":{"question":"Which folder should I use?"}});
        assert!(matches!(
            task.tool(&runtime, &Deny, &call).await,
            Err(ExecutorError::AwaitingHuman)
        ));
        let request = task.snapshot().help_requests[0].clone();
        drop(task);
        let mut task = CuaTask::open(dir.path().join("task.json")).await.unwrap();
        assert_eq!(task.snapshot().state, TaskState::WaitingForHuman);
        assert_eq!(task.snapshot().help_requests[0].id, request.id);
        assert!(matches!(
            task.answer_help(Uuid::new_v4(), Some("Documents".into()))
                .await,
            Err(ExecutorError::InvalidMessage)
        ));
        assert!(matches!(
            task.answer_help(request.id, Some("  ".into())).await,
            Err(ExecutorError::InvalidMessage)
        ));
        task.answer_help(request.id, Some("Documents".into()))
            .await
            .unwrap();
        assert_eq!(
            task.tool(&runtime, &Deny, &call).await.unwrap()["response"],
            "Documents"
        );
        assert_eq!(
            task.snapshot()
                .messages
                .iter()
                .filter(|message| message["tool_call_id"] == "help-1")
                .count(),
            1
        );
        assert!(matches!(
            task.answer_help(request.id, Some("Desktop".into())).await,
            Err(ExecutorError::InvalidMessage)
        ));
        assert!(matches!(
            task.recover_tools(&runtime, &Deny).await,
            Err(ExecutorError::Denied)
        ));
        assert!(task.snapshot().calls.is_empty());
    }

    #[tokio::test]
    async fn human_help_decline_stop_and_takeover_resolve_the_pending_request() {
        for action in ["decline", "stop", "takeover"] {
            let dir = tempfile::tempdir().unwrap();
            let (mut task, runtime) = fixture(dir.path()).await;
            let call = json!({"call_id":"help-1","name":"ask_human","arguments":{"question":"Which file?"}});
            assert!(matches!(
                task.tool(&runtime, &Deny, &call).await,
                Err(ExecutorError::AwaitingHuman)
            ));
            let id = task.snapshot().help_requests[0].id;
            let (status, state) = match action {
                "decline" => {
                    task.answer_help(id, None).await.unwrap();
                    (HelpStatus::Declined, TaskState::Interrupted)
                }
                "stop" => {
                    task.cancel().await.unwrap();
                    (HelpStatus::Cancelled, TaskState::Cancelled)
                }
                _ => {
                    task.pause().await.unwrap();
                    (HelpStatus::Cancelled, TaskState::Paused)
                }
            };
            drop(task);
            let task = CuaTask::open(dir.path().join("task.json")).await.unwrap();
            assert_eq!(task.snapshot().help_requests[0].status, status);
            assert_eq!(task.snapshot().state, state);
            assert_eq!(task.snapshot().replan_after_takeover, action == "takeover");
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
        assert_eq!(task.snapshot().state, TaskState::Cancelled);
        assert!(task.snapshot().calls.is_empty());
        drop(task);
        assert_eq!(
            CuaTask::open(dir.path().join("task.json"))
                .await
                .unwrap()
                .snapshot()
                .state,
            TaskState::Cancelled
        );
    }
}
