//! Gbot control is an owner-approved capability separate from pairing and inference.
use crate::{
    gbot_bootstrap::{Bootstrap, LocalClient},
    service::{write_private, Host, Principal},
};
use hmac::{Hmac, Mac};
use hyper::{Body, Request, Response, StatusCode};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::Sha256;
use std::{
    collections::BTreeMap,
    io::Write,
    path::PathBuf,
    sync::{Arc, Mutex},
};
use tokio::sync::watch;
use uuid::Uuid;

#[derive(Clone, Serialize, Deserialize)]
struct Grant {
    id: Uuid,
    status: String,
}
#[derive(Clone, Default, Serialize, Deserialize)]
struct State {
    bootstrap: Option<Bootstrap>,
    grants: BTreeMap<Uuid, Grant>,
}
#[derive(Clone, Copy, PartialEq, Eq)]
struct Authorization {
    client: Uuid,
    grant: Uuid,
}
struct Lease {
    authorization: Authorization,
    endpoint: String,
    close: Value,
}
pub struct Control {
    directory: PathBuf,
    state: Mutex<State>,
    changed: watch::Sender<u64>,
    leases: Mutex<BTreeMap<Uuid, Lease>>,
    startup: tokio::sync::Mutex<()>,
}
impl Control {
    pub fn open(directory: PathBuf) -> Result<Self, String> {
        let state = match std::fs::read(directory.join("gbot-control.json")) {
            Ok(bytes) => {
                serde_json::from_slice(&bytes).map_err(|e| format!("Gbot control state: {e}"))?
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => State::default(),
            Err(e) => return Err(e.to_string()),
        };
        let (changed, _) = watch::channel(0);
        Ok(Self {
            directory,
            state: Mutex::new(state),
            changed,
            leases: Mutex::new(BTreeMap::new()),
            startup: tokio::sync::Mutex::new(()),
        })
    }
    pub fn status(&self, client: Uuid) -> Value {
        let state = self.state.lock().unwrap();
        json!({"status": state.grants.get(&client).map(|g| g.status.as_str()).unwrap_or("not_requested"), "service_configured":state.bootstrap.is_some()})
    }
    fn log(&self, client: Uuid, event: &str, operation: Option<&str>) -> Result<(), String> {
        let mut options = std::fs::OpenOptions::new();
        options.create(true).append(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let mut log = options
            .open(self.directory.join("gbot-control-events.jsonl"))
            .map_err(|e| e.to_string())?;
        let time = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis();
        writeln!(
            log,
            "{}",
            json!({"unix_ms":time,"client_id":client,"event":event,"operation":operation})
        )
        .map_err(|e| e.to_string())?;
        log.sync_data().map_err(|e| e.to_string())
    }
    pub fn change(&self, client: Uuid, action: &str) -> Result<Value, String> {
        let mut state = self.state.lock().unwrap();
        let mut next = state.clone();
        let status = match action {
            "request" => {
                if next
                    .grants
                    .get(&client)
                    .is_some_and(|g| matches!(g.status.as_str(), "pending" | "approved"))
                {
                    return Ok(
                        json!({"status":next.grants[&client].status,"service_configured":next.bootstrap.is_some()}),
                    );
                }
                next.grants.insert(
                    client,
                    Grant {
                        id: Uuid::new_v4(),
                        status: "pending".into(),
                    },
                );
                "pending"
            }
            "approve" => {
                let grant = next
                    .grants
                    .get_mut(&client)
                    .filter(|g| g.status == "pending")
                    .ok_or("This device has not requested Gbot control")?;
                grant.status = "approved".into();
                "approved"
            }
            "revoke" => {
                if let Some(grant) = next.grants.get_mut(&client) {
                    grant.status = "revoked".into();
                }
                "revoked"
            }
            _ => return Err("Unknown Gbot grant action".into()),
        };
        self.log(client, action, None)?;
        write_private(
            &self.directory.join("gbot-control.json"),
            &serde_json::to_vec(&next).map_err(|e| e.to_string())?,
        )?;
        *state = next;
        self.changed.send_modify(|revision| *revision += 1);
        Ok(json!({"status":status,"service_configured":state.bootstrap.is_some()}))
    }
    fn token_mac(secret: &str, client: Uuid, grant: Uuid) -> Hmac<Sha256> {
        let mut mac =
            Hmac::<Sha256>::new_from_slice(secret.as_bytes()).expect("HMAC accepts arbitrary keys");
        mac.update(b"ginfer-host/gbot-control/v1");
        mac.update(client.as_bytes());
        mac.update(grant.as_bytes());
        mac
    }
    fn claim(&self, client: Uuid, secret: &str) -> Result<Value, String> {
        let state = self.state.lock().unwrap();
        let grant = state
            .grants
            .get(&client)
            .filter(|g| g.status == "approved")
            .ok_or("Approve Gbot control on the service computer first")?;
        self.log(client, "claim", None)?;
        Ok(
            json!({"status":"approved","token":format!("gbot.{client}.{}", hex::encode(Self::token_mac(secret, client, grant.id).finalize().into_bytes()))}),
        )
    }
    fn authenticate(&self, token: &str, secret: &str) -> Option<Authorization> {
        let mut parts = token.split('.');
        if parts.next()? != "gbot" {
            return None;
        }
        let client = parts.next()?.parse().ok()?;
        let signature = hex::decode(parts.next()?).ok()?;
        if parts.next().is_some() {
            return None;
        }
        let state = self.state.lock().unwrap();
        let grant = state
            .grants
            .get(&client)
            .filter(|g| g.status == "approved")?;
        Self::token_mac(secret, client, grant.id)
            .verify_slice(&signature)
            .ok()?;
        Some(Authorization {
            client,
            grant: grant.id,
        })
    }
    pub fn configure(&self, bootstrap: Bootstrap) -> Result<(), String> {
        bootstrap.validate()?;
        let mut state = self.state.lock().unwrap();
        let mut next = state.clone();
        next.bootstrap = Some(bootstrap);
        write_private(
            &self.directory.join("gbot-control.json"),
            &serde_json::to_vec(&next).map_err(|e| e.to_string())?,
        )?;
        *state = next;
        Ok(())
    }
    async fn service(&self) -> Result<LocalClient, String> {
        let _startup = self.startup.lock().await;
        let bootstrap =
            self.state.lock().unwrap().bootstrap.clone().ok_or(
                "Start Gbot once on the service computer to configure its installed runtime",
            )?;
        crate::gbot_bootstrap::ensure_running(&bootstrap).await
    }
    fn authorized(&self, authorization: Authorization) -> bool {
        self.state
            .lock()
            .unwrap()
            .grants
            .get(&authorization.client)
            .is_some_and(|g| g.status == "approved" && g.id == authorization.grant)
    }
    fn register_view(
        &self,
        id: Uuid,
        authorization: Authorization,
        endpoint: String,
        close: Value,
    ) -> Result<(), String> {
        let state = self.state.lock().unwrap();
        if !state
            .grants
            .get(&authorization.client)
            .is_some_and(|g| g.status == "approved" && g.id == authorization.grant)
        {
            return Err("Gbot grant revoked".into());
        }
        self.leases.lock().unwrap().insert(
            id,
            Lease {
                authorization,
                endpoint,
                close,
            },
        );
        Ok(())
    }
    fn view_endpoint(&self, id: Uuid, authorization: Authorization) -> Option<String> {
        let state = self.state.lock().unwrap();
        if !state
            .grants
            .get(&authorization.client)
            .is_some_and(|g| g.status == "approved" && g.id == authorization.grant)
        {
            return None;
        }
        self.leases
            .lock()
            .unwrap()
            .get(&id)
            .filter(|lease| lease.authorization == authorization)
            .map(|lease| lease.endpoint.clone())
    }
    fn close_view(&self, id: Uuid) {
        self.leases.lock().unwrap().remove(&id);
        self.changed.send_modify(|revision| *revision += 1);
    }
    pub(crate) async fn close_client_views(&self, client: Uuid) {
        let bootstrap = self.state.lock().unwrap().bootstrap.clone();
        let leases = {
            let mut views = self.leases.lock().unwrap();
            let ids: Vec<_> = views
                .iter()
                .filter(|(_, lease)| lease.authorization.client == client)
                .map(|(id, _)| *id)
                .collect();
            ids.into_iter()
                .filter_map(|id| views.remove(&id))
                .collect::<Vec<_>>()
        };
        if leases.is_empty() {
            return;
        }
        let closes = async {
            let bootstrap = bootstrap.ok_or("Gbot service runtime unavailable")?;
            let service = crate::gbot_bootstrap::connect(&bootstrap.data_folder).await?;
            for lease in leases {
                service.call("/v1/view/close", lease.close).await?;
            }
            Ok::<_, String>(())
        };
        if !matches!(
            tokio::time::timeout(std::time::Duration::from_secs(2), closes).await,
            Ok(Ok(()))
        ) {
            let _ = self.log(client, "view_close_failed", None);
        }
    }
}

pub fn supported_route(path: &str) -> bool {
    matches!(
        path,
        "/v1/state"
            | "/v1/updates"
            | "/v1/credentials/ssh"
            | "/v1/workspaces"
            | "/v1/workspaces/ssh"
            | "/v1/ssh/identity"
            | "/v1/workspaces/ssh/key"
            | "/v1/workspaces/ssh/check"
            | "/v1/workspaces/ssh/prepare"
            | "/v1/workspaces/ssh/tools"
            | "/v1/assignments/save"
            | "/v1/assignments/get"
            | "/v1/assignments/models"
            | "/v1/connectors/get"
            | "/v1/connectors/save"
            | "/v1/connect"
            | "/v1/disconnect"
            | "/v1/tasks"
            | "/v1/tasks/start"
            | "/v1/tasks/resume"
            | "/v1/tasks/cancel"
            | "/v1/tasks/approvals"
            | "/v1/tasks/approval"
            | "/v1/schedules"
            | "/v1/schedules/create"
            | "/v1/schedules/enabled"
            | "/v1/setup/kvm/preflight"
            | "/v1/setup/kvm/start"
            | "/v1/setup/kvm/status"
            | "/v1/setup/kvm/remove"
            | "/v1/setup/cloud/status"
            | "/v1/setup/cloud/catalog"
            | "/v1/setup/cloud/select"
            | "/v1/setup/cloud/confirm"
            | "/v1/setup/cloud/remove"
            | "/v1/setup/cloud/create"
            | "/v1/setup/cloud/check"
            | "/v1/setup/cloud/delete"
            | "/v1/setup/cloud/identity"
            | "/v1/setup/cloud/attach"
            | "/v1/setup/m365/accounts"
            | "/v1/setup/m365/status"
            | "/v1/setup/m365/assigned"
            | "/v1/setup/m365/save"
            | "/v1/setup/m365/launch"
            | "/v1/setup/m365/remove"
            | "/v1/control/take-over"
            | "/v1/control/hand-back"
            | "/v1/view/open"
            | "/v1/view/close"
    )
}
fn response(status: StatusCode, value: Value) -> Response<Body> {
    Response::builder()
        .status(status)
        .header("content-type", "application/json")
        .body(Body::from(value.to_string()))
        .unwrap()
}
impl Host {
    pub(crate) async fn gbot_route(
        self: &Arc<Self>,
        req: &mut Request<Body>,
    ) -> Result<Response<Body>, String> {
        let path = req.uri().path().to_owned();
        if path == "/host/v1/gbot/bootstrap" {
            if req.method() != hyper::Method::POST
                || self.principal(req).await != Some(Principal::LocalAdministrator)
            {
                return Ok(response(
                    StatusCode::FORBIDDEN,
                    json!({"error":"Local owner approval required"}),
                ));
            }
            let bootstrap = serde_json::from_value(crate::service::body_json(req).await?)
                .map_err(|e| e.to_string())?;
            self.gbot.configure(bootstrap)?;
            return Ok(response(StatusCode::OK, json!({"configured":true})));
        }
        if path == "/host/v1/gbot/grant" {
            let Some(principal) = self.principal(req).await else {
                return Ok(response(
                    StatusCode::UNAUTHORIZED,
                    json!({"error":"Pair this device first"}),
                ));
            };
            let body = if req.method() == hyper::Method::GET {
                Value::Null
            } else if req.method() == hyper::Method::POST {
                crate::service::body_json(req).await?
            } else {
                return Ok(response(
                    StatusCode::METHOD_NOT_ALLOWED,
                    json!({"error":"Use GET or POST"}),
                ));
            };
            let action = body["action"].as_str().unwrap_or("status");
            let data = self.data.lock().await;
            let client = match principal {
                Principal::Client(id) => {
                    if !matches!(action, "status" | "request" | "claim") {
                        return Ok(response(
                            StatusCode::FORBIDDEN,
                            json!({"error":"Only the service computer's owner can approve or revoke Gbot control"}),
                        ));
                    }
                    id
                }
                Principal::LocalAdministrator => serde_json::from_value(body["client_id"].clone())
                    .map_err(|_| "Select a paired device")?,
            };
            if !data.clients.contains_key(&client) || data.local_client_id == Some(client) {
                return Err("Select a remote paired device".into());
            }
            let result = match action {
                "status" => self.gbot.status(client),
                "claim" => self.gbot.claim(client, &data.pairing_admin_token)?,
                "request" | "approve" | "revoke" => self.gbot.change(client, action)?,
                _ => return Err("Unknown grant action".into()),
            };
            drop(data);
            if action == "revoke" {
                self.gbot.close_client_views(client).await;
            }
            if action != "status" {
                self.revision
                    .fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            }
            return Ok(response(StatusCode::OK, result));
        }
        let mut changed = self.gbot.changed.subscribe();
        let bearer = req
            .headers()
            .get("authorization")
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.strip_prefix("Bearer "))
            .unwrap_or("");
        let client = {
            let data = self.data.lock().await;
            self.gbot
                .authenticate(bearer, &data.pairing_admin_token)
                .filter(|authorization| data.clients.contains_key(&authorization.client))
        };
        let Some(authorization) = client else {
            return Ok(response(
                StatusCode::UNAUTHORIZED,
                json!({"error":"Separate approved Gbot control grant required"}),
            ));
        };
        let client = authorization.client;
        self.gbot.log(client, "use", Some(&path))?;
        if path.starts_with("/host/v1/gbot/view/") {
            let id = path
                .trim_start_matches("/host/v1/gbot/view/")
                .parse::<Uuid>()
                .map_err(|_| "Invalid view lease")?;
            let endpoint = self
                .gbot
                .view_endpoint(id, authorization)
                .ok_or("View lease unavailable for this device")?;
            if req.method() != hyper::Method::GET
                || !req
                    .headers()
                    .get("upgrade")
                    .is_some_and(|v| v == "websocket")
            {
                return Err("WebSocket upgrade required".into());
            }
            let downstream = hyper::upgrade::on(&mut *req);
            let mut upstream = Request::builder()
                .method("GET")
                .uri(endpoint.replace("ws://", "http://"))
                .body(Body::empty())
                .map_err(|e| e.to_string())?;
            *upstream.headers_mut() = req.headers().clone();
            upstream.headers_mut().remove("authorization");
            let authority = upstream
                .uri()
                .authority()
                .ok_or("View authority missing")?
                .as_str()
                .to_owned();
            upstream.headers_mut().insert(
                "host",
                authority.parse().map_err(|_| "Invalid view authority")?,
            );
            let mut reply = hyper::Client::new()
                .request(upstream)
                .await
                .map_err(|e| e.to_string())?;
            if reply.status() != StatusCode::SWITCHING_PROTOCOLS {
                return Ok(reply);
            }
            let upgrade = hyper::upgrade::on(&mut reply);
            let host = self.clone();
            tokio::spawn(async move {
                let (Ok(mut down), Ok(mut up)) = tokio::join!(downstream, upgrade) else {
                    return;
                };
                if host.gbot.view_endpoint(id, authorization).is_none() {
                    return;
                }
                let copy = tokio::io::copy_bidirectional(&mut down, &mut up);
                tokio::pin!(copy);
                loop {
                    tokio::select! {
                        _ = &mut copy => break,
                        result = changed.changed() => {
                            if result.is_err() || host.gbot.view_endpoint(id, authorization).is_none() { break; }
                        }
                    }
                }
            });
            return Ok(reply);
        }
        if path != "/host/v1/gbot/control" || req.method() != hyper::Method::POST {
            return Err("Unsupported Gbot control operation".into());
        }
        let body = crate::service::body_json(req).await?;
        let operation = body["path"]
            .as_str()
            .filter(|path| supported_route(path))
            .ok_or("Unsupported Gbot operation")?;
        let mut input = body.get("body").cloned().unwrap_or(Value::Null);
        if operation == "/v1/view/close" {
            let lease_id: Uuid = serde_json::from_value(input["lease_id"].clone())
                .map_err(|_| "Invalid view lease")?;
            let leases = self.gbot.leases.lock().unwrap();
            input = leases
                .get(&lease_id)
                .filter(|lease| lease.authorization == authorization)
                .ok_or("View lease unavailable for this device")?
                .close
                .clone();
        }
        let service = self.gbot.service().await?;
        if !self.gbot.authorized(authorization) {
            return Ok(response(
                StatusCode::UNAUTHORIZED,
                json!({"error":"Gbot grant revoked"}),
            ));
        }
        self.gbot.log(client, "operation", Some(operation))?;
        let mut output = service.call(operation, input.clone()).await?;
        if operation == "/v1/view/open" {
            let lease_id: Uuid = serde_json::from_value(output["lease_id"].clone())
                .map_err(|_| "Invalid view lease")?;
            let endpoint = output["ws_url"]
                .as_str()
                .ok_or("View endpoint missing")?
                .to_owned();
            let url = reqwest::Url::parse(&endpoint).map_err(|_| "Invalid view endpoint")?;
            if url.scheme() != "ws"
                || !url.host_str().is_some_and(|host| {
                    host.parse::<std::net::IpAddr>()
                        .is_ok_and(|ip| ip.is_loopback())
                })
            {
                return Err("View must use a loopback endpoint".into());
            }
            let close = crate::gbot_bootstrap::view_close_request(&input, lease_id);
            if let Err(error) =
                self.gbot
                    .register_view(lease_id, authorization, endpoint, close.clone())
            {
                let _ = service.call("/v1/view/close", close).await;
                return Ok(response(StatusCode::UNAUTHORIZED, json!({"error":error})));
            }
            output["ws_url"] = json!(format!("/host/v1/gbot/view/{lease_id}"));
        } else if operation == "/v1/view/close" {
            if let Ok(id) = serde_json::from_value::<Uuid>(input["lease_id"].clone()) {
                self.gbot.close_view(id);
            }
        }
        if !self.gbot.authorized(authorization) {
            return Ok(response(
                StatusCode::UNAUTHORIZED,
                json!({"error":"Gbot grant revoked"}),
            ));
        }
        Ok(response(StatusCode::OK, output))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn gbot_grant_requires_approval_is_separate_revocable_and_durable() {
        let dir = tempfile::tempdir().unwrap();
        let client = Uuid::new_v4();
        let secret = "local admin";
        let control = Control::open(dir.path().into()).unwrap();
        assert!(control.claim(client, secret).is_err());
        control.change(client, "request").unwrap();
        assert!(control.claim(client, secret).is_err());
        control.change(client, "approve").unwrap();
        let token = control.claim(client, secret).unwrap()["token"]
            .as_str()
            .unwrap()
            .to_owned();
        assert_eq!(
            control.authenticate(&token, secret).map(|a| a.client),
            Some(client)
        );
        assert!(control
            .authenticate(&format!("{client}.inference-token"), secret)
            .is_none());
        let reopened = Control::open(dir.path().into()).unwrap();
        assert_eq!(
            reopened.authenticate(&token, secret).map(|a| a.client),
            Some(client)
        );
        reopened.change(client, "revoke").unwrap();
        assert!(reopened.authenticate(&token, secret).is_none());
        reopened.change(client, "request").unwrap();
        reopened.change(client, "approve").unwrap();
        assert!(reopened.authenticate(&token, secret).is_none());
        let log = std::fs::read_to_string(dir.path().join("gbot-control-events.jsonl")).unwrap();
        assert!(log.contains("approve") && log.contains("revoke") && !log.contains(&token));
    }
    #[test]
    fn views_are_bound_to_one_grant_and_revocation_invalidates_them() {
        let dir = tempfile::tempdir().unwrap();
        let control = Control::open(dir.path().into()).unwrap();
        let first = Uuid::new_v4();
        let second = Uuid::new_v4();
        for client in [first, second] {
            control.change(client, "request").unwrap();
            control.change(client, "approve").unwrap();
        }
        let auth = |client| {
            control
                .authenticate(
                    control.claim(client, "secret").unwrap()["token"]
                        .as_str()
                        .unwrap(),
                    "secret",
                )
                .unwrap()
        };
        let first_auth = auth(first);
        let second_auth = auth(second);
        let lease = Uuid::new_v4();
        let input = json!({"identity":{"workspace":Uuid::new_v4(),"session":Uuid::new_v4()},"owner":Uuid::new_v4()});
        let close = crate::gbot_bootstrap::view_close_request(&input, lease);
        assert_eq!(close["identity"], input["identity"]);
        assert_eq!(close["owner"], input["owner"]);
        assert_eq!(close["lease_id"], json!(lease));
        control
            .register_view(
                lease,
                first_auth,
                "ws://127.0.0.1:1234/view".into(),
                close.clone(),
            )
            .unwrap();
        assert!(control.view_endpoint(lease, second_auth).is_none());
        assert!(control.view_endpoint(lease, first_auth).is_some());
        assert_eq!(control.leases.lock().unwrap()[&lease].close, close);
        let mut changed = control.changed.subscribe();
        control.change(first, "revoke").unwrap();
        assert!(changed.has_changed().unwrap());
        changed.borrow_and_update();
        assert!(control.view_endpoint(lease, first_auth).is_none());
        assert!(control
            .register_view(
                Uuid::new_v4(),
                first_auth,
                "ws://127.0.0.1:1234".into(),
                close
            )
            .is_err());
        control.change(first, "request").unwrap();
        control.change(first, "approve").unwrap();
        assert!(control.view_endpoint(lease, auth(first)).is_none());
    }

    #[test]
    fn gbot_control_cannot_reach_native_credentials_or_shutdown() {
        for path in [
            "/v1/state",
            "/v1/setup/m365/accounts",
            "/v1/tasks/start",
            "/v1/view/open",
        ] {
            assert!(supported_route(path));
        }
        for path in [
            "/v1/native/accounts",
            "/v1/native/auth/begin",
            "/v1/service/shutdown",
            "/v1/vault/unlock",
            "/host/v1/snapshot",
        ] {
            assert!(!supported_route(path));
        }
    }
}
