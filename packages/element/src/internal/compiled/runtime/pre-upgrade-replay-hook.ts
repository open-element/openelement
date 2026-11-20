/**
 * The pre-upgrade replay HOOK — the one neutral indirection that lets the
 * generated-element shell replay a pre-hydration interaction without importing
 * the capture module (2026-11-21 closeout item).
 *
 * WHY A HOOK AND NOT AN IMPORT. The capture/replay registry lives in
 * `pre-upgrade-events.ts`, which the shell's P1 closure test forbids: that module
 * is the class facade's capture bookkeeping and must stay out of every generated
 * page's bundle. The CAPTURE half is already installed by the generated ENTRY
 * through `document-services` (executor-free). Replay needs the registry's
 * per-root bucket, so the shell cannot re-implement it either.
 *
 * So this module holds ONE function slot and nothing else:
 *
 * - the capture module PUBLISHES its implementation from inside
 *   `ensurePreHydrationClickCapture` (the same call the entry already makes —
 *   no module-scope side effect, so a graph that never installs the capture
 *   carries no hook either);
 * - the shell ASKS for it on a successful claim/mount and releases at its
 *   activation decision.
 *
 * What that buys: one call site swap, no second registry, no second capture, and
 * a null hook that is a correct no-op (an entry that never installed the capture
 * has nothing to replay). What it costs: the shell can no longer prove replay
 * *statelessly* — a reader must know the entry installs it. `pre-hydration
 * replay` is therefore proven end-to-end (the packed starter's `#942` rows) and
 * not by a shell-only unit row.
 *
 * Deliberately import-free: this file is inside the shell's allowed closure
 * precisely because it reaches nothing (the P1 test names it as the exception).
 */

/** What the capture module publishes: the per-root replay/release pair. */
export interface PreUpgradeReplayHook {
  /** Replay this root's captured records (idempotent per first activation). */
  replay(root: Node): void;
  /** Empty this root's bucket at its activation decision. */
  release(root: Node): void;
}

let installed: PreUpgradeReplayHook | null = null;

/**
 * Publish (or clear) the replay implementation. Called by the capture module
 * when the page capture is installed; idempotent, and the LAST install wins so a
 * document that reinstalls the capture keeps one live pair.
 */
export function installPreUpgradeReplayHook(hook: PreUpgradeReplayHook | null): void {
  installed = hook;
}

/** True when a page capture is installed (test/inspection only). */
export function preUpgradeReplayHookInstalled(): boolean {
  return installed !== null;
}

/** Replay this root's records, or nothing when no capture was installed. */
export function replayPreUpgradeCaptures(root: Node): void {
  installed?.replay(root);
}

/** Release this root's records, or nothing when no capture was installed. */
export function releasePreUpgradeCapturesFor(root: Node): void {
  installed?.release(root);
}
