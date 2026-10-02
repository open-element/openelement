import { expect, test } from 'vitest';
import {
  checkBundlerImports,
  checkLockfileVite,
  checkManifests,
  checkStarterVitePin,
  checkTemplateViteText,
  VITE_DEV_PIN,
} from './deps-vite-check.ts';

test('vite gate accepts the unified Vite 8 baseline', () => {
  expect(
    checkManifests([
      { path: 'deno.json', imports: { vite: 'npm:vite@8.0.16' } },
      {
        path: 'packages/router/deno.json',
        imports: { vite: 'npm:vite@8.0.16' },
        peerDependencies: { vite: 'npm:vite@^8.0.0' },
      },
    ]),
  ).toEqual([]);
  expect(checkLockfileVite({ 'npm:vite@8.0.16': '8.0.16_x' })).toEqual([]);
  expect(
    checkBundlerImports([{ path: 'packages/router/src/vite/plugin.ts', text: "from 'vite'" }]),
  ).toEqual([]);
});

test('vite gate rejects legacy vite majors and transitional paths', () => {
  const violations = checkManifests([
    { path: 'examples/open-element-in-fresh/deno.json', imports: { vite: 'npm:vite@^7.1.4' } },
    { path: 'x/deno.json', imports: { 'rolldown-vite': 'npm:rolldown-vite@1.0.0' } },
    { path: 'y/deno.json', imports: { plugin: 'npm:@openelement/adapter-vite@1.0.0' } },
    { path: 'z/deno.json', imports: { terser: 'npm:@rollup/plugin-terser@1.0.0' } },
    { path: 'p/deno.json', peerDependencies: { vite: 'npm:vite@8.0.16' } },
  ]);
  expect(violations.length).toEqual(5);
});

test('vite gate rejects split lockfile instances and second bundlers', () => {
  expect(checkLockfileVite({ 'npm:vite@8.0.16': 'a', 'npm:vite@8.0.17': 'b' }).length).toEqual(1);
  expect(
    checkBundlerImports([{ path: 'tools/lib/x.ts', text: "import { build } from 'npm:esbuild';" }])
      .length,
  ).toEqual(1);
});

test('vite gate holds the starter template to the ${v.vite} token and anchors its embedded pin', () => {
  const tmpl = 'packages/create/templates/package.json.tmpl';
  // The token form passes (the raw devDependency '${v.vite}' normalizes to
  // the canonical token specifier); a literal pin in the template fails even
  // when it matches the canonical dev pin (the template must not carry a
  // copy).
  expect(checkManifests([{ path: tmpl, imports: { vite: 'npm:vite@${v.vite}' } }])).toEqual([]);
  expect(
    checkManifests([{ path: tmpl, imports: { vite: `npm:vite@${VITE_DEV_PIN}` } }]).length,
  ).toEqual(1);
  // Script commands sit outside the manifest slots, so the raw-text rule
  // covers them.
  expect(checkTemplateViteText(tmpl, '"dev": "vite"')).toEqual([]);
  expect(
    checkTemplateViteText(tmpl, '"dependencies": { "vite": "npm:vite@8.0.16" }').length,
  ).toEqual(1);
  expect(checkTemplateViteText('packages/router/deno.json', 'npm:vite@8.0.16')).toEqual([]);
  // The embedded copy the packed CLI stamps into generated starters is
  // anchored to the canonical pin.
  expect(checkStarterVitePin(`export const VITE_STARTER_PIN = '${VITE_DEV_PIN}';\n`)).toEqual([]);
  expect(checkStarterVitePin("export const VITE_STARTER_PIN = '7.0.0';\n").length).toEqual(1);
  expect(checkStarterVitePin("export const CREATE_VERSION = 'x';\n").length).toEqual(1);
});
