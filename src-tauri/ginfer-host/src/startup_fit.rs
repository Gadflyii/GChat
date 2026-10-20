//! Whether one launch fits this computer, read from the Engine's startup quote.
//!
//! The Engine's quote reports a verdict (`fit_status`, `capacity_failure`,
//! `quoted_context`) for the models whose planners search capacity. For the
//! others it reports the per-rank memory facts only: fixed startup bytes, the
//! K/V bytes per stored segment, headroom and free memory. A conversation of
//! `max_context` tokens must fit in the K/V cache, so the fixed bytes plus that
//! cache plus the headroom must fit in the free memory of every rank.
use serde::Serialize;
use serde_json::Value;

/// Typed code that leads a "does not fit" Host error, as `[does_not_fit] message`.
pub const DOES_NOT_FIT: &str = "does_not_fit";

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct StartupFit {
    pub fits: bool,
    /// The longest conversation these settings fit, when the quote shows it.
    pub max_context: Option<u32>,
    /// Memory these settings need beyond what is free, when known.
    pub shortfall_bytes: Option<u64>,
    /// The Engine's limiting resource, such as `device-memory` or `host-ram`.
    pub resource: Option<String>,
}

fn u64_field(rank: &Value, name: &str) -> Option<u64> {
    rank.get(name).and_then(Value::as_u64)
}

/// One rank's K/V estimate: the longest single conversation that fits, and the
/// shortfall for `max_context` tokens. None when the rank lacks segment facts.
fn rank_estimate(rank: &Value, max_context: u32) -> Option<(u64, u64)> {
    let free = u64_field(rank, "free_bytes")?;
    let headroom = u64_field(rank, "headroom_bytes")?;
    let peak = u64_field(rank, "startup_peak_bytes")?;
    let minimum = u64_field(rank, "minimum_kv_arena_bytes")?;
    let segment_tokens = u64_field(rank, "kv_segment_tokens").filter(|n| *n > 0)?;
    let segment_bytes = u64_field(rank, "kv_segment_bytes").filter(|n| *n > 0)?;
    let fixed = peak.checked_sub(minimum)?;
    let available = free.saturating_sub(fixed.saturating_add(headroom));
    let tokens = available / segment_bytes * segment_tokens;
    let needed_kv = u64::from(max_context)
        .div_ceil(segment_tokens)
        .saturating_mul(segment_bytes)
        .max(minimum);
    let shortfall = fixed
        .saturating_add(needed_kv)
        .saturating_add(headroom)
        .saturating_sub(free);
    Some((tokens, shortfall))
}

/// The fit of a launch of `max_context` tokens, from one Engine quote JSON.
/// `estimate_kv` compares the ranks' K/V segment facts with one full conversation in GPU
/// memory; without it (CPU, and models whose planner searches capacity) the Engine verdict stands.
pub fn evaluate(quote: &Value, max_context: u32, estimate_kv: bool) -> StartupFit {
    let failure = quote.get("capacity_failure").filter(|value| !value.is_null());
    let mut fit = StartupFit {
        fits: true,
        max_context: None,
        shortfall_bytes: failure.and_then(|f| u64_field(f, "shortfall_bytes")),
        resource: failure
            .and_then(|f| f.get("resource"))
            .and_then(Value::as_str)
            .map(str::to_owned),
    };
    let quoted = u64_field(quote, "quoted_context").map(|n| n.min(u64::from(u32::MAX)) as u32);
    if quote.get("fit_status").and_then(Value::as_str) == Some("does-not-fit")
        || failure.is_some()
        || quoted.is_some_and(|quoted| quoted < max_context)
    {
        fit.fits = false;
        fit.max_context = quoted.filter(|n| *n > 0);
    }
    let ranks = quote.get("ranks").and_then(Value::as_array).cloned().unwrap_or_default();
    let estimates: Option<Vec<_>> = (estimate_kv && !ranks.is_empty())
        .then(|| ranks.iter().map(|rank| rank_estimate(rank, max_context)).collect())
        .flatten();
    if let Some(estimates) = estimates {
        let tokens = estimates.iter().map(|(tokens, _)| *tokens).min().unwrap_or(0);
        let tokens = tokens.min(u64::from(u32::MAX)) as u32;
        let shortfall = estimates.iter().map(|(_, shortfall)| *shortfall).max().unwrap_or(0);
        if shortfall > 0 {
            fit.fits = false;
            fit.shortfall_bytes = Some(fit.shortfall_bytes.unwrap_or(0).max(shortfall));
            fit.resource.get_or_insert_with(|| "device-memory".into());
        }
        if !fit.fits {
            fit.max_context = Some(fit.max_context.map_or(tokens, |quoted| quoted.min(tokens)))
                .filter(|n| *n > 0);
        }
    }
    fit
}

/// Context lengths GChat chooses by itself, longest first.
pub const STANDARD_CONTEXTS: [u32; 6] = [262144, 131072, 65536, 32768, 16384, 8192];

/// The longest standard context of at most `fitting` tokens.
pub fn standard_context(fitting: u32) -> Option<u32> {
    STANDARD_CONTEXTS.into_iter().find(|context| *context <= fitting)
}

fn gigabytes(bytes: u64) -> String {
    // Round up so "needs 0.0 GB more" never appears for a real shortfall.
    let tenths = bytes.div_ceil(100_000_000).max(1);
    format!("{}.{} GB", tenths / 10, tenths % 10)
}

fn grouped(value: u32) -> String {
    let digits = value.to_string();
    let mut out = String::new();
    for (index, digit) in digits.chars().enumerate() {
        if index > 0 && (digits.len() - index) % 3 == 0 {
            out.push(',');
        }
        out.push(digit);
    }
    out
}

impl StartupFit {
    /// The Host error for a launch that does not fit: its typed code, then the sentence.
    pub fn message(&self) -> String {
        format!("[{DOES_NOT_FIT}] {}", self.sentence())
    }

    /// What does not fit and what to try, in plain words.
    pub fn sentence(&self) -> String {
        let memory = match self.resource.as_deref() {
            Some("host-ram" | "host-pinned" | "host-cache") => "computer memory (RAM)",
            Some("disk") => "disk space",
            _ => "GPU memory",
        };
        let need = match self.shortfall_bytes {
            Some(bytes) if bytes > 0 => format!("These settings need {} more {memory} than is free.", gigabytes(bytes)),
            _ => format!("These settings do not fit in the {memory} that is free."),
        };
        let advice = match self.max_context {
            Some(tokens) if tokens >= 1024 => format!(
                " Try a shorter context length: {} tokens or less fits.",
                grouped(tokens)
            ),
            _ => " Try a shorter context length, fewer replies at once (Concurrency), INT8 K/V cache, or close other apps using the graphics card.".to_owned(),
        };
        format!("{need}{advice}")
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    // The laptop RTX 3080 Ti quote for the Qwen 27B SMOL package, Concurrency 1, INT8 K/V.
    fn laptop_qwen(free: u64) -> Value {
        json!({"schema":"ginfer-startup-quote-v1","model_id":"qwen3.8-27b",
            "weights_id":"smol-q2g64-mix-dflash2-q4","tensor_parallel_size":1,
            "ranks":[{"rank":0,"free_bytes":free,"weights_bytes":9335830528_u64,
                "state_bytes":340326656,"graph_allowance_bytes":25165824,
                "graph_allowance_source":"planner","minimum_kv_arena_bytes":34670592,
                "kv_arena_alignment_bytes":256,"kv_bytes_per_token":33792,
                "kv_segment_bytes":34603008,"kv_segment_tokens":1024,
                "headroom_bytes":314572800,"startup_peak_bytes":9735993600_u64}]})
    }

    #[test]
    fn segment_facts_bound_the_conversation_length() {
        let quote = laptop_qwen(15761145856);
        let fit = evaluate(&quote, 131072, true);
        assert!(fit.fits, "{fit:?}");
        let fit = evaluate(&quote, 262144, true);
        assert!(evaluate(&quote, 262144, false).fits);
        assert!(!fit.fits);
        // 15761145856 free - 9701323008 fixed - 314572800 headroom = 5745250048 bytes of K/V.
        assert_eq!(fit.max_context, Some(5745250048 / 34603008 * 1024));
        assert_eq!(fit.shortfall_bytes, Some(9701323008 + 256 * 34603008 + 314572800 - 15761145856));
        assert_eq!(fit.resource.as_deref(), Some("device-memory"));
        assert_eq!(fit.message(), "[does_not_fit] These settings need 3.2 GB more GPU memory than is free. Try a shorter context length: 169,984 tokens or less fits.");
    }

    #[test]
    fn engine_verdicts_and_quoted_context_are_kept() {
        let quote = json!({"fit_status":"does-not-fit","quoted_context":67584,"requested_context":131072,
            "capacity_failure":{"resource":"host-ram","shortfall_bytes":1500000000_u64,"message":"x"},
            "ranks":[]});
        let fit = evaluate(&quote, 131072, true);
        assert_eq!(fit, StartupFit { fits: false, max_context: Some(67584),
            shortfall_bytes: Some(1500000000), resource: Some("host-ram".into()) });
        assert!(fit.message().contains("1.5 GB more computer memory (RAM)"));
        let none = json!({"fit_status":"does-not-fit","quoted_context":0,"capacity_failure":{"resource":"device-arena","shortfall_bytes":null},"ranks":[]});
        let fit = evaluate(&none, 8192, true);
        assert_eq!(fit.max_context, None);
        assert!(fit.message().ends_with("or close other apps using the graphics card."));
        assert_eq!((standard_context(169984), standard_context(8191)), (Some(131072), None));
        // A quote without segment facts (older Engines, CPU) keeps the Engine verdict alone.
        let bare = json!({"ranks":[{"rank":0,"free_bytes":1,"startup_peak_bytes":2}]});
        assert!(evaluate(&bare, 262144, true).fits);
    }
}
