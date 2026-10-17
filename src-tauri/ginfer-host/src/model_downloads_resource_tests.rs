//! Observable download durability and runtime responsiveness regressions.
use super::{tests::{fixture, insert}, *};
use std::{future::Future, task::Poll};

#[test]
fn progress_journal_yields_runtime_and_pause_acknowledges_the_later_durable_state() {
    tokio::runtime::Builder::new_current_thread().enable_all().max_blocking_threads(1)
        .build().unwrap().block_on(async {
            let directory = tempfile::tempdir().unwrap();
            let journal = directory.path().join("jobs.json");
            let manager = ModelDownloads::open(directory.path().join("models"), journal.clone()).unwrap();
            let (release, _) = fixture();
            let id = insert(&manager, release).await;
            let (unblock, blocked) = std::sync::mpsc::channel();
            let (started, ready) = tokio::sync::oneshot::channel();
            let blocker = tokio::task::spawn_blocking(move || {
                started.send(()).unwrap();
                blocked.recv_timeout(Duration::from_secs(5)).unwrap();
            });
            ready.await.unwrap();
            let mut progress = Box::pin(manager.update(id, 64, 8, "downloading"));
            futures_util::future::poll_fn(|cx| {
                assert!(matches!(progress.as_mut().poll(cx), Poll::Pending));
                Poll::Ready(())
            }).await;
            // A blocked journal must not prevent unrelated Tokio control work.
            let unrelated = tokio::spawn(async { "snapshot-control-ready" });
            assert_eq!(unrelated.await.unwrap(), "snapshot-control-ready");
            let mut pause = Box::pin(manager.action(id, "pause"));
            futures_util::future::poll_fn(|cx| {
                assert!(matches!(pause.as_mut().poll(cx), Poll::Pending));
                Poll::Ready(())
            }).await;
            unblock.send(()).unwrap();
            blocker.await.unwrap();
            progress.await.unwrap();
            pause.await.unwrap();
            let saved: BTreeMap<Uuid, Download> = serde_json::from_slice(&std::fs::read(journal).unwrap()).unwrap();
            assert_eq!(saved[&id].received, 64);
            assert_eq!(saved[&id].status, "pausing");
            assert_eq!(manager.list().await[0].status, "pausing");
        });
}

#[test]
fn cancelled_progress_cannot_publish_after_a_newer_pause() {
    tokio::runtime::Builder::new_current_thread().enable_all().max_blocking_threads(1)
        .build().unwrap().block_on(async {
            let directory = tempfile::tempdir().unwrap();
            let journal = directory.path().join("jobs.json");
            let manager = ModelDownloads::open(directory.path().join("models"), journal.clone()).unwrap();
            let (release, _) = fixture();
            let id = insert(&manager, release).await;
            let (unblock, blocked) = std::sync::mpsc::channel();
            let (started, ready) = tokio::sync::oneshot::channel();
            let blocker = tokio::task::spawn_blocking(move || {
                started.send(()).unwrap();
                blocked.recv_timeout(Duration::from_secs(5)).unwrap();
            });
            ready.await.unwrap();
            let mut progress = Box::pin(manager.update(id, 128, 16, "downloading"));
            futures_util::future::poll_fn(|cx| {
                assert!(matches!(progress.as_mut().poll(cx), Poll::Pending));
                Poll::Ready(())
            }).await;
            drop(progress);
            let mut pause = Box::pin(manager.action(id, "pause"));
            futures_util::future::poll_fn(|cx| {
                assert!(matches!(pause.as_mut().poll(cx), Poll::Pending));
                Poll::Ready(())
            }).await;
            unblock.send(()).unwrap();
            blocker.await.unwrap();
            pause.await.unwrap();
            let saved: BTreeMap<Uuid, Download> = serde_json::from_slice(&std::fs::read(journal).unwrap()).unwrap();
            assert_eq!(saved[&id].received, 128);
            assert_eq!(saved[&id].status, "pausing");
            assert!(!manager.pending_journal.load(Ordering::SeqCst));
        });
}

#[tokio::test]
async fn failed_install_journal_retries_the_complete_state_without_reinstalling() {
    let directory = tempfile::tempdir().unwrap();
    let journal = directory.path().join("jobs.json");
    let manager = ModelDownloads::open(directory.path().join("models"), journal.clone()).unwrap();
    let (release, bytes) = fixture();
    let id = insert(&manager, release.clone()).await;
    std::fs::write(manager.root().join(format!("{id}.part")), &bytes).unwrap();
    std::fs::remove_file(&journal).unwrap();
    std::fs::create_dir(&journal).unwrap();
    manager.spawn(id);
    tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            if manager.list().await[0].status == "failed" { break; }
            tokio::task::yield_now().await;
        }
    }).await.unwrap();
    assert!(manager.pending_journal.load(Ordering::SeqCst));
    // The real worker's initial progress failed before publication. Repair the
    // journal, retry its latest state, then resume the same retained full bytes.
    std::fs::remove_dir(&journal).unwrap();
    manager.flush_pending().await.unwrap();
    manager.action(id, "resume").await.unwrap();
    tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            if manager.list().await[0].status == "installed" { break; }
            tokio::task::yield_now().await;
        }
    }).await.unwrap();
    let installed = manager.list().await.remove(0);
    assert_eq!(installed.status, "installed");
    assert_eq!(std::fs::read(installed.path.as_ref().unwrap()).unwrap(), bytes);
    // A failed final journal must also remain retryable after publication.
    std::fs::remove_file(&journal).unwrap();
    std::fs::create_dir(&journal).unwrap();
    assert!(manager.installed(id, installed.path.clone().unwrap(), installed.verification.clone().unwrap()).await.is_err());
    assert!(manager.pending_journal.load(Ordering::SeqCst));
    std::fs::remove_dir(&journal).unwrap();
    manager.flush_pending().await.unwrap();
    let saved: BTreeMap<Uuid, Download> = serde_json::from_slice(&std::fs::read(journal).unwrap()).unwrap();
    assert_eq!(saved[&id].status, "installed");
    assert_eq!(saved[&id].path, installed.path);
    assert!(!manager.pending_journal.load(Ordering::SeqCst));
}

#[tokio::test]
async fn blocking_full_hash_checks_the_entire_payload_and_release_declaration() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("model.ginfer");
    let (mut release, mut bytes) = fixture();
    // Cross the verifier's read-buffer boundary; corrupt the last byte, not a
    // sampled header or directory byte, and require the original full digest.
    bytes.resize(1024 * 1024 + 31, 7);
    release.bytes = bytes.len() as u64;
    release.sha256 = hex::encode(Sha256::digest(&bytes));
    release.launch_profiles.clear();
    std::fs::write(&path, &bytes).unwrap();
    verify_package(path.clone(), &release).await.unwrap();
    *bytes.last_mut().unwrap() ^= 1;
    std::fs::write(&path, &bytes).unwrap();
    assert!(verify_package(path.clone(), &release).await.unwrap_err().contains("SHA256 mismatch"));
    std::fs::write(&path, &bytes[..bytes.len() - 1]).unwrap();
    assert_eq!(verify_package(path, &release).await.unwrap_err(), "package size differs from release");
}

#[tokio::test]
async fn destination_space_preserves_non_ascii_paths_and_reports_missing_directories() {
    let directory = tempfile::tempdir().unwrap();
    let root = directory.path().join("models-模型");
    std::fs::create_dir(&root).unwrap();
    let native = root.canonicalize().unwrap();
    // Windows canonicalize produces a verbatim path; do not strip its prefix.
    assert!(available_bytes(native.clone()).await.unwrap() > 0);
    assert!(available_bytes(native.join("missing")).await.is_err());
    #[cfg(target_os = "linux")]
    {
        use std::os::unix::{ffi::OsStringExt, fs::symlink};
        // Query native path bytes, including names unsuitable for UTF-8 or a
        // subprocess's line-oriented output. Follow the selected path itself.
        let raw = directory.path().join(std::ffi::OsString::from_vec(b"-models \xff\n".to_vec()));
        std::fs::create_dir(&raw).unwrap();
        assert!(available_bytes(raw.clone()).await.unwrap() > 0);
        let link = directory.path().join("destination-link");
        symlink(&raw, &link).unwrap();
        assert!(available_bytes(link).await.unwrap() > 0);
        let dangling = directory.path().join("missing-link");
        symlink(native.join("missing"), &dangling).unwrap();
        assert!(available_bytes(dangling).await.is_err());
        let nul = PathBuf::from(std::ffi::OsString::from_vec(b"/invalid\0path".to_vec()));
        assert!(available_bytes(nul).await.is_err());
        assert!(available_bytes(PathBuf::new()).await.is_err());
    }
    #[cfg(windows)]
    {
        use std::os::windows::ffi::OsStringExt;
        let nul = PathBuf::from(std::ffi::OsString::from_wide(&[67, 58, 92, 0, 120]));
        assert!(available_bytes(nul).await.is_err());
    }
}

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

#[test]
fn cancelled_resume_still_starts_its_durably_admitted_transfer() {
    tokio::runtime::Builder::new_current_thread().enable_all().max_blocking_threads(1)
        .build().unwrap().block_on(async {
            let directory = tempfile::tempdir().unwrap();
            let manager = ModelDownloads::open(directory.path().join("models"), directory.path().join("jobs.json")).unwrap();
            let (release, bytes) = fixture();
            let id = insert(&manager, release).await;
            std::fs::write(manager.root().join(format!("{id}.part")), &bytes).unwrap();
            manager.action(id, "pause").await.unwrap();
            let (release_preflight, hold_preflight) = std::sync::mpsc::channel();
            let (preflight_started, preflight_ready) = tokio::sync::oneshot::channel();
            let preflight_blocker = tokio::task::spawn_blocking(move || {
                preflight_started.send(()).unwrap();
                hold_preflight.recv_timeout(Duration::from_secs(5)).unwrap();
            });
            preflight_ready.await.unwrap();
            let mut resume = Box::pin(manager.action(id, "resume"));
            // Queue storage preflight behind the occupied blocking worker.
            futures_util::future::poll_fn(|cx| {
                assert!(matches!(resume.as_mut().poll(cx), Poll::Pending));
                Poll::Ready(())
            }).await;
            let (unblock, blocked) = std::sync::mpsc::channel();
            let (started, ready) = tokio::sync::oneshot::channel();
            let blocker = tokio::task::spawn_blocking(move || {
                started.send(()).unwrap();
                blocked.recv_timeout(Duration::from_secs(5)).unwrap();
            });
            // The second blocker runs after preflight, before journal persistence.
            release_preflight.send(()).unwrap();
            preflight_blocker.await.unwrap();
            ready.await.unwrap();
            futures_util::future::poll_fn(|cx| {
                assert!(matches!(resume.as_mut().poll(cx), Poll::Pending));
                Poll::Ready(())
            }).await;
            assert!(manager.pending_journal.load(Ordering::SeqCst));
            drop(resume);
            unblock.send(()).unwrap();
            blocker.await.unwrap();
            tokio::time::timeout(Duration::from_secs(5), async {
                loop {
                    let job = manager.list().await.remove(0);
                    if job.status == "installed" {
                        assert_eq!(std::fs::read(job.path.unwrap()).unwrap(), bytes);
                        break;
                    }
                    tokio::task::yield_now().await;
                }
            }).await.unwrap();
        });
}

#[test]
fn cancelled_enqueue_rolls_back_a_failed_journal_before_releasing_jobs() {
    tokio::runtime::Builder::new_current_thread().enable_all().max_blocking_threads(1)
        .build().unwrap().block_on(async {
            let directory = tempfile::tempdir().unwrap();
            let journal = directory.path().join("jobs.json");
            let manager = ModelDownloads::open(directory.path().join("models"), journal.clone()).unwrap();
            std::fs::create_dir(&journal).unwrap();
            let (release, _) = fixture();
            let mut enqueue = Box::pin(manager.enqueue(release));
            futures_util::future::poll_fn(|cx| {
                assert!(matches!(enqueue.as_mut().poll(cx), Poll::Pending));
                Poll::Ready(())
            }).await;
            let (unblock, blocked) = std::sync::mpsc::channel();
            let (started, ready) = tokio::sync::oneshot::channel();
            let blocker = tokio::task::spawn_blocking(move || {
                started.send(()).unwrap();
                blocked.recv_timeout(Duration::from_secs(5)).unwrap();
            });
            ready.await.unwrap();
            futures_util::future::poll_fn(|cx| {
                assert!(matches!(enqueue.as_mut().poll(cx), Poll::Pending));
                Poll::Ready(())
            }).await;
            drop(enqueue);
            unblock.send(()).unwrap();
            blocker.await.unwrap();
            assert!(manager.list().await.is_empty());
            assert!(manager.pending_journal.load(Ordering::SeqCst));
            std::fs::remove_dir(&journal).unwrap();
            manager.flush_pending().await.unwrap();
            let saved: BTreeMap<Uuid, Download> = serde_json::from_slice(&std::fs::read(journal).unwrap()).unwrap();
            assert!(saved.is_empty());
            assert_eq!(manager.serial.available_permits(), 1);
        });
}
