/**
 * @openelement/ui - Smoke tests
 *
 * Minimal tests to verify components can be imported and registered.
 * CI should never use continue-on-error - if tests fail, the build fails.
 *
 * v0.44: components are compiled classes (ADR-0143); the tag lives in the
 * compiled program, not a runtime `tagName` export, and the registration
 * table is owned by register.ts.
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

test('open-ui - explicit registration is complete and idempotent', async () => {
  const { registerOpenUi } = await import('../src/index.ts');
  const definitions = new Map<string, CustomElementConstructor>();
  const registry = {
    get: (name: string) => definitions.get(name),
    define: (name: string, ctor: CustomElementConstructor) => definitions.set(name, ctor),
  } as unknown as CustomElementRegistry;

  registerOpenUi(registry);
  registerOpenUi(registry);
  expect(definitions.size).toEqual(6);
  expect([...definitions.keys()]).toEqual(EXPECTED_TAGS);
});

test('open-ui - every component module exports its class', async () => {
  const expectedExports: Record<string, string> = {
    'open-button': 'OpenButton',
    'open-code-block': 'OpenCodeBlock',
    'open-dialog': 'OpenDialog',
    'open-dropdown': 'OpenDropdown',
    'open-input': 'OpenInput',
    'open-theme-toggle': 'OpenThemeToggle',
  };
  for (const [name, exportName] of Object.entries(expectedExports)) {
    const mod = await import(`../src/${name}.tsx`);
    expect(mod[exportName], `${name} should export ${exportName}`).toEqual(expect.anything());
  }
});
