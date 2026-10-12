use crate::state::{BenchmarkControl, GinferState, SessionInfo};
use ginfer_host::max_perf::{self, MaxPerfProfileRef};
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
    #[serde(default)]
    pub expected_session_id: Option<String>,
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
    pub benchmark_profile: Option<MaxPerfProfileRef>,
    pub tp: Option<u32>,
    pub max_context: u32,
    pub max_concurrency: u32,
    pub vision: bool,
    pub spec: String,
    pub draft_tokens: u32,
    pub draft_tp: u32,
    pub draft_policy: Option<String>,
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
                benchmark_profile: None,
                tp: None,
                max_context: session.max_context,
                max_concurrency: session.max_concurrency.max(1),
                vision: session.vision,
                spec: session.spec.clone(),
                draft_tokens: session.draft_tokens,
                draft_tp: session.draft_tp,
                draft_policy: None,
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
    pub warm_prefill_tokens_per_second_per_request: Option<f64>,
    pub warm_cached_ttft_seconds: Option<f64>,
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
    computed_tokens: u64,
    observed_compute_tokens: u64,
    logical_prompt_tokens: u64,
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
    prefix_reuse: bool,
    warm_cached_prompt: bool,
    warm_prefill_status: WarmPrefillStatus,
    #[serde(deserialize_with = "required_nullable")]
    warm_prefill_seconds_mean: Option<f64>,
    #[serde(deserialize_with = "required_nullable")]
    warm_cached_ttft_seconds: Option<f64>,
    #[serde(deserialize_with = "required_nullable")]
    warm_pp_effective_per_request: Option<f64>,
}

fn required_nullable<'de, D: serde::Deserializer<'de>>(d: D) -> Result<Option<f64>, D::Error> {
    Option::<f64>::deserialize(d)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum WarmPrefillStatus {
    Cached,
    PrefixReuseDisabled,
    PrefixIncomplete,
    PrefillTimerUnavailable,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct Phase {
    prefix_reuse: bool,
    warmup: Vec<Wave>,
    measured: Vec<Wave>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct Workload {
    prompt_tokens: u32,
    output_tokens: u32,
    concurrency: u32,
    warmup_rounds: u32,
    measured_rounds: u32,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct PointReport {
    configuration: serde_json::Value,
    schema: String,
    corpus: String,
    workload: Workload,
    cold_prefill: Phase,
    warm_generation: Phase,
    #[serde(default)]
    hardware: Option<serde_json::Value>,
}

fn validate_report(
    request: &BenchmarkRequest,
    concurrency: u32,
    report: &PointReport,
) -> Result<(), String> {
    let workload = &report.workload;
    if report.schema != "ginfer-resident-benchmark-v2"
        || workload.prompt_tokens != request.prompt_tokens
        || workload.output_tokens != request.max_output_tokens
        || workload.concurrency != concurrency
        || workload.warmup_rounds != request.warmup_rounds
        || workload.measured_rounds != request.measured_rounds
        || report.cold_prefill.prefix_reuse
        || report
            .configuration
            .get("prefix_reuse")
            .and_then(serde_json::Value::as_bool)
            != Some(report.warm_generation.prefix_reuse)
    {
        return Err("invalid native v2 benchmark workload or phase policy".into());
    }
    let logical = u64::from(concurrency) * u64::from(request.prompt_tokens);
    let output = u64::from(concurrency) * u64::from(request.max_output_tokens);
    for (cold, phase) in [
        (true, &report.cold_prefill),
        (false, &report.warm_generation),
    ] {
        if phase.warmup.len() != request.warmup_rounds as usize
            || phase.measured.len() != request.measured_rounds as usize
        {
            return Err("invalid native v2 benchmark round counts".into());
        }
        for wave in phase.warmup.iter().chain(&phase.measured) {
            if wave.logical_prompt_tokens != logical
                || wave.computed_tokens.checked_add(wave.cached_tokens) != Some(logical)
                || wave.observed_compute_tokens > wave.computed_tokens
                || wave.output_tokens != output
                || wave.decode_tokens > output - u64::from(concurrency)
                || wave.prefix_reuse != phase.prefix_reuse
                || [
                    wave.compute_seconds,
                    wave.mean_ttft_seconds,
                    wave.decode_seconds,
                    wave.prefill_seconds_sum,
                    wave.decode_seconds_sum,
                    wave.request_seconds_sum,
                    wave.wall_seconds,
                ]
                .iter()
                .any(|v| !v.is_finite() || *v < 0.0)
                || wave.wall_seconds <= 0.0
                || [
                    wave.warm_prefill_seconds_mean,
                    wave.warm_cached_ttft_seconds,
                    wave.warm_pp_effective_per_request,
                ]
                .into_iter()
                .flatten()
                .any(|v| !v.is_finite() || v <= 0.0)
            {
                return Err("invalid native v2 benchmark wave counters or timers".into());
            }
            let full_cold = wave.cached_tokens == 0
                && wave.computed_tokens == logical
                && wave.observed_compute_tokens == logical;
            let full_warm = phase.prefix_reuse
                && wave.cached_tokens == logical
                && wave.computed_tokens == 0
                && wave.observed_compute_tokens == 0;
            // Native status also checks each lane's timer. A positive sum does not prove
            // every lane had a usable duration; retain its unavailable observation.
            let valid_prefill = wave.warm_prefill_status == WarmPrefillStatus::Cached;
            let valid_status = match wave.warm_prefill_status {
                WarmPrefillStatus::PrefixReuseDisabled => !phase.prefix_reuse,
                WarmPrefillStatus::PrefixIncomplete => phase.prefix_reuse && !full_warm,
                WarmPrefillStatus::PrefillTimerUnavailable => full_warm,
                WarmPrefillStatus::Cached => full_warm && wave.prefill_seconds_sum > 0.0,
            };
            let close = |actual: Option<f64>, expected: Option<f64>| match (actual, expected) {
                (None, None) => true,
                (Some(a), Some(b)) => (a - b).abs() <= 1e-9 * a.abs().max(b.abs()).max(1.0),
                _ => false,
            };
            if wave.full_cold_prompt != full_cold
                || (cold && !full_cold)
                || wave.warm_cached_prompt != full_warm
                || !valid_status
                || !close(
                    wave.warm_prefill_seconds_mean,
                    (full_warm && valid_prefill)
                        .then(|| wave.prefill_seconds_sum / f64::from(concurrency)),
                )
                || !close(
                    wave.warm_pp_effective_per_request,
                    (full_warm && valid_prefill).then(|| logical as f64 / wave.prefill_seconds_sum),
                )
                || (wave.warm_cached_ttft_seconds.is_some()
                    && (!full_warm
                        || !close(wave.warm_cached_ttft_seconds, Some(wave.mean_ttft_seconds))))
            {
                return Err("inconsistent native v2 cold or cached-prefill evidence".into());
            }
        }
    }
    Ok(())
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
    validate_report(request, concurrency, &report)?;
    let measured = &report.warm_generation.measured;
    let sum = |field: fn(&Wave) -> f64| measured.iter().map(field).sum::<f64>();
    let count = concurrency * request.measured_rounds;
    let output: u64 = measured.iter().map(|w| w.output_tokens).sum();
    let cached = measured.iter().map(|w| w.cached_tokens).sum();
    let decode_tokens = measured.iter().map(|w| w.decode_tokens).sum();
    if output != u64::from(count) * u64::from(request.max_output_tokens) {
        return Err("benchmark did not return the exact output budget".into());
    }
    let cold = &report.cold_prefill.measured;
    let cold_seconds: f64 = cold.iter().map(|w| w.compute_seconds).sum();
    let cold_tokens: u64 = cold.iter().map(|w| w.computed_tokens).sum();
    let complete_cold_timer = cold.iter().all(|w| w.compute_seconds > 0.0);
    let cached_prefill = measured
        .iter()
        .all(|w| w.warm_prefill_status == WarmPrefillStatus::Cached);
    let prefill_seconds = sum(|w| w.prefill_seconds_sum);
    let cached_ttft = measured
        .iter()
        .all(|w| w.warm_cached_ttft_seconds.is_some());
    let decode_seconds = sum(|w| w.decode_seconds);
    let tg = measured
        .iter()
        .all(|wave| wave.decode_seconds > 0.0)
        .then(|| safe_rate(decode_tokens, decode_seconds));
    Ok(BenchmarkPoint {
        concurrency,
        requested_prompt_tokens: request.prompt_tokens,
        requested_output_tokens: request.max_output_tokens,
        completed_requests: count,
        average_prompt_tokens: f64::from(request.prompt_tokens),
        average_completion_tokens: output as f64 / f64::from(count),
        cached_prompt_tokens: cached,
        cold_prompt_tokens_per_second: complete_cold_timer
            .then(|| safe_rate(cold_tokens, cold_seconds)),
        // v1's logical-input/TTFT PP has no v2 alias.
        prompt_tokens_per_second: None,
        warm_prefill_tokens_per_second_per_request: cached_prefill.then(|| {
            safe_rate(
                u64::from(count) * u64::from(request.prompt_tokens),
                prefill_seconds,
            )
        }),
        warm_cached_ttft_seconds: cached_ttft
            .then(|| sum(|w| w.mean_ttft_seconds) / f64::from(request.measured_rounds)),
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

pub fn validate_request(
    request: &BenchmarkRequest,
    session: &BenchmarkTarget,
) -> Result<(), String> {
    if !["standard", "serving", "long-context", "big-bench", "custom"]
        .contains(&request.benchmark_id.as_str())
    {
        return Err("unknown benchmark identity".into());
    }
    if request.benchmark_id == "standard" {
        let expected = request
            .expected_session_id
            .as_deref()
            .filter(|id| !id.trim().is_empty())
            .ok_or("Standard Benchmark requires the selected engine session identity")?;
        if session.session_id.as_deref() != Some(expected) {
            return Err(
                "selected benchmark engine session changed; select the current session explicitly"
                    .into(),
            );
        }
        max_perf::validate_standard_workload(
            request.prompt_tokens,
            request.max_output_tokens,
            &request.concurrencies,
            request.warmup_rounds,
            request.measured_rounds,
        )
        .map_err(|error| error.to_string())?;
        let profile = session
            .benchmark_profile
            .as_ref()
            .ok_or("Standard Benchmark requires a versioned Max Perf session")?;
        max_perf::validate_configuration(profile, &expected_configuration(session)?)
            .map_err(|error| error.to_string())?;
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

fn expected_configuration(session: &BenchmarkSession) -> Result<serde_json::Value, String> {
    let (model, weights) = session
        .model_id
        .split_once('/')
        .filter(|(model, weights)| !model.is_empty() && !weights.is_empty())
        .ok_or("selected benchmark session has no exact artifact identity")?;
    Ok(serde_json::json!({
        "model": model, "weights": weights,
        "tp": session.tp.ok_or("selected benchmark session has no TP observation")?,
        "draft_tp": session.draft_tp, "max_context": session.max_context,
        "max_concurrency": session.max_concurrency, "kv_dtype": session.kv_dtype,
        "spec": session.spec, "draft_tokens": session.draft_tokens,
        "draft_policy": session.draft_policy.as_deref().ok_or("selected benchmark session has no draft policy")?,
        "cuda_graph": session.cuda_graph, "vision": session.vision,
    }))
}

fn validate_report_configuration(
    request: &BenchmarkRequest,
    session: &BenchmarkSession,
    concurrency: u32,
    report: &PointReport,
    previous: Option<&PointReport>,
) -> Result<(), String> {
    if request.benchmark_id != "standard" {
        return Ok(());
    }
    let profile = session
        .benchmark_profile
        .as_ref()
        .ok_or("Standard Benchmark requires a versioned Max Perf session")?;
    max_perf::validate_configuration(profile, &report.configuration)
        .map_err(|error| error.to_string())?;
    let expected = expected_configuration(session)?;
    for (field, value) in expected
        .as_object()
        .expect("session configuration is an object")
    {
        if report.configuration.get(field) != Some(value) {
            return Err(format!(
                "benchmark report {field} does not match the selected session"
            ));
        }
    }
    if report
        .configuration
        .get("engine_build")
        .and_then(serde_json::Value::as_str)
        .filter(|build| !build.trim().is_empty())
        .is_none()
    {
        return Err("benchmark report has no engine build identity".into());
    }
    if report.corpus.trim().is_empty()
        || previous.is_some_and(|previous| previous.corpus != report.corpus)
    {
        return Err("benchmark corpus is missing or changed between points".into());
    }
    if previous.is_some_and(|previous| previous.configuration != report.configuration) {
        return Err("benchmark engine build or configuration changed between points".into());
    }
    if !report.warm_generation.prefix_reuse {
        return Err("Standard Benchmark requires warm-generation prefix reuse".into());
    }
    for wave in [&report.cold_prefill, &report.warm_generation]
        .into_iter()
        .flat_map(|phase| phase.warmup.iter().chain(&phase.measured))
    {
        validate_standard_wave(
            concurrency,
            wave.computed_tokens,
            wave.cached_tokens,
            wave.output_tokens,
        )?;
    }
    Ok(())
}

/// Both native reports and the existing public v1 payload must carry exact wave budgets.
pub fn validate_standard_wave(
    concurrency: u32,
    computed: u64,
    cached: u64,
    output: u64,
) -> Result<(), String> {
    if computed.checked_add(cached)
        != Some(u64::from(max_perf::INPUT_TOKENS) * u64::from(concurrency))
        || output != u64::from(max_perf::OUTPUT_TOKENS) * u64::from(concurrency)
    {
        return Err("benchmark wave does not match the Standard token workload".into());
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
    let mut points: Vec<BenchmarkPoint> = Vec::new();
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
        validate_report(request, concurrency, &report)?;
        validate_report_configuration(
            request,
            session,
            concurrency,
            &report,
            points.first().map(|point| &point.evidence),
        )?;
        points.push(score(request, concurrency, report)?);
        emit_progress(app_handle, request, index + 1, concurrency, "complete");
    }
    Ok(BenchmarkResult {
        benchmark_id: request.benchmark_id.clone(),
        hardware: None,
        methodology: "ginfer-resident-max-perf-v2",
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
            expected_session_id: None,
            prompt_tokens: 512,
            max_output_tokens: 128,
            concurrencies: vec![1, 2, 4],
            warmup_rounds: 1,
            measured_rounds: 1,
        }
    }

    fn standard_configuration() -> serde_json::Value {
        serde_json::json!({"engine_build":"fixture-engine-build", "model":"qwen3.8-27b",
            "weights":"groupwise-int-dflash2-q4", "tp":1, "draft_tp":1,
            "max_context":8181, "max_concurrency":8, "kv_dtype":"int8", "spec":"dflash",
            "draft_tokens":7, "draft_policy":"fixed", "cuda_graph":true, "vision":true})
    }

    fn standard_session() -> BenchmarkTarget {
        BenchmarkTarget {
            info: BenchmarkSession {
                display_name: "fixture".into(),
                pid: None,
                target_id: "ginfer/host/instance".into(),
                session_id: Some("fixture-session".into()),
                model_id: "qwen3.8-27b/groupwise-int-dflash2-q4".into(),
                model_path: "/fixture/model.ginfer".into(),
                benchmark_profile: Some(
                    max_perf::MaxPerfProfile::for_configuration(&standard_configuration())
                        .unwrap()
                        .reference,
                ),
                tp: Some(1),
                max_context: 8181,
                max_concurrency: 8,
                vision: true,
                spec: "dflash".into(),
                draft_tokens: 7,
                draft_tp: 1,
                draft_policy: Some("fixed".into()),
                kv_dtype: "int8".into(),
                prefill_chunk: 0,
                cuda_graph: true,
            },
            base_url: "http://127.0.0.1:1".into(),
            api_key: "fixture".into(),
            client: reqwest::Client::new(),
        }
    }

    fn standard_request() -> BenchmarkRequest {
        BenchmarkRequest {
            benchmark_id: "standard".into(),
            expected_session_id: Some("fixture-session".into()),
            prompt_tokens: max_perf::INPUT_TOKENS,
            max_output_tokens: max_perf::OUTPUT_TOKENS,
            concurrencies: max_perf::CONCURRENCIES.to_vec(),
            warmup_rounds: max_perf::WARMUP_ROUNDS,
            measured_rounds: max_perf::MEASURED_ROUNDS,
            ..request()
        }
    }

    #[test]
    fn standard_requires_its_profile_session_and_complete_fixed_workload() {
        let mut value = standard_request();
        let paired = standard_session();
        assert!(validate_request(&value, &paired).is_ok());
        assert!(validate_request(&value, &session(8)).is_err());
        value.concurrencies = vec![1, 4];
        assert!(validate_request(&value, &paired).is_err());
        value.concurrencies = vec![1, 4, 8];
        value.measured_rounds = 2;
        assert!(validate_request(&value, &paired).is_err());
        value.measured_rounds = 1;
        value.expected_session_id = Some("previous-session".into());
        assert!(validate_request(&value, &paired).is_err());
        value.expected_session_id = None;
        assert!(validate_request(&value, &paired).is_err());
        value = standard_request();
        let mut wrong_profile = paired.clone();
        wrong_profile
            .info
            .benchmark_profile
            .as_mut()
            .unwrap()
            .version += 1;
        assert!(validate_request(&value, &wrong_profile).is_err());
        let mut unknown_facts = paired.clone();
        unknown_facts.info.tp = None;
        assert!(validate_request(&value, &unknown_facts).is_err());
        unknown_facts = paired.clone();
        unknown_facts.info.draft_policy = None;
        assert!(validate_request(&value, &unknown_facts).is_err());
        value.benchmark_id = "custom".into();
        assert!(validate_request(&value, &session(8)).is_ok());
    }

    #[test]
    fn validation_caps_points_to_resident_server_concurrency() {
        assert!(validate_request(&request(), &session(4)).is_ok());
        assert!(validate_request(&request(), &session(2)).is_err());
        assert!(validate_request(&request(), &session(0)).is_err());
    }

    fn captured_report() -> PointReport {
        serde_json::from_str(include_str!("fixtures/native-v2-c1.json")).unwrap()
    }

    fn captured_request() -> BenchmarkRequest {
        BenchmarkRequest {
            prompt_tokens: 2048,
            max_output_tokens: 500,
            measured_rounds: 3,
            concurrencies: vec![1],
            ..request()
        }
    }

    #[test]
    fn captured_v2_scores_measured_phases_without_v1_pp_alias() {
        let report = captured_report();
        let request = captured_request();
        let point = score(&request, 1, report.clone()).unwrap();
        let cold = &report.cold_prefill.measured;
        let warm = &report.warm_generation.measured;
        let rate = |tokens: u64, seconds: f64| tokens as f64 / seconds;
        assert_eq!(
            point.cold_prompt_tokens_per_second,
            Some(rate(6144, cold.iter().map(|w| w.compute_seconds).sum()))
        );
        assert_eq!(point.prompt_tokens_per_second, None);
        assert_eq!(
            point.warm_prefill_tokens_per_second_per_request,
            Some(rate(6144, warm.iter().map(|w| w.prefill_seconds_sum).sum()))
        );
        assert_eq!(
            point.generation_tokens_per_second,
            Some(rate(1497, warm.iter().map(|w| w.decode_seconds).sum()))
        );
        assert_eq!(point.completed_requests, 3);
        assert_eq!(point.evidence.schema, "ginfer-resident-benchmark-v2");
    }

    #[test]
    fn cached_prefill_rate_keeps_per_request_scope_at_c4() {
        let mut report = captured_report();
        report.workload.concurrency = 4;
        for phase in [&mut report.cold_prefill, &mut report.warm_generation] {
            for wave in phase.warmup.iter_mut().chain(&mut phase.measured) {
                wave.logical_prompt_tokens *= 4;
                wave.computed_tokens *= 4;
                wave.observed_compute_tokens *= 4;
                wave.cached_tokens *= 4;
                wave.output_tokens *= 4;
                wave.decode_tokens *= 4;
                wave.prefill_seconds_sum *= 4.0;
                wave.decode_seconds_sum *= 4.0;
                wave.request_seconds_sum *= 4.0;
            }
        }
        let request = captured_request();
        let single = score(&request, 1, captured_report()).unwrap();
        let parallel = score(&request, 4, report).unwrap();
        assert_eq!(
            parallel.warm_prefill_tokens_per_second_per_request,
            single.warm_prefill_tokens_per_second_per_request
        );
        assert_eq!(
            parallel.warm_cached_ttft_seconds,
            single.warm_cached_ttft_seconds
        );
        assert_eq!(
            parallel.per_request_generation_tokens_per_second,
            single.generation_tokens_per_second
        );
    }

    #[test]
    fn v2_refuses_missing_phase_wrong_workload_and_invalid_observations() {
        let value: serde_json::Value =
            serde_json::from_str(include_str!("fixtures/native-v2-c1.json")).unwrap();
        let request = captured_request();
        for field in ["cold_prefill", "warm_generation", "workload"] {
            let mut changed = value.clone();
            changed.as_object_mut().unwrap().remove(field);
            assert!(
                serde_json::from_value::<PointReport>(changed).is_err(),
                "{field}"
            );
        }
        for (pointer, wrong) in [
            ("/schema", serde_json::json!("ginfer-resident-benchmark-v1")),
            ("/workload/concurrency", serde_json::json!(4)),
            ("/workload/prompt_tokens", serde_json::json!(4096)),
            ("/workload/measured_rounds", serde_json::json!(1)),
            ("/cold_prefill/prefix_reuse", serde_json::json!(true)),
            (
                "/cold_prefill/measured/0/cached_tokens",
                serde_json::json!(1),
            ),
            (
                "/cold_prefill/measured/0/observed_compute_tokens",
                serde_json::json!(2047),
            ),
            (
                "/warm_generation/measured/0/output_tokens",
                serde_json::json!(499),
            ),
            (
                "/warm_generation/measured/0/decode_tokens",
                serde_json::json!(500),
            ),
            (
                "/warm_generation/measured/0/decode_seconds",
                serde_json::json!(-1),
            ),
            (
                "/warm_generation/measured/0/warm_pp_effective_per_request",
                serde_json::json!(123),
            ),
            (
                "/warm_generation/measured/0/warm_prefill_status",
                serde_json::json!("unknown"),
            ),
        ] {
            let mut changed = value.clone();
            *changed.pointer_mut(pointer).unwrap() = wrong;
            assert!(
                serde_json::from_value::<PointReport>(changed)
                    .and_then(|r| score(&request, 1, r).map_err(serde::de::Error::custom))
                    .is_err(),
                "{pointer}"
            );
        }
        for field in [
            "warm_prefill_seconds_mean",
            "warm_pp_effective_per_request",
            "warm_cached_ttft_seconds",
        ] {
            let mut changed = value.clone();
            changed["warm_generation"]["measured"][0]
                .as_object_mut()
                .unwrap()
                .remove(field);
            assert!(
                serde_json::from_value::<PointReport>(changed).is_err(),
                "{field}"
            );
        }
        let mut report = captured_report();
        report.warm_generation.measured.pop();
        assert!(score(&request, 1, report).is_err());
    }

    #[test]
    fn v2_keeps_missing_timers_and_incomplete_prefix_unavailable() {
        let request = captured_request();
        let mut partial = captured_report();
        partial.warm_generation.measured[0].decode_seconds = 0.0;
        assert!(score(&request, 1, partial)
            .unwrap()
            .generation_tokens_per_second
            .is_none());
        let mut report = captured_report();
        for wave in &mut report.cold_prefill.measured {
            wave.compute_seconds = 0.0;
        }
        for wave in &mut report.warm_generation.measured {
            wave.decode_seconds = 0.0;
            wave.prefill_seconds_sum = 0.0;
            wave.warm_prefill_seconds_mean = None;
            wave.warm_pp_effective_per_request = None;
            wave.warm_prefill_status = WarmPrefillStatus::PrefillTimerUnavailable;
        }
        let point = score(&request, 1, report).unwrap();
        assert!(point.cold_prompt_tokens_per_second.is_none());
        assert!(point.generation_tokens_per_second.is_none());
        assert!(point.warm_prefill_tokens_per_second_per_request.is_none());
    }

    #[test]
    fn incomplete_prefix_and_individual_timer_failure_do_not_invent_warm_rates() {
        let request = captured_request();
        let mut report = captured_report();
        for wave in &mut report.warm_generation.measured {
            wave.warm_prefill_status = WarmPrefillStatus::PrefillTimerUnavailable;
            wave.warm_prefill_seconds_mean = None;
            wave.warm_pp_effective_per_request = None;
            wave.warm_cached_ttft_seconds = None;
        }
        let point = score(&request, 1, report.clone()).unwrap();
        assert!(point.warm_prefill_tokens_per_second_per_request.is_none());
        assert!(point.warm_cached_ttft_seconds.is_none());
        for wave in &mut report.warm_generation.measured {
            wave.cached_tokens -= 1;
            wave.computed_tokens = 1;
            wave.observed_compute_tokens = 1;
            wave.warm_cached_prompt = false;
            wave.warm_prefill_status = WarmPrefillStatus::PrefixIncomplete;
        }
        assert!(score(&request, 1, report)
            .unwrap()
            .warm_prefill_tokens_per_second_per_request
            .is_none());
    }

    #[test]
    fn standard_still_refuses_changed_session_configuration_and_workload() {
        let mut report = captured_report();
        report.configuration = standard_configuration();
        report.configuration["prefix_reuse"] = true.into();
        let session = standard_session();
        let request = standard_request();
        validate_report_configuration(&request, &session, 1, &report, None).unwrap();
        for field in [
            "max_context",
            "draft_policy",
            "spec",
            "weights",
            "tp",
            "draft_tp",
            "cuda_graph",
        ] {
            let mut changed = report.clone();
            changed.configuration[field] = serde_json::Value::Null;
            assert!(
                validate_report_configuration(&request, &session, 1, &changed, None).is_err(),
                "{field}"
            );
        }
        let mut changed = report.clone();
        changed.configuration["engine_build"] = "changed".into();
        assert!(
            validate_report_configuration(&request, &session, 1, &changed, Some(&report)).is_err()
        );
        changed = report;
        changed.warm_generation.measured[0].output_tokens -= 1;
        assert!(validate_report_configuration(&request, &session, 1, &changed, None).is_err());
    }
}
