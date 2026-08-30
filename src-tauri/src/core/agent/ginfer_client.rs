//! Direct OpenAI-compatible HTTP client to the local `ginfer-serve` backend.

use std::sync::{Arc, RwLock};
use std::time::Duration;

use async_trait::async_trait;
use reqwest::header::{ACCEPT, AUTHORIZATION, CONTENT_TYPE};
use serde::Deserialize;
use serde_json::{Map, Value};
use tauri_plugin_ginfer::state::GinferState;
use thiserror::Error;
use tokio_util::sync::CancellationToken;

use crate::core::server::context_expansion::is_context_limit_error;

use super::definitions::AgentReasoningEffort;
use super::prompt::ITERATION_ONE_TOOLS;
use super::token_budget::COMPLETION_MAX_TOKENS;
use super::types::ToolCallPayload;

const DEFAULT_REQUEST_TIMEOUT: Duration = Duration::from_secs(600);
const ERROR_DETAIL_MAX_LEN: usize = 300;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GinferSessionTarget {
    pub port: i32,
    pub api_key: String,
    pub model_id: String,
    pub has_vision: bool,
}

#[async_trait]
pub trait ContextExpansionHook: Send + Sync {
    async fn expand(
        &self,
        target: &GinferSessionTarget,
        cancellation: &CancellationToken,
    ) -> Result<GinferSessionTarget, String>;
}

#[derive(Debug, Clone)]
pub struct CompletionRequest {
    pub prompt: String,
    pub reasoning_effort: Option<AgentReasoningEffort>,
    pub max_tokens: u32,
    pub temperature: f32,
    pub top_p: f32,
    pub top_k: i32,
    pub stop: Vec<String>,
}

impl CompletionRequest {
    pub fn tool_call(
        prompt: impl Into<String>,
        reasoning_effort: Option<AgentReasoningEffort>,
    ) -> Self {
        Self {
            prompt: prompt.into(),
            reasoning_effort,
            max_tokens: COMPLETION_MAX_TOKENS,
            temperature: 0.2,
            top_p: 0.95,
            top_k: 40,
            stop: Vec::new(),
        }
    }
}

#[derive(Debug, Clone, Default, PartialEq)]
pub struct CompletionTiming {
    pub prompt_ms: f64,
    pub predicted_ms: f64,
    pub prompt_tokens: f64,
    pub predicted_tokens: f64,
}

#[derive(Debug, Clone, Default, PartialEq)]
pub struct CompletionResult {
    pub content: String,
    pub reasoning_content: String,
    pub stop: bool,
    pub truncated: bool,
    pub timing: CompletionTiming,
    pub cache_hit_tokens: f64,
    pub model_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParsedToolCalls {
    pub calls: Vec<ToolCallPayload>,
    pub reasoning: Option<String>,
}

#[derive(Debug, Error)]
pub enum GinferClientError {
    #[error("no active ginfer session for model '{0}'")]
    SessionNotFound(String),
    #[error("ginfer-serve request was cancelled")]
    Cancelled,
    #[error("ginfer-serve completion exceeded the 600-second deadline")]
    TimedOut,
    #[error("ginfer-serve returned HTTP {status}: {detail}")]
    Http { status: u16, detail: String },
    #[error("ginfer-serve transport error: {0}")]
    Transport(String),
    #[error("invalid ginfer-serve response: {0}")]
    InvalidResponse(String),
    #[error("invalid tool-call completion: {0}")]
    ToolCallParse(String),
}

#[derive(Debug, Deserialize)]
struct CompletionEnvelope {
    #[serde(default)]
    choices: Vec<CompletionChoice>,
    #[serde(default)]
    usage: CompletionUsage,
    #[serde(default)]
    x_ginfer: GinferMetrics,
    #[serde(default)]
    model: Option<String>,
}

#[derive(Debug, Default, Deserialize)]
struct CompletionChoice {
    #[serde(default)]
    message: CompletionMessage,
    #[serde(default)]
    finish_reason: String,
}

#[derive(Debug, Default, Deserialize)]
struct CompletionMessage {
    #[serde(default)]
    content: Option<String>,
    #[serde(default)]
    reasoning_content: String,
    #[serde(default)]
    tool_calls: Vec<OpenAiToolCall>,
}

#[derive(Debug, Deserialize)]
struct OpenAiToolCall {
    function: OpenAiFunctionCall,
}

#[derive(Debug, Deserialize)]
struct OpenAiFunctionCall {
    name: String,
    arguments: String,
}

#[derive(Debug, Default, Deserialize)]
struct CompletionUsage {
    #[serde(default)]
    completion_tokens: f64,
    #[serde(default)]
    prompt_tokens_details: PromptTokenDetails,
}

#[derive(Debug, Default, Deserialize)]
struct PromptTokenDetails {
    #[serde(default)]
    cached_tokens: f64,
}

#[derive(Debug, Default, Deserialize)]
struct GinferMetrics {
    #[serde(default)]
    computed_prefill_tokens: f64,
    #[serde(default)]
    prefill_seconds: f64,
    #[serde(default)]
    decode_seconds: f64,
}

pub struct GinferClient {
    client: reqwest::Client,
    target: RwLock<GinferSessionTarget>,
    context_expansion: Option<Arc<dyn ContextExpansionHook>>,
}

impl GinferClient {
    pub fn new(target: &GinferSessionTarget) -> Result<Self, GinferClientError> {
        let client = reqwest::Client::builder()
            .timeout(DEFAULT_REQUEST_TIMEOUT)
            .build()
            .map_err(|error| GinferClientError::Transport(error.to_string()))?;
        Ok(Self {
            client,
            target: RwLock::new(target.clone()),
            context_expansion: None,
        })
    }

    pub fn with_context_expansion(mut self, hook: Arc<dyn ContextExpansionHook>) -> Self {
        self.context_expansion = Some(hook);
        self
    }

    pub fn retarget(&self, target: &GinferSessionTarget) {
        *self.target.write().expect("ginfer target lock poisoned") = target.clone();
    }

    pub fn target(&self) -> GinferSessionTarget {
        self.target
            .read()
            .expect("ginfer target lock poisoned")
            .clone()
    }

    pub async fn fetch_context_window(
        &self,
        cancellation: &CancellationToken,
    ) -> Result<Option<usize>, GinferClientError> {
        let model = self.fetch_model(cancellation).await?;
        Ok(read_context_window(&model))
    }

    pub async fn fetch_model(
        &self,
        cancellation: &CancellationToken,
    ) -> Result<Value, GinferClientError> {
        let target = self.target();
        let mut request = self
            .client
            .get(format!("http://127.0.0.1:{}/v1/models", target.port));
        if !target.api_key.is_empty() {
            request = request.header(AUTHORIZATION, format!("Bearer {}", target.api_key));
        }
        let response = tokio::select! {
            _ = cancellation.cancelled() => return Err(GinferClientError::Cancelled),
            result = request.send() => {
                result.map_err(|error| GinferClientError::Transport(error.to_string()))?
            }
        };
        let status = response.status();
        let bytes = response
            .bytes()
            .await
            .map_err(|error| GinferClientError::Transport(error.to_string()))?;
        if !status.is_success() {
            return Err(GinferClientError::Http {
                status: status.as_u16(),
                detail: extract_error_detail(&String::from_utf8_lossy(&bytes)),
            });
        }
        let payload: Value = serde_json::from_slice(&bytes)
            .map_err(|error| GinferClientError::InvalidResponse(error.to_string()))?;
        payload
            .get("data")
            .and_then(Value::as_array)
            .and_then(|models| {
                models.iter().find(|model| {
                    model
                        .get("id")
                        .and_then(Value::as_str)
                        .is_some_and(|id| model_ids_match(id, &target.model_id))
                })
            })
            .cloned()
            .ok_or_else(|| {
                GinferClientError::InvalidResponse(format!(
                    "GInfer /v1/models did not advertise `{}`",
                    target.model_id
                ))
            })
    }

    pub async fn describe_images(
        &self,
        prompt: &str,
        images: &[(String, String)],
        reasoning_effort: Option<AgentReasoningEffort>,
        cancellation: &CancellationToken,
    ) -> Result<CompletionResult, GinferClientError> {
        let target = self.target();
        if !target.has_vision {
            return Err(GinferClientError::InvalidResponse(
                "active ginfer session is not vision-capable".into(),
            ));
        }
        let payload = vision_request_payload(&target.model_id, prompt, images, reasoning_effort);
        let mut request = self
            .client
            .post(format!(
                "http://127.0.0.1:{}/v1/chat/completions",
                target.port
            ))
            .header(ACCEPT, "application/json")
            .header(CONTENT_TYPE, "application/json")
            .json(&payload);
        if !target.api_key.is_empty() {
            request = request.header(AUTHORIZATION, format!("Bearer {}", target.api_key));
        }
        let response = tokio::select! {
            _ = cancellation.cancelled() => return Err(GinferClientError::Cancelled),
            result = request.send() => {
                result.map_err(|error| GinferClientError::Transport(error.to_string()))?
            }
        };
        let status = response.status();
        let bytes = tokio::select! {
            _ = cancellation.cancelled() => return Err(GinferClientError::Cancelled),
            result = response.bytes() => {
                result.map_err(|error| GinferClientError::Transport(error.to_string()))?
            }
        };
        if !status.is_success() {
            return Err(GinferClientError::Http {
                status: status.as_u16(),
                detail: extract_error_detail(&String::from_utf8_lossy(&bytes)),
            });
        }
        let payload: CompletionEnvelope = serde_json::from_slice(&bytes)
            .map_err(|error| GinferClientError::InvalidResponse(error.to_string()))?;
        let completion = normalize_completion(payload)?;
        if completion.content.trim().is_empty() {
            return Err(GinferClientError::InvalidResponse(
                "vision response did not contain message content".into(),
            ));
        }
        Ok(completion)
    }

    pub async fn complete(
        &self,
        request: &CompletionRequest,
        cancellation: &CancellationToken,
    ) -> Result<CompletionResult, GinferClientError> {
        let response = self.send(request, cancellation).await?;
        let payload = tokio::select! {
            _ = cancellation.cancelled() => return Err(GinferClientError::Cancelled),
            result = response.json::<CompletionEnvelope>() => {
                result.map_err(|error| GinferClientError::InvalidResponse(error.to_string()))?
            }
        };
        normalize_completion(payload)
    }

    async fn send(
        &self,
        request: &CompletionRequest,
        cancellation: &CancellationToken,
    ) -> Result<reqwest::Response, GinferClientError> {
        let target = self.target();
        match self.send_to_target(&target, request, cancellation).await {
            Err(GinferClientError::Http { status, detail })
                if is_context_limit_error(status, &detail) && self.context_expansion.is_some() =>
            {
                let hook = self.context_expansion.as_ref().unwrap();
                let replacement = match hook.expand(&target, cancellation).await {
                    Ok(replacement) => replacement,
                    Err(_) if cancellation.is_cancelled() => {
                        return Err(GinferClientError::Cancelled);
                    }
                    Err(error) => return Err(GinferClientError::Transport(error)),
                };
                if !model_ids_match(&replacement.model_id, &target.model_id) {
                    return Err(GinferClientError::Transport(
                        "Context expansion returned a different model".into(),
                    ));
                }
                self.retarget(&replacement);
                match self.fetch_context_window(cancellation).await {
                    Err(GinferClientError::Cancelled) => {
                        return Err(GinferClientError::Cancelled);
                    }
                    Err(error) => {
                        log::warn!("Agent context profile refresh failed after expansion: {error}");
                    }
                    Ok(_) => {}
                }
                self.send_to_target(&replacement, request, cancellation)
                    .await
            }
            result => result,
        }
    }

    async fn send_to_target(
        &self,
        target: &GinferSessionTarget,
        request: &CompletionRequest,
        cancellation: &CancellationToken,
    ) -> Result<reqwest::Response, GinferClientError> {
        let payload = completion_request_payload(&target.model_id, request);
        let mut builder = self
            .client
            .post(format!(
                "http://127.0.0.1:{}/v1/chat/completions",
                target.port
            ))
            .header(CONTENT_TYPE, "application/json")
            .header(ACCEPT, "application/json")
            .json(&payload);
        if !target.api_key.is_empty() {
            builder = builder.header(AUTHORIZATION, format!("Bearer {}", target.api_key));
        }
        let response = tokio::select! {
            _ = cancellation.cancelled() => return Err(GinferClientError::Cancelled),
            result = builder.send() => {
                result.map_err(|error| GinferClientError::Transport(error.to_string()))?
            }
        };
        if response.status().is_success() {
            return Ok(response);
        }
        let status = response.status().as_u16();
        let body = response.text().await.unwrap_or_default();
        Err(GinferClientError::Http {
            status,
            detail: extract_error_detail(&body),
        })
    }
}

fn completion_request_payload(model_id: &str, request: &CompletionRequest) -> Value {
    let tools = ITERATION_ONE_TOOLS
        .iter()
        .map(|descriptor| {
            serde_json::json!({
                "type": "function",
                "function": {
                    "name": wire_tool_name(descriptor.name),
                    "description": format!("Agent tool `{}`: {}", descriptor.name, descriptor.summary),
                    "parameters": {
                        "type": "object",
                        "additionalProperties": true
                    },
                    "strict": false
                }
            })
        })
        .collect::<Vec<_>>();
    let mut payload = serde_json::json!({
        "model": model_id,
        "messages": [{"role": "user", "content": request.prompt}],
        "tools": tools,
        "tool_choice": "required",
        "stream": false,
        "max_tokens": request.max_tokens,
        "temperature": request.temperature,
        "top_p": request.top_p,
        "top_k": request.top_k
    });
    if !request.stop.is_empty() {
        payload["stop"] = serde_json::json!(request.stop);
    }
    if let Some(effort) = request.reasoning_effort {
        payload["reasoning_effort"] = Value::String(effort.as_str().into());
    }
    payload
}

fn wire_tool_name(agent_name: &str) -> String {
    agent_name
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || character == '_' || character == '-' {
                character
            } else {
                '_'
            }
        })
        .collect()
}

fn agent_tool_name(wire_name: &str) -> Option<&'static str> {
    ITERATION_ONE_TOOLS
        .iter()
        .find(|descriptor| wire_tool_name(descriptor.name) == wire_name)
        .map(|descriptor| descriptor.name)
}

fn vision_request_payload(
    model_id: &str,
    prompt: &str,
    images: &[(String, String)],
    reasoning_effort: Option<AgentReasoningEffort>,
) -> Value {
    let mut content = images
        .iter()
        .map(|(media_type, base64)| {
            serde_json::json!({
                "type": "image_url",
                "image_url": {
                    "url": format!("data:{media_type};base64,{base64}")
                }
            })
        })
        .collect::<Vec<_>>();
    content.push(serde_json::json!({"type": "text", "text": prompt}));
    let mut payload = serde_json::json!({
        "model": model_id,
        "messages": [{"role": "user", "content": content}],
        "stream": false,
        "max_tokens": 1024,
        "temperature": 0.2
    });
    if let Some(effort) = reasoning_effort {
        payload["reasoning_effort"] = Value::String(effort.as_str().into());
    }
    payload
}

pub async fn find_session_by_model_id(
    model_id: &str,
    ginfer: &GinferState,
) -> Result<GinferSessionTarget, GinferClientError> {
    let sessions = ginfer.ginfer_process.lock().await;
    sessions
        .values()
        .find(|session| model_ids_match(&session.info.model_id, model_id))
        .map(|session| GinferSessionTarget {
            port: session.info.port as i32,
            api_key: session.info.api_key.clone(),
            model_id: session.info.model_id.clone(),
            has_vision: session.info.vision,
        })
        .ok_or_else(|| GinferClientError::SessionNotFound(model_id.to_owned()))
}

fn read_context_window(model: &Value) -> Option<usize> {
    model
        .get("max_model_len")
        .and_then(|value| {
            value
                .as_u64()
                .or_else(|| value.as_str()?.parse::<u64>().ok())
        })
        .and_then(|value| usize::try_from(value).ok())
        .filter(|value| *value > 0)
}

pub fn parse_tool_calls(raw: &str) -> Result<ParsedToolCalls, GinferClientError> {
    let (reasoning, body) = extract_reasoning(raw);
    let json_text = extract_json_root(&body)?;
    let parsed: Value = serde_json::from_str(json_text)
        .map_err(|error| GinferClientError::ToolCallParse(error.to_string()))?;
    let entries = parsed.as_array().ok_or_else(|| {
        GinferClientError::ToolCallParse("tool-call root must be a JSON array".into())
    })?;
    if entries.is_empty() {
        return Err(GinferClientError::ToolCallParse(
            "tool-call array must contain at least one call".into(),
        ));
    }
    let calls = entries
        .iter()
        .enumerate()
        .map(|(index, entry)| normalize_tool_call(entry, index))
        .collect::<Result<Vec<_>, _>>()?;
    Ok(ParsedToolCalls {
        calls,
        reasoning: (!reasoning.is_empty()).then_some(reasoning),
    })
}

fn normalize_tool_call(value: &Value, index: usize) -> Result<ToolCallPayload, GinferClientError> {
    let object = value.as_object().ok_or_else(|| {
        GinferClientError::ToolCallParse(format!(
            "tool-call array entry {index} must be a JSON object"
        ))
    })?;
    let tool = ["tool", "name", "action"]
        .iter()
        .filter_map(|key| object.get(*key).and_then(Value::as_str))
        .map(str::trim)
        .find(|name| !name.is_empty())
        .ok_or_else(|| {
            GinferClientError::ToolCallParse("tool-call must include a non-empty tool name".into())
        })?
        .to_owned();
    let args = read_args(object)?;
    Ok(ToolCallPayload { tool, args })
}

fn read_args(object: &Map<String, Value>) -> Result<Value, GinferClientError> {
    if let Some(nested) = object.get("args").or_else(|| object.get("arguments")) {
        let value = match nested {
            Value::String(raw) => serde_json::from_str(raw).map_err(|error| {
                GinferClientError::ToolCallParse(format!(
                    "tool-call arguments must be valid JSON: {error}"
                ))
            })?,
            value => value.clone(),
        };
        if value.is_object() {
            return Ok(value);
        }
        return Err(GinferClientError::ToolCallParse(
            "tool-call args must be a JSON object".into(),
        ));
    }
    let flat: Map<String, Value> = object
        .iter()
        .filter(|(key, _)| !matches!(key.as_str(), "tool" | "name" | "action"))
        .map(|(key, value)| (key.clone(), value.clone()))
        .collect();
    if flat.is_empty() {
        return Err(GinferClientError::ToolCallParse(
            "tool-call must include args".into(),
        ));
    }
    Ok(Value::Object(flat))
}

fn extract_reasoning(raw: &str) -> (String, String) {
    let mut reasoning = Vec::new();
    let mut body = String::new();
    let mut rest = raw;
    loop {
        let Some(open) = rest.find("<think>") else {
            body.push_str(rest);
            break;
        };
        body.push_str(&rest[..open]);
        let after_open = &rest[open + "<think>".len()..];
        let Some(close) = after_open.find("</think>") else {
            if let Ok(json) = extract_json_root(after_open) {
                let start = after_open.find(json).unwrap_or(after_open.len());
                let prefix = after_open[..start].trim();
                if !prefix.is_empty() {
                    reasoning.push(prefix.to_owned());
                }
                body.push_str(json);
            } else {
                reasoning.push(after_open.trim().to_owned());
            }
            break;
        };
        let thought = after_open[..close].trim();
        if !thought.is_empty() {
            reasoning.push(thought.to_owned());
        }
        rest = &after_open[close + "</think>".len()..];
    }
    (reasoning.join("\n\n"), body.trim().to_owned())
}

fn extract_json_root(raw: &str) -> Result<&str, GinferClientError> {
    let input = raw.trim();
    if input.is_empty() {
        return Err(GinferClientError::ToolCallParse(
            "tool-call body is empty".into(),
        ));
    }
    let mut start = None;
    let mut root = '\0';
    let mut curly = 0_i32;
    let mut square = 0_i32;
    let mut in_string = false;
    let mut escaped = false;
    for (index, ch) in input.char_indices() {
        if start.is_none() {
            if matches!(ch, '{' | '[') {
                start = Some(index);
                root = ch;
                if ch == '{' {
                    curly = 1;
                } else {
                    square = 1;
                }
            }
            continue;
        }
        if in_string {
            if escaped {
                escaped = false;
            } else if ch == '\\' {
                escaped = true;
            } else if ch == '"' {
                in_string = false;
            }
            continue;
        }
        match ch {
            '"' => in_string = true,
            '{' => curly += 1,
            '}' => {
                curly -= 1;
                if root == '{' && curly == 0 && square == 0 {
                    return Ok(&input[start.expect("JSON start is set")..index + ch.len_utf8()]);
                }
            }
            '[' => square += 1,
            ']' => {
                square -= 1;
                if root == '[' && square == 0 && curly == 0 {
                    return Ok(&input[start.expect("JSON start is set")..index + ch.len_utf8()]);
                }
            }
            _ => {}
        }
    }
    if start.is_none() {
        Err(GinferClientError::ToolCallParse(
            "tool-call JSON value not found".into(),
        ))
    } else {
        Err(GinferClientError::ToolCallParse(
            "tool-call JSON value is incomplete".into(),
        ))
    }
}

fn normalize_completion(
    payload: CompletionEnvelope,
) -> Result<CompletionResult, GinferClientError> {
    let choice = payload.choices.into_iter().next().ok_or_else(|| {
        GinferClientError::InvalidResponse("chat completion contained no choices".into())
    })?;
    let mut content = choice.message.content.unwrap_or_default();
    if !choice.message.tool_calls.is_empty() {
        let calls = choice
            .message
            .tool_calls
            .into_iter()
            .map(|call| {
                let name = agent_tool_name(&call.function.name).ok_or_else(|| {
                    GinferClientError::ToolCallParse(format!(
                        "GInfer returned unknown tool `{}`",
                        call.function.name
                    ))
                })?;
                let args: Value =
                    serde_json::from_str(&call.function.arguments).map_err(|error| {
                        GinferClientError::ToolCallParse(format!(
                            "GInfer returned invalid arguments for `{name}`: {error}"
                        ))
                    })?;
                if !args.is_object() {
                    return Err(GinferClientError::ToolCallParse(format!(
                        "GInfer returned non-object arguments for `{name}`"
                    )));
                }
                Ok(serde_json::json!({"tool": name, "args": args}))
            })
            .collect::<Result<Vec<_>, GinferClientError>>()?;
        content = serde_json::to_string(&calls).map_err(|error| {
            GinferClientError::InvalidResponse(format!("failed to normalize tool calls: {error}"))
        })?;
    }

    Ok(CompletionResult {
        content,
        reasoning_content: choice.message.reasoning_content,
        stop: choice.finish_reason != "length",
        truncated: choice.finish_reason == "length",
        timing: CompletionTiming {
            prompt_ms: payload.x_ginfer.prefill_seconds * 1_000.0,
            predicted_ms: payload.x_ginfer.decode_seconds * 1_000.0,
            prompt_tokens: payload.x_ginfer.computed_prefill_tokens,
            predicted_tokens: payload.usage.completion_tokens,
        },
        cache_hit_tokens: payload.usage.prompt_tokens_details.cached_tokens,
        model_id: payload.model,
    })
}

fn extract_error_detail(raw: &str) -> String {
    let trimmed = raw.trim();
    let parsed = serde_json::from_str::<Value>(trimmed).ok();
    let detail = parsed
        .as_ref()
        .and_then(|value| {
            value
                .get("error")
                .and_then(|error| {
                    error
                        .as_str()
                        .map(str::to_owned)
                        .or_else(|| error.get("message")?.as_str().map(str::to_owned))
                })
                .or_else(|| value.get("message")?.as_str().map(str::to_owned))
        })
        .unwrap_or_else(|| trimmed.to_owned());
    let collapsed = detail.split_whitespace().collect::<Vec<_>>().join(" ");
    if collapsed.chars().count() <= ERROR_DETAIL_MAX_LEN {
        collapsed
    } else {
        let prefix = collapsed
            .chars()
            .take(ERROR_DETAIL_MAX_LEN - 1)
            .collect::<String>();
        format!("{prefix}…")
    }
}

fn model_ids_match(left: &str, right: &str) -> bool {
    left.len() == right.len()
        && left.bytes().zip(right.bytes()).all(|(left, right)| {
            left == right || matches!((left, right), (b'.', b'_') | (b'_', b'.'))
        })
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::{AtomicUsize, Ordering};

    use reqwest::StatusCode;

    use super::*;
    use crate::core::agent::test_support::{ScriptedGinferServer, ScriptedResponse};

    struct StaticExpansion {
        calls: AtomicUsize,
        result: Result<GinferSessionTarget, String>,
    }

    #[async_trait]
    impl ContextExpansionHook for StaticExpansion {
        async fn expand(
            &self,
            _target: &GinferSessionTarget,
            _cancellation: &CancellationToken,
        ) -> Result<GinferSessionTarget, String> {
            self.calls.fetch_add(1, Ordering::SeqCst);
            self.result.clone()
        }
    }

    struct CancellingExpansion;

    #[async_trait]
    impl ContextExpansionHook for CancellingExpansion {
        async fn expand(
            &self,
            _target: &GinferSessionTarget,
            cancellation: &CancellationToken,
        ) -> Result<GinferSessionTarget, String> {
            cancellation.cancel();
            Err("cancelled".into())
        }
    }

    #[test]
    fn normal_completion_uses_atomic_agent_limit() {
        let request = CompletionRequest::tool_call("prompt", Some(AgentReasoningEffort::High));
        assert_eq!(request.max_tokens, 8_192);
        assert_eq!(request.reasoning_effort, Some(AgentReasoningEffort::High));
    }

    #[test]
    fn reads_context_window_from_ginfer_model() {
        assert_eq!(
            read_context_window(&serde_json::json!({"max_model_len": 16_384})),
            Some(16_384)
        );
        assert_eq!(
            read_context_window(&serde_json::json!({"max_model_len": "32768"})),
            Some(32_768)
        );
        assert_eq!(read_context_window(&serde_json::json!({})), None);
        assert_eq!(
            read_context_window(&serde_json::json!({"max_model_len": 0})),
            None
        );
    }

    #[test]
    fn builds_native_ginfer_tool_request_with_reasoning_effort() {
        let request = CompletionRequest::tool_call("inspect", Some(AgentReasoningEffort::Xhigh));
        let payload = completion_request_payload("model-a", &request);
        assert_eq!(payload["model"], "model-a");
        assert_eq!(payload["messages"][0]["content"], "inspect");
        assert_eq!(payload["tool_choice"], "required");
        assert_eq!(payload["reasoning_effort"], "xhigh");
        assert!(payload["tools"]
            .as_array()
            .is_some_and(|tools| !tools.is_empty()));
        assert!(payload["tools"].as_array().unwrap().iter().all(|tool| {
            tool["function"]["name"].as_str().is_some_and(|name| {
                name.chars()
                    .all(|ch| ch.is_ascii_alphanumeric() || ch == '_' || ch == '-')
            })
        }));
    }

    #[test]
    fn forwards_every_ginfer_reasoning_effort_without_translation() {
        let efforts = [
            (AgentReasoningEffort::None, "none"),
            (AgentReasoningEffort::Minimal, "minimal"),
            (AgentReasoningEffort::Low, "low"),
            (AgentReasoningEffort::Medium, "medium"),
            (AgentReasoningEffort::High, "high"),
            (AgentReasoningEffort::Xhigh, "xhigh"),
            (AgentReasoningEffort::Max, "max"),
        ];

        for (effort, expected) in efforts {
            let request = CompletionRequest::tool_call("inspect", Some(effort));
            let tool_payload = completion_request_payload("model-a", &request);
            let vision_payload = vision_request_payload("model-a", "inspect", &[], Some(effort));
            assert_eq!(tool_payload["reasoning_effort"], expected);
            assert_eq!(vision_payload["reasoning_effort"], expected);
        }
    }

    #[tokio::test]
    async fn fetches_ginfer_model_without_consuming_completion_script() {
        let model = serde_json::json!({
            "id": "scripted-test-model",
            "object": "model",
            "max_model_len": 65_536
        });
        let server = ScriptedGinferServer::start_with_model(
            vec![ScriptedResponse::completion("ok")],
            model.clone(),
        )
        .await;

        assert_eq!(
            server
                .client()
                .fetch_model(&CancellationToken::new())
                .await
                .expect("fetch model"),
            model
        );
        assert!(server.requests().is_empty());
    }

    #[test]
    fn normalizes_native_tool_calls_and_exact_ginfer_metrics() {
        let descriptor = ITERATION_ONE_TOOLS.first().expect("tool catalog");
        let envelope: CompletionEnvelope = serde_json::from_value(serde_json::json!({
            "model": "model-a",
            "choices": [{
                "message": {
                    "reasoning_content": "inspect first",
                    "tool_calls": [{"function": {
                        "name": wire_tool_name(descriptor.name),
                        "arguments": "{\"path\":\"README.md\"}"
                    }}]
                },
                "finish_reason": "tool_calls"
            }],
            "usage": {
                "prompt_tokens": 120,
                "completion_tokens": 8,
                "prompt_tokens_details": {"cached_tokens": 40}
            },
            "x_ginfer": {
                "computed_prefill_tokens": 80,
                "prefill_seconds": 0.01,
                "decode_seconds": 0.02
            }
        }))
        .expect("completion envelope");
        let result = normalize_completion(envelope).expect("normalize completion");
        let parsed = parse_tool_calls(&result.content).expect("normalized calls");
        assert_eq!(parsed.calls[0].tool, descriptor.name);
        assert_eq!(result.reasoning_content, "inspect first");
        assert_eq!(result.timing.prompt_tokens, 80.0);
        assert_eq!(result.timing.predicted_tokens, 8.0);
        assert_eq!(result.timing.prompt_ms, 10.0);
        assert_eq!(result.timing.predicted_ms, 20.0);
        assert_eq!(result.cache_hit_tokens, 40.0);
    }

    #[tokio::test]
    async fn retries_once_after_context_expansion_and_retargets() {
        let first = ScriptedGinferServer::start(vec![ScriptedResponse::http_error(
            StatusCode::BAD_REQUEST,
            "the request exceeds the available context size",
        )])
        .await;
        let replacement =
            ScriptedGinferServer::start(vec![ScriptedResponse::completion("ok")]).await;
        let replacement_target = replacement.client().target();
        let hook = Arc::new(StaticExpansion {
            calls: AtomicUsize::new(0),
            result: Ok(replacement_target.clone()),
        });
        let client = first.client().with_context_expansion(hook.clone());

        let completion = client
            .complete(
                &CompletionRequest::tool_call("prompt", None),
                &CancellationToken::new(),
            )
            .await
            .expect("retry after context expansion");

        assert_eq!(completion.content, "ok");
        assert_eq!(hook.calls.load(Ordering::SeqCst), 1);
        assert_eq!(client.target().port, replacement_target.port);
        assert_eq!(first.requests().len(), 1);
        assert_eq!(replacement.requests().len(), 1);
    }

    #[tokio::test]
    async fn does_not_expand_for_non_context_http_errors() {
        let server = ScriptedGinferServer::start(vec![ScriptedResponse::http_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            "backend crashed",
        )])
        .await;
        let hook = Arc::new(StaticExpansion {
            calls: AtomicUsize::new(0),
            result: Err("must not run".into()),
        });
        let client = server.client().with_context_expansion(hook.clone());

        let error = client
            .complete(
                &CompletionRequest::tool_call("prompt", None),
                &CancellationToken::new(),
            )
            .await
            .unwrap_err();

        assert!(matches!(error, GinferClientError::Http { status: 500, .. }));
        assert_eq!(hook.calls.load(Ordering::SeqCst), 0);
    }

    #[tokio::test]
    async fn reports_context_expansion_failure_without_second_completion() {
        let server = ScriptedGinferServer::start(vec![ScriptedResponse::http_error(
            StatusCode::PAYLOAD_TOO_LARGE,
            "context length exceeded",
        )])
        .await;
        let hook = Arc::new(StaticExpansion {
            calls: AtomicUsize::new(0),
            result: Err("timeout_after_60s".into()),
        });
        let client = server.client().with_context_expansion(hook.clone());

        let error = client
            .complete(
                &CompletionRequest::tool_call("prompt", None),
                &CancellationToken::new(),
            )
            .await
            .unwrap_err();

        assert!(error.to_string().contains("timeout_after_60s"));
        assert_eq!(hook.calls.load(Ordering::SeqCst), 1);
        assert_eq!(server.requests().len(), 1);
    }

    #[tokio::test]
    async fn cancellation_during_context_expansion_stops_without_retry() {
        let server = ScriptedGinferServer::start(vec![ScriptedResponse::http_error(
            StatusCode::BAD_REQUEST,
            "context size exceeded",
        )])
        .await;
        let client = server
            .client()
            .with_context_expansion(Arc::new(CancellingExpansion));
        let cancellation = CancellationToken::new();

        let error = client
            .complete(&CompletionRequest::tool_call("prompt", None), &cancellation)
            .await
            .unwrap_err();

        assert!(matches!(error, GinferClientError::Cancelled));
        assert_eq!(server.requests().len(), 1);
    }

    #[tokio::test]
    async fn rejects_context_expansion_target_from_another_model() {
        let server = ScriptedGinferServer::start(vec![ScriptedResponse::http_error(
            StatusCode::BAD_REQUEST,
            "context size exceeded",
        )])
        .await;
        let mut replacement = server.client().target();
        replacement.model_id = "some-other-model".into();
        let hook = Arc::new(StaticExpansion {
            calls: AtomicUsize::new(0),
            result: Ok(replacement),
        });
        let client = server.client().with_context_expansion(hook);

        let error = client
            .complete(
                &CompletionRequest::tool_call("prompt", None),
                &CancellationToken::new(),
            )
            .await
            .unwrap_err();

        assert!(error.to_string().contains("different model"));
        assert_eq!(server.requests().len(), 1);
    }

    #[test]
    fn parses_batch_tool_calls_and_normalizes_aliases() {
        let parsed = parse_tool_calls(
            r#"<think>inspect both files</think>
            [
              {"tool":"os.fs.read","args":{"path":"a.json","nested":[1,{"x":"}"}]}},
              {"name":"os.git.status","arguments":"{\"path\":\".\"}"}
            ] trailing text"#,
        )
        .expect("batch should parse");

        assert_eq!(parsed.reasoning.as_deref(), Some("inspect both files"));
        assert_eq!(parsed.calls.len(), 2);
        assert_eq!(parsed.calls[0].tool, "os.fs.read");
        assert_eq!(parsed.calls[0].args["nested"][1]["x"], "}");
        assert_eq!(parsed.calls[1].tool, "os.git.status");
        assert_eq!(parsed.calls[1].args["path"], ".");
    }

    #[test]
    fn rejects_empty_and_non_array_roots() {
        assert!(parse_tool_calls("[]").is_err());
        assert!(parse_tool_calls(r#"{"tool":"reply","args":{"text":"x"}}"#).is_err());
    }

    #[test]
    fn parses_flat_arguments_for_legacy_model_output() {
        let parsed = parse_tool_calls(r#"[{"action":"reply","text":"done"}]"#)
            .expect("flat arguments should parse");
        assert_eq!(parsed.calls[0].args, serde_json::json!({"text": "done"}));
    }

    #[test]
    fn peels_json_after_unclosed_reasoning_tag() {
        let parsed = parse_tool_calls(
            "<think>Need answer\n[{\"tool\":\"reply\",\"args\":{\"text\":\"ok\"}}]",
        )
        .expect("unclosed reasoning should still parse");
        assert_eq!(parsed.reasoning.as_deref(), Some("Need answer"));
        assert_eq!(parsed.calls[0].tool, "reply");
    }

    #[test]
    fn extracts_and_caps_server_error_detail() {
        assert_eq!(
            extract_error_detail(r#"{"error":{"message":"context overflow"}}"#),
            "context overflow"
        );
        assert_eq!(extract_error_detail("  plain   error \n"), "plain error");
        assert_eq!(
            extract_error_detail(&"x".repeat(400)).chars().count(),
            ERROR_DETAIL_MAX_LEN
        );
    }

    #[test]
    fn builds_openai_vision_payload_without_agent_slot_fields() {
        let payload = vision_request_payload(
            "vision-model",
            "Read this image",
            &[("image/png".into(), "aGVsbG8=".into())],
            Some(AgentReasoningEffort::High),
        );
        assert_eq!(payload["model"], "vision-model");
        assert_eq!(
            payload["messages"][0]["content"][0]["image_url"]["url"],
            "data:image/png;base64,aGVsbG8="
        );
        assert_eq!(
            payload["messages"][0]["content"][1]["text"],
            "Read this image"
        );
        assert_eq!(payload["reasoning_effort"], "high");
        assert!(payload.get("slot_id").is_none());
        assert!(payload.get("grammar").is_none());
    }

    #[tokio::test]
    async fn rejects_runtime_vision_call_for_text_only_session() {
        let client = GinferClient::new(&GinferSessionTarget {
            port: 1,
            api_key: String::new(),
            model_id: "text-model".into(),
            has_vision: false,
        })
        .unwrap();
        let error = client
            .describe_images(
                "Describe",
                &[("image/png".into(), "aGVsbG8=".into())],
                None,
                &CancellationToken::new(),
            )
            .await
            .unwrap_err();
        assert!(error.to_string().contains("session is not vision-capable"));
    }
}
