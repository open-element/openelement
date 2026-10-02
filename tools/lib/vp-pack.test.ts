import { assert, assertEquals, assertStringIncludes, assertThrows } from '@std/assert';
import { dirname, fromFileUrl, isAbsolute, join, relative, resolve } from '@std/path';
import ts from 'typescript';
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
  const entries = vpPackEntries(pkg('@openelement/router', routerExports, 'packages/router'));
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
    { typescript: '6.0.3', '@preact/signals-core': '^1.12.1' },
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
    ['@openelement/element', { typescript: '6.0.3' }],
    ['@openelement/router', { hono: '^4.12', typescript: '6.0.3' }],
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
      new Set([...Deno.readDirSync(out)].map((entry) => entry.name).sort()),
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
    } catch {
      /* expected absent */
    }
    assertEquals(leaked, false);
    leaked = false;
    try {
      Deno.statSync(join(out, 'vite.config.ts'));
      leaked = true;
    } catch {
      /* expected absent */
    }
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
        ['@openelement/element', { typescript: '6.0.3' }],
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
      const tsconfig = JSON.parse(Deno.readTextFileSync(join(staged.packDir, 'tsconfig.json'))) as {
        compilerOptions: Record<string, string>;
      };
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
      } catch {
        /* expected absent */
      }
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

// ─── ROUTER_CLIENT_RUNTIME_ENTRIES drift guard (P6: single source, no parallel
// mechanism) ────────────────────────────────────────────────────────────────

const ROUTER_PACKAGE_DIR = fromFileUrl(new URL('../../packages/router', import.meta.url));

/** The file exists and is not a directory. */
function isFile(path: string): boolean {
  try {
    return Deno.statSync(path).isFile;
  } catch {
    return false;
  }
}

/** True when `candidate` sits inside `dir` (no `..` escape). */
function isWithin(candidate: string, dir: string): boolean {
  const from = relative(resolve(dir), resolve(candidate));
  return from === '' || (!from.startsWith('..') && !isAbsolute(from));
}

/**
 * The relative specifiers of one module's VALUE imports. `import type` and
 * inline `type` specifiers are erased at transpile and never execute the
 * module; every other import/export-from shape (and dynamic `import()`) does,
 * so the consumer bundler pulls those modules from the packed payload.
 */
function relativeValueImportSpecifiers(source: string): string[] {
  const sourceFile = ts.createSourceFile('module.ts', source, ts.ScriptTarget.Latest, true);
  const specifiers: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const clause = node.importClause;
      const named = clause?.namedBindings;
      const typeOnly =
        (clause?.isTypeOnly ?? false) ||
        (named !== undefined &&
          ts.isNamedImports(named) &&
          named.elements.length > 0 &&
          named.elements.every((element) => element.isTypeOnly));
      // A side-effect import (no clause at all) executes the module.
      if (!typeOnly) specifiers.push(node.moduleSpecifier.text);
    } else if (
      ts.isExportDeclaration(node) &&
      node.moduleSpecifier !== undefined &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      const reexports = node.exportClause;
      const typeOnly =
        node.isTypeOnly ||
        (reexports !== undefined &&
          ts.isNamedExports(reexports) &&
          reexports.elements.length > 0 &&
          reexports.elements.every((element) => element.isTypeOnly));
      // `export * from './x'` (no clause) re-exports values.
      if (!typeOnly) specifiers.push(node.moduleSpecifier.text);
    } else if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments.length === 1 &&
      ts.isStringLiteral(node.arguments[0])
    ) {
      specifiers.push((node.arguments[0] as ts.StringLiteral).text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return specifiers.filter((specifier) => specifier.startsWith('.'));
}

/** Resolve one relative specifier the way the source tree spells it (.ts/.tsx, index fallbacks). */
function resolveRelativeSpecifier(
  fromFile: string,
  specifier: string,
  packageDir: string,
): string | null {
  const clean = specifier.split(/[?#]/, 1)[0];
  const base = resolve(dirname(fromFile), clean);
  if (!isWithin(base, packageDir)) return null;
  const candidates = /\.(?:ts|tsx)$/.test(base)
    ? [base]
    : [`${base}.ts`, `${base}.tsx`, join(base, 'index.ts'), join(base, 'index.tsx')];
  return candidates.find((candidate) => isFile(candidate)) ?? null;
}

interface RuntimeExtraction {
  /** Package-relative module paths (src/...) the consumer build consumes by path. */
  modules: Set<string>;
  /** Fail-closed extraction problems (non-literal arguments, unresolved roots). */
  problems: string[];
}

/**
 * Extract the consumer-side path-consumed runtime set from the router's OWN
 * sources — never from vp-pack.ts, so the guard cannot self-certify. The
 * roots are the `runtimeModulePath('...')` literal resolutions in
 * cli/build-client.ts (#868: the virtual runtime specifiers resolve to real
 * modules the bundler inlines from the packed payload); the rest of the set
 * is the transitive closure of their static value imports (type-only imports
 * add nothing). This mirrors the vp-pack.ts header's definition of the entry
 * list: the two roots resolved directly, the siblings riding along as value
 * imports (G0.5 §2).
 */
function consumerPathConsumedModules(packageDir: string): RuntimeExtraction {
  const problems: string[] = [];
  const entry = join(packageDir, 'src', 'cli', 'build-client.ts');
  const source = Deno.readTextFileSync(entry);
  const literalArgs = [...source.matchAll(/runtimeModulePath\(\s*(['"])(.*?)\1\s*\)/g)].map(
    (match) => match[2],
  );
  const callSites =
    (source.match(/runtimeModulePath\(/g) ?? []).length -
    (source.match(/function runtimeModulePath\(/g) ?? []).length;
  if (literalArgs.length !== callSites) {
    problems.push(
      `build-client.ts has ${callSites} runtimeModulePath call site(s) but only ` +
        `${literalArgs.length} literal string argument(s); the extraction only sees ` +
        'string literals — pass the module path as a literal or extend this guard ' +
        'deliberately',
    );
  }
  const modules = new Set<string>();
  const queue: string[] = [];
  for (const argument of literalArgs) {
    const resolved = resolve(dirname(entry), argument.split(/[?#]/, 1)[0]);
    if (!isWithin(resolved, packageDir) || !isFile(resolved)) {
      problems.push(`runtimeModulePath('${argument}') does not resolve to a file in the package`);
      continue;
    }
    const modulePath = relative(packageDir, resolved);
    if (!modules.has(modulePath)) {
      modules.add(modulePath);
      queue.push(resolved);
    }
  }
  while (queue.length > 0) {
    const file = queue.shift()!;
    for (const specifier of relativeValueImportSpecifiers(Deno.readTextFileSync(file))) {
      const imported = resolveRelativeSpecifier(file, specifier, packageDir);
      if (imported === null) continue;
      const modulePath = relative(packageDir, imported);
      if (!modules.has(modulePath)) {
        modules.add(modulePath);
        queue.push(imported);
      }
    }
  }
  return { modules, problems };
}

Deno.test('ROUTER_CLIENT_RUNTIME_ENTRIES covers every consumer path-resolved runtime module', () => {
  const { modules, problems } = consumerPathConsumedModules(ROUTER_PACKAGE_DIR);
  assertEquals(problems, []);
  const entries: string[] = [...ROUTER_CLIENT_RUNTIME_ENTRIES];
  const missing = [...modules].filter((module) => !entries.includes(module)).sort();
  const stale = entries.filter((entry) => !modules.has(entry)).sort();
  assertEquals(
    missing,
    [],
    'path-consumed runtime modules missing from ROUTER_CLIENT_RUNTIME_ENTRIES — the ' +
      'pack would not guarantee their emitted .js, so add them to the entries list',
  );
  assertEquals(
    stale,
    [],
    'ROUTER_CLIENT_RUNTIME_ENTRIES entries no longer consumed by path from ' +
      'cli/build-client.ts — remove them from the entries list',
  );
  assertEquals([...modules].sort(), entries.sort());
});

Deno.test('runtime extraction captures a ninth value-consumed module and skips type-only edges', async () => {
  const root = await Deno.makeTempDir({ prefix: 'vp-pack-drift-capture-' });
  try {
    const cli = join(root, 'src', 'cli');
    const ssg = join(root, 'src', 'vite', 'internal', 'ssg');
    Deno.mkdirSync(cli, { recursive: true });
    Deno.mkdirSync(ssg, { recursive: true });
    Deno.writeTextFileSync(
      join(cli, 'build-client.ts'),
      [
        "export const first = runtimeModulePath('../vite/internal/ssg/root-a.ts');",
        "export const second = runtimeModulePath('../vite/internal/ssg/root-b.ts');",
      ].join('\n'),
    );
    Deno.writeTextFileSync(join(ssg, 'root-a.ts'), 'export const rootA = 1;\n');
    Deno.writeTextFileSync(
      join(ssg, 'root-b.ts'),
      [
        "import { createNinth } from './ninth.ts';",
        "import type { TypedShape } from './typed.ts';",
        'export const rootB = createNinth() as unknown as TypedShape;\n',
      ].join('\n'),
    );
    Deno.writeTextFileSync(
      join(ssg, 'ninth.ts'),
      [
        "import type { TypedShape } from './typed.ts';",
        'export const createNinth = () => 9;\n',
      ].join('\n'),
    );
    Deno.writeTextFileSync(join(ssg, 'typed.ts'), 'export interface TypedShape { n: number };\n');

    const { modules, problems } = consumerPathConsumedModules(root);
    assertEquals(problems, []);
    // The value-imported ninth module IS path-consumed; the type-only edge is not.
    assertEquals([...modules].sort(), [
      'src/vite/internal/ssg/ninth.ts',
      'src/vite/internal/ssg/root-a.ts',
      'src/vite/internal/ssg/root-b.ts',
    ]);
    assert(!modules.has('src/vite/internal/ssg/typed.ts'));
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test('runtime extraction fails closed on a non-literal runtimeModulePath argument', async () => {
  const root = await Deno.makeTempDir({ prefix: 'vp-pack-drift-failclosed-' });
  try {
    const cli = join(root, 'src', 'cli');
    Deno.mkdirSync(cli, { recursive: true });
    Deno.writeTextFileSync(
      join(cli, 'build-client.ts'),
      'export const mapped = runtimeModulePath(dynamicArgument);\n',
    );
    const { modules, problems } = consumerPathConsumedModules(root);
    assertEquals(modules.size, 0);
    assertEquals(problems.length, 1);
    assertStringIncludes(problems[0], 'literal string argument');
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});
