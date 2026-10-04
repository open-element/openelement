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
