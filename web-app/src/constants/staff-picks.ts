/**
 * Bundled fallback for the staff-picks registry. Mirrors the contents of
 * `atomic-chat-conf/models/staff-picks.json` so Hub can render the curated
 * list on the very first launch (before the manifest fetch resolves) and when
 * the network is unavailable.
 *
 * Platform filtering happens at runtime in `staff-picks-registry.ts` — keep
 * `platforms` declarative here (do NOT inline `IS_MACOS` ternaries) so the
 * baseline mirrors the manifest shape verbatim.
 *
 * Empty: the curated list targets the retired GGUF/MLX backends; the single
 * local backend (GInfer) has no staff picks yet.
 */

import type { StaffPick } from '@/services/staff-picks-registry'

export const BASELINE_STAFF_PICKS: ReadonlyArray<StaffPick> = []
