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

const EXPECTED_TAGS = [
  'open-card',
  'open-callout',
  'open-button',
  'open-input',
  'open-theme-toggle',
  'open-code-block',
  'open-badge',
  'open-dialog',
  'open-dropdown',
  'open-tabs',
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
  expect(definitions.size).toEqual(10);
  expect([...definitions.keys()]).toEqual(EXPECTED_TAGS);
});

test('open-ui - every component module exports its class', async () => {
  const expectedExports: Record<string, string> = {
    'open-badge': 'OpenBadge',
    'open-button': 'OpenButton',
    'open-callout': 'OpenCallout',
    'open-card': 'OpenCard',
    'open-code-block': 'OpenCodeBlock',
    'open-dialog': 'OpenDialog',
    'open-dropdown': 'OpenDropdown',
    'open-input': 'OpenInput',
    'open-tabs': 'OpenTabs',
    'open-theme-toggle': 'OpenThemeToggle',
  };
  for (const [name, exportName] of Object.entries(expectedExports)) {
    const mod = await import(`../src/${name}.tsx`);
    expect(mod[exportName], `${name} should export ${exportName}`).toEqual(expect.anything());
  }
});

test('open-ui - open-props-tokens exports openPropsTokenSheet', async () => {
  const mod = await import('../src/open-props-tokens.ts');
  expect(mod.openPropsTokenSheet, 'openPropsTokenSheet should be exported').toEqual(
    expect.anything(),
  );
});
