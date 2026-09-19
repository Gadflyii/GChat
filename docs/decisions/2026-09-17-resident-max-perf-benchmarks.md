# Resident Max Perf benchmarks

GChat uses the authenticated `POST /v1/ginfer/benchmark` endpoint on the selected
resident instance. This replaces chat-template prompts and overlapping request
phase estimates. The host forwards this route without injecting a chat model field.

The engine owns the frozen model-specific 2048-token Max Perf sequences, repeated
or truncated to the exact input length. Greedy raw-token generation disables model
stops and requires the exact output budget. Loaded draft/KV/Graph settings remain.

Presets: Standard Benchmark 2048/500 at C1/C4/C8; Serving 4096/1000;
Long Context 32768/512; Big Bench 65536/65536; Custom. Non-standard presets
offer all C1–C8 within loaded capacity. At least one warmup and measured wave.
Context and output are never silently reduced.

Cold PP uses actual computed prefill tokens and matching compute observations
from the first warmup. A previously cached prompt may have no full cold observation;
that rate is unavailable, not zero. Application caches are not flushed and the
engine is not restarted. PP divides logical prompt tokens by mean TTFT, including
avoided cached work. TG uses exact-concurrency decode-transaction counters,
excluding the first prefill token. Per-request TG is aggregate TG/concurrency.
Graphs use a left PP scale and right TG scale, with gaps for missing observations.
Storage version 1 discards the old benchmark history on hydration. There is no
legacy scoring path or record conversion; only the new methodology is supported.

An idle engine grants exclusive benchmark admission; disconnect cancels execution.
These synthetic best-case results are not representative agent workloads.
Leaderboard, page redesign and installer packaging remain separate work.
