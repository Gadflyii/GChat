//! Scoped Cua media through the workspace's authenticated SSH connection.
use crate::contract::SessionIdentity;
use cua_spacesd_client::{pb, SpacesdClient};
use hyper::{service::service_fn, Body, Client, Method, Request, Response, StatusCode};
use serde::{Deserialize, Serialize};
use std::{convert::Infallible, net::SocketAddr};
use tokio::{
    net::TcpListener,
    sync::{mpsc, watch},
    task::{JoinHandle, JoinSet},
};
use uuid::Uuid;

#[derive(Clone, Deserialize)]
pub struct OpenView {
    pub identity: SessionIdentity,
    pub owner: Uuid,
    #[serde(default)]
    pub interactive: bool,
    #[serde(default)]
    pub audio: bool,
    #[serde(default)]
    pub h264: bool,
}

#[derive(Deserialize)]
pub struct CloseView {
    pub identity: SessionIdentity,
    pub owner: Uuid,
    pub lease_id: Uuid,
}

#[derive(Clone, Serialize)]
pub struct ViewTicket {
    pub lease_id: Uuid,
    pub ws_url: String,
    pub media_session_id: String,
    pub interactive: bool,
}

#[derive(Debug)]
pub struct MediaError;
impl std::fmt::Display for MediaError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(
            "The bot's desktop media service is unavailable. Reconnect or repair its guest setup.",
        )
    }
}
impl std::error::Error for MediaError {}

pub struct MediaLease {
    pub owner: Uuid,
    pub ticket: ViewTicket,
    client: SpacesdClient,
    stop: watch::Sender<bool>,
    task: Option<JoinHandle<()>>,
}

fn policy(interactive: bool) -> i32 {
    if interactive {
        pb::SessionPolicy::AllowActivation as i32
    } else {
        pb::SessionPolicy::ViewOnly as i32
    }
}

impl MediaLease {
    pub async fn open(
        endpoint: SocketAddr,
        token: String,
        request: &OpenView,
    ) -> Result<Self, MediaError> {
        let client = SpacesdClient::connect_url(&format!("http://{endpoint}"), Some(token))
            .await
            .map_err(|_| MediaError)?;
        let targets = client
            .stream()
            .list_targets(pb::ListTargetsRequest::default())
            .await
            .map_err(|_| MediaError)?
            .into_inner();
        let displays: Vec<_> = targets
            .targets
            .into_iter()
            .filter_map(|target| match target.target {
                Some(pb::stream_target::Target::Display(display)) if target.available => {
                    Some(display)
                }
                _ => None,
            })
            .collect();
        // A dedicated bot guest has one display; never guess another desktop.
        let [display] = displays.as_slice() else {
            return Err(MediaError);
        };
        let listener = TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0))
            .await
            .map_err(|_| MediaError)?;
        let address = listener.local_addr().map_err(|_| MediaError)?;
        let opened = client
            .stream()
            .open_media(pb::OpenMediaRequest {
                target: Some(pb::MediaTarget {
                    target: Some(pb::media_target::Target::DisplayId(display.id.clone())),
                }),
                codecs: if request.h264 { vec![1, 3] } else { vec![3] },
                policy: policy(request.interactive),
                geometry_control: pb::GeometryControl::ObserveOnly as i32,
                audio: Some(pb::AudioOptions {
                    enabled: request.audio,
                    encoding: Some(pb::AudioEncoding {
                        codecs: vec![pb::AudioCodec::PcmS16le as i32],
                        ..Default::default()
                    }),
                    ..Default::default()
                }),
                ..Default::default()
            })
            .await
            .map_err(|_| MediaError)?
            .into_inner();
        let path = opened.ws_path;
        if !path.starts_with("/media?ticket=")
            || path.contains(['\r', '\n', '#'])
            || format!("http://{endpoint}{path}")
                .parse::<hyper::Uri>()
                .is_err()
        {
            let _ = client
                .stream()
                .close_media(pb::CloseMediaRequest {
                    media_session_id: opened.media_session_id,
                })
                .await;
            return Err(MediaError);
        }
        let ticket = ViewTicket {
            lease_id: Uuid::new_v4(),
            ws_url: format!("ws://{address}{path}"),
            media_session_id: opened.media_session_id,
            interactive: request.interactive,
        };
        let (stop, stopped) = watch::channel(false);
        let task = tokio::spawn(gateway(listener, endpoint, path, stopped));
        Ok(Self {
            owner: request.owner,
            ticket,
            client,
            stop,
            task: Some(task),
        })
    }

    pub async fn close(&mut self) -> Result<(), MediaError> {
        self.stop.send_replace(true);
        if let Some(task) = self.task.as_mut() {
            task.await.map_err(|_| MediaError)?;
        }
        self.task = None;
        self.client
            .stream()
            .close_media(pb::CloseMediaRequest {
                media_session_id: self.ticket.media_session_id.clone(),
            })
            .await
            .map_err(|_| MediaError)?;
        Ok(())
    }
}
impl Drop for MediaLease {
    fn drop(&mut self) {
        self.stop.send_replace(true);
    }
}

type Upgrade = (hyper::upgrade::OnUpgrade, hyper::upgrade::OnUpgrade);
async fn gateway(
    listener: TcpListener,
    endpoint: SocketAddr,
    path: String,
    mut stop: watch::Receiver<bool>,
) {
    let (upgrades, mut pending) = mpsc::channel::<Upgrade>(8);
    let mut jobs = JoinSet::new();
    loop {
        tokio::select! {
            biased;
            _ = stop.changed() => break,
            Some((downstream, upstream)) = pending.recv() => {
                jobs.spawn(async move {
                    if let (Ok(mut down), Ok(mut up)) = tokio::join!(downstream, upstream) {
                        let _ = tokio::io::copy_bidirectional(&mut down, &mut up).await;
                    }
                });
            }
            accepted = listener.accept() => {
                let Ok((socket, _)) = accepted else { break; };
                let path = path.clone();
                let upgrades = upgrades.clone();
                jobs.spawn(async move {
                    let service = service_fn(move |request| proxy(request, endpoint, path.clone(), upgrades.clone()));
                    let _ = hyper::server::conn::Http::new().serve_connection(socket, service).with_upgrades().await;
                });
            }
            _ = jobs.join_next(), if !jobs.is_empty() => {}
        }
    }
    jobs.abort_all();
    while jobs.join_next().await.is_some() {}
}

async fn proxy(
    mut request: Request<Body>,
    endpoint: SocketAddr,
    path: String,
    upgrades: mpsc::Sender<Upgrade>,
) -> Result<Response<Body>, Infallible> {
    let reject = || {
        Response::builder()
            .status(StatusCode::NOT_FOUND)
            .body(Body::empty())
            .unwrap()
    };
    if request.method() != Method::GET
        || request.uri().to_string() != path
        || !request
            .headers()
            .get("upgrade")
            .is_some_and(|value| value.as_bytes().eq_ignore_ascii_case(b"websocket"))
    {
        return Ok(reject());
    }
    let downstream = hyper::upgrade::on(&mut request);
    *request.uri_mut() = format!("http://{endpoint}{path}").parse().unwrap();
    request
        .headers_mut()
        .insert("host", endpoint.to_string().parse().unwrap());
    match Client::new().request(request).await {
        Ok(mut response) if response.status() == StatusCode::SWITCHING_PROTOCOLS => {
            let upstream = hyper::upgrade::on(&mut response);
            if upgrades.send((downstream, upstream)).await.is_err() {
                return Ok(reject());
            }
            Ok(response)
        }
        _ => Ok(reject()),
    }
}
