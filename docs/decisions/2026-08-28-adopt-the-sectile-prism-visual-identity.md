---
date: 2026-08-28
title: "Adopt the Sectile Prism visual identity"
---

# 2026-08-28 — Adopt the Sectile Prism visual identity

- **Context:** GChat had completed its product-name migration but still used inherited neutral
  tokens, Inter and Studio Feixen, an obsolete application mark, and unrelated publisher metadata.
  Sectile Research Laboratories now has a locked Prism identity shared with GInfer.
- **Decision:** GChat uses the Sectile corporate Prism language for desktop product chrome and
  public repository surfaces.
  - The locked GChat square mark is the application, favicon, loader, and avatar symbol. It is never
    color-inverted in CSS.
  - The light and reversed GChat lockups are used for mastheads and onboarding. The full Sectile
    lockup is used where the corporate identity must be explicit.
  - Light tokens use paper `#fafbfc`, panel `#f1f3f5`, ink `#0a0c0f`, body `#23272e`, muted
    `#5a6068`, rule `#e3e5e8`, and teal `#0b6b6b`. Dark surfaces use `#08090b` / `#111316` with
    teal-light `#3dd3c8`.
  - Geist is the UI and display family. Geist Mono is used for code, metrics, compact labels, and
    terminal content. Both are self-hosted from the official Vercel release under OFL-1.1.
  - Semantic success, warning, error, and provider colors remain semantic; they are not replaced by
    teal merely to increase brand coverage.
  - GChat remains the written product name. Artwork may render the locked `G.chat` treatment.
  - The legal publisher and author identity is Sectile Research Laboratories.
- **Consequences:** the old Inter and Studio Feixen application font bundles are removed. New UI
  work must consume central tokens instead of introducing a competing product accent. Platform
  icons are regenerated from the locked square master, and README/onboarding surfaces use the
  supplied lockups rather than reconstructed text.
- **Owner:** Sectile Research Laboratories
- **Links:** `2026-08-21-brand-the-fork-gchat-and-rename-every-legacy-jan-atomic-identifier.md`,
  `web-app/src/index.css`, `web-app/src/styles/font.css`, `README.md`.
