---
date: 2026-10-18
title: "Render choice popups with the app theme"
---

# 2026-10-18 — Render choice popups with the app theme

- **Context:** In native Linux WebKitGTK, the serving-instance popup remains white in app Dark mode despite dark option styles and color-scheme. Native selects therefore cannot meet the shared font, size and color contract across application dropdowns.
- **Decision:** Render remaining choice fields with `ChoiceSelect`, using the existing Radix dropdown radio items and shared menu palette/typography. Keep the existing values, labels, disabled choices and selection callbacks. Escape restores trigger focus; Tab closes the nonmodal popup and moves to the adjacent visible field.
- **Consequences:** App choices use the same theme and Interface text-size setting as action menus. The app owns keyboard focus behavior previously supplied by native selects; focused interaction tests and native acceptance cover that responsibility. No dependency or serving contract changes.
- **Owner:** team.
- **Links:** [Host UI acceptance](../host-ui/README.md#installed-dropdown-acceptance--c7-october-18), [ChoiceSelect](../../web-app/src/components/ui/choice-select.tsx).
