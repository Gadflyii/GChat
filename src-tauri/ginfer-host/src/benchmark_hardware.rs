//! Public benchmark metadata. No host names, device identifiers or filesystem paths.
use serde_json::{json, Value};

#[cfg(not(windows))]
fn linux_info(cpu: &str, memory: &str, release: &str) -> Value {
    let field = |block: &str, key: &str| block.lines().find_map(|line| {
        let (name, value) = line.split_once(':')?;
        (name.trim() == key).then(|| value.trim().to_owned())
    });
    let processors: Vec<_> = cpu.split("\n\n").filter(|b| field(b, "processor").is_some()).collect();
    let cores: std::collections::BTreeSet<_> = processors.iter().filter_map(|b| {
        Some((field(b, "physical id")?, field(b, "core id")?))
    }).collect();
    let wsl = release.to_ascii_lowercase().contains("microsoft");
    let ram = memory.lines().find_map(|line| line.strip_prefix("MemTotal:")?
        .split_whitespace().next()?.parse::<u64>().ok()).map(|kib| kib * 1024);
    json!({"cpu_model":field(cpu,"model name"),
        "physical_cores":if wsl || cores.is_empty() { None } else { Some(cores.len()) },
        "logical_threads":processors.len(), "ram_bytes":ram, "ram_speed_mt_s":null,
        "os":if wsl {"WSL"} else {"Linux"}, "os_version":release.trim(),
        "resource_scope":if wsl {"wsl-assigned"} else {"os-visible"}})
}

pub async fn collect() -> Value {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        let mut command = tokio::process::Command::new("powershell.exe");
        command.as_std_mut().creation_flags(0x08000000);
        command.kill_on_drop(true).args(["-NoProfile", "-NonInteractive", "-Command",
            "$ErrorActionPreference='Stop'; $c=@(Get-CimInstance Win32_Processor); $r=@(Get-CimInstance Win32_PhysicalMemory); $o=Get-CimInstance Win32_OperatingSystem; @{cpu_model=(($c.Name | Select-Object -Unique) -join ' / '); physical_cores=($c.NumberOfCores | Measure-Object -Sum).Sum; logical_threads=($c.NumberOfLogicalProcessors | Measure-Object -Sum).Sum; ram_bytes=($r.Capacity | Measure-Object -Sum).Sum; ram_speed_mt_s=($r.ConfiguredClockSpeed | Measure-Object -Minimum).Minimum; os='Windows'; os_version=$o.Version; resource_scope='physical'} | ConvertTo-Json -Compress"]);
        if let Ok(Ok(output)) = tokio::time::timeout(std::time::Duration::from_secs(8), command.output()).await {
            if output.status.success() {
                if let Ok(value) = serde_json::from_slice::<Value>(&output.stdout) { return value; }
            }
        }
        json!({"cpu_model":null,"physical_cores":null,"logical_threads":null,
            "ram_bytes":null,"ram_speed_mt_s":null,"os":"Windows","os_version":null,"resource_scope":"unknown"})
    }
    #[cfg(not(windows))]
    {
        let cpu = tokio::fs::read_to_string("/proc/cpuinfo").await.unwrap_or_default();
        let memory = tokio::fs::read_to_string("/proc/meminfo").await.unwrap_or_default();
        let release = tokio::fs::read_to_string("/proc/sys/kernel/osrelease").await.unwrap_or_default();
        linux_info(&cpu, &memory, &release)
    }
}

#[cfg(all(test, not(windows)))]
mod tests {
    use super::*;
    #[test]
    fn reports_visible_resources_without_inventing_wsl_physical_cores() {
        let cpu = "processor : 0\nmodel name : Example CPU\nphysical id : 0\ncore id : 0\n\nprocessor : 1\nphysical id : 0\ncore id : 0\n";
        let native = linux_info(cpu, "MemTotal: 1048576 kB", "6.8");
        assert_eq!(native["physical_cores"], 1);
        assert_eq!(native["logical_threads"], 2);
        assert_eq!(native["ram_bytes"], 1073741824u64);
        let wsl = linux_info(cpu, "MemTotal: 1048576 kB", "6.8-microsoft-standard-WSL2");
        assert_eq!(wsl["os"], "WSL");
        assert!(wsl["physical_cores"].is_null());
        assert!(wsl["ram_speed_mt_s"].is_null());
    }
}
