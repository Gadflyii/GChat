//! Host CPU facts for the GInfer CPU device: the instruction-set path a CPU model can use and
//! the Host RAM it can plan against. The Engine still admits the exact route at startup.
use serde::Serialize;

/// The CPU paths GInfer launch profiles and GBench name: AMX, AVX-512 (VNNI) and AVX2.
pub const ISA_PATHS: [&str; 3] = ["amx", "avx512", "avx2"];

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
pub struct CpuFacts {
    pub model_name: Option<String>,
    /// Best CPU path this processor admits, or None when it lacks AVX2/FMA/F16C.
    pub isa_path: Option<&'static str>,
    pub logical_cpus: usize,
    pub total_ram_bytes: Option<u64>,
}

/// Plain label for a CPU path, as GBench and the Models page show it.
pub fn isa_label(path: &str) -> &'static str {
    match path {
        "amx" => "CPU AMX",
        "avx512" => "CPU AVX-512",
        "avx2" => "CPU AVX2",
        _ => "CPU",
    }
}

/// The best path from Linux `/proc/cpuinfo` flag names. AMX needs the INT8 tiles, AVX-512 its
/// VNNI and byte/word forms, and every path the x86-64-v3 base (AVX2, FMA, F16C).
pub fn isa_path_from_flags<'a>(flags: impl IntoIterator<Item = &'a str>) -> Option<&'static str> {
    let flags: std::collections::BTreeSet<_> = flags.into_iter().collect();
    let has = |name: &str| flags.contains(name);
    if !(has("avx2") && has("fma") && has("f16c")) {
        return None;
    }
    if has("amx_tile") && has("amx_int8") && has("avx512_vnni") {
        return Some("amx");
    }
    if has("avx512f") && has("avx512bw") && has("avx512_vnni") {
        return Some("avx512");
    }
    Some("avx2")
}

fn meminfo_bytes(meminfo: &str, key: &str) -> Option<u64> {
    meminfo.lines().find_map(|line| {
        let rest = line.strip_prefix(key)?.strip_prefix(':')?;
        let kib: u64 = rest.trim().strip_suffix("kB")?.trim().parse().ok()?;
        kib.checked_mul(1024)
    })
}

pub fn detect() -> CpuFacts {
    let logical_cpus = std::thread::available_parallelism().map(usize::from).unwrap_or(0);
    #[cfg(target_os = "linux")]
    {
        let cpuinfo = std::fs::read_to_string("/proc/cpuinfo").unwrap_or_default();
        let field = |name: &str| {
            cpuinfo.lines().find_map(|line| {
                let (key, value) = line.split_once(':')?;
                (key.trim() == name).then(|| value.trim().to_owned())
            })
        };
        let flags = field("flags").unwrap_or_default();
        CpuFacts {
            model_name: field("model name"),
            isa_path: isa_path_from_flags(flags.split_whitespace()),
            logical_cpus,
            total_ram_bytes: std::fs::read_to_string("/proc/meminfo")
                .ok()
                .and_then(|text| meminfo_bytes(&text, "MemTotal")),
        }
    }
    #[cfg(not(target_os = "linux"))]
    {
        // Windows CPU serving waits for the native Engine decision; report the path only.
        #[cfg(target_arch = "x86_64")]
        let isa_path = {
            let base = std::arch::is_x86_feature_detected!("avx2")
                && std::arch::is_x86_feature_detected!("fma")
                && std::arch::is_x86_feature_detected!("f16c");
            let avx512 = std::arch::is_x86_feature_detected!("avx512f")
                && std::arch::is_x86_feature_detected!("avx512bw")
                && std::arch::is_x86_feature_detected!("avx512vnni");
            base.then_some(if avx512 { "avx512" } else { "avx2" })
        };
        #[cfg(not(target_arch = "x86_64"))]
        let isa_path = None;
        CpuFacts { model_name: None, isa_path, logical_cpus, total_ram_bytes: None }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn paths_follow_the_engine_routes() {
        let base = ["avx2", "fma", "f16c"];
        assert_eq!(isa_path_from_flags(["avx2", "fma"]), None);
        assert_eq!(isa_path_from_flags(base), Some("avx2"));
        assert_eq!(isa_path_from_flags(base.into_iter().chain(["avx_vnni"])), Some("avx2"));
        let avx512 = base.into_iter().chain(["avx512f", "avx512bw", "avx512_vnni"]);
        assert_eq!(isa_path_from_flags(avx512.clone()), Some("avx512"));
        assert_eq!(isa_path_from_flags(avx512.clone().chain(["amx_tile"])), Some("avx512"));
        assert_eq!(isa_path_from_flags(avx512.chain(["amx_tile", "amx_int8"])), Some("amx"));
        assert_eq!(isa_label("avx512"), "CPU AVX-512");
    }

    #[test]
    fn meminfo_reads_kib_lines() {
        let text = "MemTotal:       131072 kB\nMemFree:  1 kB\nMemAvailable:    65536 kB\n";
        assert_eq!(meminfo_bytes(text, "MemTotal"), Some(131072 * 1024));
        assert_eq!(meminfo_bytes(text, "MemAvailable"), Some(65536 * 1024));
        assert_eq!(meminfo_bytes(text, "Mem"), None);
    }
}
