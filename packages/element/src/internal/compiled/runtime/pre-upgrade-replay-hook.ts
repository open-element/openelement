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
 * The hook owns the installed replay pair and the weak record of settled hosts:
 *
 * - the capture module PUBLISHES its implementation from inside
 *   `ensurePreHydrationClickCapture` (the same call the entry already makes —
 *   no module-scope side effect, so a graph that never installs the capture
 *   carries no hook either);
 * - after a successful claim or mount the shell requests replay and settles the
 *   host before redispatch. Release settles hosts whose activation failed as
 *   well. Settlement also works when capture installs after the host activates.
 *
 * A shell that activates before capture has nothing to replay, but its weak
 * settlement record still lets a later installer reject ordinary live traffic.
 * The packed starter exercises both the delayed replay and the capture bound.
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
const settledIslandHosts = new WeakSet<object>();

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

/** Whether a generated host has reached its activation decision. */
export function isPreUpgradeIslandSettled(host: object): boolean {
  return settledIslandHosts.has(host);
}

/** Settle the host before replay, so its redispatched events see it as live. */
export function replayPreUpgradeCaptures(root: Node): void {
  settledIslandHosts.add(root);
  installed?.replay(root);
}

/** Settle the host and release its records, including after a failed activation. */
export function releasePreUpgradeCapturesFor(root: Node): void {
  settledIslandHosts.add(root);
  installed?.release(root);
}
