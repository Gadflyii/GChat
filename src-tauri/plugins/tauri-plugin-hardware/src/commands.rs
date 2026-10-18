use crate::{
    types::{CpuStaticInfo, GpuInfo, SystemInfo, SystemUsage},
    vendor::{nvidia, vulkan},
    SYSTEM_INFO,
};
use sysinfo::System;

fn merge_gpu_inventory(mut nvidia_gpus: Vec<GpuInfo>, vulkan_gpus: Vec<GpuInfo>) -> Vec<GpuInfo> {
    // Reconcile only cross-probe aliases. A model name or memory size never
    // identifies a physical card, and two NVML indices must remain separate.
    let nvidia_count = nvidia_gpus.len();
    for gpu in vulkan_gpus {
        let existing = nvidia_gpus[..nvidia_count].iter_mut().find(|nvidia_gpu| {
            match (&nvidia_gpu.pci_address, &gpu.pci_address) {
                (Some(nvidia_pci), Some(vulkan_pci)) => nvidia_pci == vulkan_pci,
                _ => !gpu.uuid.is_empty() && nvidia_gpu.uuid == gpu.uuid,
            }
        });
        if let Some(nvidia_gpu) = existing {
            // Retain the NVML UUID and index used for live memory telemetry.
            nvidia_gpu.vulkan_info = gpu.vulkan_info;
        } else {
            nvidia_gpus.push(gpu);
        }
    }
    nvidia_gpus
}

fn compute_system_info() -> SystemInfo {
    let mut system = System::new();
    system.refresh_memory();

    let gpus = merge_gpu_inventory(nvidia::get_nvidia_gpus(), vulkan::get_vulkan_gpus());

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
        gpus,
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

#[cfg(test)]
mod tests {
    use super::merge_gpu_inventory;
    use crate::{
        types::{GpuInfo, PciAddress, Vendor},
        vendor::{nvidia::NvidiaInfo, vulkan::VulkanInfo},
    };

    fn gpu(uuid: &str, bus: Option<u32>, nvidia_index: Option<u32>) -> GpuInfo {
        GpuInfo {
            name: "NVIDIA RTX PRO 6000 Blackwell Workstation Edition".into(),
            total_memory: 97887,
            vendor: Vendor::NVIDIA,
            uuid: uuid.into(),
            pci_address: bus.map(|bus| PciAddress {
                domain: 0,
                bus,
                device: 0,
                function: 0,
            }),
            driver_version: "580".into(),
            nvidia_info: nvidia_index.map(|index| NvidiaInfo {
                index,
                compute_capability: "12.0".into(),
            }),
            vulkan_info: None,
        }
    }

    fn vulkan_gpu(uuid: &str, bus: Option<u32>, index: u64) -> GpuInfo {
        let mut gpu = gpu(uuid, bus, None);
        gpu.vulkan_info = Some(VulkanInfo {
            index,
            device_type: "DiscreteGpu".into(),
            api_version: "1.3".into(),
            device_id: 0x2bb1,
        });
        gpu
    }

    #[test]
    fn identical_physical_cards_keep_their_nvml_identity_and_merge_pci_aliases() {
        let first_uuid = "5268c64e-5bc4-4be1-ed12-e731c3de56cf";
        let second_uuid = "bb41307d-6d91-5de3-9e23-a4aec948c49c";
        let inventory = merge_gpu_inventory(
            vec![
                gpu(first_uuid, Some(0x41), Some(0)),
                gpu(second_uuid, Some(0x61), Some(1)),
            ],
            // Vulkan enumeration and UUIDs need not match NVML's.
            vec![
                vulkan_gpu("vulkan-second-card", Some(0x61), 0),
                vulkan_gpu("vulkan-first-card", Some(0x41), 1),
            ],
        );

        assert_eq!(inventory.len(), 2);
        assert_eq!(inventory[0].uuid, first_uuid);
        assert_eq!(inventory[0].nvidia_info.as_ref().unwrap().index, 0);
        assert_eq!(inventory[0].vulkan_info.as_ref().unwrap().index, 1);
        assert_eq!(inventory[1].uuid, second_uuid);
        assert_eq!(inventory[1].nvidia_info.as_ref().unwrap().index, 1);
        assert_eq!(inventory[1].vulkan_info.as_ref().unwrap().index, 0);
    }

    #[test]
    fn uuid_aliases_merge_without_pci_but_conflicting_pci_devices_stay_separate() {
        let inventory = merge_gpu_inventory(
            vec![gpu("shared-uuid", Some(0x41), Some(0))],
            vec![
                vulkan_gpu("shared-uuid", None, 0),
                vulkan_gpu("shared-uuid", Some(0x61), 1),
            ],
        );

        assert_eq!(inventory.len(), 2);
        assert_eq!(inventory[0].vulkan_info.as_ref().unwrap().index, 0);
        assert_eq!(inventory[1].vulkan_info.as_ref().unwrap().index, 1);
    }

    #[test]
    fn matching_model_and_memory_without_shared_identity_never_merge_cards() {
        let inventory = merge_gpu_inventory(
            vec![
                gpu("nvml-first", None, Some(0)),
                gpu("nvml-second", None, Some(1)),
            ],
            vec![vulkan_gpu("", None, 0), vulkan_gpu("", None, 1)],
        );

        assert_eq!(inventory.len(), 4);
        assert_eq!(inventory[0].nvidia_info.as_ref().unwrap().index, 0);
        assert_eq!(inventory[1].nvidia_info.as_ref().unwrap().index, 1);
        assert_eq!(inventory[2].vulkan_info.as_ref().unwrap().index, 0);
        assert_eq!(inventory[3].vulkan_info.as_ref().unwrap().index, 1);
    }
}
