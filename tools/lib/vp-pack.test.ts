import { chmodSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { expect, test } from 'vitest';
import { assertRejectsIncludes, assertThrowsIncludes } from '../../tests/lib/vitest-asserts.ts';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import {
  assembleVpPackageTree,
  prepareVpStagingFiles,
  publishGlobToRegExp,
  rootStagingPackageJsonFor,
  ROUTER_BIN_ENTRY,
  ROUTER_CLIENT_RUNTIME_ENTRIES,
  stagingPackageJsonFor,
  synthesizedPackedManifest,
  VITE_ALIAS_SPEC,
  VP_TOOLCHAIN,
  vpPackConfigFile,
  vpPackEntries,
  VP_STAGING_INSTALL_ARGS,
  VP_PACK_TIMEOUT_MS,
  assertVpStagingCli,
  runVpPack,
  vpStagingCliPath,
  type VpStagedWorkspace,
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

test('vpPackEntries derives ordered entries from exports', () => {
  expect(vpPackEntries(pkg('@openelement/element', ELEMENT_EXPORTS))).toEqual([
    'src/index.ts',
    'src/vite.ts',
  ]);
});

test('vpPackEntries appends the router client-runtime entries and the bin dispatcher exactly once each', () => {
  const routerExports: Record<string, string> = {
    '.': './src/index.ts',
    './vite': './src/vite/index.ts',
  };
  const entries = vpPackEntries(pkg('@openelement/router', routerExports, 'packages/router'));
  expect(entries.slice(0, 2)).toEqual(['src/index.ts', 'src/vite/index.ts']);
  // The client-runtime modules first, then the `openelement` bin dispatcher: a
  // bin target is not an exports subpath, so the pack carries it as an
  // explicit entry (tools/release/npm-manifest.ts declares the same path).
  expect(entries.slice(2)).toEqual([...ROUTER_CLIENT_RUNTIME_ENTRIES, ROUTER_BIN_ENTRY]);
  expect(new Set(entries).size).toEqual(entries.length);
});

test('vpPackEntries rejects non-src targets and missing root entry', () => {
  assertThrowsIncludes(
    () => vpPackEntries(pkg('@openelement/element', { '.': './lib/index.ts' })),
    Error,
    'not a src/*.ts module',
  );
  assertThrowsIncludes(
    () => vpPackEntries(pkg('@openelement/element', { './html': './src/html.ts' })),
    Error,
    'must define the "." entry',
  );
});

test('asset export targets ship verbatim: no compile entry, default-only export shape', () => {
  const ui = pkg('@openelement/ui', {
    '.': './src/index.ts',
    './instance-state': './src/instance-state.ts',
    './theme.css': './src/theme.css',
  });
  // The CSS target is not a compile entry — it ships through the staged-tree
  // copy (assembleVpPackageTree), like every publish-scoped non-module file.
  expect(vpPackEntries(ui)).toEqual(['src/index.ts', 'src/instance-state.ts']);
  const manifest = synthesizedPackedManifest(ui) as {
    exports: Record<string, Record<string, string>>;
  };
  // Verbatim asset: no types, no module shapes — one default condition.
  expect(manifest.exports['./theme.css']).toEqual({ default: './src/theme.css' });
  expect(manifest.exports['./instance-state']).toEqual({
    types: './src/instance-state.d.ts',
    import: './src/instance-state.js',
    default: './src/instance-state.js',
  });
  // Assets must live under src/ — anything else fails closed.
  assertThrowsIncludes(
    () =>
      synthesizedPackedManifest(
        pkg('@openelement/ui', { '.': './src/index.ts', './x.css': './assets/x.css' }),
      ),
    Error,
    'must live under src/',
  );
});

test('vpPackConfigFile pins the verified recipe', () => {
  const file = vpPackConfigFile(['src/index.ts']);
  expect(file).toContain('dts: true');
  expect(file).toContain('treeshake: false');
  expect(file).toContain('unbundle: true');
  expect(file).toContain('fixedExtension: false');
  expect(file).toContain('neverBundle');
  expect(file).toContain('"src/index.ts"');
});

test('synthesizedPackedManifest preserves the published exports shape', () => {
  const manifest = synthesizedPackedManifest(
    pkg('@openelement/element', {
      '.': './src/index.ts',
      './tokens.js': './src/tokens.ts',
    }),
  ) as {
    name: string;
    version: string;
    type: string;
    main: string;
    types: string;
    exports: Record<string, Record<string, string>>;
  };
  expect(manifest.name).toEqual('@openelement/element');
  expect(manifest.version).toEqual('1.0.0-test');
  expect(manifest.type).toEqual('module');
  expect(manifest.main).toEqual('./src/index.js');
  expect(manifest.types).toEqual('./src/index.d.ts');
  expect(manifest.exports['.']).toEqual({
    types: './src/index.d.ts',
    import: './src/index.js',
    default: './src/index.js',
  });
  expect(manifest.exports['./tokens.js']).toEqual({
    types: './src/tokens.d.ts',
    import: './src/tokens.js',
    default: './src/tokens.js',
  });
});

test('stagingPackageJsonFor declares self-name and pins the toolchain', () => {
  const staged = stagingPackageJsonFor(pkg('@openelement/element', ELEMENT_EXPORTS), {
    typescript: '6.0.3',
    '@preact/signals-core': '^1.12.1',
  }) as {
    dependencies: Record<string, string>;
    peerDependencies: Record<string, string> | undefined;
    devDependencies: Record<string, string>;
  };
  expect(staged.dependencies['@openelement/element']).toEqual('1.0.0-test');
  expect(staged.dependencies['typescript']).toEqual('6.0.3');
  // Peers are not staged: they never resolve in the shared install, and the
  // published manifest applies them in the coordinator's post-processing.
  expect(staged.peerDependencies).toEqual(undefined);
  expect(staged.devDependencies).toEqual({
    vite: VITE_ALIAS_SPEC,
    'vite-plus': VP_TOOLCHAIN.vitePlus,
  });
});

test('rootStagingPackageJsonFor unions member dependencies', () => {
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
  expect(root.private).toBeTruthy();
  expect(root.dependencies).toEqual({ typescript: '6.0.3', hono: '^4.12' });
  expect(root.devDependencies.vite).toEqual(VITE_ALIAS_SPEC);
});

test('publishGlobToRegExp matches the publish dialect used by the manifests', () => {
  const srcAll = publishGlobToRegExp('src/**');
  expect(srcAll.test('src/index.ts')).toBeTruthy();
  expect(srcAll.test('src/internal/protocol/errors.ts')).toBeTruthy();
  expect(!srcAll.test('srcx/index.ts')).toBeTruthy();

  const nestedTests = publishGlobToRegExp('src/**/__tests__/**');
  expect(nestedTests.test('src/internal/__tests__/a.ts')).toBeTruthy();
  expect(nestedTests.test('src/__tests__/a.ts')).toBeTruthy();

  const bare = publishGlobToRegExp('templates');
  expect(bare.test('templates')).toBeTruthy();
  expect(bare.test('templates/app/x.ts.tmpl')).toBeTruthy();
  expect(!bare.test('src/templates.ts')).toBeTruthy();

  const singleSegment = publishGlobToRegExp('src/*.ts');
  expect(singleSegment.test('src/index.ts')).toBeTruthy();
  expect(!singleSegment.test('src/internal/index.ts')).toBeTruthy();
});

test('assembleVpPackageTree maps dist to src, copies scoped payload, fails on unreachable modules', async () => {
  const root = await mkdtemp(join(tmpdir(), 'vp-pack-assemble-'));
  try {
    const staged = join(root, 'staged');
    const dist = join(staged, 'dist');
    const out = join(root, 'package');
    mkdirSync(join(dist, 'internal'), { recursive: true });
    writeFileSync(join(dist, 'index.js'), 'export {};\n');
    writeFileSync(join(dist, 'index.d.ts'), 'export declare const x: number;\n');
    writeFileSync(join(dist, 'internal', 'helper.js'), 'export {};\n');
    mkdirSync(join(staged, 'src'), { recursive: true });
    mkdirSync(join(staged, 'src', 'internal'), { recursive: true });
    writeFileSync(join(staged, 'src', 'index.ts'), 'export const x = 1;\n');
    writeFileSync(join(staged, 'src', 'internal', 'helper.ts'), 'export const y = 2;\n');
    mkdirSync(join(staged, 'src', 'unreachable'), { recursive: true });
    writeFileSync(join(staged, 'src', 'unreachable', 'orphan.ts'), 'export const z = 3;\n');
    // An ambient declaration (#1558's ./css-modules pattern): payload by
    // design — nothing imports it, so the dist graph carries no stem for it.
    writeFileSync(join(staged, 'src', 'css-modules.d.ts'), 'declare module "*.css";\n');
    writeFileSync(join(staged, 'README.md'), 'readme\n');
    writeFileSync(join(staged, 'src', 'tokens.css'), ':root {}\n');
    writeFileSync(join(staged, 'vite.config.ts'), 'export default {};\n');

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
        'src/css-modules.d.ts',
        'README.md',
      ]),
      publishInclude: ['src/**', 'README.md'],
      publishExclude: [],
    });

    expect(
      new Set(
        readdirSync(out, { withFileTypes: true })
          .map((entry) => entry.name)
          .sort(),
      ),
    ).toEqual(new Set(['package.json', 'src', 'README.md']));
    expect(statSync(join(out, 'src', 'index.js')).isFile()).toBeTruthy();
    expect(statSync(join(out, 'src', 'index.d.ts')).isFile()).toBeTruthy();
    expect(statSync(join(out, 'src', 'internal', 'helper.js')).isFile()).toBeTruthy();
    expect(statSync(join(out, 'src', 'tokens.css')).isFile()).toBeTruthy();
    // The ambient declaration ships verbatim, without a dist stem.
    expect(statSync(join(out, 'src', 'css-modules.d.ts')).isFile()).toBeTruthy();
    // The synthesized vite.config.ts never ships.
    let leaked = false;
    try {
      statSync(join(out, 'vite.config.ts'));
      leaked = true;
    } catch {
      /* expected absent */
    }
    expect(leaked).toEqual(false);

    // An orphan source module (no dist emission at all) fails closed.
    const failRoot = await mkdtemp(join(tmpdir(), 'vp-pack-assemble-fail-'));
    try {
      const failDist = join(failRoot, 'staged', 'dist');
      mkdirSync(failDist, { recursive: true });
      writeFileSync(join(failDist, 'index.js'), 'export {};\n');
      const failStaged = join(failRoot, 'staged');
      mkdirSync(join(failStaged, 'src', 'unreachable'), { recursive: true });
      writeFileSync(join(failStaged, 'src', 'unreachable', 'orphan.ts'), 'export const z = 3;\n');
      assertThrowsIncludes(
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
      await rm(failRoot, { recursive: true });
    }
  } finally {
    await rm(root, { recursive: true });
  }
});

test('prepareVpStagingFiles stages manifests and config without network', async () => {
  const root = await mkdtemp(join(tmpdir(), 'vp-pack-prepare-'));
  try {
    const pkgDir = join(root, 'element');
    const depDir = join(root, 'router');
    mkdirSync(pkgDir, { recursive: true });
    mkdirSync(depDir, { recursive: true });
    const element = pkg('@openelement/element', ELEMENT_EXPORTS, pkgDir);
    const router = pkg('@openelement/router', { '.': './src/index.ts' }, depDir);
    mkdirSync(join(pkgDir, 'src'), { recursive: true });
    writeFileSync(join(pkgDir, 'src', 'index.ts'), 'export {};\n');

    const staged = await prepareVpStagingFiles({
      pkg: router,
      members: [element, router],
      dependencyMap: new Map<string, Record<string, string>>([
        ['@openelement/element', { typescript: '6.0.3' }],
        ['@openelement/router', {}],
      ]),
    });
    try {
      expect(staged.packDir).toEqual(join(staged.stagingRoot, 'router'));
      // Root manifest unions member deps and pins the toolchain.
      const rootManifest = JSON.parse(
        readFileSync(join(staged.stagingRoot, 'package.json'), 'utf8'),
      ) as {
        dependencies: Record<string, string>;
        devDependencies: Record<string, string>;
      };
      expect(rootManifest.dependencies).toEqual({ typescript: '6.0.3' });
      expect(rootManifest.devDependencies['vite-plus']).toEqual('1.0.0');
      // Each member carries a staging manifest with its self-name.
      const memberManifest = JSON.parse(
        readFileSync(join(staged.stagingRoot, 'element', 'package.json'), 'utf8'),
      ) as { dependencies: Record<string, string> };
      expect(memberManifest.dependencies['@openelement/element']).toEqual('1.0.0-test');
      // Pack config lands in the pack dir.
      expect(statSync(join(staged.packDir, 'vite.config.ts')).isFile()).toBeTruthy();
      // The member copy must not drag package.json along.
      expect(readFileSync(join(staged.stagingRoot, 'element', 'src', 'index.ts'), 'utf8')).toEqual(
        'export {};\n',
      );
    } finally {
      await staged.cleanup();
    }
    // Cleanup removes the whole staging root.
    let gone = false;
    try {
      statSync(staged.stagingRoot);
    } catch {
      gone = true;
    }
    expect(gone, 'cleanup must remove the staging root').toBeTruthy();
  } finally {
    await rm(root, { recursive: true });
  }
});

// ─── ROUTER_CLIENT_RUNTIME_ENTRIES drift guard (single source, no parallel
// mechanism) ────────────────────────────────────────────────────────────────

const ROUTER_PACKAGE_DIR = fileURLToPath(new URL('../../packages/router', import.meta.url));

/** The file exists and is not a directory. */
function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
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
 * Every router source that resolves a runtime module BY PATH for a consumer
 * build. One seed is not enough: the element-services wrappers are selected in
 * entry-client-codegen.ts (the generated entry reaches them through an import
 * STRING, so the pack module graph has no edge to follow), while the
 * scheduler/enhance specifiers are mapped in the two build hosts. A file added
 * here contributes its literal resolutions to the union the entries list must
 * cover.
 */
const RUNTIME_CONSUMPTION_SEEDS = [
  'src/cli/build-client.ts',
  'src/vite/dev-island-client.ts',
  'src/vite/internal/ssg/entry-client-codegen.ts',
] as const;

/**
 * Extract the consumer-side path-consumed runtime set from the router's OWN
 * sources — never from vp-pack.ts, so the guard cannot self-certify. The
 * roots are the `runtimeModulePath('...')` literal resolutions in
 * {@linkcode RUNTIME_CONSUMPTION_SEEDS} (#868: the virtual runtime specifiers
 * resolve to real modules the bundler inlines from the packed payload; B2
 * added the element-services wrappers, selected by the generated entry's own
 * codegen); the rest of the set is the transitive closure of their static
 * value imports (type-only imports add nothing). This mirrors the vp-pack.ts
 * header's definition of the entry list: the roots resolved directly, the
 * siblings riding along as value imports (G0.5 §2).
 *
 * Literal arguments resolve the way the shared helper resolves them:
 * relative to runtime-module-path.ts's own directory (src/vite/internal/),
 * not relative to the call site — every seed passes './ssg/...' for that
 * reason.
 */
function consumerPathConsumedModules(packageDir: string): RuntimeExtraction {
  const problems: string[] = [];
  const runtimeModulePathModule = join(
    packageDir,
    'src',
    'vite',
    'internal',
    'runtime-module-path.ts',
  );
  if (!isFile(runtimeModulePathModule)) {
    return {
      modules: new Set(),
      problems: [
        `runtime-module-path.ts not found at src/vite/internal/ — the literal ` +
          'resolution base moved; update this guard to the helper\u2019s new directory',
      ],
    };
  }
  const modules = new Set<string>();
  const queue: string[] = [];
  for (const seed of RUNTIME_CONSUMPTION_SEEDS) {
    const seedPath = join(packageDir, seed);
    if (!isFile(seedPath)) {
      problems.push(
        `${seed} not found — a runtime-consumption seed moved or was renamed; ` +
          'update RUNTIME_CONSUMPTION_SEEDS deliberately',
      );
      continue;
    }
    const source = readFileSync(seedPath, 'utf8');
    const literalArgs = [...source.matchAll(/runtimeModulePath\(\s*(['"])(.*?)\1\s*\)/g)].map(
      (match) => match[2],
    );
    const callSites =
      (source.match(/runtimeModulePath\(/g) ?? []).length -
      (source.match(/function runtimeModulePath\(/g) ?? []).length;
    if (literalArgs.length !== callSites) {
      problems.push(
        `${seed} has ${callSites} runtimeModulePath call site(s) but only ` +
          `${literalArgs.length} literal string argument(s); the extraction only sees ` +
          'string literals — pass the module path as a literal or extend this guard ' +
          'deliberately',
      );
    }
    for (const argument of literalArgs) {
      const resolved = resolve(dirname(runtimeModulePathModule), argument.split(/[?#]/, 1)[0]);
      if (!isWithin(resolved, packageDir) || !isFile(resolved)) {
        problems.push(
          `runtimeModulePath('${argument}') in ${seed} does not resolve to a file in the package`,
        );
        continue;
      }
      const modulePath = relative(packageDir, resolved);
      if (!modules.has(modulePath)) {
        modules.add(modulePath);
        queue.push(resolved);
      }
    }
  }
  while (queue.length > 0) {
    const file = queue.shift()!;
    for (const specifier of relativeValueImportSpecifiers(readFileSync(file, 'utf8'))) {
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

/**
 * The guard's verdict over one extraction: entries no seed consumes (stale)
 * and seed-consumed modules the entries list does not cover (missing).
 * Extracted so the negative test below can prove the stale direction fails
 * closed on a genuinely unconsumed entry.
 */
function packEntryDrift(
  modules: ReadonlySet<string>,
  entries: readonly string[],
): { missing: string[]; stale: string[] } {
  return {
    missing: [...modules].filter((module) => !entries.includes(module)).sort(),
    stale: entries.filter((entry) => !modules.has(entry)).sort(),
  };
}

test('ROUTER_CLIENT_RUNTIME_ENTRIES covers every consumer path-resolved runtime module', () => {
  const { modules, problems } = consumerPathConsumedModules(ROUTER_PACKAGE_DIR);
  expect(problems).toEqual([]);
  const entries: string[] = [...ROUTER_CLIENT_RUNTIME_ENTRIES];
  const { missing, stale } = packEntryDrift(modules, entries);
  expect(
    missing,
    'path-consumed runtime modules missing from ROUTER_CLIENT_RUNTIME_ENTRIES — the ' +
      'pack would not guarantee their emitted .js, so add them to the entries list',
  ).toEqual([]);
  expect(
    stale,
    'ROUTER_CLIENT_RUNTIME_ENTRIES entries no longer consumed by path from ' +
      `${RUNTIME_CONSUMPTION_SEEDS.join(', ')} — remove them from the entries list`,
  ).toEqual([]);
  expect([...modules].sort()).toEqual(entries.sort());
});

test('the guard fails an entry no seed file consumes (negative)', async () => {
  // The stale direction, on a synthetic package: every seed contributes one
  // root, and an entry named by none of them must surface as stale. Without
  // the RUNTIME_CONSUMPTION_SEEDS union the codegen seed's wrapper would also
  // show up as missing, which is the second half of the same assertion.
  const root = await mkdtemp(join(tmpdir(), 'vp-pack-stale-entry-'));
  try {
    const cli = join(root, 'src', 'cli');
    const vite = join(root, 'src', 'vite');
    const internal = join(vite, 'internal');
    const ssg = join(internal, 'ssg');
    mkdirSync(cli, { recursive: true });
    mkdirSync(ssg, { recursive: true });
    writeFileSync(
      join(internal, 'runtime-module-path.ts'),
      'export const runtimeModulePath = (p: string): string => p;\n',
    );
    writeFileSync(
      join(cli, 'build-client.ts'),
      "export const scheduler = runtimeModulePath('./ssg/island-scheduler.ts');\n",
    );
    writeFileSync(
      join(vite, 'dev-island-client.ts'),
      '// no path-resolved roots in this fixture\n',
    );
    writeFileSync(
      join(ssg, 'entry-client-codegen.ts'),
      "export const surface = runtimeModulePath('./ssg/element-services-full.ts');\n",
    );
    writeFileSync(join(ssg, 'island-scheduler.ts'), 'export const schedule = 1;\n');
    writeFileSync(join(ssg, 'element-services-full.ts'), 'export const surface = 1;\n');

    const { modules, problems } = consumerPathConsumedModules(root);
    expect(problems).toEqual([]);
    const drift = packEntryDrift(modules, [
      'src/vite/internal/ssg/island-scheduler.ts',
      'src/vite/internal/ssg/element-services-full.ts',
      'src/vite/internal/ssg/element-services-retired.ts',
    ]);
    expect(drift.missing).toEqual([]);
    expect(drift.stale).toEqual(['src/vite/internal/ssg/element-services-retired.ts']);
  } finally {
    await rm(root, { recursive: true });
  }
});

test('runtime extraction captures a ninth value-consumed module and skips type-only edges', async () => {
  const root = await mkdtemp(join(tmpdir(), 'vp-pack-drift-capture-'));
  try {
    const cli = join(root, 'src', 'cli');
    const internal = join(root, 'src', 'vite', 'internal');
    const ssg = join(internal, 'ssg');
    mkdirSync(cli, { recursive: true });
    mkdirSync(ssg, { recursive: true });
    writeFileSync(
      join(internal, 'runtime-module-path.ts'),
      'export const runtimeModulePath = (p: string): string => p;\n',
    );
    writeFileSync(
      join(cli, 'build-client.ts'),
      [
        "export const first = runtimeModulePath('./ssg/root-a.ts');",
        "export const second = runtimeModulePath('./ssg/root-b.ts');",
      ].join('\n'),
    );
    // The other two seeds exist but contribute no roots: the fixture is about
    // the build host's closure walk, not about the seed union (the negative
    // test below covers that).
    writeFileSync(join(internal, '..', 'dev-island-client.ts'), '// no roots\n');
    writeFileSync(join(ssg, 'entry-client-codegen.ts'), '// no roots\n');
    writeFileSync(join(ssg, 'root-a.ts'), 'export const rootA = 1;\n');
    writeFileSync(
      join(ssg, 'root-b.ts'),
      [
        "import { createNinth } from './ninth.ts';",
        "import type { TypedShape } from './typed.ts';",
        'export const rootB = createNinth() as unknown as TypedShape;\n',
      ].join('\n'),
    );
    writeFileSync(
      join(ssg, 'ninth.ts'),
      [
        "import type { TypedShape } from './typed.ts';",
        'export const createNinth = () => 9;\n',
      ].join('\n'),
    );
    writeFileSync(join(ssg, 'typed.ts'), 'export interface TypedShape { n: number };\n');

    const { modules, problems } = consumerPathConsumedModules(root);
    expect(problems).toEqual([]);
    // The value-imported ninth module IS path-consumed; the type-only edge is not.
    expect([...modules].sort()).toEqual([
      'src/vite/internal/ssg/ninth.ts',
      'src/vite/internal/ssg/root-a.ts',
      'src/vite/internal/ssg/root-b.ts',
    ]);
    expect(!modules.has('src/vite/internal/ssg/typed.ts')).toBeTruthy();
  } finally {
    await rm(root, { recursive: true });
  }
});

test('runtime extraction fails closed on a non-literal runtimeModulePath argument', async () => {
  const root = await mkdtemp(join(tmpdir(), 'vp-pack-drift-failclosed-'));
  try {
    const cli = join(root, 'src', 'cli');
    const internal = join(root, 'src', 'vite', 'internal');
    mkdirSync(cli, { recursive: true });
    mkdirSync(internal, { recursive: true });
    writeFileSync(
      join(internal, 'runtime-module-path.ts'),
      'export const runtimeModulePath = (p: string): string => p;\n',
    );
    writeFileSync(
      join(cli, 'build-client.ts'),
      'export const mapped = runtimeModulePath(dynamicArgument);\n',
    );
    writeFileSync(join(internal, '..', 'dev-island-client.ts'), '// no roots\n');
    mkdirSync(join(internal, 'ssg'), { recursive: true });
    writeFileSync(join(internal, 'ssg', 'entry-client-codegen.ts'), '// no roots\n');
    const { modules, problems } = consumerPathConsumedModules(root);
    expect(modules.size).toEqual(0);
    expect(problems.length).toEqual(1);
    expect(problems[0]).toContain('literal string argument');
  } finally {
    await rm(root, { recursive: true });
  }
});

test('runtime extraction fails closed when the runtimeModulePath helper is missing', async () => {
  const root = await mkdtemp(join(tmpdir(), 'vp-pack-drift-helper-'));
  try {
    const cli = join(root, 'src', 'cli');
    mkdirSync(cli, { recursive: true });
    writeFileSync(
      join(cli, 'build-client.ts'),
      "export const mapped = runtimeModulePath('./ssg/island-scheduler.ts');\n",
    );
    const { modules, problems } = consumerPathConsumedModules(root);
    expect(modules.size).toEqual(0);
    expect(problems.length).toEqual(1);
    expect(problems[0]).toContain('runtime-module-path.ts');
  } finally {
    await rm(root, { recursive: true });
  }
});

// ─── S-C1.4 toolchain recovery: the staging install must state its own env ──

test('the staging install includes dev dependencies regardless of the caller environment', () => {
  // RED before the fix: npm derives `omit=dev` from an ambient
  // NODE_ENV=production, and the staging toolchain (vite-plus + the aliased
  // vite-plus core) lives in devDependencies by design — so the install
  // succeeded while silently skipping the toolchain, and the failure surfaced
  // later as an ENOENT spawn of <staging>/node_modules/.bin/vp.
  expect(VP_STAGING_INSTALL_ARGS).toContain('--include=dev');
  // The rest of the recipe is unchanged: lifecycle scripts stay off, the peer
  // check stays relaxed for the vite alias, and nothing becomes online-only.
  expect(VP_STAGING_INSTALL_ARGS).toContain('--ignore-scripts');
  expect(VP_STAGING_INSTALL_ARGS).toContain('--legacy-peer-deps');
  expect(VP_STAGING_INSTALL_ARGS).not.toContain('--omit=dev');
});

test('a staging root without the toolchain CLI fails fast with an actionable error', async () => {
  const stagingRoot = await mkdtemp(join(tmpdir(), 'vp-staging-guard-'));
  try {
    // RED before the fix: this condition reached the pack assembler as a bare
    // spawn ENOENT with no explanation of the staging root or the cause.
    const error = assertThrowsIncludes(
      () => assertVpStagingCli(stagingRoot, 'npm install (exit 0)'),
      Error,
    );
    expect(error.message).toContain('staging toolchain CLI');
    expect(error.message).toContain(stagingRoot);
    expect(error.message).toContain('include dev dependencies');

    // GREEN: an installed CLI (file or link) satisfies the guard.
    const binDir = join(stagingRoot, 'node_modules', '.bin');
    mkdirSync(binDir, { recursive: true });
    writeFileSync(join(binDir, 'vp'), '#!/bin/sh\nexit 0\n', 'utf8');
    expect(() => assertVpStagingCli(stagingRoot)).not.toThrow();
    expect(vpStagingCliPath(stagingRoot)).toEqual(join(binDir, 'vp'));
  } finally {
    await rm(stagingRoot, { recursive: true, force: true });
  }
});

// ─── The vp pack shield: closed stdin and a hard budget ─────────────────────

/** A staged workspace whose `vp` is a fake script, rooted in a temp dir. */
async function fakeStagedWorkspace(script: string): Promise<VpStagedWorkspace> {
  const stagingRoot = await mkdtemp(join(tmpdir(), 'vp-pack-shield-'));
  const binDir = join(stagingRoot, 'node_modules', '.bin');
  mkdirSync(binDir, { recursive: true });
  const vp = join(binDir, 'vp');
  writeFileSync(vp, `#!/bin/sh\n${script}\n`, 'utf8');
  chmodSync(vp, 0o755);
  return {
    stagingRoot,
    packDir: stagingRoot,
    distDir: join(stagingRoot, 'dist'),
    cleanup: async () => {},
  };
}

// The fakes are POSIX shell scripts; the tools project runs on the ubuntu lane.
const posixOnly = test.skipIf(process.platform === 'win32');

posixOnly('runVpPack closes stdin: the pack tool cannot block on a stream', async () => {
  // `read` returns EOF immediately on the null device and blocks on an
  // inherited pipe; the shield's budget turns that block into the failure
  // below instead of a hung test.
  const staged = await fakeStagedWorkspace(
    'if read -r line; then echo "stdin had data"; exit 3; fi\necho "stdin closed"',
  );
  try {
    const output = await runVpPack(staged, 5_000);
    expect(output).toContain('stdin closed');
    expect(output).not.toContain('stdin had data');
  } finally {
    await rm(staged.stagingRoot, { recursive: true, force: true });
  }
});

posixOnly('runVpPack enforces its budget instead of waiting forever', async () => {
  const staged = await fakeStagedWorkspace('exec sleep 30');
  const startedAt = Date.now();
  try {
    const error = await assertRejectsIncludes(() => runVpPack(staged, 400), Error);
    const elapsed = Date.now() - startedAt;
    expect(elapsed, `took ${elapsed}ms`).toBeLessThan(5_000);
    expect(error.message).toContain('exceeded its 400 ms budget');
    expect(error.message).toContain(staged.packDir);
  } finally {
    await rm(staged.stagingRoot, { recursive: true, force: true });
  }
});

test('runVpPack has a finite default budget', () => {
  expect(Number.isFinite(VP_PACK_TIMEOUT_MS)).toBeTruthy();
  expect(VP_PACK_TIMEOUT_MS).toBeGreaterThan(0);
});
