import { assertEquals } from '@std/assert';
import { checkBundlerImports, checkLockfileVite, checkManifests } from './deps-vite-check.ts';

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
