use cua_spacesd_client::{
    pb,
    testing::{MockAuth, MockServer},
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
    for interactive in [false, true] {
        let request = OpenView {
            identity: SessionIdentity {
                workspace_id: WorkspaceId::new(),
                session_id: SessionId::new(),
            },
            owner: Uuid::new_v4(),
            interactive,
            audio: interactive,
            h264: false,
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
            assert_eq!(negotiated.codecs, vec![pb::MediaCodec::Png as i32]);
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
    assert_eq!(server.state.observed.media_close.lock().unwrap().len(), 2);
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
