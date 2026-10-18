use serde::Serialize;

use crate::vendor::{nvidia::NvidiaInfo, vulkan::VulkanInfo};

#[derive(Clone, Serialize, Debug)]
pub struct CpuStaticInfo {
    pub name: String,
    pub core_count: usize,
    pub arch: String,
    pub extensions: Vec<String>,
}

#[derive(Debug, Clone)]
pub enum Vendor {
    AMD,
    NVIDIA,
    Intel,
    Unknown(u32),
}

impl Serialize for Vendor {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        match self {
            Vendor::AMD => "AMD".serialize(serializer),
            Vendor::NVIDIA => "NVIDIA".serialize(serializer),
            Vendor::Intel => "Intel".serialize(serializer),
            Vendor::Unknown(vendor_id) => {
                let formatted = format!("Unknown (vendor_id: {})", vendor_id);
                serializer.serialize_str(&formatted)
            }
        }
    }
}

/// Physical PCI function, shared by NVML and Vulkan even when their UUIDs differ.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PciAddress {
    pub domain: u32,
    pub bus: u32,
    pub device: u32,
    pub function: u32,
}

impl PciAddress {
    pub fn from_bus_id(bus_id: &str) -> Option<Self> {
        let (domain, rest) = bus_id.split_once(':')?;
        let (bus, rest) = rest.split_once(':')?;
        let (device, function) = rest.split_once('.')?;
        Some(Self {
            domain: u32::from_str_radix(domain, 16).ok()?,
            bus: u32::from_str_radix(bus, 16).ok()?,
            device: u32::from_str_radix(device, 16).ok()?,
            function: u32::from_str_radix(function, 16).ok()?,
        })
    }
}

#[derive(Clone, Debug, Serialize)]
pub struct GpuInfo {
    pub name: String,
    pub total_memory: u64,
    pub vendor: Vendor,
    pub uuid: String,
    // Used to reconcile probe aliases before publishing the physical inventory.
    #[serde(skip)]
    pub pci_address: Option<PciAddress>,
    pub driver_version: String,
    pub nvidia_info: Option<NvidiaInfo>,
    pub vulkan_info: Option<VulkanInfo>,
}

#[derive(Serialize, Clone, Debug)]
pub struct SystemInfo {
    pub cpu: CpuStaticInfo,
    pub os_type: String,
    pub os_name: String,
    pub total_memory: u64,
    pub gpus: Vec<GpuInfo>,
}

#[derive(Serialize, Clone, Debug)]
pub struct GpuUsage {
    pub uuid: String,
    pub used_memory: u64,
    pub total_memory: u64,
}

#[derive(Serialize, Clone, Debug)]
pub struct SystemUsage {
    pub cpu: f32,
    pub used_memory: u64,
    pub total_memory: u64,
    pub gpus: Vec<GpuUsage>,
}

#[cfg(test)]
mod tests {
    use super::PciAddress;

    #[test]
    fn nvml_pci_bus_id_preserves_domain_and_function() {
        assert_eq!(
            PciAddress::from_bus_id("00000000:41:00.0"),
            Some(PciAddress {
                domain: 0,
                bus: 0x41,
                device: 0,
                function: 0,
            })
        );
        assert_eq!(
            PciAddress::from_bus_id("0001:ab:02.1"),
            Some(PciAddress {
                domain: 1,
                bus: 0xab,
                device: 2,
                function: 1,
            })
        );
        assert_eq!(PciAddress::from_bus_id("unknown"), None);
    }
}
