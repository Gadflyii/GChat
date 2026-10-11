//! Preserve instance aliases at the public facade without editing model output.
use serde_json::Value;

pub fn model_metadata(value: &mut Value, alias: &str) -> bool {
    let mut changed = false;
    if let Some(model) = value.get_mut("model").filter(|v| v.is_string()) {
        *model = alias.into();
        changed = true;
    }
    for envelope in ["response", "message"] {
        if let Some(model) = value
            .get_mut(envelope)
            .and_then(|v| v.get_mut("model"))
            .filter(|v| v.is_string())
        {
            *model = alias.into();
            changed = true;
        }
    }
    changed
}

pub struct AliasEvents {
    pending: Vec<u8>,
    scanned: usize,
    alias: String,
    scope: Option<crate::response_route::ResponseScope>,
}
impl AliasEvents {
    pub fn new(alias: &str) -> Self {
        Self {
            pending: Vec::new(),
            scanned: 0,
            alias: alias.into(),
            scope: None,
        }
    }
    pub fn push(&mut self, bytes: &[u8]) -> Result<Vec<u8>, String> {
        self.pending.extend_from_slice(bytes);
        let mut output = Vec::new();
        let mut consumed = 0;
        let mut index = self.scanned;
        while index < self.pending.len() {
            let remaining = &self.pending[index..];
            let end = if remaining.starts_with(b"\r\n\r\n") {
                Some(index + 4)
            } else if remaining.starts_with(b"\n\n") {
                Some(index + 2)
            } else {
                None
            };
            if let Some(end) = end {
                rewrite_event(
                    &self.pending[consumed..end],
                    &self.alias,
                    self.scope.as_ref(),
                    &mut output,
                )?;
                consumed = end;
                index = end;
            } else if b"\r\n\r\n".starts_with(remaining) || b"\n\n".starts_with(remaining) {
                // Only a delimiter prefix can change when the next fragment arrives.
                break;
            } else {
                index += 1;
            }
        }
        self.pending.drain(..consumed);
        self.scanned = index - consumed;
        Ok(output)
    }
    pub fn finish(self) -> Result<(), String> {
        if self.pending.iter().all(u8::is_ascii_whitespace) {
            Ok(())
        } else {
            Err("incomplete upstream event stream".into())
        }
    }
}

fn rewrite_event(
    frame: &[u8],
    alias: &str,
    scope: Option<&crate::response_route::ResponseScope>,
    output: &mut Vec<u8>,
) -> Result<(), String> {
    let text = std::str::from_utf8(frame).map_err(|e| e.to_string())?;
    let mut lines = text
        .lines()
        .filter_map(|line| {
            line.strip_prefix("data:")
                .map(|s| s.strip_prefix(' ').unwrap_or(s))
        });
    let Some(first) = lines.next() else {
        output.extend_from_slice(frame);
        return Ok(());
    };
    let data = if let Some(second) = lines.next() {
        let capacity = first.len() + second.len() + 1
            + lines.clone().map(|line| line.len() + 1).sum::<usize>();
        let mut data = String::with_capacity(capacity);
        data.push_str(first);
        for line in std::iter::once(second).chain(lines) {
            data.push('\n');
            data.push_str(line);
        }
        std::borrow::Cow::Owned(data)
    } else {
        std::borrow::Cow::Borrowed(first)
    };
    if data.trim() == "[DONE]" {
        output.extend_from_slice(frame);
        return Ok(());
    }
    let mut value: Value =
        serde_json::from_str(&data).map_err(|e| format!("invalid upstream event JSON: {e}"))?;
    let mut changed = model_metadata(&mut value, alias);
    if let Some(scope) = scope {
        changed |= scope.rewrite(&mut value);
    }
    if !changed {
        output.extend_from_slice(frame);
        return Ok(());
    }
    output.reserve(frame.len());
    let mut wrote = false;
    for line in text.lines() {
        if line.starts_with("data:") {
            if !wrote {
                output.extend_from_slice(b"data: ");
                serde_json::to_writer(&mut *output, &value).map_err(|e| e.to_string())?;
                output.push(b'\n');
                wrote = true;
            }
        } else {
            output.extend_from_slice(line.as_bytes());
            output.push(b'\n');
        }
    }
    Ok(())
}

pub async fn alias_response(
    response: reqwest::Response,
    alias: &str,
    scope: Option<crate::response_route::ResponseScope>,
) -> Result<hyper::Response<hyper::Body>, String> {
    use futures_util::StreamExt;
    let content_type = response
        .headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_owned();
    let success = response.status().is_success();
    let mut builder = hyper::Response::builder().status(response.status());
    for (name, value) in response.headers() {
        if !matches!(
            name.as_str(),
            "connection" | "content-length" | "transfer-encoding" | "keep-alive"
        ) {
            builder = builder.header(name, value);
        }
    }
    let body = if success && content_type.starts_with("text/event-stream") {
        let mut events = AliasEvents::new(alias);
        events.scope = scope;
        let stream = futures_util::stream::try_unfold(
            (response.bytes_stream(), events),
            |(mut input, mut events)| async move {
                loop {
                    match input.next().await {
                        Some(Ok(bytes)) => {
                            let output = events
                                .push(&bytes)
                                .map_err(std::io::Error::other)?;
                            if !output.is_empty() {
                                return Ok(Some((output, (input, events))));
                            }
                        }
                        Some(Err(e)) => return Err(std::io::Error::other(e)),
                        None => {
                            events
                                .finish()
                                .map_err(std::io::Error::other)?;
                            return Ok(None);
                        }
                    }
                }
            },
        );
        hyper::Body::wrap_stream(stream)
    } else if success && content_type.starts_with("application/json") {
        let mut value: Value = response.json().await.map_err(|e| e.to_string())?;
        model_metadata(&mut value, alias);
        if let Some(scope) = scope {
            scope.rewrite(&mut value);
        }
        hyper::Body::from(value.to_string())
    } else {
        hyper::Body::wrap_stream(response.bytes_stream())
    };
    builder.body(body).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    #[ignore = "one fragmented-request resource measurement"]
    fn request_resource_measurement_fragmented_alias_event() {
        let generated = "x".repeat(8192);
        let value = serde_json::json!({"model":"upstream","choices":[{"delta":{"content":generated}}]});
        let input = format!("event: message\r\ndata: {value}\r\n\r\ndata: {{\"usage\":{{\"completion_tokens\":1}}}}\n\ndata: [DONE]\n\n");
        let mut expected_value = value.clone();
        expected_value["model"] = "ginfer/host/instance".into();
        let expected = format!("event: message\ndata: {expected_value}\n\ndata: {{\"usage\":{{\"completion_tokens\":1}}}}\n\ndata: [DONE]\n\n");
        let measurement = crate::resource_measurement::Measurement::start();
        let mut events = AliasEvents::new("ginfer/host/instance");
        let mut output = Vec::new();
        for byte in input.as_bytes() {
            output.extend(events.push(std::slice::from_ref(byte)).unwrap());
        }
        events.finish().unwrap();
        measurement.finish("fragmented_alias_event");
        assert_eq!(output, expected.as_bytes());
    }

    #[test]
    fn request_resources_delimiter_fragments_preserve_raw_frames_and_errors() {
        let input = b": ping\r\n\r\n\r\n: next\n\ndata: [DONE]\r\n\r\n";
        for split in 0..=input.len() {
            let mut events = AliasEvents::new("alias");
            let mut output = events.push(&input[..split]).unwrap();
            output.extend(events.push(&input[split..]).unwrap());
            events.finish().unwrap();
            assert_eq!(output, input, "split {split}");
        }
        for invalid in [&b"data: {broken}\n\n"[..], &b"data: \xff\n\n"[..]] {
            let mut events = AliasEvents::new("alias");
            for byte in &invalid[..invalid.len() - 1] {
                assert!(events.push(std::slice::from_ref(byte)).unwrap().is_empty());
            }
            assert!(events.push(&invalid[invalid.len() - 1..]).is_err());
        }
    }

    #[test]
    fn response_event_handles_keep_item_and_tool_identifiers_unchanged() {
        let scope = crate::response_route::ResponseScope {
            instance: crate::engine_registry::InstanceRef {
                host_id: uuid::Uuid::new_v4(),
                instance_id: uuid::Uuid::new_v4(),
            },
            session: uuid::Uuid::new_v4(),
        };
        let alias = scope.instance.model_alias();
        let event = serde_json::json!({"type":"response.completed","response":{"object":"response","id":"resp_new","previous_response_id":"resp_old","model":"muse","output":[{"id":"item_one","call_id":"call_one"}]}});
        let mut events = AliasEvents::new(&alias);
        events.scope = Some(scope.clone());
        let output = events
            .push(format!("event: response.completed\ndata: {event}\n\n").as_bytes())
            .unwrap();
        events.finish().unwrap();
        let text = std::str::from_utf8(&output).unwrap();
        let parsed: Value =
            serde_json::from_str(text.lines().find_map(|s| s.strip_prefix("data: ")).unwrap())
                .unwrap();
        assert_eq!(parsed["response"]["id"], scope.encode("resp_new"));
        assert_eq!(
            parsed["response"]["previous_response_id"],
            scope.encode("resp_old")
        );
        assert_eq!(parsed["response"]["model"], alias);
        assert_eq!(parsed["response"]["output"], event["response"]["output"]);
        let mut deleted =
            serde_json::json!({"object":"response.deleted","id":"resp_new","deleted":true});
        scope.rewrite(&mut deleted);
        assert_eq!(deleted["id"], scope.encode("resp_new"));
    }
    #[tokio::test]
    async fn public_response_adapter_preserves_errors_and_stream_usage() {
        use hyper::{
            service::{make_service_fn, service_fn},
            Body, Response, Server,
        };
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        listener.set_nonblocking(true).unwrap();
        let origin = format!("http://{}", listener.local_addr().unwrap());
        let server = Server::from_tcp(listener).unwrap().serve(make_service_fn(|_| async {
            Ok::<_,std::convert::Infallible>(service_fn(|request:hyper::Request<Body>| async move {
                let response = match request.uri().path() {
                    "/error" => Response::builder().status(429).header("retry-after","2").header("content-type","application/json")
                        .body(Body::from("{\"error\":\"busy\",\"model\":\"upstream\"}")).unwrap(),
                    "/stream" => Response::builder().header("content-type","text/event-stream")
                        .body(Body::wrap_stream(futures_util::stream::iter([
                            Ok::<_,std::io::Error>("data: {\"model\":\"upstream\",\"choices\":[{\"delta\":{\"content\":\"upstream\"}}]}\n\n"),
                            Ok("data: {\"usage\":{\"completion_tokens\":1}}\n\ndata: [DONE]\n\n"),
                        ]))).unwrap(),
                    _ => Response::builder().header("content-type","application/json")
                        .body(Body::from("{\"model\":\"upstream\",\"choices\":[{\"message\":{\"content\":\"upstream\"}}]}")).unwrap(),
                };
                Ok::<_,std::convert::Infallible>(response)
            }))
        }));
        let task = tokio::spawn(server);
        let client = reqwest::Client::builder().no_proxy().build().unwrap();
        let adapted = alias_response(
            client.get(format!("{origin}/json")).send().await.unwrap(),
            "ginfer/a/b",
            None,
        )
        .await
        .unwrap();
        let bytes = hyper::body::to_bytes(adapted.into_body()).await.unwrap();
        let value: Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(value["model"], "ginfer/a/b");
        assert_eq!(value["choices"][0]["message"]["content"], "upstream");
        let adapted = alias_response(
            client.get(format!("{origin}/error")).send().await.unwrap(),
            "ginfer/a/b",
            None,
        )
        .await
        .unwrap();
        assert_eq!(adapted.status(), 429);
        assert_eq!(adapted.headers()["retry-after"], "2");
        assert_eq!(
            &hyper::body::to_bytes(adapted.into_body()).await.unwrap()[..],
            b"{\"error\":\"busy\",\"model\":\"upstream\"}"
        );
        let adapted = alias_response(
            client.get(format!("{origin}/stream")).send().await.unwrap(),
            "ginfer/a/b",
            None,
        )
        .await
        .unwrap();
        let bytes = hyper::body::to_bytes(adapted.into_body()).await.unwrap();
        let text = std::str::from_utf8(&bytes).unwrap();
        assert!(text.contains("\"model\":\"ginfer/a/b\""));
        assert!(text.contains("\"content\":\"upstream\""));
        assert!(text.ends_with("data: {\"usage\":{\"completion_tokens\":1}}\n\ndata: [DONE]\n\n"));
        task.abort();
    }
    #[test]
    fn aliases_metadata_but_never_generated_text_tool_arguments_or_usage() {
        let mut value = serde_json::json!({"model":"muse","choices":[{"delta":{"content":"muse", "tool_calls":[{"function":{"arguments":"{\"model\":\"muse\"}"}}]}}],"usage":{"completion_tokens":2}});
        let preserved = value["choices"].clone();
        let usage = value["usage"].clone();
        model_metadata(&mut value, "ginfer/host/instance");
        assert_eq!(value["model"], "ginfer/host/instance");
        assert_eq!(value["choices"], preserved);
        assert_eq!(value["usage"], usage);
    }
    #[test]
    fn fragmented_utf8_multiline_events_keep_framing_and_done() {
        let input = "event: message\r\ndata: {\"model\":\"muse\",\r\ndata: \"choices\":[{\"text\":\"café\"}]}\r\n\r\n: ping\n\ndata: [DONE]\n\n";
        let mut events = AliasEvents::new("ginfer/a/b");
        let mut output = Vec::new();
        for byte in input.as_bytes() {
            output.extend(events.push(&[*byte]).unwrap());
        }
        events.finish().unwrap();
        let output = String::from_utf8(output).unwrap();
        assert!(output.starts_with("event: message\ndata: "));
        assert!(output.ends_with("\n\n: ping\n\ndata: [DONE]\n\n"));
        let value: Value = serde_json::from_str(
            output
                .lines()
                .find_map(|s| s.strip_prefix("data: "))
                .unwrap(),
        )
        .unwrap();
        assert_eq!(value["model"], "ginfer/a/b");
        assert_eq!(value["choices"][0]["text"], "café");
    }
    #[test]
    fn rewrites_response_and_message_envelopes_and_rejects_truncation() {
        for field in ["response", "message"] {
            let mut value =
                serde_json::json!({field:{"model":"muse","output":[{"model":"leave alone"}]}});
            model_metadata(&mut value, "alias");
            assert_eq!(value[field]["model"], "alias");
            assert_eq!(value[field]["output"][0]["model"], "leave alone");
        }
        let mut events = AliasEvents::new("alias");
        events.push(b"data: {\"model\":").unwrap();
        assert!(events.finish().is_err());
    }
}
