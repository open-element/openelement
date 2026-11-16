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

test('open-ui - explicit registration covers every class-authored component', async () => {
  const { registerOpenUi } = await import('../src/index.ts');
  const definitions = new Map<string, CustomElementConstructor>();
  const registry = {
    get: (name: string) => definitions.get(name),
    define: (name: string, ctor: CustomElementConstructor) => definitions.set(name, ctor),
  } as unknown as CustomElementRegistry;

  registerOpenUi(registry);
  registerOpenUi(registry);
  // `open-theme-toggle` and `open-code-block` are authored as function
  // components: their element classes are build-emitted and defined by the
  // island entry, so they are deliberately absent from the manual table.
  const classAuthored = EXPECTED_TAGS.filter(
    (tag) => tag !== 'open-theme-toggle' && tag !== 'open-code-block',
  );
  expect(definitions.size).toEqual(classAuthored.length);
  expect([...definitions.keys()]).toEqual(classAuthored);
});

test('open-ui - every component module exports its component', async () => {
  const classExports: Record<string, string> = {
    'open-button': 'OpenButton',
    'open-dialog': 'OpenDialog',
    'open-dropdown': 'OpenDropdown',
    'open-input': 'OpenInput',
  };
  for (const [name, exportName] of Object.entries(classExports)) {
    const mod = await import(`../src/${name}.tsx`);
    expect(mod[exportName], `${name} should export ${exportName}`).toEqual(expect.anything());
  }
  // Generated components export the authored function plus their platform
  // facts; the element class exists only in the build output.
  for (const [name, exportName] of [
    ['open-theme-toggle', 'OpenThemeToggle'],
    ['open-code-block', 'OpenCodeBlock'],
  ] as const) {
    const generated = await import(`../src/${name}.tsx`);
    expect(typeof generated.default).toEqual('function');
    expect(generated.openElement).toMatchObject({ root: 'shadow' });
    expect(exportName in generated).toEqual(false);
  }
});
