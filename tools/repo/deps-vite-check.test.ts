import { expect, test } from 'vitest';
import {
  checkBundlerImports,
  checkLockfileVite,
  checkManifests,
  VITE_DEV_PIN,
} from './deps-vite-check.ts';

test('vite gate accepts the unified Vite 8 baseline', () => {
  expect(
    checkManifests([
      { path: 'package.json', imports: { vite: 'npm:vite@8.0.16' } },
      {
        path: 'packages/router/package.json',
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
    { path: 'tests/fixtures/legacy-example/package.json', imports: { vite: 'npm:vite@^7.1.4' } },
    {
      path: 'packages/legacy-x/package.json',
      imports: { 'rolldown-vite': 'npm:rolldown-vite@1.0.0' },
    },
    {
      path: 'packages/legacy-y/package.json',
      imports: { plugin: 'npm:@openelement/adapter-vite@1.0.0' },
    },
    {
      path: 'packages/legacy-z/package.json',
      imports: { terser: 'npm:@rollup/plugin-terser@1.0.0' },
    },
    { path: 'packages/legacy-p/package.json', peerDependencies: { vite: 'npm:vite@8.0.16' } },
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

test('vite gate accepts the starter template pinned at the router version', () => {
  const tmpl = 'packages/create/templates/package.json.tmpl';
  // The package-manager-neutral scaffold pins vite itself, at exactly the
  // version packages/router/package.json declares in dependencies.vite.
  expect(checkManifests([{ path: tmpl, imports: { vite: `npm:vite@${VITE_DEV_PIN}` } }])).toEqual(
    [],
  );
  // The pin follows the router manifest the caller passes in, not a literal.
  expect(
    checkManifests([{ path: tmpl, imports: { vite: 'npm:vite@8.0.17' } }], {
      routerVitePin: '8.0.17',
    }),
  ).toEqual([]);
});

test('vite gate rejects a starter template that drifts from the router pin', () => {
  const tmpl = 'packages/create/templates/package.json.tmpl';
  // A different exact version and a range both disagree with the router's own
  // resolved vite.
  const drifted = checkManifests([
    { path: tmpl, imports: { vite: 'npm:vite@8.0.17' } },
    { path: tmpl, imports: { vite: 'npm:vite@^8.0.0' } },
  ]);
  expect(drifted.length).toEqual(2);
  for (const violation of drifted) {
    expect(violation.message).toContain(`must pin the router's own vite exactly`);
  }
  // The retired `${v.vite}` scaffold token is not a version at all.
  expect(
    checkManifests([{ path: tmpl, imports: { vite: 'npm:vite@${v.vite}' } }]).map(
      (violation) => violation.message,
    ),
  ).toEqual([`unparseable vite specifier 'npm:vite@\${v.vite}'`]);
  // A template that drops the pin entirely has no catalog to fall back on.
  expect(checkManifests([{ path: tmpl, imports: { 'vite-plus': 'catalog:' } }])).toEqual([
    {
      where: `${tmpl} imports.vite`,
      message:
        `the starter template must declare vite directly at the router's own version ` +
        `('${VITE_DEV_PIN}'); the Vite+ catalog is retired and the generated project ` +
        `has no other source for its vite tree`,
    },
  ]);
});
