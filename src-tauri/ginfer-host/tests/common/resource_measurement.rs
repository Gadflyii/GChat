use std::{
    alloc::{GlobalAlloc, Layout, System},
    sync::atomic::{AtomicBool, AtomicU64, Ordering},
    time::Instant,
};

struct CountingAllocator;
static ACTIVE: AtomicBool = AtomicBool::new(false);
static NATIVE_SYSTEM_ONLY: AtomicBool = AtomicBool::new(false);
static ACCOUNTING_LOCK: AtomicBool = AtomicBool::new(false);
static CALLS: AtomicU64 = AtomicU64::new(0);
static BYTES: AtomicU64 = AtomicU64::new(0);
static LIVE_BYTES: AtomicU64 = AtomicU64::new(0);
static PEAK_BYTES: AtomicU64 = AtomicU64::new(0);

struct AccountingGuard;
impl AccountingGuard {
    fn lock() -> Self {
        while ACCOUNTING_LOCK.compare_exchange_weak(false, true, Ordering::Acquire, Ordering::Relaxed).is_err() {
            std::hint::spin_loop();
        }
        Self
    }
}
impl Drop for AccountingGuard {
    fn drop(&mut self) {
        ACCOUNTING_LOCK.store(false, Ordering::Release);
    }
}

/// Only the explicitly filtered native-process fixture uses this irreversible
/// mode. Other allocation fixtures run in separate processes and stay tracked.
#[allow(dead_code)] // Shared integration copies do not select native-process mode.
pub fn native_process_system_allocation() {
    let guard = AccountingGuard::lock();
    if ACTIVE.load(Ordering::Relaxed) {
        drop(guard);
        panic!("native process mode cannot interrupt an active allocation measurement");
    }
    if NATIVE_SYSTEM_ONLY.load(Ordering::Relaxed) {
        drop(guard);
        panic!("native process mode is irreversible and can only be selected once");
    }
    NATIVE_SYSTEM_ONLY.store(true, Ordering::Release);
}

fn record_allocation(previous: usize, bytes: usize) {
    let _guard = AccountingGuard::lock();
    // Track outstanding Rust layouts even outside the measured interval.
    let live = LIVE_BYTES.load(Ordering::Relaxed) - previous as u64 + bytes as u64;
    LIVE_BYTES.store(live, Ordering::Relaxed);
    if ACTIVE.load(Ordering::Relaxed) {
        CALLS.fetch_add(1, Ordering::Relaxed);
        BYTES.fetch_add(bytes as u64, Ordering::Relaxed);
        PEAK_BYTES.fetch_max(live, Ordering::Relaxed);
    }
}

fn record_deallocation(bytes: usize) {
    let _guard = AccountingGuard::lock();
    LIVE_BYTES.fetch_sub(bytes as u64, Ordering::Relaxed);
}

unsafe impl GlobalAlloc for CountingAllocator {
    unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
        let pointer = System.alloc(layout);
        if !pointer.is_null() && !NATIVE_SYSTEM_ONLY.load(Ordering::Acquire) { record_allocation(0, layout.size()); }
        pointer
    }
    unsafe fn alloc_zeroed(&self, layout: Layout) -> *mut u8 {
        let pointer = System.alloc_zeroed(layout);
        if !pointer.is_null() && !NATIVE_SYSTEM_ONLY.load(Ordering::Acquire) { record_allocation(0, layout.size()); }
        pointer
    }
    unsafe fn realloc(&self, pointer: *mut u8, layout: Layout, size: usize) -> *mut u8 {
        let pointer = System.realloc(pointer, layout, size);
        if !pointer.is_null() && !NATIVE_SYSTEM_ONLY.load(Ordering::Acquire) { record_allocation(layout.size(), size); }
        pointer
    }
    unsafe fn dealloc(&self, pointer: *mut u8, layout: Layout) {
        System.dealloc(pointer, layout);
        if !NATIVE_SYSTEM_ONLY.load(Ordering::Acquire) { record_deallocation(layout.size()); }
    }
}

#[global_allocator]
static ALLOCATOR: CountingAllocator = CountingAllocator;

pub struct Measurement { started: Instant, live_bytes_start: u64, finished: bool }
pub struct Counts {
    pub allocations: u64,
    pub allocated_bytes: u64,
    pub elapsed_ns: u128,
    pub live_bytes_start: u64,
    pub live_bytes_end: u64,
    pub peak_live_bytes: u64,
    pub peak_live_bytes_above_start: u64,
}

impl Measurement {
    pub fn start() -> Self {
        let guard = AccountingGuard::lock();
        if NATIVE_SYSTEM_ONLY.load(Ordering::Relaxed) {
            drop(guard);
            panic!("native process mode cannot measure allocator layouts");
        }
        if ACTIVE.load(Ordering::Relaxed) {
            drop(guard);
            panic!("measurements must not overlap");
        }
        CALLS.store(0, Ordering::Relaxed);
        BYTES.store(0, Ordering::Relaxed);
        let live_bytes_start = LIVE_BYTES.load(Ordering::Relaxed);
        PEAK_BYTES.store(live_bytes_start, Ordering::Relaxed);
        let started = Instant::now();
        ACTIVE.store(true, Ordering::Relaxed);
        Self { started, live_bytes_start, finished: false }
    }
    pub fn finish(mut self, label: &str) -> Counts {
        let counts = {
            let _guard = AccountingGuard::lock();
            let elapsed_ns = self.started.elapsed().as_nanos();
            ACTIVE.store(false, Ordering::Relaxed);
            self.finished = true;
            let peak_live_bytes = PEAK_BYTES.load(Ordering::Relaxed);
            Counts {
                allocations: CALLS.load(Ordering::Relaxed),
                allocated_bytes: BYTES.load(Ordering::Relaxed),
                elapsed_ns,
                live_bytes_start: self.live_bytes_start,
                live_bytes_end: LIVE_BYTES.load(Ordering::Relaxed),
                peak_live_bytes,
                peak_live_bytes_above_start: peak_live_bytes - self.live_bytes_start,
            }
        };
        println!("RESOURCE_MEASUREMENT label={label} allocations={} allocated_bytes={} elapsed_ns={} allocator=rust_global live_bytes_start={} live_bytes_end={} peak_live_bytes={} peak_live_bytes_above_start={}",
            counts.allocations, counts.allocated_bytes, counts.elapsed_ns, counts.live_bytes_start,
            counts.live_bytes_end, counts.peak_live_bytes, counts.peak_live_bytes_above_start);
        counts
    }
}
impl Drop for Measurement {
    fn drop(&mut self) {
        if !self.finished {
            let _guard = AccountingGuard::lock();
            ACTIVE.store(false, Ordering::Relaxed);
        }
    }
}
