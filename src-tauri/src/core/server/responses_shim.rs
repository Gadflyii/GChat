//! Translation shim between OpenAI's Responses API (`/v1/responses`) and the
//! Chat Completions API (`/v1/chat/completions`).
//!
//! Codex CLI speaks only the Responses wire protocol — `wire_api = "responses"`
//! is its sole supported value as of v0.135. Legacy ginfer sessions use this
//! bridge; Host-owned sessions use the engine's native Responses endpoint.
//! This module converts a representable Responses request
//! into a Chat Completions request and converts the Chat Completions reply
//! (both the single-shot JSON form and the streamed SSE form) back into
//! Responses objects/events, so Codex — and any other Responses-only client —
//! works against a local model.
//!
//! Remote providers serve `/v1/responses` natively, so the proxy forwards
//! those untouched (see the passthrough branch in `proxy.rs`). Unsupported
//! bridge inputs fail explicitly instead of losing part of the request.

use serde_json::{json, Map, Value};
use std::collections::BTreeMap;
use uuid::Uuid;

pub fn new_response_id() -> String {
    format!("resp_{}", Uuid::new_v4().simple())
}

fn new_message_id() -> String {
    format!("msg_{}", Uuid::new_v4().simple())
}

fn new_fc_id() -> String {
    format!("fc_{}", Uuid::new_v4().simple())
}

/// Convert a Responses API request body into a Chat Completions request body.
pub fn responses_request_to_chat(body: &Value) -> Result<Value, String> {
    if !body.is_object() {
        return Err("request body must be an object".into());
    }
    validate_responses_controls(body)?;
    let mut messages: Vec<Value> = Vec::new();

    // `instructions` (the system prompt in the Responses API) becomes a leading
    // system message.
    if let Some(value) = non_null(body, "instructions") {
        let instr = value.as_str().ok_or("instructions must be a string")?;
        if !instr.is_empty() {
            messages.push(json!({"role": "system", "content": instr}));
        }
    }

    match body.get("input") {
        Some(Value::String(s)) => {
            messages.push(json!({"role": "user", "content": s}));
        }
        Some(Value::Array(items)) => {
            if items.is_empty() {
                return Err("input must not be empty".into());
            }
            for (index, item) in items.iter().enumerate() {
                messages.push(responses_input_item_to_chat(item, index)?);
            }
        }
        _ => return Err("input must be a string or an array of input items".into()),
    }

    let messages = merge_system_messages(messages);

    let mut out = json!({ "messages": messages });
    let obj = out.as_object_mut().unwrap();

    if let Some(model) = body.get("model") {
        obj.insert("model".into(), model.clone());
    }
    if let Some(stream) = body.get("stream") {
        obj.insert("stream".into(), stream.clone());
        // Ask the backend to include a usage block in the final streamed chunk
        // so we can populate Responses `usage` on `response.completed`.
        if stream.as_bool() == Some(true) {
            obj.insert("stream_options".into(), json!({"include_usage": true}));
        }
    }
    if let Some(v) = body.get("temperature") {
        obj.insert("temperature".into(), v.clone());
    }
    if let Some(v) = body.get("top_p") {
        obj.insert("top_p".into(), v.clone());
    }
    // Responses caps output with `max_output_tokens`; Chat uses `max_tokens`.
    if let Some(v) = body.get("max_output_tokens") {
        obj.insert("max_tokens".into(), v.clone());
    }
    if let Some(v) = body.get("parallel_tool_calls") {
        obj.insert("parallel_tool_calls".into(), v.clone());
    }
    for key in [
        "chat_template_kwargs",
        "max_reasoning_tokens",
        "preserve_thinking",
        "retain_turn_checkpoint",
    ] {
        if let Some(value) = body.get(key) {
            obj.insert(key.into(), value.clone());
        }
    }

    if let Some(value) = non_null(body, "tools") {
        let tools = value.as_array().ok_or("tools must be an array")?;
        let chat_tools: Result<Vec<_>, _> = tools
            .iter()
            .enumerate()
            .map(|(index, tool)| responses_tool_to_chat(tool, index))
            .collect();
        obj.insert("tools".into(), Value::Array(chat_tools?));
    }
    if let Some(tc) = non_null(body, "tool_choice") {
        obj.insert("tool_choice".into(), responses_tool_choice_to_chat(tc)?);
    }

    // Structured output: Responses `text.format` -> Chat `response_format`.
    if let Some(text) = non_null(body, "text") {
        require_only_members(text, "text", &["format"])?;
        if let Some(format) = non_null(text, "format") {
            obj.insert(
                "response_format".into(),
                responses_text_format_to_chat(format)?,
            );
        }
    }

    Ok(out)
}

fn non_null<'a>(value: &'a Value, key: &str) -> Option<&'a Value> {
    value.get(key).filter(|value| !value.is_null())
}

fn require_string<'a>(value: &'a Value, key: &str, path: &str) -> Result<&'a str, String> {
    value
        .get(key)
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| format!("{path}.{key} must be a non-empty string"))
}

fn require_only_members(value: &Value, path: &str, allowed: &[&str]) -> Result<(), String> {
    let object = value
        .as_object()
        .ok_or_else(|| format!("{path} must be an object"))?;
    for (key, value) in object {
        if !value.is_null() && !allowed.contains(&key.as_str()) {
            return Err(format!(
                "{path}.{key} is not supported by the Responses bridge"
            ));
        }
    }
    Ok(())
}

// These controls cannot be represented by a single Chat Completions request.
// Explicit inert values and client hints remain usable by existing clients.
fn validate_responses_controls(body: &Value) -> Result<(), String> {
    for (key, value) in body.as_object().unwrap() {
        if value.is_null() {
            continue;
        }
        let valid = match key.as_str() {
            "model"
            | "input"
            | "instructions"
            | "stream"
            | "temperature"
            | "top_p"
            | "max_output_tokens"
            | "tools"
            | "tool_choice"
            | "text"
            | "chat_template_kwargs"
            | "max_reasoning_tokens"
            | "preserve_thinking"
            | "retain_turn_checkpoint" => true,
            "store" | "background" => value.as_bool() == Some(false),
            "include" => value.as_array().is_some_and(Vec::is_empty),
            "truncation" => value.as_str() == Some("disabled"),
            "parallel_tool_calls" => value.as_bool() == Some(true),
            "top_logprobs" => value.as_u64() == Some(0),
            "service_tier" => matches!(value.as_str(), Some("auto" | "default")),
            "metadata" | "client_metadata" | "prompt_cache_options" => value.is_object(),
            "prompt_cache_key" | "prompt_cache_retention" => value.is_string(),
            "stream_options" => {
                require_only_members(value, "stream_options", &["include_obfuscation"])?;
                matches!(
                    non_null(value, "include_obfuscation"),
                    None | Some(Value::Bool(false))
                )
            }
            _ => false,
        };
        if !valid {
            return Err(format!(
                "{key} value is not supported by the Responses bridge"
            ));
        }
    }
    Ok(())
}

/// Collapse every `system`/`developer` message into a single leading `system`
/// message. Strict chat templates (notably the Qwen3-family models) `raise`
/// "System message must be at the beginning" whenever a request carries more
/// than one system message or places one after the first turn — which Codex
/// readily does by combining `instructions` with developer/system input items.
/// Order of the remaining (non-system) messages is preserved.
///
/// Also reused by the Anthropic `/messages` proxy path (Claude Code), which can
/// likewise emit more than one system message after conversion.
pub(crate) fn merge_system_messages(messages: Vec<Value>) -> Vec<Value> {
    let mut system_parts: Vec<String> = Vec::new();
    let mut rest: Vec<Value> = Vec::with_capacity(messages.len());

    for msg in messages {
        let role = msg.get("role").and_then(|r| r.as_str()).unwrap_or("");
        if role == "system" || role == "developer" {
            let text = flatten_content_to_text(msg.get("content"));
            if !text.is_empty() {
                system_parts.push(text);
            }
        } else {
            rest.push(msg);
        }
    }

    if system_parts.is_empty() {
        return rest;
    }

    let mut out = Vec::with_capacity(rest.len() + 1);
    out.push(json!({"role": "system", "content": system_parts.join("\n\n")}));
    out.extend(rest);
    out
}

fn responses_input_item_to_chat(item: &Value, index: usize) -> Result<Value, String> {
    let path = format!("input[{index}]");
    if !item.is_object() {
        return Err(format!("{path} must be an object"));
    }
    let ty = match item.get("type") {
        None if item.get("role").is_some() => "message",
        Some(Value::String(ty)) => ty,
        _ => return Err(format!("{path}.type must be a string")),
    };
    match ty {
        "message" => {
            require_only_members(item, &path, &["type", "id", "status", "role", "content"])?;
            let role = require_string(item, "role", &path)?;
            if !matches!(role, "user" | "assistant" | "system" | "developer") {
                return Err(format!("{path}.role '{role}' is not supported"));
            }
            let text = responses_content_to_text(item.get("content"), &format!("{path}.content"))?;
            Ok(json!({"role": role, "content": text}))
        }
        "function_call" => {
            require_only_members(
                item,
                &path,
                &["type", "id", "status", "name", "arguments", "call_id"],
            )?;
            let name = require_string(item, "name", &path)?;
            let args = item
                .get("arguments")
                .and_then(Value::as_str)
                .ok_or_else(|| format!("{path}.arguments must be a string"))?;
            let call_id = require_string(item, "call_id", &path)?;
            Ok(json!({
                "role": "assistant",
                "content": Value::Null,
                "tool_calls": [{
                    "id": call_id,
                    "type": "function",
                    "function": {"name": name, "arguments": args}
                }]
            }))
        }
        "function_call_output" => {
            require_only_members(item, &path, &["type", "id", "status", "call_id", "output"])?;
            let call_id = require_string(item, "call_id", &path)?;
            let content = item.get("output").and_then(Value::as_str).ok_or_else(|| {
                format!("{path}.output must be a string; structured tool outputs are not supported by the Responses bridge")
            })?;
            Ok(json!({
                "role": "tool",
                "tool_call_id": call_id,
                "content": content
            }))
        }
        _ => Err(format!(
            "{path}.type '{ty}' is not supported by the Responses bridge"
        )),
    }
}

fn responses_content_to_text(content: Option<&Value>, path: &str) -> Result<String, String> {
    match content {
        Some(Value::String(text)) => Ok(text.clone()),
        Some(Value::Array(parts)) => {
            let mut text = String::new();
            for (index, part) in parts.iter().enumerate() {
                let path = format!("{path}[{index}]");
                let ty = require_string(part, "type", &path)?;
                if !matches!(ty, "input_text" | "output_text") {
                    return Err(format!(
                        "{path}.type '{ty}' is not supported by the Responses bridge"
                    ));
                }
                require_only_members(part, &path, &["type", "text", "annotations", "logprobs"])?;
                let part_text = part
                    .get("text")
                    .and_then(Value::as_str)
                    .ok_or_else(|| format!("{path}.text must be a string"))?;
                text.push_str(part_text);
            }
            Ok(text)
        }
        _ => Err(format!("{path} must be a string or an array of text parts")),
    }
}

/// Flatten already-validated text messages while merging system messages.
fn flatten_content_to_text(content: Option<&Value>) -> String {
    match content {
        Some(Value::String(s)) => s.clone(),
        Some(Value::Array(parts)) => {
            let mut buf = String::new();
            for part in parts {
                if let Some(t) = part.get("text").and_then(|v| v.as_str()) {
                    buf.push_str(t);
                }
            }
            buf
        }
        _ => String::new(),
    }
}

fn responses_tool_to_chat(tool: &Value, index: usize) -> Result<Value, String> {
    let path = format!("tools[{index}]");
    let ty = require_string(tool, "type", &path)?;
    if ty != "function" {
        return Err(format!(
            "{path}.type '{ty}' is not supported by the Responses bridge; use function tools"
        ));
    }
    require_only_members(
        tool,
        &path,
        &["type", "name", "description", "parameters", "strict"],
    )?;
    let name = require_string(tool, "name", &path)?;
    let mut func = Map::new();
    func.insert("name".into(), json!(name));
    if let Some(d) = non_null(tool, "description") {
        if !d.is_string() {
            return Err(format!("{path}.description must be a string"));
        }
        func.insert("description".into(), d.clone());
    }
    if let Some(p) = non_null(tool, "parameters") {
        if !p.is_object() {
            return Err(format!("{path}.parameters must be an object"));
        }
        func.insert("parameters".into(), p.clone());
    }
    if let Some(strict) = non_null(tool, "strict") {
        if !strict.is_boolean() {
            return Err(format!("{path}.strict must be a boolean"));
        }
        // Preserve enforcement intent: the engine must accept it or explicitly
        // reject it, rather than receiving a weakened function definition.
        func.insert("strict".into(), strict.clone());
    }
    Ok(json!({"type": "function", "function": Value::Object(func)}))
}

fn responses_tool_choice_to_chat(tc: &Value) -> Result<Value, String> {
    match tc {
        Value::String(choice) if matches!(choice.as_str(), "auto" | "none" | "required") => {
            Ok(tc.clone())
        }
        Value::Object(_) => {
            let ty = require_string(tc, "type", "tool_choice")?;
            if ty != "function" {
                return Err(format!(
                    "tool_choice.type '{ty}' is not supported by the Responses bridge"
                ));
            }
            require_only_members(tc, "tool_choice", &["type", "name"])?;
            let name = require_string(tc, "name", "tool_choice")?;
            Ok(json!({"type": "function", "function": {"name": name}}))
        }
        _ => Err("tool_choice must be 'auto', 'none', 'required', or a function choice".into()),
    }
}

fn responses_text_format_to_chat(format: &Value) -> Result<Value, String> {
    let ty = require_string(format, "type", "text.format")?;
    match ty {
        "json_schema" => {
            require_only_members(
                format,
                "text.format",
                &["type", "name", "schema", "strict", "description"],
            )?;
            let name = require_string(format, "name", "text.format")?;
            let schema = format
                .get("schema")
                .filter(|schema| schema.is_object())
                .ok_or("text.format.schema must be an object")?;
            let mut js = Map::new();
            js.insert("name".into(), json!(name));
            js.insert("schema".into(), schema.clone());
            if let Some(description) = non_null(format, "description") {
                if !description.is_string() {
                    return Err("text.format.description must be a string".into());
                }
                js.insert("description".into(), description.clone());
            }
            if let Some(strict) = non_null(format, "strict") {
                if !strict.is_boolean() {
                    return Err("text.format.strict must be a boolean".into());
                }
                js.insert("strict".into(), strict.clone());
            }
            Ok(json!({"type": "json_schema", "json_schema": Value::Object(js)}))
        }
        "text" | "json_object" => {
            require_only_members(format, "text.format", &["type"])?;
            Ok(json!({"type": ty}))
        }
        _ => Err(format!(
            "text.format.type '{ty}' is not supported; use text, json_object, or json_schema"
        )),
    }
}

/// Map a Chat Completions `usage` block to the Responses `usage` shape.
fn map_usage(u: &Value) -> Value {
    let input = u.get("prompt_tokens").and_then(|v| v.as_u64()).unwrap_or(0);
    let output = u
        .get("completion_tokens")
        .and_then(|v| v.as_u64())
        .unwrap_or(0);
    let total = u
        .get("total_tokens")
        .and_then(|v| v.as_u64())
        .unwrap_or(input + output);
    json!({
        "input_tokens": input,
        "input_tokens_details": {"cached_tokens": 0},
        "output_tokens": output,
        "output_tokens_details": {"reasoning_tokens": 0},
        "total_tokens": total
    })
}

/// Build the `output` array (assistant message + function_call items) from a
/// Chat Completions assistant message.
fn message_to_output_items(message: Option<&Value>) -> Vec<Value> {
    let mut output: Vec<Value> = Vec::new();
    let Some(msg) = message else {
        return output;
    };

    if let Some(text) = msg.get("content").and_then(|v| v.as_str()) {
        if !text.is_empty() {
            output.push(json!({
                "type": "message",
                "id": new_message_id(),
                "status": "completed",
                "role": "assistant",
                "content": [{"type": "output_text", "text": text, "annotations": []}]
            }));
        }
    }

    if let Some(tool_calls) = msg.get("tool_calls").and_then(|v| v.as_array()) {
        for tc in tool_calls {
            let name = tc
                .get("function")
                .and_then(|f| f.get("name"))
                .cloned()
                .unwrap_or_else(|| json!(""));
            let args = tc
                .get("function")
                .and_then(|f| f.get("arguments"))
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let call_id = tc.get("id").and_then(|v| v.as_str()).unwrap_or("");
            output.push(json!({
                "type": "function_call",
                "id": new_fc_id(),
                "call_id": call_id,
                "name": name,
                "arguments": args,
                "status": "completed"
            }));
        }
    }

    output
}

/// Convert a non-streaming Chat Completions response into a Responses object.
pub fn chat_response_to_responses(chat: &Value, response_id: &str, model_fallback: &str) -> Value {
    let model = chat
        .get("model")
        .and_then(|v| v.as_str())
        .unwrap_or(model_fallback);
    let created = chat.get("created").and_then(|v| v.as_u64()).unwrap_or(0);

    let message = chat
        .get("choices")
        .and_then(|c| c.as_array())
        .and_then(|c| c.first())
        .and_then(|c| c.get("message"));

    let output = message_to_output_items(message);
    let usage = chat.get("usage").map(map_usage).unwrap_or(Value::Null);

    json!({
        "id": response_id,
        "object": "response",
        "created_at": created,
        "status": "completed",
        "model": model,
        "output": output,
        "usage": usage,
        "parallel_tool_calls": true,
        "tool_choice": "auto",
        "tools": []
    })
}

struct ToolAcc {
    item_id: String,
    output_index: usize,
    call_id: String,
    name: String,
    args: String,
    added: bool,
}

/// Stateful converter from a Chat Completions SSE stream to the Responses SSE
/// event protocol. Feed each parsed Chat `data:` JSON chunk to [`on_chunk`] and
/// emit the returned events; call [`finish`] when the stream ends (`[DONE]`).
///
/// Emits the event sequence Codex consumes: `response.created`, per-item
/// `response.output_item.added` / `response.output_text.delta` /
/// `response.function_call_arguments.delta`, the matching `*.done` events, and
/// a terminal `response.completed` carrying the full `output` and `usage`.
pub struct ResponsesStreamConverter {
    response_id: String,
    model: String,
    seq: u64,
    next_output_index: usize,
    // assistant text message item
    msg_item_id: Option<String>,
    msg_output_index: usize,
    text: String,
    // tool calls keyed by the Chat `tool_calls[].index`
    tools: BTreeMap<u64, ToolAcc>,
}

impl ResponsesStreamConverter {
    pub fn new(response_id: String, model: String) -> Self {
        Self {
            response_id,
            model,
            seq: 0,
            next_output_index: 0,
            msg_item_id: None,
            msg_output_index: 0,
            text: String::new(),
            tools: BTreeMap::new(),
        }
    }

    fn next_seq(&mut self) -> u64 {
        let s = self.seq;
        self.seq += 1;
        s
    }

    fn response_envelope(&self, status: &str, output: Value, usage: Value) -> Value {
        json!({
            "id": self.response_id,
            "object": "response",
            "status": status,
            "model": self.model,
            "output": output,
            "usage": usage,
            "parallel_tool_calls": true,
            "tool_choice": "auto",
            "tools": []
        })
    }

    /// The opening `response.created` event. Send once, before any chunk.
    pub fn created_event(&mut self) -> Value {
        let seq = self.next_seq();
        json!({
            "type": "response.created",
            "sequence_number": seq,
            "response": self.response_envelope("in_progress", json!([]), Value::Null)
        })
    }

    pub fn on_chunk(&mut self, chunk: &Value) -> Vec<Value> {
        let mut events: Vec<Value> = Vec::new();
        let Some(choice) = chunk
            .get("choices")
            .and_then(|c| c.as_array())
            .and_then(|c| c.first())
        else {
            return events;
        };
        let Some(delta) = choice.get("delta") else {
            return events;
        };

        // Text content delta.
        if let Some(text) = delta.get("content").and_then(|v| v.as_str()) {
            if !text.is_empty() {
                if self.msg_item_id.is_none() {
                    let item_id = new_message_id();
                    let output_index = self.next_output_index;
                    self.next_output_index += 1;
                    self.msg_item_id = Some(item_id.clone());
                    self.msg_output_index = output_index;

                    let seq = self.next_seq();
                    events.push(json!({
                        "type": "response.output_item.added",
                        "sequence_number": seq,
                        "output_index": output_index,
                        "item": {
                            "type": "message",
                            "id": item_id,
                            "status": "in_progress",
                            "role": "assistant",
                            "content": []
                        }
                    }));
                    let seq = self.next_seq();
                    events.push(json!({
                        "type": "response.content_part.added",
                        "sequence_number": seq,
                        "item_id": self.msg_item_id.clone(),
                        "output_index": output_index,
                        "content_index": 0,
                        "part": {"type": "output_text", "text": "", "annotations": []}
                    }));
                }
                self.text.push_str(text);
                let seq = self.next_seq();
                events.push(json!({
                    "type": "response.output_text.delta",
                    "sequence_number": seq,
                    "item_id": self.msg_item_id.clone(),
                    "output_index": self.msg_output_index,
                    "content_index": 0,
                    "delta": text
                }));
            }
        }

        // Tool-call deltas.
        if let Some(tool_calls) = delta.get("tool_calls").and_then(|v| v.as_array()) {
            for tc in tool_calls {
                let index = tc.get("index").and_then(|v| v.as_u64()).unwrap_or(0);
                let is_new = !self.tools.contains_key(&index);
                if is_new {
                    let output_index = self.next_output_index;
                    self.next_output_index += 1;
                    self.tools.insert(
                        index,
                        ToolAcc {
                            item_id: new_fc_id(),
                            output_index,
                            call_id: String::new(),
                            name: String::new(),
                            args: String::new(),
                            added: false,
                        },
                    );
                }
                let acc = self.tools.get_mut(&index).unwrap();
                if let Some(id) = tc.get("id").and_then(|v| v.as_str()) {
                    if !id.is_empty() {
                        acc.call_id = id.to_string();
                    }
                }
                if let Some(name) = tc
                    .get("function")
                    .and_then(|f| f.get("name"))
                    .and_then(|v| v.as_str())
                {
                    if !name.is_empty() {
                        acc.name.push_str(name);
                    }
                }

                if !acc.added {
                    acc.added = true;
                    let item_id = acc.item_id.clone();
                    let output_index = acc.output_index;
                    let call_id = acc.call_id.clone();
                    let name = acc.name.clone();
                    let seq = self.next_seq();
                    events.push(json!({
                        "type": "response.output_item.added",
                        "sequence_number": seq,
                        "output_index": output_index,
                        "item": {
                            "type": "function_call",
                            "id": item_id,
                            "status": "in_progress",
                            "call_id": call_id,
                            "name": name,
                            "arguments": ""
                        }
                    }));
                }

                if let Some(args) = tc
                    .get("function")
                    .and_then(|f| f.get("arguments"))
                    .and_then(|v| v.as_str())
                {
                    if !args.is_empty() {
                        let acc = self.tools.get_mut(&index).unwrap();
                        acc.args.push_str(args);
                        let item_id = acc.item_id.clone();
                        let output_index = acc.output_index;
                        let seq = self.next_seq();
                        events.push(json!({
                            "type": "response.function_call_arguments.delta",
                            "sequence_number": seq,
                            "item_id": item_id,
                            "output_index": output_index,
                            "delta": args
                        }));
                    }
                }
            }
        }

        events
    }

    /// Closing events: per-item `*.done` plus the terminal `response.completed`.
    pub fn finish(&mut self, usage: Option<&Value>) -> Vec<Value> {
        let mut events: Vec<Value> = Vec::new();

        // Ordered output items for the final envelope.
        let mut items: Vec<(usize, Value)> = Vec::new();

        if let Some(item_id) = self.msg_item_id.clone() {
            let output_index = self.msg_output_index;
            let text = self.text.clone();

            let seq = self.next_seq();
            events.push(json!({
                "type": "response.output_text.done",
                "sequence_number": seq,
                "item_id": item_id,
                "output_index": output_index,
                "content_index": 0,
                "text": text
            }));
            let seq = self.next_seq();
            events.push(json!({
                "type": "response.content_part.done",
                "sequence_number": seq,
                "item_id": item_id,
                "output_index": output_index,
                "content_index": 0,
                "part": {"type": "output_text", "text": text, "annotations": []}
            }));
            let item = json!({
                "type": "message",
                "id": item_id,
                "status": "completed",
                "role": "assistant",
                "content": [{"type": "output_text", "text": text, "annotations": []}]
            });
            let seq = self.next_seq();
            events.push(json!({
                "type": "response.output_item.done",
                "sequence_number": seq,
                "output_index": output_index,
                "item": item.clone()
            }));
            items.push((output_index, item));
        }

        let tools = std::mem::take(&mut self.tools);
        for acc in tools.values() {
            let seq = self.next_seq();
            events.push(json!({
                "type": "response.function_call_arguments.done",
                "sequence_number": seq,
                "item_id": acc.item_id,
                "output_index": acc.output_index,
                "arguments": acc.args
            }));
            let item = json!({
                "type": "function_call",
                "id": acc.item_id,
                "status": "completed",
                "call_id": acc.call_id,
                "name": acc.name,
                "arguments": acc.args
            });
            let seq = self.next_seq();
            events.push(json!({
                "type": "response.output_item.done",
                "sequence_number": seq,
                "output_index": acc.output_index,
                "item": item.clone()
            }));
            items.push((acc.output_index, item));
        }

        items.sort_by_key(|(idx, _)| *idx);
        let output: Vec<Value> = items.into_iter().map(|(_, v)| v).collect();
        let usage = usage.map(map_usage).unwrap_or(Value::Null);

        let seq = self.next_seq();
        events.push(json!({
            "type": "response.completed",
            "sequence_number": seq,
            "response": self.response_envelope("completed", Value::Array(output), usage)
        }));

        events
    }
}
