use std::{
    alloc::{GlobalAlloc, Layout, System},
    sync::atomic::{AtomicBool, AtomicU64, Ordering},
    time::Instant,
};

struct CountingAllocator;
static ACTIVE: AtomicBool = AtomicBool::new(false);
static CALLS: AtomicU64 = AtomicU64::new(0);
static BYTES: AtomicU64 = AtomicU64::new(0);

fn record(bytes: usize) {
    if ACTIVE.load(Ordering::Relaxed) {
        CALLS.fetch_add(1, Ordering::Relaxed);
        BYTES.fetch_add(bytes as u64, Ordering::Relaxed);
    }
}

unsafe impl GlobalAlloc for CountingAllocator {
    unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
        let pointer = System.alloc(layout);
        if !pointer.is_null() { record(layout.size()); }
        pointer
    }
    unsafe fn alloc_zeroed(&self, layout: Layout) -> *mut u8 {
        let pointer = System.alloc_zeroed(layout);
        if !pointer.is_null() { record(layout.size()); }
        pointer
    }
    unsafe fn realloc(&self, pointer: *mut u8, layout: Layout, size: usize) -> *mut u8 {
        let pointer = System.realloc(pointer, layout, size);
        if !pointer.is_null() { record(size); }
        pointer
    }
    unsafe fn dealloc(&self, pointer: *mut u8, layout: Layout) {
        System.dealloc(pointer, layout);
    }
}

#[global_allocator]
static ALLOCATOR: CountingAllocator = CountingAllocator;

pub struct Measurement { started: Instant, finished: bool }
pub struct Counts { pub allocations: u64, pub allocated_bytes: u64, pub elapsed_ns: u128 }

impl Measurement {
    pub fn start() -> Self {
        assert!(!ACTIVE.swap(true, Ordering::SeqCst), "measurements must not overlap");
        CALLS.store(0, Ordering::Relaxed);
        BYTES.store(0, Ordering::Relaxed);
        Self { started: Instant::now(), finished: false }
    }
    pub fn finish(mut self, label: &str) -> Counts {
        let elapsed_ns = self.started.elapsed().as_nanos();
        ACTIVE.store(false, Ordering::SeqCst);
        self.finished = true;
        let counts = Counts {
            allocations: CALLS.load(Ordering::Relaxed),
            allocated_bytes: BYTES.load(Ordering::Relaxed),
            elapsed_ns,
        };
        println!("RESOURCE_MEASUREMENT label={label} allocations={} allocated_bytes={} elapsed_ns={}", counts.allocations, counts.allocated_bytes, counts.elapsed_ns);
        counts
    }
}
impl Drop for Measurement {
    fn drop(&mut self) {
        if !self.finished { ACTIVE.store(false, Ordering::SeqCst); }
    }
}
