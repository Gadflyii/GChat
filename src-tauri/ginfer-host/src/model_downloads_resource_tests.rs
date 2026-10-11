//! Identical coordinator-owned before/after download resource measurement.
use super::{tests::{fixture, insert}, *};

// Run this identical fixture once on baseline and candidate, in an otherwise
// idle, admitted process. It measures runtime interference, not download speed.
#[cfg(target_os = "linux")]
#[test]
#[ignore = "coordinator-owned before/after resource measurement"]
fn measure_one_progress_and_full_hash_with_unrelated_control() {
    fn cpu_ticks() -> (u64, u64) {
        let stat = std::fs::read_to_string("/proc/self/stat").unwrap();
        let fields: Vec<_> = stat[stat.rfind(')').unwrap() + 2..].split_whitespace().collect();
        (fields[11].parse().unwrap(), fields[12].parse().unwrap())
    }
    fn io_counts() -> BTreeMap<String, u64> {
        std::fs::read_to_string("/proc/self/io").unwrap().lines().map(|line| {
            let (key, value) = line.split_once(':').unwrap();
            (key.to_owned(), value.trim().parse().unwrap())
        }).collect()
    }
    tokio::runtime::Builder::new_current_thread().enable_all().max_blocking_threads(2)
        .build().unwrap().block_on(async {
            let directory = tempfile::tempdir().unwrap();
            let journal = directory.path().join("jobs.json");
            let manager = ModelDownloads::open(directory.path().join("models"), journal.clone()).unwrap();
            let (mut release, mut bytes) = fixture();
            bytes.resize(4 * 1024 * 1024 + 31, 7);
            release.bytes = bytes.len() as u64;
            release.sha256 = hex::encode(Sha256::digest(&bytes));
            release.launch_profiles.clear();
            let id = insert(&manager, release.clone()).await;
            let package = directory.path().join("measured.ginfer");
            std::fs::write(&package, &bytes).unwrap();
            // Warm the file and existing async filesystem worker equally.
            tokio::fs::metadata(&package).await.unwrap();
            let stopped = Arc::new(AtomicBool::new(false));
            let finished = stopped.clone();
            let (ready, started) = tokio::sync::oneshot::channel();
            let control = tokio::spawn(async move {
                let mut previous = Instant::now();
                let mut max_gap = Duration::ZERO;
                let mut ticks = 0_u64;
                ready.send(()).unwrap();
                loop {
                    tokio::time::sleep(Duration::from_millis(1)).await;
                    let now = Instant::now();
                    max_gap = max_gap.max(now.duration_since(previous));
                    previous = now;
                    ticks += 1;
                    if finished.load(Ordering::SeqCst) { break; }
                }
                (ticks, max_gap.as_nanos())
            });
            started.await.unwrap();
            let cpu_before = cpu_ticks();
            let io_before = io_counts();
            let measurement = crate::resource_measurement::Measurement::start();
            manager.update(id, 128, 16, "downloading").await.unwrap();
            verify_package(package, &release).await.unwrap();
            stopped.store(true, Ordering::SeqCst);
            let (control_ticks, max_control_gap_ns) = control.await.unwrap();
            let measured = measurement.finish("download-one-progress-full-sha");
            let cpu_after = cpu_ticks();
            let io_after = io_counts();
            let io_delta: BTreeMap<_, _> = io_after.iter()
                .map(|(key, value)| (key, value - io_before[key])).collect();
            let saved: BTreeMap<Uuid, Download> = serde_json::from_slice(&std::fs::read(&journal).unwrap()).unwrap();
            assert_eq!(saved[&id].received, 128);
            assert_eq!(saved[&id].status, "downloading");
            println!("DOWNLOAD_RESOURCE_RESULT {}", serde_json::json!({
                "journal_entries":1,"journal_bytes":std::fs::metadata(journal).unwrap().len(),
                "full_hash_bytes":release.bytes,"full_sha256":release.sha256,
                "control_scope":"unrelated current-thread Tokio task; same-journal controls still await durability",
                "control_ticks":control_ticks,"max_control_gap_ns":max_control_gap_ns,
                "user_cpu_ticks":cpu_after.0-cpu_before.0,"system_cpu_ticks":cpu_after.1-cpu_before.1,
                "io_delta":io_delta,"allocations":measured.allocations,
                "allocated_bytes":measured.allocated_bytes,"elapsed_ns":measured.elapsed_ns,
            }));
        });
}
