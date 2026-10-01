import { assert, assertEquals, assertStringIncludes, assertThrows } from '@std/assert';
import { join } from '@std/path';
import {
  assembleVpPackageTree,
  prepareVpStagingFiles,
  publishGlobToRegExp,
  rootStagingPackageJsonFor,
  ROUTER_CLIENT_RUNTIME_ENTRIES,
  stagingPackageJsonFor,
  synthesizedPackedManifest,
  VITE_ALIAS_SPEC,
  VP_TOOLCHAIN,
  vpPackConfigFile,
  vpPackEntries,
} from './vp-pack.ts';
import type { PackageInfo } from './package-graph.ts';

function pkg(name: string, exports: Record<string, string>, dir = `packages/foo`): PackageInfo {
  return {
    name,
    version: '1.0.0-test',
    dir,
    deps: [],
    exports,
    importKeys: new Set(),
    importValues: {},
  };
}

const ELEMENT_EXPORTS: Record<string, string> = {
  '.': './src/index.ts',
  './vite': './src/vite.ts',
};

Deno.test('vpPackEntries derives ordered entries from exports', () => {
  assertEquals(vpPackEntries(pkg('@openelement/element', ELEMENT_EXPORTS)), [
    'src/index.ts',
    'src/vite.ts',
  ]);
});

Deno.test('vpPackEntries appends the router client-runtime entries exactly once each', () => {
  const routerExports: Record<string, string> = {
    '.': './src/index.ts',
    './vite': './src/vite/index.ts',
  };
  const entries = vpPackEntries(
    pkg('@openelement/router', routerExports, 'packages/router'),
  );
  assertEquals(entries.slice(0, 2), ['src/index.ts', 'src/vite/index.ts']);
  assertEquals(entries.slice(2), [...ROUTER_CLIENT_RUNTIME_ENTRIES]);
  assertEquals(new Set(entries).size, entries.length);
});

Deno.test('vpPackEntries rejects non-src targets and missing root entry', () => {
  assertThrows(
    () => vpPackEntries(pkg('@openelement/element', { '.': './lib/index.ts' })),
    Error,
    'not a src/*.ts module',
  );
  assertThrows(
    () => vpPackEntries(pkg('@openelement/element', { './html': './src/html.ts' })),
    Error,
    'must define the "." entry',
  );
});

Deno.test('vpPackConfigFile pins the verified recipe', () => {
  const file = vpPackConfigFile(['src/index.ts']);
  assertStringIncludes(file, 'dts: true');
  assertStringIncludes(file, 'treeshake: false');
  assertStringIncludes(file, 'unbundle: true');
  assertStringIncludes(file, 'fixedExtension: false');
  assertStringIncludes(file, 'neverBundle');
  assertStringIncludes(file, '"src/index.ts"');
});

Deno.test('synthesizedPackedManifest preserves the published exports shape', () => {
  const manifest = synthesizedPackedManifest(
    pkg('@openelement/element', {
      '.': './src/index.ts',
      './open-props-tokens.js': './src/open-props-tokens.ts',
    }),
  ) as {
    name: string;
    version: string;
    type: string;
    main: string;
    types: string;
    exports: Record<string, Record<string, string>>;
  };
  assertEquals(manifest.name, '@openelement/element');
  assertEquals(manifest.version, '1.0.0-test');
  assertEquals(manifest.type, 'module');
  assertEquals(manifest.main, './src/index.js');
  assertEquals(manifest.types, './src/index.d.ts');
  assertEquals(manifest.exports['.'], {
    types: './src/index.d.ts',
    import: './src/index.js',
    default: './src/index.js',
  });
  assertEquals(manifest.exports['./open-props-tokens.js'], {
    types: './src/open-props-tokens.d.ts',
    import: './src/open-props-tokens.js',
    default: './src/open-props-tokens.js',
  });
});

Deno.test('stagingPackageJsonFor declares self-name, unwraps npm: peers, pins the toolchain', () => {
  const staged = stagingPackageJsonFor(
    pkg('@openelement/element', ELEMENT_EXPORTS),
    { 'typescript': '6.0.3', '@preact/signals-core': '^1.12.1' },
    {
      peerDependencies: { vite: 'npm:vite@^8.0.0' },
      peerDependenciesMeta: { vite: { optional: true } },
    },
  ) as {
    dependencies: Record<string, string>;
    peerDependencies: Record<string, string>;
    peerDependenciesMeta: Record<string, unknown>;
    devDependencies: Record<string, string>;
  };
  assertEquals(staged.dependencies['@openelement/element'], '1.0.0-test');
  assertEquals(staged.dependencies['typescript'], '6.0.3');
  assertEquals(staged.peerDependencies, { vite: '^8.0.0' });
  assertEquals(staged.peerDependenciesMeta, { vite: { optional: true } });
  assertEquals(staged.devDependencies, {
    vite: VITE_ALIAS_SPEC,
    'vite-plus': VP_TOOLCHAIN.vitePlus,
  });
});

Deno.test('rootStagingPackageJsonFor unions member dependencies', () => {
  const members = [
    pkg('@openelement/element', ELEMENT_EXPORTS),
    pkg('@openelement/router', { '.': './src/index.ts' }, 'packages/router'),
  ];
  const dependencyMap = new Map<string, Record<string, string>>([
    ['@openelement/element', { 'typescript': '6.0.3' }],
    ['@openelement/router', { 'hono': '^4.12', 'typescript': '6.0.3' }],
  ]);
  const root = rootStagingPackageJsonFor(members, dependencyMap) as {
    private: boolean;
    dependencies: Record<string, string>;
    devDependencies: Record<string, string>;
  };
  assert(root.private);
  assertEquals(root.dependencies, { typescript: '6.0.3', hono: '^4.12' });
  assertEquals(root.devDependencies.vite, VITE_ALIAS_SPEC);
});

Deno.test('publishGlobToRegExp matches the publish dialect used by the manifests', () => {
  const srcAll = publishGlobToRegExp('src/**');
  assert(srcAll.test('src/index.ts'));
  assert(srcAll.test('src/internal/protocol/errors.ts'));
  assert(!srcAll.test('srcx/index.ts'));

  const nestedTests = publishGlobToRegExp('src/**/__tests__/**');
  assert(nestedTests.test('src/internal/__tests__/a.ts'));
  assert(nestedTests.test('src/__tests__/a.ts'));

  const bare = publishGlobToRegExp('templates');
  assert(bare.test('templates'));
  assert(bare.test('templates/app/x.ts.tmpl'));
  assert(!bare.test('src/templates.ts'));

  const singleSegment = publishGlobToRegExp('src/*.ts');
  assert(singleSegment.test('src/index.ts'));
  assert(!singleSegment.test('src/internal/index.ts'));
});

Deno.test('assembleVpPackageTree maps dist to src, copies scoped payload, fails on unreachable modules', async () => {
  const root = await Deno.makeTempDir({ prefix: 'vp-pack-assemble-' });
  try {
    const staged = join(root, 'staged');
    const dist = join(staged, 'dist');
    const out = join(root, 'package');
    Deno.mkdirSync(join(dist, 'internal'), { recursive: true });
    Deno.writeTextFileSync(join(dist, 'index.js'), 'export {};\n');
    Deno.writeTextFileSync(join(dist, 'index.d.ts'), 'export declare const x: number;\n');
    Deno.writeTextFileSync(join(dist, 'internal', 'helper.js'), 'export {};\n');
    Deno.mkdirSync(join(staged, 'src'), { recursive: true });
    Deno.mkdirSync(join(staged, 'src', 'internal'), { recursive: true });
    Deno.writeTextFileSync(join(staged, 'src', 'index.ts'), 'export const x = 1;\n');
    Deno.writeTextFileSync(join(staged, 'src', 'internal', 'helper.ts'), 'export const y = 2;\n');
    Deno.mkdirSync(join(staged, 'src', 'unreachable'), { recursive: true });
    Deno.writeTextFileSync(
      join(staged, 'src', 'unreachable', 'orphan.ts'),
      'export const z = 3;\n',
    );
    Deno.writeTextFileSync(join(staged, 'README.md'), 'readme\n');
    Deno.writeTextFileSync(join(staged, 'src', 'tokens.css'), ':root {}\n');
    Deno.writeTextFileSync(join(staged, 'deno.json'), '{"name":"x"}\n');
    Deno.writeTextFileSync(join(staged, 'vite.config.ts'), 'export default {};\n');

    assembleVpPackageTree({
      pkg: pkg('@openelement/demo', ELEMENT_EXPORTS),
      stagedPackDir: staged,
      distDir: dist,
      outDir: out,
      manifest: synthesizedPackedManifest(pkg('@openelement/demo', ELEMENT_EXPORTS)),
      notIgnored: new Set([
        'src/index.ts',
        'src/internal/helper.ts',
        'src/tokens.css',
        'README.md',
        'deno.json',
      ]),
      publishInclude: ['src/**', 'README.md'],
      publishExclude: [],
    });

    assertEquals(
      new Set(
        [...Deno.readDirSync(out)].map((entry) => entry.name).sort(),
      ),
      new Set(['package.json', 'src', 'README.md']),
    );
    assert(Deno.statSync(join(out, 'src', 'index.js')).isFile);
    assert(Deno.statSync(join(out, 'src', 'index.d.ts')).isFile);
    assert(Deno.statSync(join(out, 'src', 'internal', 'helper.js')).isFile);
    assert(Deno.statSync(join(out, 'src', 'tokens.css')).isFile);
    // deno.json and the synthesized vite.config.ts never ship.
    let leaked = false;
    try {
      Deno.statSync(join(out, 'deno.json'));
      leaked = true;
    } catch { /* expected absent */ }
    assertEquals(leaked, false);
    leaked = false;
    try {
      Deno.statSync(join(out, 'vite.config.ts'));
      leaked = true;
    } catch { /* expected absent */ }
    assertEquals(leaked, false);

    // An orphan source module (no dist emission at all) fails closed.
    const failRoot = await Deno.makeTempDir({ prefix: 'vp-pack-assemble-fail-' });
    try {
      const failDist = join(failRoot, 'staged', 'dist');
      Deno.mkdirSync(failDist, { recursive: true });
      Deno.writeTextFileSync(join(failDist, 'index.js'), 'export {};\n');
      const failStaged = join(failRoot, 'staged');
      Deno.mkdirSync(join(failStaged, 'src', 'unreachable'), { recursive: true });
      Deno.writeTextFileSync(
        join(failStaged, 'src', 'unreachable', 'orphan.ts'),
        'export const z = 3;\n',
      );
      assertThrows(
        () =>
          assembleVpPackageTree({
            pkg: pkg('@openelement/demo', ELEMENT_EXPORTS),
            stagedPackDir: failStaged,
            distDir: failDist,
            outDir: join(failRoot, 'out'),
            manifest: {},
            notIgnored: new Set(['src/unreachable/orphan.ts']),
            publishInclude: ['src/**'],
            publishExclude: [],
          }),
        Error,
        'cannot reach it',
      );
    } finally {
      await Deno.remove(failRoot, { recursive: true });
    }
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test('prepareVpStagingFiles stages manifests, config and optional tsconfig without network', async () => {
  const root = await Deno.makeTempDir({ prefix: 'vp-pack-prepare-' });
  try {
    const pkgDir = join(root, 'element');
    const depDir = join(root, 'router');
    Deno.mkdirSync(pkgDir, { recursive: true });
    Deno.mkdirSync(depDir, { recursive: true });
    const element = pkg('@openelement/element', ELEMENT_EXPORTS, pkgDir);
    const router = pkg('@openelement/router', { '.': './src/index.ts' }, depDir);
    Deno.mkdirSync(join(pkgDir, 'src'), { recursive: true });
    Deno.writeTextFileSync(join(pkgDir, 'src', 'index.ts'), 'export {};\n');

    const staged = await prepareVpStagingFiles({
      pkg: router,
      members: [element, router],
      dependencyMap: new Map<string, Record<string, string>>([
        ['@openelement/element', { 'typescript': '6.0.3' }],
        ['@openelement/router', {}],
      ]),
      sourceManifest: { compilerOptions: { jsx: 'react-jsx' } },
    });
    try {
      assertEquals(staged.packDir, join(staged.stagingRoot, 'router'));
      // Root manifest unions member deps and pins the toolchain.
      const rootManifest = JSON.parse(
        Deno.readTextFileSync(join(staged.stagingRoot, 'package.json')),
      ) as { dependencies: Record<string, string>; devDependencies: Record<string, string> };
      assertEquals(rootManifest.dependencies, { typescript: '6.0.3' });
      assertEquals(rootManifest.devDependencies['vite-plus'], '1.0.0');
      // Each member carries a staging manifest with its self-name.
      const memberManifest = JSON.parse(
        Deno.readTextFileSync(join(staged.stagingRoot, 'element', 'package.json')),
      ) as { dependencies: Record<string, string> };
      assertEquals(memberManifest.dependencies['@openelement/element'], '1.0.0-test');
      // Pack config lands in the pack dir; tsconfig only with compilerOptions.
      assert(Deno.statSync(join(staged.packDir, 'vite.config.ts')).isFile);
      const tsconfig = JSON.parse(
        Deno.readTextFileSync(join(staged.packDir, 'tsconfig.json')),
      ) as { compilerOptions: Record<string, string> };
      assertEquals(tsconfig.compilerOptions.jsx, 'react-jsx');
      // The member copy must not drag deno.json/package.json along.
      assertEquals(
        Deno.readTextFileSync(join(staged.stagingRoot, 'element', 'src', 'index.ts')),
        'export {};\n',
      );
      let leaked = false;
      try {
        Deno.statSync(join(staged.stagingRoot, 'element', 'deno.json'));
        leaked = true;
      } catch { /* expected absent */ }
      assertEquals(leaked, false);
    } finally {
      await staged.cleanup();
    }
    // Cleanup removes the whole staging root.
    let gone = false;
    try {
      Deno.statSync(staged.stagingRoot);
    } catch {
      gone = true;
    }
    assert(gone, 'cleanup must remove the staging root');
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});
