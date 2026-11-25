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
 * `cinematic-home.spec.ts` checks contrast in the settled flood scene using
 * screenshots of the painted background under the text in both locales.
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
