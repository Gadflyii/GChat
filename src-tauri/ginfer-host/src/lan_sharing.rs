//! Desktop-owned LAN listener, independent of loopback management and inference.
use crate::{discovery::advertise, service::Host};
use std::{sync::Arc, time::Duration};
use tokio::{net::TcpListener, task::JoinHandle};

pub const PORT: u16 = 7444;

pub struct LanSharing {
    pub(crate) port: u16,
    pub managed: bool,
    pub standalone: bool,
    pub error: Option<String>,
    running: Option<Listener>,
}

impl Default for LanSharing {
    fn default() -> Self {
        Self { port: PORT, managed: false, standalone: false, error: None, running: None }
    }
}

struct Listener {
    task: JoinHandle<()>,
    advertisement: mdns_sd::ServiceDaemon,
    fullname: String,
}

impl Listener {
    async fn stop(self) {
        self.task.abort();
        let _ = self.task.await;
        let _ = tokio::task::spawn_blocking(move || {
            if let Ok(done) = self.advertisement.unregister(&self.fullname) {
                let _ = done.recv_timeout(Duration::from_secs(1));
            }
            let _ = self.advertisement.shutdown();
        }).await;
    }
}

impl LanSharing {
    pub fn active(&self) -> bool {
        self.running.as_ref().is_some_and(|listener| !listener.task.is_finished())
    }

    pub fn set<'a>(&'a mut self, host: &'a Arc<Host>, enabled: bool) -> futures_util::future::BoxFuture<'a, Result<(), String>> {
        Box::pin(async move {
        if !self.managed { return Err("LAN sharing is managed by the standalone service configuration".into()); }
        self.error = None;
        if enabled && !self.active() {
            if let Some(previous) = self.running.take() { previous.stop().await; }
            let listener = TcpListener::bind((std::net::Ipv4Addr::UNSPECIFIED, self.port))
                .await.map_err(|e| format!("Cannot open LAN port {}: {e}", self.port))?;
            let data = host.data.lock().await;
            let acceptor = data.certificate.acceptor()?;
            let advertisement = advertise(data.host_id, &data.name, listener.local_addr().map_err(|e| e.to_string())?)?;
            let fullname = format!("{}.{}", data.host_id, crate::discovery::SERVICE_TYPE);
            drop(data);
            let weak = Arc::downgrade(host);
            let task = tokio::spawn(async move {
                let mut connections = tokio::task::JoinSet::new();
                loop {
                    tokio::select! {
                        Some(_) = connections.join_next(), if !connections.is_empty() => {},
                        result = listener.accept() => {
                            let Ok((socket, _)) = result else { break };
                            let Some(host) = weak.upgrade() else { break };
                            let acceptor = acceptor.clone();
                            connections.spawn(async move {
                                let Ok(Ok(tls)) = tokio::time::timeout(Duration::from_secs(10), acceptor.accept(socket)).await else { return };
                                let service = hyper::service::service_fn(move |req| host.clone().route(req));
                                let _ = hyper::server::conn::Http::new().serve_connection(tls, service).await;
                            });
                        },
                    }
                }
            });
            self.running = Some(Listener { task, advertisement, fullname });
        } else if !enabled {
            self.stop().await;
        }
        Ok(())
        })
    }

    pub async fn stop(&mut self) {
        if let Some(listener) = self.running.take() { listener.stop().await; }
    }
}

impl Host {
    pub async fn set_name(&self, name: &str) -> Result<(), String> {
        let name = name.trim();
        if name.is_empty() || name.len() > 80 || name.chars().any(char::is_control) {
            return Err("Host name must contain 1–80 bytes of visible text".into());
        }
        let sharing = self.lan_sharing.lock().await;
        if !sharing.managed { return Err("Host name is managed by the standalone service configuration".into()); }
        let mut data = self.data.lock().await;
        let previous = data.name.clone();
        data.name = name.into();
        let publish = || -> Result<(), String> {
            crate::service::write_private(&self.directory.join("host.json"),
                &serde_json::to_vec(&*data).map_err(|error| error.to_string())?)?;
            if let Some(listener) = &sharing.running {
                crate::discovery::announce(&listener.advertisement, data.host_id, name, sharing.port)?;
            }
            Ok(())
        };
        if let Err(error) = publish() {
            data.name = previous;
            crate::service::write_private(&self.directory.join("host.json"),
                &serde_json::to_vec(&*data).map_err(|error| error.to_string())?)?;
            return Err(error);
        }
        Ok(())
    }

    pub async fn initialize_lan_sharing(self: &Arc<Self>) {
        let mut sharing = self.lan_sharing.lock().await;
        sharing.managed = true;
        let enabled = self.data.lock().await.share_lan;
        if let Err(error) = sharing.set(self, enabled).await { sharing.error = Some(error); }
    }

    pub async fn set_lan_sharing(self: &Arc<Self>, enabled: bool) -> Result<(), String> {
        let mut sharing = self.lan_sharing.lock().await;
        let previous = self.data.lock().await.share_lan;
        if let Err(error) = sharing.set(self, enabled).await {
            sharing.error = Some(error.clone());
            return Err(error);
        }
        self.data.lock().await.share_lan = enabled;
        if let Err(error) = self.save().await {
            self.data.lock().await.share_lan = previous;
            let rollback = sharing.set(self, previous).await.err();
            sharing.error = Some(format!("Cannot save LAN sharing: {error}; rollback: {rollback:?}"));
            return Err(sharing.error.clone().unwrap());
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use hyper::{Body, Request, StatusCode};

    #[tokio::test]
    async fn sharing_defaults_on_requires_admin_and_persists_opt_out() {
        let dir = tempfile::tempdir().unwrap();
        let probe = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = probe.local_addr().unwrap().port();
        drop(probe);
        let open = || async {
            let host = Host::open(dir.path().to_owned(), "Sharing test".into(),
                std::env::current_exe().unwrap(), vec![], vec![], vec![]).await?;
            host.lan_sharing.lock().await.port = port;
            Ok::<_, String>(host)
        };
        let host = open().await.unwrap();
        assert!(host.data.lock().await.share_lan);
        host.initialize_lan_sharing().await;
        assert_eq!(host.snapshot().await["lan_sharing"]["active"], true, "{}", host.snapshot().await["lan_sharing"]);
        let (token, fingerprint) = {
            let data = host.data.lock().await;
            (data.pairing_admin_token.clone(), data.certificate.fingerprint())
        };
        let client = crate::transport::pinned_client(&fingerprint).unwrap();
        let url = format!("https://127.0.0.1:{port}");
        assert_eq!(client.get(format!("{url}/host/v1/snapshot")).send().await.unwrap().status(), StatusCode::UNAUTHORIZED);
        let paired: serde_json::Value = client.post(format!("{url}/host/v1/pair"))
            .json(&serde_json::json!({"client_name":"Remote test"}))
            .send().await.unwrap().json().await.unwrap();
        let remote_token = paired["token"].as_str().unwrap();
        assert_eq!(client.get(format!("{url}/host/v1/snapshot")).bearer_auth(remote_token)
            .send().await.unwrap().status(), StatusCode::OK);
        assert_eq!(client.post(format!("{url}/host/v1/lan-sharing")).bearer_auth(remote_token)
            .json(&serde_json::json!({"enabled":false})).send().await.unwrap().status(), StatusCode::UNAUTHORIZED);
        let request = Request::post("/host/v1/lan-sharing")
            .body(Body::from(r#"{"enabled":false}"#)).unwrap();
        assert_eq!(host.clone().route(request).await.unwrap().status(), StatusCode::UNAUTHORIZED);
        assert!(host.lan_sharing.lock().await.active());
        assert_eq!(client.post(format!("{url}/host/v1/name")).bearer_auth(remote_token)
            .json(&serde_json::json!({"name":"Remote rename"})).send().await.unwrap().status(), StatusCode::UNAUTHORIZED);
        assert!(host.set_name("  ").await.is_err());
        let before = host.boot_id;
        host.set_name("  Lab workstation  ").await.unwrap();
        assert_eq!(host.snapshot().await["display_name"], "Lab workstation");
        assert_eq!(host.boot_id, before);
        assert_eq!(client.get(format!("{url}/host/v1/snapshot")).bearer_auth(remote_token)
            .send().await.unwrap().json::<serde_json::Value>().await.unwrap()["display_name"], "Lab workstation");
        let request = Request::post("/host/v1/lan-sharing")
            .header("authorization", format!("Bearer {token}"))
            .body(Body::from(r#"{"enabled":false}"#)).unwrap();
        assert_eq!(host.clone().route(request).await.unwrap().status(), StatusCode::OK);
        assert!(tokio::net::TcpStream::connect((std::net::Ipv4Addr::LOCALHOST, port)).await.is_err());
        assert!(!host.data.lock().await.share_lan);
        assert!(client.get(format!("{url}/host/v1/snapshot")).bearer_auth(remote_token)
            .timeout(Duration::from_secs(2)).send().await.is_err());
        let request = Request::post("/host/v1/pair")
            .body(Body::from(r#"{"client_name":"Blocked client"}"#)).unwrap();
        assert_eq!(host.clone().route(request).await.unwrap().status(), StatusCode::FORBIDDEN);
        drop(host);
        let host = open().await.unwrap();
        host.initialize_lan_sharing().await;
        assert_eq!(host.snapshot().await["lan_sharing"]["enabled"], false);
        assert_eq!(host.snapshot().await["display_name"], "Lab workstation");
        assert!(!host.lan_sharing.lock().await.active());
        let occupied = TcpListener::bind((std::net::Ipv4Addr::UNSPECIFIED, port)).await.unwrap();
        assert!(host.set_lan_sharing(true).await.is_err());
        assert!(!host.data.lock().await.share_lan);
        assert!(host.snapshot().await["lan_sharing"]["error"].is_string());
        drop(occupied);
        host.set_lan_sharing(true).await.unwrap();
        assert!(host.lan_sharing.lock().await.active());
        host.lan_sharing.lock().await.stop().await;
        drop(host);
        let host = open().await.unwrap();
        host.initialize_lan_sharing().await;
        assert!(host.lan_sharing.lock().await.active());
        host.lan_sharing.lock().await.stop().await;
    }
}
