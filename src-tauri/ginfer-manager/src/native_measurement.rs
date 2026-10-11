use super::{project_hosts, refreshed_view, resource_measurement::Measurement};
use ginfer_host::client::ClientError;
use serde_json::{json, Value};
use std::io::Write;
use uuid::Uuid;

#[cfg(target_os = "linux")]
fn thread_cpu_ns() -> u128 {
    #[repr(C)]
    struct Timespec { seconds: i64, nanoseconds: i64 }
    extern "C" {
        fn clock_gettime(clock: i32, value: *mut Timespec) -> i32;
    }
    let mut value = Timespec { seconds: 0, nanoseconds: 0 };
    // Linux CLOCK_THREAD_CPUTIME_ID; this fixture runs synchronously on one thread.
    assert_eq!(unsafe { clock_gettime(3, &mut value) }, 0);
    value.seconds as u128 * 1_000_000_000 + value.nanoseconds as u128
}

#[test]
#[ignore = "one serial process, run by the resource coordinator on baseline and candidate"]
fn one_fleet_refresh_projection() {
    let profiles: Vec<_> = (0..174).map(|index| json!({
        "profile_id":Uuid::from_u128(1000 + index).to_string(),
        "display_name":format!("Saved profile {index}"),
        "launch":{"model_id":"muse-fixture","max_context":131072,"max_concurrency":4,
            "artifact_path":format!("/owned/models/package-{index}/model.ginfer")}
    })).collect();
    let ids: Vec<_> = (1..=8).map(Uuid::from_u128).collect();
    let previous_hosts: Vec<_> = ids.iter().map(|id| json!({
        "host_id":id,"name":"Previous name","local":false,
        "snapshot":{"host_id":id,"revision":41,"launch_profiles":profiles,
            "models":[{"model_id":"muse-fixture","tp_size":1}],"instances":[]}
    })).collect();
    let previous = refreshed_view(
        previous_hosts,
        json!({"discovered":[],"local_error":null}),
        json!({"snapshot":{"revision":3},"authority":{"host_id":ids[0],"origins":["https://saved:8443"]}}),
        Some("Measurement".into()),
    );
    let registrations: Vec<_> = ids.iter().enumerate().map(|(index, id)| json!({
        "host_id":id,"name":format!("Current host {index}"),"local":index == 0,
        "base_url":format!("https://current-{index}:8443"),"certificate_sha256":"current-pin"
    })).collect();
    let mut listed = json!({"registered":registrations,
        "discovered":[{"base_url":"https://discovered:8443"}],"local_error":null});
    let snapshots = ids.iter().enumerate().map(|(index, id)| {
        if index == 7 { Ok(json!({"host_id":id,"revision":42,"launch_profiles":profiles,"instances":[]})) }
        else if index == 3 { Err(ClientError::Problem("certificate has changed".into())) }
        else { Err(ClientError::Offline("host did not respond".into())) }
    }).collect();

    let measurement = Measurement::start();
    #[cfg(target_os = "linux")]
    let cpu_before = thread_cpu_ns();
    let previous = previous.clone();
    let registrations = listed["registered"].as_array_mut().map(std::mem::take).unwrap_or_default();
    let observed_ids = registrations.iter().map(|host| {
        serde_json::from_value(host["host_id"].clone()).unwrap()
    }).collect::<Vec<Uuid>>();
    let hosts = project_hosts(registrations, snapshots, &previous);
    let fleet = json!({"connected":false,"snapshot":previous["fleet"]["snapshot"],
        "authority":previous["fleet"]["authority"],"error":"authority unavailable"});
    let view = refreshed_view(hosts, listed, fleet, Some("Measurement".into()));
    let stored = view.clone();
    let event = serde_json::to_string(&view).unwrap();
    let command = serde_json::to_string(&view).unwrap();
    #[cfg(target_os = "linux")]
    let cpu_ns = thread_cpu_ns() - cpu_before;
    let counts = measurement.finish("manager-native-one-fleet-refresh");
    #[cfg(target_os = "linux")]
    println!("RESOURCE_CPU label=manager-native-one-fleet-refresh thread_cpu_ns={cpu_ns}");

    assert_eq!(observed_ids, ids);
    assert_eq!(event, command);
    assert_eq!(serde_json::to_string(&stored).unwrap(), event);
    let output: Value = serde_json::from_str(&event).unwrap();
    assert_eq!(output["hosts"].as_array().unwrap().len(), 8);
    assert_eq!(output["hosts"][0]["name"], "Current host 0");
    assert_eq!(output["hosts"][0]["snapshot"]["revision"], 41);
    assert_eq!(output["hosts"][3]["offline"], false);
    assert_eq!(output["hosts"][7]["snapshot"]["revision"], 42);
    assert_eq!(output["fleet"]["snapshot"]["revision"], 3);
    assert!(counts.allocations > 0 && counts.allocated_bytes > 0 && counts.elapsed_ns > 0);
    if let Some(path) = std::env::var_os("GINFER_MANAGER_MEASUREMENT_OUTPUT") {
        let mut file = std::fs::OpenOptions::new().write(true).create_new(true).open(path).unwrap();
        file.write_all(event.as_bytes()).unwrap();
    }
    println!("RESOURCE_OUTPUT serialized_bytes={} hosts=8 profiles_per_snapshot=174", event.len());
}
