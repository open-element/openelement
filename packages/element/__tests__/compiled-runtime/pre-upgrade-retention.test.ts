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

import { assertEquals } from '@std/assert';
import { type FacadeDom, FacadeElement, FacadeEvent, installFacadeDom } from './facade-dom.ts';

// The facade captures its HTMLElement base at module evaluation time.
const dom: FacadeDom = installFacadeDom();

const {
  ensurePreHydrationClickCapture,
  preUpgradeRetainedRecordCount,
  releasePreUpgradeCapturesFor,
  replayPreUpgradeCaptures,
} = await import('../../src/internal/compiled/runtime/pre-upgrade-events.ts');

// deno-lint-ignore no-explicit-any
type AnyElement = any;

function click(): FacadeEvent {
  return new FacadeEvent('click', { bubbles: true, composed: true });
}

/** A connected dash-tagged pending host with one button child. */
function pendingHost(tag: string): { host: FacadeElement; button: AnyElement } {
  const host = new FacadeElement(tag, dom.document);
  const button = new FacadeElement('button', dom.document);
  host.appendChild(button);
  dom.document.body.appendChild(host);
  return { host, button };
}

function cleanup(...hosts: FacadeElement[]): void {
  for (const host of hosts) {
    if (host.parentNode) host.parentNode.removeChild(host);
  }
}

function asNode(host: FacadeElement): Node {
  return host as unknown as Node;
}

Deno.test('retention: release empties the root bucket and replay is a no-op', () => {
  ensurePreHydrationClickCapture();
  const { host, button } = pendingHost('oe-retention-claimed');
  button.dispatchEvent(click());
  assertEquals(
    preUpgradeRetainedRecordCount(asNode(host)),
    0,
    'a pending record sits in the shared pool; the root has no bucket yet',
  );

  const fired: string[] = [];
  button.addEventListener('click', () => fired.push('button'));
  replayPreUpgradeCaptures(asNode(host));
  assertEquals(fired, ['button'], 'the pending click replays into its claim root');

  releasePreUpgradeCapturesFor(asNode(host));
  assertEquals(
    preUpgradeRetainedRecordCount(asNode(host)),
    0,
    'release empties the root bucket deterministically',
  );
  releasePreUpgradeCapturesFor(asNode(host));
  assertEquals(preUpgradeRetainedRecordCount(asNode(host)), 0, 'release is idempotent');

  replayPreUpgradeCaptures(asNode(host));
  assertEquals(fired, ['button'], 'replay after release never re-fires');
  assertEquals(preUpgradeRetainedRecordCount(asNode(host)), 0);

  cleanup(host);
});

Deno.test('retention: release without replay drops the unconsumed record (replay is a no-op)', () => {
  ensurePreHydrationClickCapture();
  const { host, button } = pendingHost('oe-retention-cancelled');
  button.dispatchEvent(click());

  // Cancelled before activation: the disconnect path releases the root's
  // records without any replay pass — the record was never consumed.
  releasePreUpgradeCapturesFor(asNode(host));
  assertEquals(
    preUpgradeRetainedRecordCount(asNode(host)),
    0,
    'the root bucket is empty after an unreplayed release',
  );

  const fired: string[] = [];
  button.addEventListener('click', () => fired.push('button'));
  replayPreUpgradeCaptures(asNode(host));
  assertEquals(fired, [], 'the unconsumed record is gone: replay is a no-op');
  assertEquals(preUpgradeRetainedRecordCount(asNode(host)), 0);

  cleanup(host);
});

Deno.test('retention: a root release never touches another pending root share', () => {
  ensurePreHydrationClickCapture();
  const a = pendingHost('oe-retention-a');
  const b = pendingHost('oe-retention-b');
  a.button.dispatchEvent(click());
  b.button.dispatchEvent(click());

  releasePreUpgradeCapturesFor(asNode(a.host));
  assertEquals(
    preUpgradeRetainedRecordCount(asNode(a.host)),
    0,
    'the released root retains nothing',
  );

  const fired: string[] = [];
  b.button.addEventListener('click', () => fired.push('b'));
  replayPreUpgradeCaptures(asNode(b.host));
  assertEquals(fired, ['b'], 'the sibling root still replays its own share');
  assertEquals(
    preUpgradeRetainedRecordCount(asNode(b.host)),
    1,
    'the adopted record is retained until its own root releases it',
  );
  releasePreUpgradeCapturesFor(asNode(b.host));
  assertEquals(preUpgradeRetainedRecordCount(asNode(b.host)), 0);

  cleanup(a.host, b.host);
});
