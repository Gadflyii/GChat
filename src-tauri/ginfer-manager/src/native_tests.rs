use super::*;

fn id(value: u128) -> String {
    Uuid::from_u128(value).to_string()
}

#[test]
fn refresh_keeps_current_locators_order_and_exact_error_fallbacks() {
    let first = json!({"host_id":id(1),"name":"Renamed local","local":true,
        "base_url":"https://new-local:8443","certificate_sha256":"fresh-pin"});
    let problem = json!({"host_id":id(2),"name":"Remote","local":false,
        "base_url":"https://new-remote:8443"});
    let missing = json!({"host_id":id(3),"name":"Never observed","local":false});
    let online = json!({"host_id":id(4),"name":"Online","local":false});
    let saved = json!({"models":[{"model_id":"saved-model"}],
        "instances":[{"instance_id":"saved-instance","session_id":"saved-session"}]});
    let previous = json!({"hosts":[
        {"host_id":id(2),"snapshot":{"revision":9}},
        {"host_id":id(1),"snapshot":saved},
        {"host_id":id(1),"snapshot":{"revision":999}},
        {"host_id":id(5),"snapshot":{"revision":5}}
    ]});
    let fresh = json!({"host_id":id(4),"revision":11,"instances":[]});
    let hosts = project_hosts(
        vec![first, problem, missing, online],
        vec![
            Err(ClientError::Offline("host did not respond".into())),
            Err(ClientError::Problem("certificate has changed".into())),
            Err(ClientError::Offline("new host did not respond".into())),
            Ok(fresh.clone()),
        ],
        &previous,
    );
    assert_eq!(hosts.iter().map(|host| host["host_id"].as_str().unwrap())
        .collect::<Vec<_>>(), vec![id(1), id(2), id(3), id(4)]);
    assert_eq!(hosts[0]["name"], "Renamed local");
    assert_eq!(hosts[0]["base_url"], "https://new-local:8443");
    assert_eq!(hosts[0]["certificate_sha256"], "fresh-pin");
    assert_eq!(hosts[0]["snapshot"], saved);
    assert_eq!(hosts[0]["online"], false);
    assert_eq!(hosts[0]["offline"], true);
    assert_eq!(hosts[0]["error"], "host did not respond");
    assert_eq!(hosts[1]["snapshot"], json!({"revision":9}));
    assert_eq!(hosts[1]["online"], false);
    assert_eq!(hosts[1]["offline"], false);
    assert_eq!(hosts[1]["error"], "certificate has changed");
    assert!(hosts[2]["snapshot"].is_null());
    assert_eq!(hosts[3]["snapshot"], fresh);
    assert_eq!(hosts[3]["online"], true);
    assert_eq!(hosts[3]["offline"], false);
    assert!(hosts[3]["error"].is_null());
}

#[test]
fn command_refresh_error_preserves_snapshot_bytes_and_cached_observation() {
    for snapshot in [
        json!({"hosts":[],"discovered":[],"fleet":null}),
        json!({"hosts":[{"host_id":id(1),"snapshot":{"session_id":"current"}}],
            "discovered":[{"base_url":"https://latest:8443"}],
            "client_name":"Fixture","local_error":null,"fleet":{"connected":true}}),
    ] {
        let cached = ManagerView::new(snapshot.clone());
        assert_eq!(serde_json::to_string(&cached).unwrap(), serde_json::to_string(&snapshot).unwrap());
        let mut response_view = cached.clone();
        response_view.refresh_error = Some("registry write denied".into());
        let response = ManagerResponse { result: json!({"ok":true}), view: response_view };
        let mut expected = snapshot.clone();
        expected["refresh_error"] = "registry write denied".into();
        let expected = json!({"result":{"ok":true},"view":expected});
        assert_eq!(serde_json::to_string(&response).unwrap(), serde_json::to_string(&expected).unwrap());
        assert_eq!(serde_json::to_string(&cached).unwrap(), serde_json::to_string(&snapshot).unwrap(),
            "an action's refresh failure must not change the cached snapshot");
    }
}

#[test]
fn tray_share_uses_first_online_local_and_preserves_errors_and_toggle() {
    for view in [json!({"hosts":[]}), json!({"hosts":[
        {"host_id":id(1),"local":true,"online":false},
        {"host_id":id(2),"local":false,"online":true}
    ]})] {
        assert!(matches!(local_share_request(&view), Err(error) if error == "This computer is offline"));
    }
    let malformed = json!({"hosts":[{"host_id":"not-a-uuid","local":true,"online":true}]});
    let expected = serde_json::from_value::<Uuid>(malformed["hosts"][0]["host_id"].clone())
        .unwrap_err().to_string();
    assert!(matches!(local_share_request(&malformed), Err(error) if error == expected));
    for enabled in [true, false] {
        let view = json!({"hosts":[
            {"host_id":id(1),"local":true,"online":false},
            {"host_id":id(2),"local":true,"online":true,"snapshot":{"lan_sharing":{"enabled":enabled}}},
            {"host_id":id(3),"local":true,"online":true,"snapshot":{"lan_sharing":{"enabled":!enabled}}}
        ]});
        match local_share_request(&view).unwrap() {
            ManagerRequest::Host { host_id, operation: HostOperation::Share, args } => {
                assert_eq!(host_id, Uuid::from_u128(2));
                assert_eq!(args, json!({"enabled":!enabled}));
            }
            _ => panic!("tray Share must remain the host-owned Share action"),
        }
    }
}
