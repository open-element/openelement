/**
 * @openelement/ui - Smoke tests
 *
 * Minimal tests to verify components can be imported and registered.
 * CI should never use continue-on-error - if tests fail, the build fails.
 *
 * v0.44: components are compiled classes (ADR-0143); the tag lives in the
 * compiled program, not a runtime `tagName` export. Alpha16 moved every
 * component to the generated (function-component) lane, so the element classes
 * are build-emitted per manifest declaration and the manual registration table
 * is empty.
 */
import { expect, test } from 'vitest';

// Frozen 6-component roster (owner ruling 2026-10-07, #1557): the four
// zero-interaction components retired to CSS recipes in the create starter.
const EXPECTED_TAGS = [
  'open-button',
  'open-input',
  'open-theme-toggle',
  'open-code-block',
  'open-dialog',
  'open-dropdown',
];

test('open-ui - index exports manifest (WC Package Protocol)', async () => {
  const mod = await import('../src/index.ts');
  expect(mod.manifest, 'manifest export should exist').toEqual(expect.anything());
  expect(typeof mod.manifest).toEqual('object');
  expect(mod.manifest.packageName).toEqual('@openelement/ui');
  expect(mod.manifest.declarations.map((decl) => decl.tagName)).toEqual(EXPECTED_TAGS);
});

test('open-ui - the bulk registration surface is RETIRED, not merely empty', async () => {
  // `registerOpenUi` was an empty compatibility surface: it registered nothing
  // because every first-party element migrated to the generated lane. Its own
  // shim entry (#28) said "delete with the next breaking alpha", and alpha.16 is
  // that alpha, so it is GONE rather than still published-and-empty.
  const root = await import('../src/index.ts');
  expect('registerOpenUi' in root).toEqual(false);
  // The exit is a retirement, not a gap: every element is still exported and
  // still registers itself through the build (the next test pins that).
  expect(root.manifest).toBeDefined();
});

test('open-ui - every component module exports the function-component face', async () => {
  // All six are generated: each module exports the authored function as
  // `default` plus its platform facts as `openElement`. None exports a class —
  // the element constructor exists only in the build output.
  for (const name of EXPECTED_TAGS) {
    const generated = await import(`../src/${name}.tsx`);
    expect(typeof generated.default, `${name} must export its function`).toEqual('function');
    expect(generated.openElement, `${name} must export its platform facts`).toMatchObject({
      root: 'shadow',
    });
  }
});
