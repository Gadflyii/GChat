---
date: 2026-10-09
title: "Load frontend features and syntax data on demand"
---

# 2026-10-09 — Load frontend features and syntax data on demand

- **Context:** OI-074's production frontend eagerly loaded unused locales, terminals, syntax runtimes and an emoji picker. The main bundle was 4.68 MB, while individual C++/Emacs Lisp grammars and the inlined regex WASM also exceeded the existing 500 kB advisory.
- **Decision:** Load features at their actual use boundaries, preserving visited terminal sessions and waiting for the saved locale before first render. Emit every installed Shiki grammar as exact, deduplicated offline JSON data and its unchanged Oniguruma engine as a binary asset. Share code chunks by semantic runtime ownership; preserve Mermaid's distinct math version and independent HTML/AST/module support. JSON-only editors register their existing Prism JSON grammar.
- **Consequences:** The app preserves language, Markdown, math, diagram and syntax behavior without changing dependencies or warning limits. Runtime grouping must stay acyclic; a passing build alone is insufficient, as a browser fixture caught an initial HTML-parser/Markdown initialization cycle. The syntax asset test compares every represented grammar with its original input, and the browser exercises actual emitted paths. Artifact/loading byte counts do not establish a measured desktop startup speedup.
- **Owner:** team.
- **Links:** [Current state, acceptance and measurements](../installer-refresh/README.md#oi-074-frontend-loading-and-oi-070-linux-refresh--current-work), [Vite runtime ownership](../../web-app/vite.config.ts), [Offline syntax assets](../../web-app/scripts/syntax-grammar-assets.ts).
