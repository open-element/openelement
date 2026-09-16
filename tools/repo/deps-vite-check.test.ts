import { assertEquals } from '@std/assert';
import {
  checkBundlerImports,
  checkLockfileVite,
  checkManifests,
  checkStarterVitePin,
  checkTemplateViteText,
  VITE_DEV_PIN,
} from './deps-vite-check.ts';

Deno.test('vite gate accepts the unified Vite 8 baseline', () => {
  assertEquals(
    checkManifests([
      { path: 'deno.json', imports: { vite: 'npm:vite@8.0.16' } },
      {
        path: 'packages/router/deno.json',
        imports: { vite: 'npm:vite@8.0.16' },
        peerDependencies: { vite: 'npm:vite@^8.0.0' },
      },
    ]),
    [],
  );
  assertEquals(checkLockfileVite({ 'npm:vite@8.0.16': '8.0.16_x' }), []);
  assertEquals(
    checkBundlerImports([{ path: 'packages/router/src/vite/plugin.ts', text: "from 'vite'" }]),
    [],
  );
});

Deno.test('vite gate rejects legacy vite majors and transitional paths', () => {
  const violations = checkManifests([
    { path: 'examples/open-element-in-fresh/deno.json', imports: { vite: 'npm:vite@^7.1.4' } },
    { path: 'x/deno.json', imports: { 'rolldown-vite': 'npm:rolldown-vite@1.0.0' } },
    { path: 'y/deno.json', imports: { plugin: 'npm:@openelement/adapter-vite@1.0.0' } },
    { path: 'z/deno.json', imports: { terser: 'npm:@rollup/plugin-terser@1.0.0' } },
    { path: 'p/deno.json', peerDependencies: { vite: 'npm:vite@8.0.16' } },
  ]);
  assertEquals(violations.length, 5);
});

Deno.test('vite gate rejects split lockfile instances and second bundlers', () => {
  assertEquals(checkLockfileVite({ 'npm:vite@8.0.16': 'a', 'npm:vite@8.0.17': 'b' }).length, 1);
  assertEquals(
    checkBundlerImports([{ path: 'tools/lib/x.ts', text: "import { build } from 'npm:esbuild';" }])
      .length,
    1,
  );
});

Deno.test('vite gate holds the starter template to the ${v.vite} token and anchors its embedded pin', () => {
  const tmpl = 'packages/create/templates/deno.json.tmpl';
  // The token form passes; a literal pin in the template fails even when it
  // matches the canonical dev pin (the template must not carry a copy).
  assertEquals(checkManifests([{ path: tmpl, imports: { vite: 'npm:vite@${v.vite}' } }]), []);
  assertEquals(
    checkManifests([{ path: tmpl, imports: { vite: `npm:vite@${VITE_DEV_PIN}` } }]).length,
    1,
  );
  // Task commands sit outside the manifest slots, so the raw-text rule
  // covers them.
  assertEquals(checkTemplateViteText(tmpl, '"dev": "deno run npm:vite@${v.vite}"'), []);
  assertEquals(checkTemplateViteText(tmpl, '"dev": "deno run npm:vite@8.0.16"').length, 1);
  assertEquals(checkTemplateViteText('packages/router/deno.json', 'npm:vite@8.0.16'), []);
  // The embedded copy the packed CLI stamps into generated starters is
  // anchored to the canonical pin.
  assertEquals(checkStarterVitePin(`export const VITE_STARTER_PIN = '${VITE_DEV_PIN}';\n`), []);
  assertEquals(checkStarterVitePin("export const VITE_STARTER_PIN = '7.0.0';\n").length, 1);
  assertEquals(checkStarterVitePin("export const CREATE_VERSION = 'x';\n").length, 1);
});
