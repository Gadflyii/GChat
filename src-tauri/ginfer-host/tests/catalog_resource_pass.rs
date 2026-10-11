//! One fresh metadata/catalog pass; synthetic directories and GPUs, no Engine or payload qualification.
#[path = "common/resource_measurement.rs"]
mod resource_measurement;

use ginfer_host::{
    engine_host::LaunchOptions,
    engine_inventory::{artifact_set_members, ArtifactIdentity},
    launch_profiles::{LaunchProfile, Qualification, QualificationTier, HEADROOM_BYTES},
    service::Gpu,
};
use serde_json::json;
use sha2::{Digest, Sha256};
use std::{collections::BTreeSet, fs::File, io::Write, path::Path};
#[cfg(target_os = "linux")]
use std::io::{Read, Seek};

fn write_member(path: &Path, model: &str, tp: u32) -> (u64, u64) {
    let mut objects: Vec<_> = (0..10_000).map(|index| json!({
        "kind":"tensor", "rank":0, "name":format!("unrelated/layer/{index}/weight")
    })).collect();
    if model == "qwen3.8-flash-next" {
        objects.push(json!({"kind":"tensor", "rank":"all", "name":"nvfp4_kv/profile_v2"}));
        objects.push(json!({"kind":"resource", "name":"nvfp4_kv/provenance"}));
        for rank in 0..tp {
            let placement = if tp == 1 { json!("all") } else { json!(rank) };
            for suffix in ["body_inverse_global_scales", "mtp_inverse_global_scales"] {
                objects.push(json!({"kind":"tensor", "rank":placement, "name":format!("nvfp4_kv/{suffix}")}));
            }
        }
    } else {
        let suffixes: &[&str] = if model == "muse-glimmer-30b" {
            &["profile_v2", "full_inverse_global_scales", "sliding_inverse_global_scales"]
        } else { &["profile_v1", "inverse_global_scales"] };
        for rank in 0..tp {
            for suffix in suffixes {
                objects.push(json!({"kind":"tensor", "rank":rank, "name":format!("text/kv_cache/nvfp4_g16/{suffix}")}));
            }
        }
    }
    let directory = serde_json::to_vec(&json!({
        "identity":{"model_id":model,"weights_id":"nvfp4"},
        "tp_size":tp,"draft_tp":0,"objects":objects,
    })).unwrap();
    let payload_offset = (16 + directory.len() as u64 + 4095) & !4095;
    let size = payload_offset + 4096;
    let mut file = File::create(path).unwrap();
    file.write_all(b"NINFER\0\x03").unwrap();
    file.write_all(&(directory.len() as u64).to_le_bytes()).unwrap();
    file.write_all(&directory).unwrap();
    file.set_len(size).unwrap();
    (size, 16 + directory.len() as u64)
}

#[cfg(target_os = "linux")]
fn proc_snapshot(file: &mut File, buffer: &mut [u8]) -> usize {
    file.rewind().unwrap();
    file.read(buffer).unwrap()
}

#[cfg(target_os = "linux")]
fn io_field(bytes: &[u8], name: &str) -> u64 {
    std::str::from_utf8(bytes).unwrap().lines().find_map(|line| {
        let (key, value) = line.split_once(':')?;
        (key == name).then(|| value.trim().parse().unwrap())
    }).unwrap()
}

#[test]
#[ignore = "one filtered serial baseline/candidate resource measurement"]
fn catalog_resource_pass() {
    let directory = tempfile::tempdir().unwrap();
    let mut sets = Vec::new();
    let mut profiles = Vec::new();
    let mut expected_read_bytes = 0;
    for model in ["muse-glimmer-30b", "qwen3.8-27b", "qwen3.8-flash-next"] {
        let mut declarations = Vec::new();
        for tp in [1, 2, 4] {
            let name = format!("{model}-{tp}.ginfer");
            let (size, read_bytes) = write_member(&directory.path().join(&name), model, tp);
            expected_read_bytes += read_bytes;
            declarations.push(json!({"tp":tp,"draft_tp":0,"path":name,"bytes":size,"sha256":"a".repeat(64)}));
            let profile = LaunchProfile {
                id: format!("{model}-{tp}"), name: "Synthetic resource fixture, not qualification".into(),
                platform: std::env::consts::OS.into(),
                identity: ArtifactIdentity { model_id:model.into(), weights_id:"nvfp4".into() },
                artifact_sha256: "a".repeat(64), artifact_bytes:size, tp, draft_tp:0,
                gpu_name: "Fixture GPU".into(), compute_capability:"12.0".into(),
                vram_tier_gib:32, min_memory_mib_per_gpu:32000, max_context:65536, concurrency:4,
                options: LaunchOptions::default(),
                qualification: Qualification {
                    tier: QualificationTier::FullContextTested, evidence:"synthetic only".into(),
                    engine_revision:"fixture".into(), free_bytes_per_gpu:Some(HEADROOM_BYTES),
                    full_context_requests:4, calculation:None, smoke_requests:None,
                },
            };
            profile.validate().unwrap();
            profiles.push(profile);
        }
        let set = serde_json::to_vec(&json!({
            "schema":"ginfer-artifact-set-v1",
            "identity":{"model_id":model,"weights_id":"nvfp4","family_id":"b".repeat(64)},
            "canonical_reconstructed_target_sha256":"c".repeat(64),
            "canonical_reconstructed_draft_sha256":null,"artifacts":declarations,
        })).unwrap();
        expected_read_bytes += set.len() as u64;
        let path = directory.path().join(format!("{model}.json"));
        std::fs::write(&path, set).unwrap();
        sets.push(path);
    }
    let templates = profiles.clone();
    profiles = (0..174).map(|index| {
        let mut profile = templates[index % templates.len()].clone();
        profile.id = format!("profile-{index}");
        profile
    }).collect();
    let gpus: Vec<_> = (0..8).map(|index| Gpu {
        uuid:format!("GPU-{index}"), name:"Fixture GPU".into(), display_name:None,
        memory_mib:32607, compute_capability:Some("12.0".into()),
    }).collect();
    let reserved = BTreeSet::new();

    #[cfg(target_os = "linux")]
    let mut io_file = File::open("/proc/self/io").unwrap();
    #[cfg(target_os = "linux")]
    let mut cpu_file = File::open("/proc/thread-self/schedstat").unwrap();
    #[cfg(target_os = "linux")]
    let mut cpu_bytes = [0u8; 128];
    #[cfg(target_os = "linux")]
    let cpu_before = {
        let count = proc_snapshot(&mut cpu_file, &mut cpu_bytes);
        std::str::from_utf8(&cpu_bytes[..count]).unwrap().split_whitespace().next().unwrap().parse::<u64>().unwrap()
    };
    #[cfg(target_os = "linux")]
    let mut io_bytes = [0u8; 512];
    #[cfg(target_os = "linux")]
    let (rchar_before, syscr_before, io_probe_bytes) = {
        let count = proc_snapshot(&mut io_file, &mut io_bytes);
        (io_field(&io_bytes[..count], "rchar"), io_field(&io_bytes[..count], "syscr"), count as u64)
    };

    let measurement = resource_measurement::Measurement::start();
    let members: Vec<_> = sets.iter().flat_map(|path| artifact_set_members(path).unwrap()).collect();
    let choices: Vec<_> = profiles.iter().map(|profile| {
        (profile.id.clone(), profile.gpu_groups(&gpus, &reserved))
    }).collect();
    #[cfg(target_os = "linux")]
    let (cpu_after, cpu_probe_bytes) = {
        let count = proc_snapshot(&mut cpu_file, &mut cpu_bytes);
        (std::str::from_utf8(&cpu_bytes[..count]).unwrap().split_whitespace().next().unwrap().parse::<u64>().unwrap(), count as u64)
    };
    #[cfg(target_os = "linux")]
    let (rchar_after, syscr_after) = {
        let count = proc_snapshot(&mut io_file, &mut io_bytes);
        (io_field(&io_bytes[..count], "rchar"), io_field(&io_bytes[..count], "syscr"))
    };
    let counts = measurement.finish("catalog");

    assert_eq!(members.len(), 9);
    assert!(members.iter().all(|(_, metadata)| metadata.nvfp4_kv_available));
    for profile in &profiles {
        assert_eq!(members.iter().filter(|(_, metadata)| {
            metadata.identity == profile.identity && metadata.tp_size == profile.tp
                && metadata.draft_tp == profile.draft_tp && metadata.size_bytes == profile.artifact_bytes
        }).count(), 1);
    }
    assert_eq!(choices.iter().map(|(_, groups)| groups.len()).sum::<usize>(), 6148);
    let facts: Vec<_> = members.iter().map(|(path, metadata)| (path.file_name().unwrap().to_str().unwrap(), metadata)).collect();
    let digest = hex::encode(Sha256::digest(serde_json::to_vec(&(facts, choices)).unwrap()));
    #[cfg(target_os = "linux")]
    {
        let read_bytes = rchar_after - rchar_before - io_probe_bytes - cpu_probe_bytes;
        let read_calls = syscr_after - syscr_before - 2;
        assert_eq!(read_bytes, expected_read_bytes);
        println!("CATALOG_PASS {}", json!({
            "artifact_sets":3,"members":9,"profiles":174,"gpus":8,"choices":6148,
            "allocations":counts.allocations,"allocated_bytes":counts.allocated_bytes,"elapsed_ns":counts.elapsed_ns,
            "thread_cpu_ns_with_probe_overhead":cpu_after-cpu_before,
            "directory_read_bytes":read_bytes,"read_calls":read_calls,"opens":null,
            "output_sha256":digest,"scope":"synthetic single fresh pass; no payload hash or Engine",
        }));
    }
    #[cfg(not(target_os = "linux"))]
    println!("CATALOG_PASS {}", json!({"allocations":counts.allocations,"allocated_bytes":counts.allocated_bytes,"elapsed_ns":counts.elapsed_ns,"opens":null,"output_sha256":digest,"expected_directory_read_bytes":expected_read_bytes}));
}
