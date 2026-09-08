use crate::state::{BenchmarkControl, GinferState, SessionInfo};
use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;
use std::sync::atomic::Ordering;
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{Emitter, Manager, Runtime, State};
use tokio::task::JoinSet;
use tokio::time::Instant;

const MAX_BENCHMARK_ROUNDS: u32 = 5;
const MAX_PROMPT_TOKENS: u32 = 262_144;
const MAX_OUTPUT_TOKENS: u32 = 16_384;

#[derive(Debug, Clone, Deserialize)]
pub struct BenchmarkRequest {
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
    pub prompt_tokens_per_second: f64,
    pub generation_tokens_per_second: f64,
    pub per_request_generation_tokens_per_second: f64,
    pub wave_output_tokens_per_second: f64,
    pub average_prefill_seconds: f64,
    pub average_decode_seconds: f64,
    pub average_request_seconds: f64,
    pub wave_seconds: f64,
    pub finish_reasons: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct BenchmarkResult {
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

#[derive(Clone, Serialize)]
struct ChatMessage {
    role: &'static str,
    content: String,
}

#[derive(Clone, Serialize)]
struct ChatRequest {
    model: String,
    messages: Vec<ChatMessage>,
    stream: bool,
    max_tokens: u32,
    temperature: f64,
    top_p: f64,
    top_k: u32,
    reasoning_effort: &'static str,
}

#[derive(Deserialize)]
struct ChatResponse {
    choices: Vec<ChatChoice>,
    usage: ChatUsage,
    #[serde(rename = "x_ginfer")]
    metrics: CompletionMetrics,
}

#[derive(Deserialize)]
struct ChatChoice {
    finish_reason: Option<String>,
}

#[derive(Deserialize)]
struct ChatUsage {
    prompt_tokens: u64,
    completion_tokens: u64,
    #[serde(default)]
    prompt_tokens_details: PromptTokenDetails,
}

#[derive(Default, Deserialize)]
struct PromptTokenDetails {
    #[serde(default)]
    cached_tokens: u64,
}

#[derive(Deserialize)]
struct CompletionMetrics {
    finish_reason: String,
    #[serde(default)]
    computed_prefill_tokens: u64,
    prefill_seconds: f64,
    decode_seconds: f64,
}

#[derive(Deserialize)]
struct ModelsResponse {
    data: Vec<ModelDescription>,
}

#[derive(Deserialize)]
struct ModelDescription {
    id: String,
    max_model_len: u32,
}

struct RequestSample {
    prompt_tokens: u64,
    completion_tokens: u64,
    cached_tokens: u64,
    computed_prefill_tokens: u64,
    prefill_seconds: f64,
    decode_seconds: f64,
    request_seconds: f64,
    finish_reason: String,
}

struct WaveResult {
    samples: Vec<RequestSample>,
    wall_seconds: f64,
}

#[derive(Default)]
struct PointAccumulator {
    completed_requests: u32,
    prompt_tokens: u64,
    completion_tokens: u64,
    cached_tokens: u64,
    computed_prefill_tokens: u64,
    prefill_phase_seconds: f64,
    decode_phase_seconds: f64,
    request_seconds: f64,
    prefill_seconds: f64,
    decode_seconds: f64,
    wave_seconds: f64,
    finish_reasons: BTreeSet<String>,
}

impl PointAccumulator {
    fn add_wave(&mut self, wave: WaveResult) {
        self.wave_seconds += wave.wall_seconds;
        self.prefill_phase_seconds += wave
            .samples
            .iter()
            .map(|sample| sample.prefill_seconds)
            .fold(0.0, f64::max);
        self.decode_phase_seconds += wave
            .samples
            .iter()
            .map(|sample| sample.decode_seconds)
            .fold(0.0, f64::max);

        for sample in wave.samples {
            self.completed_requests += 1;
            self.prompt_tokens += sample.prompt_tokens;
            self.completion_tokens += sample.completion_tokens;
            self.cached_tokens += sample.cached_tokens;
            self.computed_prefill_tokens += sample.computed_prefill_tokens;
            self.prefill_seconds += sample.prefill_seconds;
            self.decode_seconds += sample.decode_seconds;
            self.request_seconds += sample.request_seconds;
            self.finish_reasons.insert(sample.finish_reason);
        }
    }

    fn finish(
        self,
        concurrency: u32,
        requested_prompt_tokens: u32,
        requested_output_tokens: u32,
    ) -> BenchmarkPoint {
        let request_count = f64::from(self.completed_requests.max(1));
        BenchmarkPoint {
            concurrency,
            requested_prompt_tokens,
            requested_output_tokens,
            completed_requests: self.completed_requests,
            average_prompt_tokens: self.prompt_tokens as f64 / request_count,
            average_completion_tokens: self.completion_tokens as f64 / request_count,
            cached_prompt_tokens: self.cached_tokens,
            prompt_tokens_per_second: safe_rate(
                self.computed_prefill_tokens,
                self.prefill_phase_seconds,
            ),
            generation_tokens_per_second: safe_rate(
                self.completion_tokens,
                self.decode_phase_seconds,
            ),
            per_request_generation_tokens_per_second: safe_rate(
                self.completion_tokens,
                self.decode_seconds,
            ),
            wave_output_tokens_per_second: safe_rate(self.completion_tokens, self.wave_seconds),
            average_prefill_seconds: self.prefill_seconds / request_count,
            average_decode_seconds: self.decode_seconds / request_count,
            average_request_seconds: self.request_seconds / request_count,
            wave_seconds: self.wave_seconds,
            finish_reasons: self.finish_reasons.into_iter().collect(),
        }
    }
}

fn safe_rate(tokens: u64, seconds: f64) -> f64 {
    if seconds > 0.0 {
        tokens as f64 / seconds
    } else {
        0.0
    }
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
    if request.warmup_rounds > MAX_BENCHMARK_ROUNDS {
        return Err(format!(
            "benchmark warmup_rounds must be in 0..={MAX_BENCHMARK_ROUNDS}"
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

fn benchmark_prompt(run_id: &str, round: u32, lane: u32, corpus_repetitions: usize) -> String {
    const CORPUS: &str = "A production inference service balances request admission, prefix processing, cache locality, speculative proposal quality, verification cost, and token publication. Measure each phase independently, preserve exact state transitions, and prefer repeatable end-to-end evidence over isolated peak numbers. ";
    let mut prompt = format!(
        "Benchmark sample {run_id}-{round}-{lane}. Analyze the following technical workload. After the analysis, continue with numbered optimization observations until the output limit; do not conclude early.\n\n"
    );
    for _ in 0..corpus_repetitions {
        prompt.push_str(CORPUS);
    }
    prompt
}

fn initial_corpus_repetitions(target_tokens: u32) -> usize {
    ((target_tokens as usize).saturating_sub(40) / 42).max(1)
}

async fn request_model_context(
    client: &reqwest::Client,
    session: &BenchmarkTarget,
) -> Result<u32, String> {
    let response = client
        .get(format!("{}/v1/models", session.base_url))
        .bearer_auth(&session.api_key)
        .send()
        .await
        .map_err(|error| format!("could not query the loaded GInfer model: {error}"))?;
    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(format!(
            "loaded GInfer server returned {status} from /v1/models: {body}"
        ));
    }
    let models = response
        .json::<ModelsResponse>()
        .await
        .map_err(|error| format!("invalid /v1/models response: {error}"))?;
    models
        .data
        .into_iter()
        .find(|model| model.id == session.model_id)
        .map(|model| model.max_model_len)
        .ok_or_else(|| {
            format!(
                "loaded GInfer server did not report model '{}'",
                session.model_id
            )
        })
}

async fn count_prompt_tokens(
    client: &reqwest::Client,
    session: &BenchmarkTarget,
    prompt: String,
) -> Result<u32, String> {
    #[derive(Serialize)]
    struct CountRequest {
        model: String,
        messages: Vec<ChatMessage>,
        reasoning_effort: &'static str,
    }
    #[derive(Deserialize)]
    struct CountResponse {
        input_tokens: u32,
    }

    let response = client
        .post(format!(
            "{}/v1/chat/completions/count_tokens",
            session.base_url
        ))
        .bearer_auth(&session.api_key)
        .json(&CountRequest {
            model: session.model_id.clone(),
            messages: vec![ChatMessage {
                role: "user",
                content: prompt,
            }],
            reasoning_effort: "none",
        })
        .send()
        .await
        .map_err(|error| format!("could not count benchmark prompt tokens: {error}"))?;
    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(format!(
            "loaded GInfer server returned {status} while counting tokens: {body}"
        ));
    }
    response
        .json::<CountResponse>()
        .await
        .map(|body| body.input_tokens)
        .map_err(|error| format!("invalid token-count response: {error}"))
}

async fn calibrate_prompt(
    client: &reqwest::Client,
    session: &BenchmarkTarget,
    request: &BenchmarkRequest,
) -> Result<(usize, u32), String> {
    let mut repetitions = initial_corpus_repetitions(request.prompt_tokens);
    let mut best = (repetitions, u32::MAX, 0u32);
    for _ in 0..5 {
        let count = count_prompt_tokens(
            client,
            session,
            benchmark_prompt(&request.run_id, 0, 0, repetitions),
        )
        .await?;
        let distance = count.abs_diff(request.prompt_tokens);
        if distance < best.1 {
            best = (repetitions, distance, count);
        }
        if distance <= (request.prompt_tokens / 50).max(4) {
            break;
        }
        repetitions =
            ((repetitions as f64 * request.prompt_tokens as f64 / f64::from(count.max(1))).round()
                as usize)
                .max(1);
        if repetitions == best.0 {
            break;
        }
    }
    Ok((best.0, best.2))
}

async fn request_completion(
    client: reqwest::Client,
    session: BenchmarkTarget,
    prompt: String,
    max_output_tokens: u32,
) -> Result<RequestSample, String> {
    let started = Instant::now();
    let response = client
        .post(format!("{}/v1/chat/completions", session.base_url))
        .bearer_auth(&session.api_key)
        .json(&ChatRequest {
            model: session.model_id.clone(),
            messages: vec![ChatMessage {
                role: "user",
                content: prompt,
            }],
            stream: false,
            max_tokens: max_output_tokens,
            temperature: 0.0,
            top_p: 1.0,
            top_k: 1,
            reasoning_effort: "none",
        })
        .send()
        .await
        .map_err(|error| format!("benchmark request failed: {error}"))?;
    let request_seconds = started.elapsed().as_secs_f64();
    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(format!(
            "loaded GInfer server returned {status} during benchmark: {body}"
        ));
    }
    let body = response
        .json::<ChatResponse>()
        .await
        .map_err(|error| format!("invalid GInfer benchmark response: {error}"))?;
    let finish_reason = if body.metrics.finish_reason.is_empty() {
        body.choices
            .first()
            .and_then(|choice| choice.finish_reason.clone())
            .unwrap_or_else(|| "unknown".into())
    } else {
        body.metrics.finish_reason.clone()
    };
    Ok(RequestSample {
        prompt_tokens: body.usage.prompt_tokens,
        completion_tokens: body.usage.completion_tokens,
        cached_tokens: body.usage.prompt_tokens_details.cached_tokens,
        computed_prefill_tokens: body.metrics.computed_prefill_tokens,
        prefill_seconds: body.metrics.prefill_seconds,
        decode_seconds: body.metrics.decode_seconds,
        request_seconds,
        finish_reason,
    })
}

async fn run_wave(
    client: &reqwest::Client,
    session: &BenchmarkTarget,
    control: &Arc<BenchmarkControl>,
    request: &BenchmarkRequest,
    concurrency: u32,
    round: u32,
    corpus_repetitions: usize,
) -> Result<WaveResult, String> {
    if control.cancelled.load(Ordering::Acquire) {
        return Err("benchmark cancelled".into());
    }

    let started = Instant::now();
    let mut tasks = JoinSet::new();
    for lane in 0..concurrency {
        tasks.spawn(request_completion(
            client.clone(),
            session.clone(),
            benchmark_prompt(&request.run_id, round, lane, corpus_repetitions),
            request.max_output_tokens,
        ));
    }

    let mut samples = Vec::with_capacity(concurrency as usize);
    while !tasks.is_empty() {
        tokio::select! {
            _ = control.notify.notified() => {
                tasks.abort_all();
                return Err("benchmark cancelled".into());
            }
            joined = tasks.join_next() => {
                match joined {
                    Some(Ok(Ok(sample))) => samples.push(sample),
                    Some(Ok(Err(error))) => {
                        tasks.abort_all();
                        return Err(error);
                    }
                    Some(Err(error)) => {
                        tasks.abort_all();
                        return Err(format!("benchmark worker failed: {error}"));
                    }
                    None => break,
                }
            }
        }
    }

    Ok(WaveResult {
        samples,
        wall_seconds: started.elapsed().as_secs_f64(),
    })
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
    let client = session.client.clone();
    let max_context = request_model_context(&client, session).await?;
    emit_progress(app_handle, request, 0, 0, "preparing");
    let (corpus_repetitions, calibrated_prompt_tokens) =
        calibrate_prompt(&client, session, request).await?;
    if calibrated_prompt_tokens.saturating_add(request.max_output_tokens) > max_context {
        return Err(format!(
            "calibrated prompt ({calibrated_prompt_tokens}) plus output reservation ({}) exceeds the loaded model context ({max_context})",
            request.max_output_tokens
        ));
    }

    let started_at_ms = unix_millis();
    let mut points = Vec::with_capacity(request.concurrencies.len());
    for (point_index, concurrency) in request.concurrencies.iter().copied().enumerate() {
        emit_progress(app_handle, request, point_index, concurrency, "warming");
        for warmup in 0..request.warmup_rounds {
            let round = 10_000 + (point_index as u32 * 100) + warmup;
            run_wave(
                &client,
                session,
                control,
                request,
                concurrency,
                round,
                corpus_repetitions,
            )
            .await?;
        }

        emit_progress(app_handle, request, point_index, concurrency, "measuring");
        let mut accumulator = PointAccumulator::default();
        for measured in 0..request.measured_rounds {
            let round = 20_000 + (point_index as u32 * 100) + measured;
            let wave = run_wave(
                &client,
                session,
                control,
                request,
                concurrency,
                round,
                corpus_repetitions,
            )
            .await?;
            accumulator.add_wave(wave);
        }
        points.push(accumulator.finish(
            concurrency,
            request.prompt_tokens,
            request.max_output_tokens,
        ));
        emit_progress(
            app_handle,
            request,
            point_index + 1,
            concurrency,
            "complete",
        );
    }

    Ok(BenchmarkResult {
        run_id: request.run_id.clone(),
        started_at_ms,
        completed_at_ms: unix_millis(),
        session: BenchmarkSession {
            max_context,
            ..session.info.clone()
        },
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
    fn validation_caps_points_to_resident_server_concurrency() {
        assert!(validate_request(&request(), &session(4)).is_ok());
        assert!(validate_request(&request(), &session(2)).is_err());
        assert!(validate_request(&request(), &session(0)).is_err());
    }

    #[test]
    fn accumulator_reports_aggregate_phase_rates() {
        let mut accumulator = PointAccumulator::default();
        accumulator.add_wave(WaveResult {
            wall_seconds: 2.5,
            samples: vec![
                RequestSample {
                    prompt_tokens: 100,
                    completion_tokens: 50,
                    cached_tokens: 0,
                    computed_prefill_tokens: 100,
                    prefill_seconds: 0.5,
                    decode_seconds: 2.0,
                    request_seconds: 2.5,
                    finish_reason: "length".into(),
                },
                RequestSample {
                    prompt_tokens: 100,
                    completion_tokens: 50,
                    cached_tokens: 0,
                    computed_prefill_tokens: 100,
                    prefill_seconds: 0.4,
                    decode_seconds: 2.0,
                    request_seconds: 2.4,
                    finish_reason: "length".into(),
                },
            ],
        });
        let point = accumulator.finish(2, 100, 50);
        assert_eq!(point.prompt_tokens_per_second, 400.0);
        assert_eq!(point.generation_tokens_per_second, 50.0);
        assert_eq!(point.per_request_generation_tokens_per_second, 25.0);
        assert_eq!(point.wave_output_tokens_per_second, 40.0);
    }
}
