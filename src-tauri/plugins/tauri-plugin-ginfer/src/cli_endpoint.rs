//! CLI-owned HTTP endpoint; inference remains owned by ginfer-host.
use hyper::{Body, Request, Response, StatusCode};
use std::{convert::Infallible, net::TcpListener};

pub struct CliEndpoint(tokio::task::JoinHandle<()>);
impl Drop for CliEndpoint {
    fn drop(&mut self) {
        self.0.abort();
    }
}

impl CliEndpoint {
    pub fn start(
        listener: TcpListener,
        upstream_port: u16,
        upstream_key: String,
        client_key: String,
    ) -> Result<Self, String> {
        listener.set_nonblocking(true).map_err(|e| e.to_string())?;
        let server = hyper::Server::from_tcp(listener).map_err(|e| e.to_string())?;
        let client = reqwest::Client::builder()
            .no_proxy()
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .map_err(|e| e.to_string())?;
        let service = hyper::service::make_service_fn(move |_| {
            let client = client.clone();
            let upstream_key = upstream_key.clone();
            let client_key = client_key.clone();
            async move {
                Ok::<_, Infallible>(hyper::service::service_fn(move |request| {
                    let client = client.clone();
                    let upstream_key = upstream_key.clone();
                    let client_key = client_key.clone();
                    async move {
                        Ok::<_, Infallible>(forward(client, upstream_port, &upstream_key, &client_key, request).await
                    .unwrap_or_else(|error| Response::builder().status(StatusCode::BAD_GATEWAY)
                        .header("content-type", "application/json")
                        .body(Body::from(serde_json::json!({"error":{"message":error,"type":"upstream_error"}}).to_string())).unwrap()))
                    }
                }))
            }
        });
        Ok(Self(tokio::spawn(async move {
            let _ = server.serve(service).await;
        })))
    }
}

async fn forward(
    client: reqwest::Client,
    port: u16,
    upstream_key: &str,
    client_key: &str,
    request: Request<Body>,
) -> Result<Response<Body>, String> {
    if !client_key.is_empty()
        && request.uri().path() != "/health"
        && request
            .headers()
            .get("authorization")
            .and_then(|v| v.to_str().ok())
            != Some(&format!("Bearer {client_key}"))
        && request.headers().get("x-api-key").and_then(|v| v.to_str().ok()) != Some(client_key)
    {
        let error = if request.uri().path().starts_with("/v1/messages") {
            serde_json::json!({"type":"error","error":{"message":"missing or invalid API key","type":"authentication_error"}})
        } else {
            serde_json::json!({"error":{"message":"missing or invalid API key","type":"invalid_request_error","code":"invalid_api_key","param":null}})
        };
        return Ok(Response::builder().status(StatusCode::UNAUTHORIZED).header("content-type", "application/json")
            .body(Body::from(error.to_string())).unwrap());
    }
    let (parts, body) = request.into_parts();
    let path = parts
        .uri
        .path_and_query()
        .map(|v| v.as_str())
        .unwrap_or("/");
    let mut upstream = client
        .request(parts.method, format!("http://127.0.0.1:{port}{path}"))
        .bearer_auth(upstream_key);
    for name in [
        "content-type",
        "accept",
        "anthropic-version",
        "anthropic-beta",
    ] {
        if let Some(value) = parts.headers.get(name) {
            upstream = upstream.header(name, value);
        }
    }
    let response = upstream
        .body(reqwest::Body::wrap_stream(body))
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let mut output = Response::builder().status(response.status());
    for (name, value) in response.headers() {
        if !matches!(
            name.as_str(),
            "connection" | "transfer-encoding" | "content-length" | "keep-alive"
        ) {
            output = output.header(name, value);
        }
    }
    output
        .body(Body::wrap_stream(response.bytes_stream()))
        .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn cli_key_and_stream_forwarding_preserve_the_upstream_session() {
        let upstream = hyper::Server::bind(&([127, 0, 0, 1], 0).into());
        let upstream_port = upstream.local_addr().port();
        let upstream = tokio::spawn(upstream.serve(hyper::service::make_service_fn(|_| async {
            Ok::<_, Infallible>(hyper::service::service_fn(|request: Request<Body>| async {
                assert_eq!(request.headers()["authorization"], "Bearer upstream-key");
                assert_eq!(
                    request.uri().path_and_query().unwrap().as_str(),
                    "/v1/chat/completions?fixture=1"
                );
                let body = hyper::body::to_bytes(request.into_body()).await.unwrap();
                assert_eq!(&body[..], br#"{"model":"alias","stream":true}"#);
                Ok::<_, Infallible>(
                    Response::builder()
                        .header("content-type", "text/event-stream")
                        .body(Body::from(
                            "data: {\"delta\":\"hello\"}\n\ndata: [DONE]\n\n",
                        ))
                        .unwrap(),
                )
            }))
        })));
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let endpoint = CliEndpoint::start(
            listener,
            upstream_port,
            "upstream-key".into(),
            "client-key".into(),
        )
        .unwrap();
        let client = reqwest::Client::new();
        let url = format!("http://127.0.0.1:{port}/v1/chat/completions?fixture=1");
        assert_eq!(client.post(&url).send().await.unwrap().status(), 401);
        let denied = client.post(format!("http://127.0.0.1:{port}/v1/messages")).send().await.unwrap();
        assert_eq!(denied.status(), 401);
        assert_eq!(denied.json::<serde_json::Value>().await.unwrap()["type"], "error");
        let anthropic_key = client.post(&url).header("x-api-key", "client-key")
            .body(r#"{"model":"alias","stream":true}"#).send().await.unwrap();
        assert_eq!(anthropic_key.status(), 200);
        anthropic_key.bytes().await.unwrap();
        let response = client
            .post(&url)
            .bearer_auth("client-key")
            .header("content-type", "application/json")
            .body(r#"{"model":"alias","stream":true}"#)
            .send()
            .await
            .unwrap();
        assert_eq!(response.headers()["content-type"], "text/event-stream");
        assert_eq!(
            response.text().await.unwrap(),
            "data: {\"delta\":\"hello\"}\n\ndata: [DONE]\n\n"
        );
        drop(endpoint);
        upstream.abort();
    }
}
