import { expect, test } from 'vitest';
import { collectPublicProps, normalizePublicProps } from '../src/internal/core/props-utils.ts';
import { isDangerousKey } from '../src/internal/core/security.ts';

// #903: SSR and CSR prop-collection paths must filter the same key set, so a
// security fix cannot land on one path and be missed on the other.
//
// 0.44: the CSR collector (collectPropBindings in the deleted jsx-render-dom)
// was removed with the legacy renderer. The compiled architecture filters at
// compile/serialization time instead: the program validator and the compiled
// server reject unsafe attribute names (attributeNameIsSafe /
// isSafeAttributeName), covered by compiled-server/compiled-server.test.ts
// and the program validator tests. The shared key filter stays pinned here.

const DANGEROUS = ['__proto__', 'constructor', 'toString', 'hasOwnProperty', 'valueOf'];
const INTERNAL = ['__openElementState', '__openElementHmr'];
const SAFE = ['class', 'style', 'aria-label'];

const FIXTURE: Record<string, unknown> = Object.fromEntries([
  ...DANGEROUS.map((k) => [k, 'x'] as [string, unknown]),
  ...INTERNAL.map((k) => [k, 1] as [string, unknown]),
  ...SAFE.map((k) => [k, 'v'] as [string, unknown]),
]);

test('isDangerousKey covers the prototype-pollution key set', () => {
  for (const key of DANGEROUS) {
    expect(isDangerousKey(key), `expected ${key} to be dangerous`).toEqual(true);
  }
  expect(isDangerousKey('class')).toEqual(false);
  expect(isDangerousKey('onclick')).toEqual(false);
});

test('normalizePublicProps strips dangerous + internal keys, keeps the rest', () => {
  const clean = normalizePublicProps(FIXTURE);
  expect(Object.keys(clean).sort()).toEqual([...SAFE].sort());
});

test('SSR path (collectPublicProps) filters identically to the shared core', () => {
  const host = { ...FIXTURE } as unknown as object;
  expect(Object.keys(collectPublicProps(host)).sort()).toEqual([...SAFE].sort());
});

test('collectPublicProps strips framework-internal host instance fields (#1037)', () => {
  // Host instances may carry own-enumerable framework internals. Collected
  // into props they leak into `{...props}` spreads as garbage attributes
  // (`signal-registry="[object Map]"`) and diverge SSR/CSR output.
  const host = {
    label: 'public',
    signalRegistry: new Map(),
    _internals: undefined,
  } as unknown as object;
  expect(collectPublicProps(host)).toEqual({ label: 'public' });
});
