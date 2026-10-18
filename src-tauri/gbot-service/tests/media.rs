use cua_spacesd_client::{
    pb,
    testing::{Code, MockAuth, MockServer, Status},
};
use gbot_service::{
    contract::{SessionId, SessionIdentity, WorkspaceId},
    media::{MediaLease, OpenView},
};
use hyper::{Body, Client, Request, StatusCode};
use std::time::Duration;
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::TcpStream,
    task::JoinHandle,
};
use uuid::Uuid;

// Keep a connection to this gateway, rather than probing an address after it
// has been released and may belong to another parallel fixture.
struct GatewayConnection {
    requests: hyper::client::conn::SendRequest<Body>,
    task: Option<JoinHandle<Result<(), hyper::Error>>>,
}

impl GatewayConnection {
    async fn open(lease: &MediaLease) -> Self {
        let url = lease.ticket.ws_url.replacen("ws://", "http://", 1);
        let uri: hyper::Uri = url.parse().unwrap();
        let socket = TcpStream::connect(uri.authority().unwrap().as_str())
            .await
            .unwrap();
        let (requests, connection) = hyper::client::conn::handshake(socket).await.unwrap();
        let mut connection = Self {
            requests,
            task: Some(tokio::spawn(connection)),
        };
        let response = connection
            .requests
            .send_request(Request::get(uri).body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::NOT_FOUND);
        hyper::body::to_bytes(response.into_body()).await.unwrap();
        connection
    }

    async fn assert_closed(&mut self) {
        if let Some(task) = self.task.as_mut() {
            // EOF and a reset both prove the original connection ended. A
            // timeout or a task panic is a teardown failure.
            let _ = tokio::time::timeout(Duration::from_secs(2), task)
                .await
                .expect("the closed gateway must end its existing connection")
                .expect("the gateway connection task must not panic");
            self.task = None;
        }
    }
}

impl Drop for GatewayConnection {
    fn drop(&mut self) {
        if let Some(task) = &self.task {
            task.abort();
        }
    }
}

#[tokio::test]
async fn scoped_media_policies_and_revocation() {
    let root_token = "guest-root-token-never-exposed";
    let server = MockServer::start(MockAuth {
        token: Some(root_token.into()),
        ..Default::default()
    })
    .await;
    server
        .state
        .stream_targets
        .lock()
        .unwrap()
        .push(pb::StreamTarget {
            target: Some(pb::stream_target::Target::Display(pb::Display {
                id: "dedicated".into(),
                ..Default::default()
            })),
            available: true,
            ..Default::default()
        });
    for (interactive, h264) in [(false, false), (true, false), (false, true), (true, true)] {
        let request = OpenView {
            identity: SessionIdentity {
                workspace_id: WorkspaceId::new(),
                session_id: SessionId::new(),
            },
            owner: Uuid::new_v4(),
            interactive,
            audio: interactive,
            h264,
        };
        let mut lease = MediaLease::open(server.addr, root_token.into(), &request)
            .await
            .unwrap();
        assert_eq!(lease.ticket.interactive, interactive);
        assert!(!serde_json::to_string(&lease.ticket)
            .unwrap()
            .contains(root_token));
        {
            let opens = server.state.observed.media_open.lock().unwrap();
            let negotiated = opens.last().unwrap();
            assert_eq!(
                negotiated.policy,
                if interactive {
                    pb::SessionPolicy::AllowActivation
                } else {
                    pb::SessionPolicy::ViewOnly
                } as i32
            );
            assert_eq!(
                negotiated.geometry_control,
                pb::GeometryControl::ObserveOnly as i32
            );
            assert_eq!(
                negotiated.codecs,
                if h264 {
                    vec![
                        pb::MediaCodec::H264,
                        pb::MediaCodec::Png,
                        pb::MediaCodec::Bgra,
                    ]
                } else {
                    vec![pb::MediaCodec::Png, pb::MediaCodec::Bgra]
                }
                .into_iter()
                .map(|codec| codec as i32)
                .collect::<Vec<_>>()
            );
            assert_eq!(negotiated.audio.as_ref().unwrap().enabled, interactive);
        }
        let url = lease.ticket.ws_url.replacen("ws://", "http://", 1);
        let wrong_path = url.split('?').next().unwrap().to_owned() + "?ticket=foreign";
        let response = Client::new()
            .request(
                Request::builder()
                    .uri(wrong_path)
                    .header("upgrade", "websocket")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::NOT_FOUND);
        let mut connection = GatewayConnection::open(&lease).await;
        lease.close().await.unwrap();
        connection.assert_closed().await;
    }
    assert_eq!(server.state.observed.media_close.lock().unwrap().len(), 4);
    server.shutdown().await.unwrap();
}

#[tokio::test]
async fn media_failures_identify_the_operation_and_keep_the_cause() {
    let root_token = "private-media-test-token";
    let server = MockServer::start(MockAuth {
        token: Some(root_token.into()),
        ..Default::default()
    })
    .await;
    let request = OpenView {
        identity: SessionIdentity {
            workspace_id: WorkspaceId::new(),
            session_id: SessionId::new(),
        },
        owner: Uuid::new_v4(),
        interactive: false,
        audio: false,
        h264: false,
    };
    let error = MediaLease::open(server.addr, root_token.into(), &request)
        .await
        .err()
        .unwrap();
    assert!(error.to_string().contains("select display"));
    assert_eq!(
        error.diagnostic(),
        "expected one dedicated display, found 0"
    );
    let error = MediaLease::open(server.addr, "wrong-token".into(), &request)
        .await
        .err()
        .unwrap();
    assert!(error.to_string().contains("connect"));
    assert!(error
        .diagnostic()
        .to_lowercase()
        .contains("unauthenticated"));
    assert!(!format!("{error:?}").contains(root_token));
    server.shutdown().await.unwrap();
}

async fn media_close_fixture() -> (MockServer, MediaLease, GatewayConnection) {
    let root_token = "private-media-close-token";
    let server = MockServer::start(MockAuth {
        token: Some(root_token.into()),
        ..Default::default()
    })
    .await;
    server
        .state
        .stream_targets
        .lock()
        .unwrap()
        .push(pb::StreamTarget {
            target: Some(pb::stream_target::Target::Display(pb::Display {
                id: "dedicated".into(),
                ..Default::default()
            })),
            available: true,
            ..Default::default()
        });
    let lease = MediaLease::open(
        server.addr,
        root_token.into(),
        &OpenView {
            identity: SessionIdentity {
                workspace_id: WorkspaceId::new(),
                session_id: SessionId::new(),
            },
            owner: Uuid::new_v4(),
            interactive: true,
            audio: false,
            h264: false,
        },
    )
    .await
    .unwrap();
    let connection = GatewayConnection::open(&lease).await;
    (server, lease, connection)
}

#[tokio::test]
async fn expired_guest_media_closes_the_gateway_and_repeated_close_is_safe() {
    let (server, mut lease, mut connection) = media_close_fixture().await;
    *server.state.media_close_error.lock().unwrap() =
        Some(Status::not_found("unknown media session"));

    for _ in 0..2 {
        lease.close().await.unwrap();
        connection.assert_closed().await;
    }

    {
        let closes = server.state.observed.media_close.lock().unwrap();
        assert_eq!(closes.len(), 2);
        assert!(closes
            .iter()
            .all(|request| request.media_session_id == lease.ticket.media_session_id));
    }
    drop(lease);
    server.shutdown().await.unwrap();
}

#[tokio::test]
async fn other_guest_close_errors_remain_failures_with_the_gateway_stopped() {
    for code in [
        Code::Unauthenticated,
        Code::Unavailable,
        Code::DeadlineExceeded,
        Code::PermissionDenied,
    ] {
        let (server, mut lease, mut connection) = media_close_fixture().await;
        // The same detail as expiry must not turn another status into success.
        *server.state.media_close_error.lock().unwrap() =
            Some(Status::new(code, "unknown media session"));

        let error = lease.close().await.unwrap_err();
        assert!(error.to_string().contains("close media"), "{code:?}");
        assert!(
            error.diagnostic().contains("unknown media session"),
            "{code:?}: {error:?}"
        );
        connection.assert_closed().await;

        *server.state.media_close_error.lock().unwrap() = None;
        lease.close().await.unwrap();
        connection.assert_closed().await;
        {
            let closes = server.state.observed.media_close.lock().unwrap();
            assert_eq!(closes.len(), 2, "{code:?}");
            assert!(closes
                .iter()
                .all(|request| request.media_session_id == lease.ticket.media_session_id));
        }
        drop(lease);
        server.shutdown().await.unwrap();
    }
}

#[tokio::test]
async fn mock_shutdown_joins_an_incomplete_front_connection() {
    let server = MockServer::start(MockAuth::default()).await;
    let mut socket = TcpStream::connect(server.addr).await.unwrap();
    // Leave protocol detection or the HTTP reader with an incomplete request.
    socket.write_all(b"GET /tunnel").await.unwrap();
    tokio::time::timeout(Duration::from_secs(2), server.shutdown())
        .await
        .expect("mock shutdown must join its ingress and server tasks")
        .unwrap();
    let closed = tokio::time::timeout(Duration::from_secs(2), socket.read(&mut [0]))
        .await
        .expect("mock shutdown must close its original front connection");
    assert!(
        matches!(closed, Ok(0))
            || matches!(closed, Err(ref error) if error.kind() == std::io::ErrorKind::ConnectionReset),
        "original mock connection remained open: {closed:?}"
    );
}
