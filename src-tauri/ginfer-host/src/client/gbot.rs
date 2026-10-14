//! A distinct vault slot and pinned Host channel for approved Gbot control.
use super::{Client, SavedHost};
use hyper::{Body, Request, Response, StatusCode};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{sync::Arc, time::Duration};
use uuid::Uuid;

pub(super) fn credential_slot(host: &SavedHost) -> Uuid {
    let mut hash = Sha256::new();
    hash.update(b"ginfer-host/gbot-control/v1");
    hash.update(host.host_id.as_bytes());
    hash.update(host.client_id.as_bytes());
    let bytes = hash.finalize();
    Uuid::from_bytes(bytes[..16].try_into().expect("SHA256 has 32 bytes"))
}

impl Client {
    async fn gbot_host(&self, id: Uuid) -> Result<SavedHost, String> {
        self.refresh().await?;
        let state = self.state.lock().await;
        let host = state
            .saved
            .get(&id)
            .ok_or("Pair the service computer first")?;
        if state.local_credentials.contains_key(&host.client_id) {
            return Err("Use the local Gbot service for this computer".into());
        }
        Ok(host.clone())
    }
    pub async fn gbot_grant(&self, id: Uuid, action: &str) -> Result<Value, String> {
        let host = self.gbot_host(id).await?;
        if !matches!(action, "status" | "request" | "claim") {
            return Err("Approve or revoke on the service computer".into());
        }
        let mut result = self
            .request_json(
                id,
                reqwest::Method::POST,
                "/host/v1/gbot/grant",
                Some(&json!({"action":action})),
            )
            .await
            .map_err(String::from)?;
        if action == "claim" {
            let token = result["token"]
                .as_str()
                .ok_or("Gbot control credential missing")?;
            self.credentials.set(credential_slot(&host), token).await?;
            result
                .as_object_mut()
                .ok_or("Invalid grant response")?
                .remove("token");
        }
        Ok(result)
    }
    pub async fn gbot_call(&self, id: Uuid, path: &str, body: Value) -> Result<Value, String> {
        if !crate::gbot_control::supported_route(path) {
            return Err("Unsupported Gbot operation".into());
        }
        let host = self.gbot_host(id).await?;
        let token = self
            .credentials
            .get(credential_slot(&host))
            .await
            .map_err(|_| "Request and approve separate Gbot control on the service computer")?;
        let response = self
            .pinned_transport(&host)
            .await?
            .post(format!("{}/host/v1/gbot/control", host.base_url))
            .bearer_auth(token)
            .json(&json!({"path":path,"body":body}))
            .timeout(Duration::from_secs(600))
            .send()
            .await
            .map_err(|e| e.to_string())?;
        crate::transport::response_json(response)
            .await
            .map_err(String::from)
    }
    async fn gbot_view_upgrade(
        &self,
        id: Uuid,
        path: &str,
        req: &Request<Body>,
    ) -> Result<Response<Body>, String> {
        let host = self.gbot_host(id).await?;
        let token = self.credentials.get(credential_slot(&host)).await?;
        let url = reqwest::Url::parse(&host.base_url).map_err(|e| e.to_string())?;
        let name = url.host_str().ok_or("Host address missing")?;
        let port = url.port_or_known_default().ok_or("Host port missing")?;
        let socket = tokio::net::TcpStream::connect((name, port))
            .await
            .map_err(|e| e.to_string())?;
        let config = crate::transport::pinned_tls_config(&host.certificate_sha256)?;
        let stream = tokio_rustls::TlsConnector::from(Arc::new(config))
            .connect(
                rustls::ServerName::try_from(name).map_err(|e| e.to_string())?,
                socket,
            )
            .await
            .map_err(|e| e.to_string())?;
        let (mut sender, connection) = hyper::client::conn::handshake(stream)
            .await
            .map_err(|e| e.to_string())?;
        tokio::spawn(async move {
            let _ = connection.await;
        });
        let mut upstream = Request::builder()
            .method("GET")
            .uri(path)
            .body(Body::empty())
            .map_err(|e| e.to_string())?;
        *upstream.headers_mut() = req.headers().clone();
        upstream.headers_mut().insert(
            "host",
            format!("{name}:{port}")
                .parse()
                .map_err(|_| "Invalid Host address")?,
        );
        upstream.headers_mut().insert(
            "authorization",
            format!("Bearer {token}")
                .parse()
                .map_err(|_| "Invalid Gbot credential")?,
        );
        sender
            .send_request(upstream)
            .await
            .map_err(|e| e.to_string())
    }
    /// Browser sees only a single-use loopback address, never the control credential.
    pub async fn gbot_view_bridge(
        self: &Arc<Self>,
        id: Uuid,
        path: &str,
    ) -> Result<(String, tokio::task::JoinHandle<()>), String> {
        let lease = path
            .strip_prefix("/host/v1/gbot/view/")
            .ok_or("Invalid remote view path")?;
        lease
            .parse::<Uuid>()
            .map_err(|_| "Invalid remote view lease")?;
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .map_err(|e| e.to_string())?;
        let endpoint = listener.local_addr().map_err(|e| e.to_string())?;
        let browser_path = format!("/{}", Uuid::new_v4());
        let url = format!("ws://{endpoint}{browser_path}");
        let client = self.clone();
        let path = path.to_owned();
        let task = tokio::spawn(async move {
            let Ok(Ok((socket, _))) =
                tokio::time::timeout(Duration::from_secs(30), listener.accept()).await
            else {
                return;
            };
            let (send, receive) = tokio::sync::oneshot::channel();
            let send = Arc::new(std::sync::Mutex::new(Some(send)));
            let service = hyper::service::service_fn(move |mut req: Request<Body>| {
                let client = client.clone();
                let path = path.clone();
                let browser_path = browser_path.clone();
                let send = send.clone();
                async move {
                    if req.uri().path() != browser_path
                        || req.method() != hyper::Method::GET
                        || !req
                            .headers()
                            .get("upgrade")
                            .is_some_and(|v| v == "websocket")
                    {
                        return Ok::<_, hyper::Error>(
                            Response::builder()
                                .status(StatusCode::FORBIDDEN)
                                .body(Body::empty())
                                .unwrap(),
                        );
                    }
                    let result = tokio::time::timeout(
                        Duration::from_secs(10),
                        client.gbot_view_upgrade(id, &path, &req),
                    )
                    .await;
                    match result {
                        Ok(Ok(mut reply)) if reply.status() == StatusCode::SWITCHING_PROTOCOLS => {
                            if let Some(send) = send.lock().unwrap().take() {
                                let _ = send.send((
                                    hyper::upgrade::on(&mut req),
                                    hyper::upgrade::on(&mut reply),
                                ));
                                Ok(reply)
                            } else {
                                Ok(Response::builder()
                                    .status(StatusCode::GONE)
                                    .body(Body::empty())
                                    .unwrap())
                            }
                        }
                        _ => Ok(Response::builder()
                            .status(StatusCode::BAD_GATEWAY)
                            .body(Body::empty())
                            .unwrap()),
                    }
                }
            });
            let connection = hyper::server::conn::Http::new()
                .serve_connection(socket, service)
                .with_upgrades();
            let proxy = async {
                let Ok(Ok((down, up))) =
                    tokio::time::timeout(Duration::from_secs(15), receive).await
                else {
                    return;
                };
                let (Ok(mut down), Ok(mut up)) = tokio::join!(down, up) else {
                    return;
                };
                let _ = tokio::io::copy_bidirectional(&mut down, &mut up).await;
            };
            let _ = tokio::join!(connection, proxy);
        });
        Ok((url, task))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn gbot_credentials_have_a_distinct_slot_per_host_and_paired_device() {
        let mut host = SavedHost {
            host_id: Uuid::new_v4(),
            client_id: Uuid::new_v4(),
            name: "Test".into(),
            base_url: "https://127.0.0.1:7444".into(),
            certificate_sha256: "00".repeat(32),
        };
        let slot = credential_slot(&host);
        assert_ne!(slot, host.client_id);
        assert_eq!(slot, credential_slot(&host));
        host.client_id = Uuid::new_v4();
        assert_ne!(slot, credential_slot(&host));
        host.host_id = Uuid::new_v4();
        assert_ne!(slot, credential_slot(&host));
    }
}
