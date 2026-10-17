pub mod discovery;
pub mod benchmark_hardware;
pub mod engine_host;
pub mod engine_inventory;
pub mod engine_registry;
pub mod fleet;
pub mod fleet_client;
pub mod facade;
pub mod launch_profiles;
pub mod launcher;
pub mod local_inference;
pub mod local_host;
pub mod local_host_registry;
pub mod model_downloads;
pub mod payload_verification;
pub mod model_storage;
pub mod max_perf;
pub mod response_route;
pub mod service;
pub mod service_owner;
pub mod transport;
pub mod lan_sharing;

pub mod client;

#[cfg(test)]
#[path = "../tests/common/resource_measurement.rs"]
pub(crate) mod resource_measurement;

pub mod hardware_profile;
pub mod first_run;
pub(crate) mod draft_width;

#[cfg(windows)]
pub(crate) mod hardware_profile_windows;

pub mod gbot_bootstrap;
pub mod gbot_control;

#[cfg(target_os = "linux")]
pub mod gbot_login;
