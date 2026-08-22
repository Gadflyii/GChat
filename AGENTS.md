# AGENTS.md — GChat

Operating instructions for AI coding agents in this repository.
Everything here applies to **every** task. Anything that applies only sometimes
lives behind a link — follow the link when the task needs it.

| Need                                    | Go to                                            |
| --------------------------------------- | ------------------------------------------------ |
| Why something is built the way it is    | [`docs/decisions/INDEX.md`](docs/decisions/INDEX.md) |
| Dev loop, data folders, troubleshooting | [`DEVELOP.md`](DEVELOP.md)                        |
| Product overview, install, API examples | [`README.md`](README.md)                          |
| Contribution conventions                | [`CONTRIBUTING.md`](CONTRIBUTING.md)              |

---

## 1. What this is

Desktop app (Tauri + React) that runs local models through the [ginfer]
inference engine and exposes an OpenAI-compatible API at
`http://localhost:1337/v1`. One inference backend sits behind that one
facade: `ginfer`.

[ginfer]: https://github.com/Gadflyii/ginfer

Targets: Linux x86_64 (AppImage) with an NVIDIA GPU (CUDA 13.1, SM 86/89/120a).
Windows is gated until the ginfer port ships; other platforms are unsupported.

**Product name is GChat.** Clean-slate fork of Atomic Chat (itself a hard fork
of [Jan](https://github.com/janhq/jan)); the legacy `jan*` / `atomic`
identifiers were renamed wholesale per
[ADR 2026-08-21](docs/decisions/2026-08-21-brand-the-fork-gchat-and-rename-every-legacy-jan-atomic-identifier.md) —
there is no legacy user base and no migration shim.

---

## 2. Repository map

| Path                                      | What lives there                                                                     |
| ----------------------------------------- | ------------------------------------------------------------------------------------ |
| `web-app/`                                | Frontend: React + Vite + TanStack Router, Tailwind, shadcn. Workspace `@gchat/web-app`. |
| `web-app/src/routes/launch/`              | "Launch" page — install/configure external coding agents against the local API. Catalog: `web-app/src/constants/integrations.ts`; commands: `src-tauri/src/core/system/commands.rs`. |
| `core/`                                   | Shared TS core: types, browser runtime, extension contracts. Built + `yarn pack`'d, consumed by extensions. |
| `extensions/`                             | Pluggable backend extensions (TS, rolldown-bundled). Each has `src/`, `package.json`, `settings.json`. |
| `extensions/ginfer-extension/`            | Driver for the ginfer engine. Provider id `ginfer` (the only local provider). |
| `src-tauri/`                              | Rust/Tauri shell: `src/lib.rs`, `src/main.rs`, plugins, capabilities, bundle configs.  |
| `src-tauri/plugins/tauri-plugin-ginfer/`  | Owns `ginfer-serve` process lifecycle (spawn/stop/readiness) for the ginfer extension. |
| `src-tauri/plugins/tauri-plugin-hardware/`| GPU/CPU/RAM probing that feeds the NVIDIA/CUDA hardware gate.                        |
| `pre-install/`                            | Pre-built extension tarballs bundled into the installer, named `gchat-<ext>-<ver>.tgz`. |
| `scripts/`                                | Build, packaging, signing, download helpers.                                          |
| `docs/`                                   | Public docs site (Next.js/MDX) + `docs/decisions/` (ADR log).                          |
| `autoqa/`, `tests/`                       | Automated QA harness, top-level Vitest + quality fixtures.                            |

The engine itself lives in [`Gadflyii/ginfer`](https://github.com/Gadflyii/ginfer)
(`ginfer-serve` contract in its `docs/serving.md`); models are published in the
[`GadflyII/ginfer-models`](https://huggingface.co/collections/GadflyII/ginfer-models)
Hugging Face collection.

---

## 3. Backends — the part that is easy to get wrong

**There is exactly one local inference backend: ginfer.**

- Provider id is `ginfer`; the engine is the `ginfer-serve` HTTP server driven
  by `src-tauri/plugins/tauri-plugin-ginfer/`, surfaced by
  `extensions/ginfer-extension/` (extends `AIEngine`).
- Models are `.ginfer` containers from the `GadflyII/ginfer-models` HF
  collection (int-autoround + NVFP4). The HF download pipeline is narrowed to
  `.ginfer`; the local model cache is `<data>/ginfer/models/`.
- Model identity comes from the `.ginfer` artifact itself (closed registered
  set); anything outside the collection fails at server start, so catalog
  entries must track published artifacts 1:1.
- Hardware gate: **Linux x86_64 + NVIDIA, CUDA 13.1 driver, SM 86/89/120a.**
  The gate must surface a clear "unsupported" state everywhere the UI assumes
  a local engine — never let an unsupported host fall through to loading.
  Windows is gated until the ginfer port ships.
- RAG/vector DB extensions stay wired but embedding is feature-disabled until
  ginfer ships an embeddings endpoint; do not revive llama.cpp/MLX code paths.

Details and reasoning are in
[`docs/decisions/INDEX.md`](docs/decisions/INDEX.md) — start with
*Use ginfer as the sole inference backend* and *Brand the fork GChat*.
Older upstream provider ADRs (llama.cpp, MLX, speculative decoding) describe
history only.

---

## 4. Naming: the GChat identity

The legacy `jan*` / `atomic` rename is done (ADR 2026-08-21); this identity is
now load-bearing — do not introduce new legacy identifiers.

| Surface                  | Value                   |
| ------------------------ | ----------------------- |
| Product name             | `GChat`                 |
| Root `package.json` name | `gchat`                 |
| Workspaces               | `@gchat/*` (core, web-app, `*-extension`, `tauri-plugin-*-api`) |
| Cargo crate              | `gchat`                 |
| Tauri CLI binary         | `gchat-cli`             |
| Tauri bundle id          | `app.gchat`             |
| Data folder (all OS)     | `GChat`                 |
| Ginfer model cache       | `<data>/ginfer/models/` |
| Pre-install tarballs     | `gchat-*-*.tgz`         |

**All** modules, packages, env vars, log prefixes, CLI subcommands, telemetry
events, user-facing strings and docs use `gchat` / `GChat`. Adding a new
`jan*` or `atomic*` identifier is not.

---

## 5. Commands

```bash
make dev      # first-time setup: deps, core, extensions, icons, launch Tauri
yarn dev      # hot loop after make dev has run once
make build    # production build (see Makefile / package.json for per-platform targets)
make typecheck # web-app `tsc -b` — the release build's type check; lint/Vitest don't check types
make verify-fast # local agent gate: lint, typecheck, quality guards, Vitest + critical coverage floors
make verify   # verify-fast plus every platform-supported Rust suite
make test-all # exhaustive artefact build + verify + configured live contracts
make test-local # root + extension Vitest and platform Rust suites; creates inert Tauri resource stubs
make test     # full suite: lint, downloads, generated icons, sidecars, CLI, tests
yarn lint     # eslint in @gchat/web-app
```

Per-OS runtime data paths are documented in `DEVELOP.md`.
Do not invent new data paths.

---

## 6. Rules

These are additional to the user's global engineering rules and override
defaults on conflict.

1. **Do only what was asked.** No opportunistic refactors, no "while I'm here"
   cleanups. Tempting improvement → propose it, don't ship it.
2. **Don't fabricate backend behaviour.** Unsure about a `ginfer-serve` flag or
   the `.ginfer` format? Read the `Gadflyii/ginfer` repo's `README.md` and
   `docs/serving.md`.
3. **OpenAI-compat is a contract.** `http://localhost:1337/v1` must stay
   OpenAI-compatible — OpenCode, Codex, Hermes and others depend on it. Adding
   non-standard fields is fine; breaking standard ones is not.
4. **Verify before you finish.** Run `make verify` for agent-authored changes.
   For focused iteration, TS/JS uses lint + tests in the affected workspace;
   Rust uses `cargo check` and `cargo clippy` in `src-tauri/`.
5. **Never commit unless explicitly asked.**
6. **No new top-level folders, config files or runtime dependencies** without
   the user's explicit "ok" (name + reason first).
7. **No destructive commands** — `rm -rf`, `git push --force`, `cargo clean
   --release`, deleting user data folders — without explicit confirmation.
8. **Record non-trivial decisions** as a new file in `docs/decisions/`
   (architecture, backend selection, perf trade-off, security default, schema
   or migration). Same session, before you finish. See §7.

---

## 7. Keeping this file small

`AGENTS.md` is loaded into context on every single task, so its size is a tax
on every task. Hard limits:

- **Target ≤ 200 lines. Never exceed 300.** If an edit pushes it over, move
  something out to a linked doc in the same edit.
- **No decision log in this file.** Each ADR is its own file under
  `docs/decisions/` (template: `_TEMPLATE.md`), indexed one line per record in
  `docs/decisions/INDEX.md`. Never inline a record here.
- **At most 10 ADRs may be referenced from this file**, and only ones that
  change how you write code today — the standing platform/provider policies.
  Everything else is reachable via the index.
- **No duplication.** If a fact already lives in `README.md`, `DEVELOP.md`,
  `CONTRIBUTING.md` or an ADR, link to it instead of restating it. When they
  disagree, the linked doc wins and this file gets fixed.
- Prefer a table or an imperative rule over a paragraph. Delete anything a
  competent agent would infer from the code in under a minute.
