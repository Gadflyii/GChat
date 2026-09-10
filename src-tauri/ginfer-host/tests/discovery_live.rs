use ginfer_host::discovery::Discovery;
use std::time::{Duration, Instant};

/// Opt-in cross-host check; the caller owns an already-advertising remote host.
#[test]
#[ignore = "requires GINFER_LAN_HOST_ID and GINFER_LAN_HOST_URL for a real remote host"]
fn discovers_the_remote_host_and_its_reachable_origin() {
    let expected_id = std::env::var("GINFER_LAN_HOST_ID").expect("remote host ID");
    let expected_url = std::env::var("GINFER_LAN_HOST_URL").expect("remote management URL");
    uuid::Uuid::parse_str(&expected_id).expect("valid remote host ID");
    let discovery = Discovery::start().expect("start native GChat discovery");
    let deadline = Instant::now() + Duration::from_secs(20);
    loop {
        let hosts = discovery.hosts();
        if hosts
            .iter()
            .any(|host| host.host_id == expected_id && host.urls.contains(&expected_url))
        {
            return;
        }
        assert!(
            Instant::now() < deadline,
            "remote host and expected LAN origin were not discovered"
        );
        std::thread::sleep(Duration::from_millis(100));
    }
}
