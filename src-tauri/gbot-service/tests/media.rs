use cua_spacesd_client::{
    pb,
    testing::{Code, MockAuth, MockServer, Status},
};
use gbot_service::{
    contract::{SessionId, SessionIdentity, WorkspaceId},
    media::{MediaLease, OpenView},
};
use hyper::{Body, Client, Request, StatusCode};
use uuid::Uuid;

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
        lease.close().await.unwrap();
        assert!(Client::new().get(url.parse().unwrap()).await.is_err());
    }
    assert_eq!(server.state.observed.media_close.lock().unwrap().len(), 4);
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
}

async fn media_close_fixture() -> (MockServer, MediaLease) {
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
    let url = lease.ticket.ws_url.replacen("ws://", "http://", 1);
    assert_eq!(
        Client::new()
            .get(url.parse().unwrap())
            .await
            .unwrap()
            .status(),
        StatusCode::NOT_FOUND,
        "the local gateway must be listening before close"
    );
    (server, lease)
}

#[tokio::test]
async fn expired_guest_media_closes_the_gateway_and_repeated_close_is_safe() {
    let (server, mut lease) = media_close_fixture().await;
    *server.state.media_close_error.lock().unwrap() =
        Some(Status::not_found("unknown media session"));
    let url = lease.ticket.ws_url.replacen("ws://", "http://", 1);

    for _ in 0..2 {
        lease.close().await.unwrap();
        assert!(Client::new().get(url.parse().unwrap()).await.is_err());
    }

    let closes = server.state.observed.media_close.lock().unwrap();
    assert_eq!(closes.len(), 2);
    assert!(closes
        .iter()
        .all(|request| request.media_session_id == lease.ticket.media_session_id));
}

#[tokio::test]
async fn other_guest_close_errors_remain_failures_with_the_gateway_stopped() {
    for code in [
        Code::Unauthenticated,
        Code::Unavailable,
        Code::DeadlineExceeded,
        Code::PermissionDenied,
    ] {
        let (server, mut lease) = media_close_fixture().await;
        // The same detail as expiry must not turn another status into success.
        *server.state.media_close_error.lock().unwrap() =
            Some(Status::new(code, "unknown media session"));
        let url = lease.ticket.ws_url.replacen("ws://", "http://", 1);

        let error = lease.close().await.unwrap_err();
        assert!(error.to_string().contains("close media"), "{code:?}");
        assert!(
            error.diagnostic().contains("unknown media session"),
            "{code:?}: {error:?}"
        );
        assert!(Client::new().get(url.parse().unwrap()).await.is_err());

        *server.state.media_close_error.lock().unwrap() = None;
        lease.close().await.unwrap();
        assert!(Client::new().get(url.parse().unwrap()).await.is_err());
        let closes = server.state.observed.media_close.lock().unwrap();
        assert_eq!(closes.len(), 2, "{code:?}");
        assert!(closes
            .iter()
            .all(|request| request.media_session_id == lease.ticket.media_session_id));
    }
}
