pub mod api;
pub mod cloud;
pub mod connectors;
pub mod contract;
mod cua_skill;
pub mod executor;
pub mod guest_assets;
#[cfg(any(target_os = "linux", target_os = "windows"))]
pub mod hyperv;
pub mod inference;
#[cfg(any(target_os = "linux", target_os = "windows"))]
pub mod kvm;
#[cfg(any(target_os = "linux", target_os = "windows"))]
pub mod kvm_setup;
pub mod lan_setup;
pub mod m365;
pub mod media;
pub mod schedules;
pub mod service;
pub mod ssh;
pub mod store;
pub mod sub_agents;
pub mod task_files;
pub mod tasks;
pub mod vault;
pub mod workspace;
