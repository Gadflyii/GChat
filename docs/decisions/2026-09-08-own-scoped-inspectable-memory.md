---
date: 2026-09-08
title: Own scoped, inspectable memory in GChat
---

# Own scoped, inspectable memory in GChat

- **Context:** Session checkpoints preserve conversation continuity but do not provide reusable cross-session facts or a user-visible memory library.
- **Decision:** Native GChat owns revisioned personal/workspace memories, bounded lexical recall, approval-gated agent mutations and a shared desktop library. Workspace-root `AGENTS.md` is an optional read-only instruction source, separate from learned facts. No automatic transcript mining, embedding dependency or cross-workspace recall is introduced.
- **Consequences:** Users can inspect and correct everything saved. New conversations recall relevant personal facts; agents additionally receive their exact workspace's facts and instructions. Remote inference receives selected context, not filesystem access. Independent terminal integrations retain their own memory systems.
- **Owner:** GChat
- **Links:** [Memory contract](../memory.md)
