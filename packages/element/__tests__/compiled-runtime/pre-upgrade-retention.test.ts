/**
 * pre-upgrade-retention.test.ts — the facade capture registry's per-root
 * ownership model (the M1 data model).
 *
 * Records pend in one bounded shared pool until their claim root adopts them
 * into its own WeakMap-keyed bucket; replay and release then touch only that
 * bucket, and release empties it deterministically. These are STRUCTURAL
 * assertions: JS cannot observe GC, so the WeakMap keying itself is the
 * memory guarantee and the tests pin observable state (bucket counts, replay
 * behavior) — never collection behavior. Covered behavior:
 *   - a pending record sits in the pool: no bucket exists before adoption
 *   - release empties the root's bucket deterministically (and idempotently)
 *   - replay after release is a no-op, even for never-consumed records
 *   - an adopted record stays retained until its own root releases it
 *   - a root's release never touches another pending root's share
 */

import { expect, test } from 'vitest';
import { type FacadeDom, FacadeElement, installFacadeDom } from './facade-dom.ts';
import { cleanup, click, pendingHost } from './pre-upgrade-helpers.ts';

// The facade captures its HTMLElement base at module evaluation time.
const dom: FacadeDom = installFacadeDom();

const {
  ensurePreHydrationClickCapture,
  markPreUpgradeIslandSettled,
  preUpgradeRetainedRecordCount,
  releasePreUpgradeCapturesFor,
  replayPreUpgradeCaptures,
} = await import('../../src/internal/compiled/runtime/pre-upgrade-events.ts');

function asNode(host: FacadeElement): Node {
  return host as unknown as Node;
}

test('retention: release empties the root bucket and replay is a no-op', () => {
  ensurePreHydrationClickCapture();
  const { host, button } = pendingHost(dom, 'oe-retention-claimed');
  button.dispatchEvent(click());
  expect(
    preUpgradeRetainedRecordCount(asNode(host)),
    'a pending record sits in the shared pool; the root has no bucket yet',
  ).toEqual(0);

  const fired: string[] = [];
  button.addEventListener('click', () => fired.push('button'));
  replayPreUpgradeCaptures(asNode(host));
  expect(fired, 'the pending click replays into its claim root').toEqual(['button']);

  releasePreUpgradeCapturesFor(asNode(host));
  expect(
    preUpgradeRetainedRecordCount(asNode(host)),
    'release empties the root bucket deterministically',
  ).toEqual(0);
  releasePreUpgradeCapturesFor(asNode(host));
  expect(preUpgradeRetainedRecordCount(asNode(host)), 'release is idempotent').toEqual(0);

  replayPreUpgradeCaptures(asNode(host));
  expect(fired, 'replay after release never re-fires').toEqual(['button']);
  expect(preUpgradeRetainedRecordCount(asNode(host))).toEqual(0);

  cleanup(host);
});

test('retention: reentrant replay and reconnect keep the adopted order without double replay', () => {
  ensurePreHydrationClickCapture();
  const { host, button } = pendingHost(dom, 'oe-retention-reentrant');
  const second = new FacadeElement('button', dom.document);
  host.appendChild(second);
  button.dispatchEvent(click());
  second.dispatchEvent(click());
  markPreUpgradeIslandSettled(host);

  const fired: string[] = [];
  button.addEventListener('click', () => {
    fired.push('first');
    replayPreUpgradeCaptures(asNode(host));
  });
  second.addEventListener('click', () => fired.push('second'));
  try {
    replayPreUpgradeCaptures(asNode(host));
    releasePreUpgradeCapturesFor(asNode(host));
    replayPreUpgradeCaptures(asNode(host));
    expect(fired).toEqual(['first', 'second']);
    expect(preUpgradeRetainedRecordCount(asNode(host))).toBe(0);
  } finally {
    cleanup(host);
  }
});

test('retention: release without replay drops the unconsumed record (replay is a no-op)', () => {
  ensurePreHydrationClickCapture();
  const { host, button } = pendingHost(dom, 'oe-retention-cancelled');
  button.dispatchEvent(click());

  // Cancelled before activation: the disconnect path releases the root's
  // records without any replay pass — the record was never consumed.
  releasePreUpgradeCapturesFor(asNode(host));
  expect(
    preUpgradeRetainedRecordCount(asNode(host)),
    'the root bucket is empty after an unreplayed release',
  ).toEqual(0);

  const fired: string[] = [];
  button.addEventListener('click', () => fired.push('button'));
  replayPreUpgradeCaptures(asNode(host));
  expect(fired, 'the unconsumed record is gone: replay is a no-op').toEqual([]);
  expect(preUpgradeRetainedRecordCount(asNode(host))).toEqual(0);

  cleanup(host);
});

test('retention: a root release never touches another pending root share', () => {
  ensurePreHydrationClickCapture();
  const a = pendingHost(dom, 'oe-retention-a');
  const b = pendingHost(dom, 'oe-retention-b');
  a.button.dispatchEvent(click());
  b.button.dispatchEvent(click());

  releasePreUpgradeCapturesFor(asNode(a.host));
  expect(
    preUpgradeRetainedRecordCount(asNode(a.host)),
    'the released root retains nothing',
  ).toEqual(0);

  const fired: string[] = [];
  b.button.addEventListener('click', () => fired.push('b'));
  replayPreUpgradeCaptures(asNode(b.host));
  expect(fired, 'the sibling root still replays its own share').toEqual(['b']);
  expect(
    preUpgradeRetainedRecordCount(asNode(b.host)),
    'the adopted record is retained until its own root releases it',
  ).toEqual(1);
  releasePreUpgradeCapturesFor(asNode(b.host));
  expect(preUpgradeRetainedRecordCount(asNode(b.host))).toEqual(0);

  cleanup(a.host, b.host);
});

// ---- the generated shell's neutral replay hook (2026-11-21) ----------------

test('the shell hook is published by the capture install and chains the ONE registry', async () => {
  const hook = await import('../../src/internal/compiled/runtime/pre-upgrade-replay-hook.ts');
  // Before any capture install in THIS realm the hook is a no-op: a generated
  // page whose entry never installs the capture has nothing to replay, and the
  // shell's call must not throw.
  expect(() =>
    hook.replayPreUpgradeCaptures(asNode(pendingHost(dom, 'oe-hook-none').host)),
  ).not.toThrow();

  ensurePreHydrationClickCapture();
  expect(hook.preUpgradeReplayHookInstalled()).toBe(true);

  // The hook's implementation IS the registry's pair: a record captured before a
  // root's first activation is adopted out of the shared pool by the hook's call
  // (the bucket count is the structural fact), and the hook's release empties it.
  const { host, button } = pendingHost(dom, 'oe-hook-claimed');
  button.dispatchEvent(click());
  expect(
    preUpgradeRetainedRecordCount(asNode(host)),
    'the record sits in the shared pool before any adoption',
  ).toBe(0);
  hook.replayPreUpgradeCaptures(asNode(host));
  expect(
    preUpgradeRetainedRecordCount(asNode(host)),
    "the hook adopted this root's share into its own bucket",
  ).toBe(1);
  hook.releasePreUpgradeCapturesFor(asNode(host));
  expect(preUpgradeRetainedRecordCount(asNode(host)), 'the hook released it').toBe(0);
});

test('retention: outer shadow claim leaves a nested declared island pending', () => {
  ensurePreHydrationClickCapture(undefined, ['oe-adopt-outer', 'oe-adopt-inner']);
  const outer = pendingHost(dom, 'oe-adopt-outer');
  const inner = pendingHost(dom, 'oe-adopt-inner');
  const shadow = outer.host.attachShadow({ mode: 'open' });
  shadow.appendChild(outer.button);
  shadow.appendChild(inner.host);
  outer.button.dispatchEvent(click());
  inner.button.dispatchEvent(click());

  const fired: string[] = [];
  outer.button.addEventListener('click', () => fired.push('outer'));
  inner.button.addEventListener('click', () => fired.push('inner'));
  try {
    markPreUpgradeIslandSettled(outer.host);
    replayPreUpgradeCaptures(asNode(outer.host));
    releasePreUpgradeCapturesFor(asNode(outer.host));
    expect(fired).toEqual(['outer']);

    markPreUpgradeIslandSettled(inner.host);
    replayPreUpgradeCaptures(asNode(inner.host));
    releasePreUpgradeCapturesFor(asNode(inner.host));
    expect(fired).toEqual(['outer', 'inner']);
  } finally {
    cleanup(outer.host, inner.host);
  }
});
