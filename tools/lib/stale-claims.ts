/**
 * Handwritten stale history-claim patterns shared by the strategic-docs and
 * public-docs-integrity gates (#838). Both gates used to carry private copies
 * of this list; the JSR best-effort rule had drifted into two spellings
 * (`JSR publish is a best-effort distribution step` vs `JSR publish
 * .*best-effort`) — the unified form is the broader one, which covers both.
 * Gate-specific claims stay in the owning gate; only patterns both gates
 * enforce belong here.
 */
export const STALE_HISTORY_CLAIM_PATTERNS: readonly RegExp[] = [
  /v0\.37\.6 package\s+line current/i,
  /active execution target is\s+v0\.38\.0/i,
  /JSR publish .*best-effort/i,
  /to JSR as a secondary channel/i,
  /Vue adapter proof/i,
  /Vue is .*heavy-framework island/i,
  /Vue 是.*heavy-framework island/i,
  /v0\.41 beta/i,
];
