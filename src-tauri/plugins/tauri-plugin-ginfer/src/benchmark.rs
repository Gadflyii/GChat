use crate::state::{BenchmarkControl, GinferState, SessionInfo};
use serde::{Deserialize, Serialize};
use std::sync::atomic::Ordering;
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{Emitter, Manager, Runtime, State};

const MAX_BENCHMARK_ROUNDS: u32 = 5;
const MAX_PROMPT_TOKENS: u32 = 262_144;
const MAX_OUTPUT_TOKENS: u32 = 65_536;

#[derive(Debug, Clone, Deserialize)]
pub struct BenchmarkRequest {
    pub benchmark_id: String,
    pub run_id: String,
    pub session_pid: Option<i32>,
    pub prompt_tokens: u32,
    pub max_output_tokens: u32,
    pub concurrencies: Vec<u32>,
    pub warmup_rounds: u32,
    pub measured_rounds: u32,
}

#[derive(Debug, Clone, Serialize)]
pub struct BenchmarkSession {
    pub display_name: String,
    pub pid: Option<i32>,
    pub target_id: String,
    pub session_id: Option<String>,
    pub model_id: String,
    pub model_path: String,
    pub max_context: u32,
    pub max_concurrency: u32,
    pub vision: bool,
    pub spec: String,
    pub draft_tokens: u32,
    pub draft_tp: u32,
    pub kv_dtype: String,
    pub prefill_chunk: u32,
    pub cuda_graph: bool,
}

/// Native-only resolved endpoint. Authentication and certificate trust are supplied
/// by the owning local process manager or paired-host registry, never by JS.
#[derive(Clone)]
pub struct BenchmarkTarget {
    pub info: BenchmarkSession,
    pub base_url: String,
    pub api_key: String,
    pub client: reqwest::Client,
}
impl std::ops::Deref for BenchmarkTarget {
    type Target = BenchmarkSession;
    fn deref(&self) -> &Self::Target {
        &self.info
    }
}
impl BenchmarkTarget {
    pub fn local(session: &SessionInfo) -> Result<Self, String> {
        Ok(Self {
            info: BenchmarkSession {
                display_name: session.model_id.clone(),
                pid: Some(session.pid),
                target_id: format!("local:{}", session.pid),
                session_id: None,
                model_id: session.model_id.clone(),
                model_path: session.model_path.clone(),
                max_context: session.max_context,
                max_concurrency: session.max_concurrency.max(1),
                vision: session.vision,
                spec: session.spec.clone(),
                draft_tokens: session.draft_tokens,
                draft_tp: session.draft_tp,
                kv_dtype: session.kv_dtype.clone(),
                prefill_chunk: session.prefill_chunk,
                cuda_graph: !session.no_cuda_graph,
            },
            base_url: format!("http://127.0.0.1:{}", session.port),
            api_key: session.api_key.clone(),
            client: reqwest::Client::builder()
                .no_proxy()
                .connect_timeout(Duration::from_secs(5))
                .timeout(Duration::from_secs(60 * 60))
                .build()
                .map_err(|e| e.to_string())?,
        })
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct BenchmarkPoint {
    pub concurrency: u32,
    pub requested_prompt_tokens: u32,
    pub requested_output_tokens: u32,
    pub completed_requests: u32,
    pub average_prompt_tokens: f64,
    pub average_completion_tokens: f64,
    pub cached_prompt_tokens: u64,
    pub cold_prompt_tokens_per_second: Option<f64>,
    pub prompt_tokens_per_second: Option<f64>,
    pub generation_tokens_per_second: Option<f64>,
    pub per_request_generation_tokens_per_second: Option<f64>,
    pub evidence: PointReport,
    pub wave_output_tokens_per_second: f64,
    pub average_prefill_seconds: f64,
    pub average_decode_seconds: f64,
    pub average_request_seconds: f64,
    pub wave_seconds: f64,
    pub finish_reasons: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct BenchmarkResult {
    pub benchmark_id: String,
    pub hardware: Option<serde_json::Value>,
    pub methodology: &'static str,
    pub run_id: String,
    pub started_at_ms: u64,
    pub completed_at_ms: u64,
    pub session: BenchmarkSession,
    pub points: Vec<BenchmarkPoint>,
}

#[derive(Debug, Clone, Serialize)]
struct BenchmarkProgress {
    run_id: String,
    completed_points: usize,
    total_points: usize,
    concurrency: u32,
    phase: &'static str,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct Wave {
    full_cold_prompt: bool,
    cold_pp: Option<f64>,
    computed_tokens: u64,
    compute_seconds: f64,
    cached_tokens: u64,
    output_tokens: u64,
    mean_ttft_seconds: f64,
    decode_tokens: u64,
    decode_rounds: u64,
    decode_seconds: f64,
    prefill_seconds_sum: f64,
    decode_seconds_sum: f64,
    request_seconds_sum: f64,
    wall_seconds: f64,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct PointReport {
    configuration: serde_json::Value,
    schema: String,
    corpus: String,
    warmup: Vec<Wave>,
    measured: Vec<Wave>,
}

fn safe_rate(tokens: u64, seconds: f64) -> f64 {
    if seconds > 0.0 {
        tokens as f64 / seconds
    } else {
        0.0
    }
}

fn score(
    request: &BenchmarkRequest,
    concurrency: u32,
    report: PointReport,
) -> Result<BenchmarkPoint, String> {
    if report.schema != "ginfer-resident-benchmark-v1"
        || report.warmup.len() != request.warmup_rounds as usize
        || report.measured.len() != request.measured_rounds as usize
    {
        return Err("invalid resident benchmark report".into());
    }
    let sum = |field: fn(&Wave) -> f64| report.measured.iter().map(field).sum::<f64>();
    let count = concurrency * request.measured_rounds;
    let output: u64 = report.measured.iter().map(|w| w.output_tokens).sum();
    let cached = report.measured.iter().map(|w| w.cached_tokens).sum();
    let decode_tokens = report.measured.iter().map(|w| w.decode_tokens).sum();
    if output != u64::from(count) * u64::from(request.max_output_tokens) {
        return Err("benchmark did not return the exact output budget".into());
    }
    let mean_ttft_sum = sum(|w| w.mean_ttft_seconds);
    let decode_seconds = sum(|w| w.decode_seconds);
    let tg = (decode_seconds > 0.0).then(|| safe_rate(decode_tokens, decode_seconds));
    Ok(BenchmarkPoint {
        concurrency,
        requested_prompt_tokens: request.prompt_tokens,
        requested_output_tokens: request.max_output_tokens,
        completed_requests: count,
        average_prompt_tokens: f64::from(request.prompt_tokens),
        average_completion_tokens: output as f64 / f64::from(count),
        cached_prompt_tokens: cached,
        cold_prompt_tokens_per_second: report.warmup[0].cold_pp,
        prompt_tokens_per_second: (mean_ttft_sum > 0.0).then(|| {
            safe_rate(
                u64::from(count) * u64::from(request.prompt_tokens),
                mean_ttft_sum,
            )
        }),
        generation_tokens_per_second: tg,
        per_request_generation_tokens_per_second: tg.map(|value| value / f64::from(concurrency)),
        evidence: report.clone(),
        wave_output_tokens_per_second: safe_rate(output, sum(|w| w.wall_seconds)),
        average_prefill_seconds: sum(|w| w.prefill_seconds_sum) / f64::from(count),
        average_decode_seconds: sum(|w| w.decode_seconds_sum) / f64::from(count),
        average_request_seconds: sum(|w| w.request_seconds_sum) / f64::from(count),
        wave_seconds: sum(|w| w.wall_seconds),
        finish_reasons: vec!["output_limit".into()],
    })
}

fn unix_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

fn effective_concurrency(session: &BenchmarkTarget) -> u32 {
    if session.max_concurrency == 0 {
        1
    } else {
        session.max_concurrency
    }
}

fn validate_request(request: &BenchmarkRequest, session: &BenchmarkTarget) -> Result<(), String> {
    if !["standard", "serving", "long-context", "big-bench", "custom"].contains(&request.benchmark_id.as_str()) {
        return Err("unknown benchmark identity".into());
    }
    if request.benchmark_id == "standard" && (request.prompt_tokens != 2048 ||
        request.max_output_tokens != 500 || request.warmup_rounds != 1 || request.measured_rounds != 1 ||
        request.concurrencies != [1, 4, 8].into_iter().filter(|c| *c <= effective_concurrency(session)).collect::<Vec<_>>()) {
        return Err("Standard Benchmark requires the fixed 2048/500 workload and all supported C1/C4/C8 points".into());
    }
    if request.run_id.trim().is_empty() || request.run_id.len() > 128 {
        return Err("benchmark run_id must contain 1..=128 characters".into());
    }
    if !(32..=MAX_PROMPT_TOKENS).contains(&request.prompt_tokens) {
        return Err(format!(
            "benchmark prompt_tokens must be in 32..={MAX_PROMPT_TOKENS}"
        ));
    }
    if !(1..=MAX_OUTPUT_TOKENS).contains(&request.max_output_tokens) {
        return Err(format!(
            "benchmark max_output_tokens must be in 1..={MAX_OUTPUT_TOKENS}"
        ));
    }
    if request.measured_rounds == 0 || request.measured_rounds > MAX_BENCHMARK_ROUNDS {
        return Err(format!(
            "benchmark measured_rounds must be in 1..={MAX_BENCHMARK_ROUNDS}"
        ));
    }
    if request.warmup_rounds == 0 || request.warmup_rounds > MAX_BENCHMARK_ROUNDS {
        return Err(format!(
            "benchmark warmup_rounds must be in 1..={MAX_BENCHMARK_ROUNDS}"
        ));
    }
    if request.concurrencies.is_empty() {
        return Err("benchmark requires at least one concurrency point".into());
    }
    let max_concurrency = effective_concurrency(session);
    if request
        .concurrencies
        .iter()
        .any(|value| *value == 0 || *value > max_concurrency)
    {
        return Err(format!(
            "benchmark concurrency must be in 1..={max_concurrency} for this loaded server"
        ));
    }
    Ok(())
}

fn emit_progress<R: Runtime>(
    app_handle: &tauri::AppHandle<R>,
    request: &BenchmarkRequest,
    completed_points: usize,
    concurrency: u32,
    phase: &'static str,
) {
    let _ = app_handle.emit(
        "ginfer-benchmark-progress",
        BenchmarkProgress {
            run_id: request.run_id.clone(),
            completed_points,
            total_points: request.concurrencies.len(),
            concurrency,
            phase,
        },
    );
}

async fn execute_benchmark<R: Runtime>(
    app_handle: &tauri::AppHandle<R>,
    request: &BenchmarkRequest,
    session: &BenchmarkTarget,
    control: &Arc<BenchmarkControl>,
) -> Result<BenchmarkResult, String> {
    let started_at_ms = unix_millis();
    let mut points = Vec::new();
    for (index, &concurrency) in request.concurrencies.iter().enumerate() {
        if control.cancelled.load(Ordering::Acquire) {
            return Err("benchmark cancelled".into());
        }
        emit_progress(app_handle, request, index, concurrency, "measuring");
        let response = session
            .client
            .post(format!("{}/v1/ginfer/benchmark", session.base_url))
            .bearer_auth(&session.api_key)
            .json(&serde_json::json!({
                "prompt_tokens": request.prompt_tokens,
                "output_tokens": request.max_output_tokens,
                "concurrency": concurrency,
                "warmup_rounds": request.warmup_rounds,
                "measured_rounds": request.measured_rounds,
            }))
            .send()
            .await
            .map_err(|e| format!("resident benchmark request failed: {e}"))?;
        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            if status == reqwest::StatusCode::NOT_FOUND {
                return Err("This engine needs an update to support the resident Max Perf benchmark endpoint.".into());
            }
            return Err(format!("resident benchmark failed ({status}): {body}"));
        }
        let report = response
            .json::<PointReport>()
            .await
            .map_err(|e| format!("invalid benchmark report: {e}"))?;
        points.push(score(request, concurrency, report)?);
        emit_progress(app_handle, request, index + 1, concurrency, "complete");
    }
    Ok(BenchmarkResult {
        benchmark_id: request.benchmark_id.clone(),
        hardware: None,
        methodology: "ginfer-resident-max-perf-v1",
        run_id: request.run_id.clone(),
        started_at_ms,
        completed_at_ms: unix_millis(),
        session: session.info.clone(),
        points,
    })
}

#[tauri::command]
pub async fn run_ginfer_benchmark<R: Runtime>(
    app_handle: tauri::AppHandle<R>,
    request: BenchmarkRequest,
) -> Result<BenchmarkResult, String> {
    let state: State<GinferState> = app_handle.state();
    let session = {
        let sessions = state.ginfer_process.lock().await;
        sessions
            .get(
                &request
                    .session_pid
                    .ok_or("local benchmark requires a process ID")?,
            )
            .map(|session| session.info.clone())
            .ok_or_else(|| "the selected GInfer model is no longer loaded".to_string())?
    };
    run_benchmark_target(app_handle, request, BenchmarkTarget::local(&session)?).await
}

pub async fn run_benchmark_target<R: Runtime>(
    app_handle: tauri::AppHandle<R>,
    request: BenchmarkRequest,
    session: BenchmarkTarget,
) -> Result<BenchmarkResult, String> {
    let state: State<GinferState> = app_handle.state();
    validate_request(&request, &session)?;
    let control = Arc::new(BenchmarkControl::default());
    {
        let mut runs = state.benchmark_runs.lock().await;
        if runs.contains_key(&request.run_id) {
            return Err(format!(
                "benchmark run '{}' is already active",
                request.run_id
            ));
        }
        runs.insert(request.run_id.clone(), control.clone());
    }

    let result = tokio::select! {
        _ = control.notify.notified() => Err("benchmark cancelled".into()),
        result = execute_benchmark(&app_handle, &request, &session, &control) => result,
    };
    state.benchmark_runs.lock().await.remove(&request.run_id);
    result
}

#[tauri::command]
pub async fn cancel_ginfer_benchmark<R: Runtime>(
    app_handle: tauri::AppHandle<R>,
    run_id: String,
) -> Result<bool, String> {
    let state: State<GinferState> = app_handle.state();
    let control = state.benchmark_runs.lock().await.get(&run_id).cloned();
    if let Some(control) = control {
        control.cancelled.store(true, Ordering::Release);
        control.notify.notify_one();
        Ok(true)
    } else {
        Ok(false)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn session(max_concurrency: u32) -> BenchmarkTarget {
        BenchmarkTarget::local(&SessionInfo {
            pid: 1,
            port: 8080,
            model_id: "model".into(),
            model_path: "model.ginfer".into(),
            is_embedding: false,
            vision: true,
            max_context: 8192,
            spec: "auto".into(),
            draft_tokens: 0,
            draft_tp: 0,
            kv_dtype: "auto".into(),
            kv_arena_bytes: "auto".into(),
            prefill_chunk: 0,
            max_concurrency,
            no_cuda_graph: false,
            api_key: "secret".into(),
        })
        .unwrap()
    }

    fn request() -> BenchmarkRequest {
        BenchmarkRequest {
            benchmark_id: "custom".into(),
            run_id: "run-1".into(),
            session_pid: Some(1),
            prompt_tokens: 512,
            max_output_tokens: 128,
            concurrencies: vec![1, 2, 4],
            warmup_rounds: 1,
            measured_rounds: 1,
        }
    }

    #[test]
    fn standard_requires_its_fixed_workload_and_supported_points() {
        let mut value = request();
        value.benchmark_id = "standard".into();
        value.prompt_tokens = 2048;
        value.max_output_tokens = 500;
        value.concurrencies = vec![1, 4];
        assert!(validate_request(&value, &session(4)).is_ok());
        assert!(validate_request(&value, &session(8)).is_err());
        value.concurrencies = vec![1, 4, 8];
        assert!(validate_request(&value, &session(8)).is_ok());
        value.measured_rounds = 2;
        assert!(validate_request(&value, &session(8)).is_err());
        value.benchmark_id = "custom".into();
        assert!(validate_request(&value, &session(8)).is_ok());
    }

    #[test]
    fn validation_caps_points_to_resident_server_concurrency() {
        assert!(validate_request(&request(), &session(4)).is_ok());
        assert!(validate_request(&request(), &session(2)).is_err());
        assert!(validate_request(&request(), &session(0)).is_err());
    }

    #[test]
    fn scores_cold_compute_cached_ttft_and_exact_batch_decode_separately() {
        let request = request();
        let wave = || Wave {
            computed_tokens: 512,
            full_cold_prompt: true,
            compute_seconds: 0.512,
            decode_rounds: 127,
            cold_pp: Some(1000.0),
            cached_tokens: 1024,
            output_tokens: 256,
            mean_ttft_seconds: 0.01,
            decode_tokens: 254,
            decode_seconds: 2.0,
            prefill_seconds_sum: 0.02,
            decode_seconds_sum: 4.0,
            request_seconds_sum: 4.02,
            wall_seconds: 2.01,
        };
        let report = PointReport {
            configuration: serde_json::json!({}),
            schema: "ginfer-resident-benchmark-v1".into(),
            corpus: "test".into(),
            warmup: vec![wave()],
            measured: vec![wave()],
        };
        let point = score(&request, 2, report).unwrap();
        assert_eq!(point.cold_prompt_tokens_per_second, Some(1000.0));
        assert_eq!(point.prompt_tokens_per_second, Some(102400.0));
        assert_eq!(point.generation_tokens_per_second, Some(127.0));
        assert_eq!(point.per_request_generation_tokens_per_second, Some(63.5));
    }

    #[test]
    fn rejects_truncated_output_and_keeps_unobserved_rates_unavailable() {
        let request = request();
        let wave = || Wave {
            cold_pp: None,
            full_cold_prompt: false,
            computed_tokens: 0,
            compute_seconds: 0.0,
            cached_tokens: 512,
            output_tokens: 128,
            mean_ttft_seconds: 0.01,
            decode_tokens: 0,
            decode_rounds: 0,
            decode_seconds: 0.0,
            prefill_seconds_sum: 0.0,
            decode_seconds_sum: 0.0,
            request_seconds_sum: 1.0,
            wall_seconds: 1.0,
        };
        let mut report = PointReport {
            configuration: serde_json::json!({}),
            schema: "ginfer-resident-benchmark-v1".into(),
            corpus: "test".into(),
            warmup: vec![wave()],
            measured: vec![wave()],
        };
        let point = score(&request, 1, report.clone()).unwrap();
        assert_eq!(point.cold_prompt_tokens_per_second, None);
        assert_eq!(point.generation_tokens_per_second, None);
        report.measured[0].output_tokens -= 1;
        assert!(score(&request, 1, report).is_err());
    }
}
