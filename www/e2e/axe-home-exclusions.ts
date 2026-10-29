/**
 * Shared axe policy for the home template (T10 R5).
 *
 * The home page is scanned by two specs — the resident gate
 * (`accessibility-gate.spec.ts`, English `/`) and the T10 coverage sweep
 * (`accessibility-coverage.spec.ts`, `/` and `/zh`) — so the exclusion list
 * lives here. A copy per spec would drift, and `/zh` turned out to need exactly
 * the English list: the zh home had never been scanned, and its 66 suppressed
 * contrast nodes are the same animated scenes.
 *
 * Two causes, both about measurement rather than design:
 *   - the scroll-reveal entries (`animation: scene-in linear both` under
 *     `@supports (animation-timeline: view())`) sit at their entry opacity
 *     (0.12) in any whole-page snapshot, so axe reads sub-fold copy in a state
 *     the reader never reads it in;
 *   - `.flood`'s backdrop is painted by its `::before`/`::after` pseudo
 *     elements, which axe cannot composite, so those panels are measured
 *     against the page background instead of their real one.
 *
 * The settled-state numbers for the scenes whose backdrop IS resolvable are
 * recorded in the T10 optimization register (§2.9.2 — scene 0 `.scene-copy` at
 * opacity 1 reads 7.72:1); the pseudo-element regions still need a pixel-truth
 * check (register R5b). Until that exists these exclusions are a reviewed
 * decision, not a claim that the regions are covered — the earlier comment in
 * the resident gate claimed the WCAG AA pair test covered the settled prose,
 * and the T10 audit found that test measures the reading shell's code blocks
 * and the mobile rail summary instead.
 */
export const HOME_AXE_EXCLUSIONS: readonly string[] = [
  '.scene-copy',
  '.scene-art',
  '.scene > h2',
  '.flood-panel',
  '.flood-arrow',
  '.strategy',
  '.output-row',
];
