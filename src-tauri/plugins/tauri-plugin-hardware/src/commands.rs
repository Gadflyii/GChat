use crate::{
    types::{CpuStaticInfo, SystemInfo, SystemUsage},
    vendor::{nvidia, vulkan},
    SYSTEM_INFO,
};
use sysinfo::System;

fn compute_system_info() -> SystemInfo {
    let mut system = System::new();
    system.refresh_memory();

    let mut gpu_map = std::collections::HashMap::new();
    for gpu in nvidia::get_nvidia_gpus() {
        gpu_map.insert(gpu.uuid.clone(), gpu);
    }

    let vulkan_gpus = vulkan::get_vulkan_gpus();

    for gpu in vulkan_gpus {
        match gpu_map.get_mut(&gpu.uuid) {
            // for existing NVIDIA GPUs, add Vulkan info
            Some(nvidia_gpu) => {
                nvidia_gpu.vulkan_info = gpu.vulkan_info;
            }
            None => {
                gpu_map.insert(gpu.uuid.clone(), gpu);
            }
        }
    }

    let os_type = if cfg!(target_os = "windows") {
        "windows"
    } else if cfg!(target_os = "macos") {
        "macos"
    } else if cfg!(target_os = "linux") {
        "linux"
    } else {
        "unknown"
    };
    let os_name = System::long_os_version().unwrap_or("Unknown".to_string());

    SystemInfo {
        cpu: CpuStaticInfo::new(),
        os_type: os_type.to_string(),
        os_name,
        total_memory: system.total_memory() / 1024 / 1024, // bytes to MiB
        gpus: gpu_map.into_values().collect(),
    }
}

#[tauri::command]
pub async fn get_system_info() -> Result<SystemInfo, String> {
    tauri::async_runtime::spawn_blocking(cached_system_info)
        .await
        .map_err(|e| e.to_string())
}

fn cached_system_info() -> SystemInfo {
    {
        let guard = SYSTEM_INFO.read().expect("RwLock poisoned");
        if let Some(ref info) = *guard {
            return info.clone();
        }
    }
    let info = compute_system_info();
    {
        let mut guard = SYSTEM_INFO.write().expect("RwLock poisoned");
        *guard = Some(info.clone());
    }
    info
}

/// Re-detect GPUs after resume or a driver change.
#[tauri::command]
pub fn refresh_system_info() {
    #[cfg(target_os = "linux")]
    nvidia::invalidate_nvml();
    let mut guard = SYSTEM_INFO.write().expect("RwLock poisoned");
    *guard = None;
}

#[tauri::command]
pub async fn get_system_usage() -> Result<SystemUsage, String> {
    tauri::async_runtime::spawn_blocking(sample_system_usage)
        .await
        .map_err(|e| e.to_string())
}

fn sample_system_usage() -> SystemUsage {
    let mut system = System::new();
    system.refresh_memory();

    // CPU utilization needs two samples; this wait runs on the blocking pool.
    system.refresh_cpu_all();
    std::thread::sleep(sysinfo::MINIMUM_CPU_UPDATE_INTERVAL);
    system.refresh_cpu_all();

    let cpus = system.cpus();
    let cpu_usage =
        cpus.iter().map(|cpu| cpu.cpu_usage()).sum::<f32>() / (cpus.len().max(1) as f32);

    SystemUsage {
        cpu: cpu_usage,
        used_memory: system.used_memory() / 1024 / 1024, // bytes to MiB,
        total_memory: system.total_memory() / 1024 / 1024, // bytes to MiB,
        gpus: cached_system_info()
            .gpus
            .iter()
            .map(|gpu| gpu.get_usage())
            .collect(),
    }
}
