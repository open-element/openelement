/**
 * TS7 evaluation harness — issue #1156, Beta.2.2 slice.
 *
 * Re-runs the full experiment matrix against the CURRENT tree and exits
 * non-zero when a hard parity criterion fails. The unit under test is the
 * exact stable typescript@7.0.2 package (the native compiler, invoked through
 * its real `tsc` CLI); typescript@5.9.3 is the repo reference line. See
 * README.md for the toolchain pin and
 * docs/evidence/2026-09-10-beta2-2-ts7-experiment.md for the recorded results.
 */

import {
  compilePackageElementModules,
  stageCompiledPackWorkspace,
} from '../../lib/compiled-pack-staging.ts';
import { join } from '@std/path';

const EXPECTED_TS7 = '7.0.2';
const EXPECTED_TSC = '5.9.3';

const EXP = new URL('.', import.meta.url).pathname;
const ROOT = join(EXP, '..', '..', '..');
const WORK = join(EXP, '.work');
const TC = join(EXP, 'toolchain');
// typescript@7.0.2 (stable) is the unit under test; typescript@5.9.3 is the
// repo reference line. Both are installed under npm aliases so neither
// package's `.bin/tsc` link can shadow the other — always call the real
// package bin directly.
const TS7 = join(TC, 'node_modules', 'typescript-7', 'bin', 'tsc');
const TSC = join(TC, 'node_modules', 'typescript-5', 'bin', 'tsc');

const APP_DIR = join(ROOT, 'packages', 'app');
const UI_DIR = join(ROOT, 'packages', 'ui');
const ELEMENT_DIR = join(ROOT, 'packages', 'element');

// ---------------------------------------------------------------- utilities

interface CmdResult {
  code: number;
  stdout: string;
  stderr: string;
  ms: number;
  maxRssBytes: number | null;
}

async function run(
  cmd: string,
  args: string[],
  opts: { cwd?: string; withTime?: boolean } = {},
): Promise<CmdResult> {
  const argv = opts.withTime ? ['/usr/bin/time', '-l', cmd, ...args] : [cmd, ...args];
  const start = performance.now();
  const out = await new Deno.Command(argv[0], {
    args: argv.slice(1),
    cwd: opts.cwd,
    stdout: 'piped',
    stderr: 'piped',
  }).output();
  const ms = performance.now() - start;
  const stderr = new TextDecoder().decode(out.stderr);
  const rss = stderr.match(/^\s*(\d+)\s+maximum resident set size$/m);
  return {
    code: out.code,
    stdout: new TextDecoder().decode(out.stdout),
    stderr,
    ms,
    maxRssBytes: rss ? Number(rss[1]) : null,
  };
}

function tsCodes(text: string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const m of text.matchAll(/error (TS\d+)/g)) {
    counts[m[1]] = (counts[m[1]] ?? 0) + 1;
  }
  return counts;
}

async function writeText(path: string, text: string): Promise<void> {
  await Deno.mkdir(join(path, '..'), { recursive: true });
  await Deno.writeTextFile(path, text);
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeText(path, JSON.stringify(value, null, 2) + '\n');
}

async function symlink(target: string, link: string): Promise<void> {
  try {
    await Deno.remove(link, { recursive: true });
  } catch { /* absent */ }
  await Deno.mkdir(join(link, '..'), { recursive: true });
  await Deno.symlink(target, link);
}

async function copyDir(src: string, dest: string): Promise<void> {
  await Deno.mkdir(dest, { recursive: true });
  for await (const entry of Deno.readDir(src)) {
    if (entry.name === 'node_modules' || entry.name === 'dist') continue;
    if (entry.isFile && entry.name.endsWith('.tgz')) continue;
    const from = join(src, entry.name);
    const to = join(dest, entry.name);
    if (entry.isDirectory) await copyDir(from, to);
    else if (entry.isFile) await Deno.copyFile(from, to);
  }
}

async function listFiles(dir: string, ext: string): Promise<string[]> {
  const out: string[] = [];
  for await (const entry of Deno.readDir(dir)) {
    const p = join(dir, entry.name);
    if (entry.isDirectory) out.push(...await listFiles(p, ext));
    else if (entry.name.endsWith(ext)) out.push(p);
  }
  return out.sort();
}

// ------------------------------------------------------------- report model

type Severity = 'hard' | 'soft';

interface CheckRow {
  id: string;
  severity: Severity;
  description: string;
  pass: boolean;
  detail: string;
}

const checks: CheckRow[] = [];
const findings: Record<string, unknown> = {};
const timings: Record<string, { ms: number[]; maxRssBytes: (number | null)[] }> = {};

function check(id: string, severity: Severity, description: string, pass: boolean, detail: string) {
  checks.push({ id, severity, description, pass, detail });
  console.log(`  [${pass ? 'PASS' : 'FAIL'}] ${id}: ${description} — ${detail}`);
}

async function timed(label: string, cmd: string, args: string[], cwd?: string, runs = 3) {
  const entry = { ms: [] as number[], maxRssBytes: [] as (number | null)[] };
  for (let i = 0; i < runs; i++) {
    const r = await run(cmd, args, { cwd, withTime: true });
    entry.ms.push(Math.round(r.ms));
    entry.maxRssBytes.push(r.maxRssBytes);
  }
  timings[label] = entry;
}

// ------------------------------------------------------------------ blocked

function blocked(reason: string): never {
  console.error(`BLOCKED: ${reason}`);
  Deno.exit(2);
}

// ---------------------------------------------------------------- toolchain

async function ensureToolchain(): Promise<void> {
  console.log('== toolchain ==');
  const probe = await run(TS7, ['--version']);
  if (probe.code !== 0) {
    console.log('  ts7 toolchain not installed; running pinned npm install…');
    const npm = await run('npm', ['install', '--prefix', TC, '--no-audit', '--no-fund']);
    if (npm.code !== 0) {
      blocked(
        'toolchain install failed (npm install --prefix tools/experiments/ts7/toolchain): ' +
          npm.stderr.trim().slice(0, 400),
      );
    }
  }
  // The version under test is read from the RUNNING binary, never inferred
  // from package.json.
  const ts7 = await run(TS7, ['--version']);
  const tsc = await run(TSC, ['--version']);
  const ts7Version = ts7.stdout.replace(/^Version\s+/, '').trim();
  const tscVersion = tsc.stdout.replace(/^Version\s+/, '').trim();
  check(
    'toolchain.ts7-version',
    'hard',
    'ts7 (stable typescript@7 tsc CLI) runs and reports the exact pinned stable version',
    ts7.code === 0 && ts7Version === EXPECTED_TS7,
    `got '${ts7.stdout.trim()}', want ${EXPECTED_TS7}`,
  );
  check(
    'toolchain.tsc-version',
    'hard',
    'reference tsc matches the repo typescript@^5.9 pin line',
    tsc.code === 0 && tscVersion === EXPECTED_TSC,
    `got '${tsc.stdout.trim()}', want ${EXPECTED_TSC}`,
  );
  findings.toolchain = { ts7: ts7Version, tsc: tscVersion };
  if (ts7Version !== EXPECTED_TS7) {
    blocked(`pinned ts7 ${EXPECTED_TS7} unavailable; see README 'Toolchain pin'`);
  }
}

// ---------------------------------------------------------- shared tsconfig

interface TsConfigOptions {
  include: string[];
  jsx?: boolean;
  emit?: { outDir: string; rootDir: string; declarationMap?: boolean };
  relax?: boolean;
  skipLibCheck?: boolean;
  elementSrcDir?: string;
  extra?: Record<string, unknown>;
}

function makeTsConfig(o: TsConfigOptions): Record<string, unknown> {
  const esd = o.elementSrcDir ?? join(ELEMENT_DIR, 'src');
  const compilerOptions: Record<string, unknown> = {
    strict: true,
    target: 'esnext',
    module: 'esnext',
    moduleResolution: 'bundler',
    lib: ['esnext', 'dom', 'dom.iterable'],
    allowImportingTsExtensions: true,
    skipLibCheck: o.skipLibCheck ?? true,
    paths: {
      '@openelement/element': [join(esd, 'index.ts')],
      '@openelement/element/jsx-runtime': [join(esd, 'jsx-runtime.ts')],
      '@openelement/element/jsx-dev-runtime': [join(esd, 'jsx-dev-runtime.ts')],
      // Subpath exports such as @openelement/element/authoring resolve
      // source-side through this wildcard (deno workspace resolves them
      // through the member deno.json exports map instead).
      '@openelement/element/*': [join(esd, '*.ts')],
    },
    ...(o.jsx ? { jsx: 'react-jsx', jsxImportSource: '@openelement/element' } : {}),
    ...(o.relax ? { noImplicitOverride: false, noImplicitAny: false } : {}),
    ...(o.emit
      ? {
        declaration: true,
        emitDeclarationOnly: true,
        declarationMap: o.emit.declarationMap ?? true,
        outDir: o.emit.outDir,
        rootDir: o.emit.rootDir,
      }
      : { noEmit: true }),
    ...(o.extra ?? {}),
  };
  return { compilerOptions, include: o.include };
}

// ------------------------------------------------------------ res matrix

async function resMatrix(): Promise<void> {
  console.log('== resolution matrix ==');
  const base = join(WORK, 'res-matrix');
  const mk = (extra: Record<string, unknown>) => ({
    compilerOptions: {
      strict: true,
      target: 'esnext',
      module: 'esnext',
      moduleResolution: 'bundler',
      noEmit: true,
      ...extra,
    },
    include: ['src'],
  });

  // (a) npm dep (hono from the repo's own node_modules)
  const a = join(base, 'npm-dep');
  await symlink(join(ROOT, 'node_modules', 'hono'), join(a, 'node_modules', 'hono'));
  await writeJson(join(a, 'tsconfig.json'), mk({}));
  await writeText(
    join(a, 'src', 'main.ts'),
    'import { Hono } from "hono";\nconst app = new Hono();\napp.get("/", (c) => c.text("hi"));\nexport default app;\n',
  );
  const ra = await run(TS7, ['-p', 'tsconfig.json'], { cwd: a });
  check(
    'res.npm-dep',
    'hard',
    'ts7 resolves a bare npm dep via node_modules',
    ra.code === 0,
    `exit=${ra.code}`,
  );

  // (b) relative pair with explicit .ts extension (Deno style)
  const b = join(base, 'relative');
  await writeJson(join(b, 'tsconfig.json'), mk({}));
  await writeText(
    join(b, 'src', 'util.ts'),
    'export const add = (a: number, b: number): number => a + b;\n',
  );
  await writeText(
    join(b, 'src', 'main.ts'),
    'import { add } from "./util.ts";\nconsole.log(add(1, 2));\n',
  );
  const rb1 = await run(TS7, ['-p', 'tsconfig.json'], { cwd: b });
  const codes1 = tsCodes(rb1.stdout);
  check(
    'res.relative-ts-ext-flag-required',
    'hard',
    "explicit '.ts' import without allowImportingTsExtensions fails with TS5097",
    rb1.code !== 0 && (codes1.TS5097 ?? 0) === 1,
    `exit=${rb1.code} codes=${JSON.stringify(codes1)}`,
  );
  await writeJson(join(b, 'tsconfig.json'), mk({ allowImportingTsExtensions: true }));
  const rb2 = await run(TS7, ['-p', 'tsconfig.json'], { cwd: b });
  check(
    'res.relative-ts-ext-with-flag',
    'hard',
    'same import passes with allowImportingTsExtensions',
    rb2.code === 0,
    `exit=${rb2.code}`,
  );

  // (c) subpath-export package
  const c = join(base, 'subpath');
  await writeJson(join(c, 'tsconfig.json'), mk({}));
  await writeJson(join(c, 'node_modules', 'subpkg', 'package.json'), {
    name: 'subpkg',
    version: '1.0.0',
    exports: { '.': './index.js', './extra': './extra.js' },
    types: './index.d.ts',
  });
  await writeText(
    join(c, 'node_modules', 'subpkg', 'index.js'),
    'export const main = () => "main";\n',
  );
  await writeText(
    join(c, 'node_modules', 'subpkg', 'index.d.ts'),
    'export declare const main: () => string;\n',
  );
  await writeText(
    join(c, 'node_modules', 'subpkg', 'extra.js'),
    'export const extra = () => 42;\n',
  );
  await writeText(
    join(c, 'node_modules', 'subpkg', 'extra.d.ts'),
    'export declare const extra: () => number;\n',
  );
  await writeText(
    join(c, 'src', 'main.ts'),
    'import { main } from "subpkg";\nimport { extra } from "subpkg/extra";\nconsole.log(main(), extra());\n',
  );
  const rc = await run(TS7, ['-p', 'tsconfig.json'], { cwd: c });
  check(
    'res.subpath-exports',
    'hard',
    "ts7 resolves package 'exports' subpaths",
    rc.code === 0,
    `exit=${rc.code}`,
  );

  // (d) Deno import-map specifiers: documented unsupported path
  const d = join(base, 'deno-specifiers');
  await symlink(join(ROOT, 'node_modules', 'hono'), join(d, 'node_modules', 'hono'));
  await writeJson(join(d, 'tsconfig.json'), mk({}));
  await writeText(
    join(d, 'src', 'main.ts'),
    'import { Hono } from "npm:hono@^4.12";\nimport { walk } from "jsr:@std/fs/walk";\nconsole.log(Hono, walk);\n',
  );
  const rd = await run(TS7, ['-p', 'tsconfig.json'], { cwd: d });
  const codesD = tsCodes(rd.stdout);
  check(
    'res.deno-specifiers-unsupported',
    'hard',
    'npm:/jsr: specifiers fail with TS2307 (no import-map support)',
    rd.code !== 0 && (codesD.TS2307 ?? 0) === 2,
    `exit=${rd.code} codes=${JSON.stringify(codesD)} sample=${
      rd.stdout.trim().split('\n')[0] ?? ''
    }`,
  );
  // paths shim keyed on the literal specifier rescues npm: but not jsr:
  await writeJson(join(d, 'tsconfig.paths.json'), {
    compilerOptions: {
      ...mk({}).compilerOptions,
      paths: { 'npm:hono@^4.12': ['./node_modules/hono/dist/types/index.d.ts'] },
    },
    include: ['src'],
  });
  const rd2 = await run(TS7, ['-p', 'tsconfig.paths.json'], { cwd: d });
  const codesD2 = tsCodes(rd2.stdout);
  check(
    'res.paths-shim-partial',
    'soft',
    "a literal 'paths' key rescues npm: but import-map semantics (versions, lockfile) are not modeled",
    rd2.code !== 0 && (codesD2.TS2307 ?? 0) === 1,
    `exit=${rd2.code} codes=${JSON.stringify(codesD2)}`,
  );
  // baseUrl removed in TS7
  await writeJson(join(d, 'tsconfig.baseurl.json'), {
    compilerOptions: { ...mk({}).compilerOptions, baseUrl: '.' },
    include: ['src'],
  });
  const rd3 = await run(TS7, ['-p', 'tsconfig.baseurl.json'], { cwd: d });
  const codesD3 = tsCodes(rd3.stdout);
  check(
    'res.baseurl-removed',
    'soft',
    "TS7 removed 'baseUrl' (TS5102)",
    rd3.code !== 0 && (codesD3.TS5102 ?? 0) === 1,
    `exit=${rd3.code} codes=${JSON.stringify(codesD3)}`,
  );
  findings.resolutionMatrix = {
    npmDep: ra.code,
    relativeNoFlag: codes1,
    relativeWithFlag: rb2.code,
    subpath: rc.code,
    denoSpecifiers: codesD,
    pathsShim: codesD2,
    baseUrl: codesD3,
  };
}

// ------------------------------------------------- parity: deno check vs ts7

async function appParity(): Promise<void> {
  console.log('== packages/app typecheck parity ==');
  const deno = await run('deno', ['check', 'src/'], { cwd: APP_DIR });
  check(
    'parity.app.deno-check',
    'hard',
    '`deno check src/` gate on packages/app',
    deno.code === 0,
    `exit=${deno.code}`,
  );

  const dir = join(WORK, 'app-check');
  await symlink(join(ROOT, 'node_modules'), join(dir, 'node_modules'));
  await writeJson(
    join(dir, 'tsconfig.json'),
    makeTsConfig({ include: [join(APP_DIR, 'src')] }),
  );
  const ts7 = await run(TS7, ['-p', 'tsconfig.json'], { cwd: dir });
  check(
    'parity.app.ts7',
    'hard',
    'ts7 typechecks packages/app/src clean where deno check does (skipLibCheck, paths->element source)',
    deno.code === 0 && ts7.code === 0,
    `deno=${deno.code} ts7=${ts7.code} ${ts7.stdout.trim().split('\n')[0] ?? ''}`,
  );

  // Soft: lock the known lib divergence — without skipLibCheck the
  // urlpattern-polyfill `declare global` collides with TS7 lib.dom URLPattern.
  await writeJson(
    join(dir, 'tsconfig.noskiplib.json'),
    makeTsConfig({ include: [join(APP_DIR, 'src')], skipLibCheck: false }),
  );
  const noSkip = await run(TS7, ['-p', 'tsconfig.noskiplib.json'], { cwd: dir });
  const codesNoSkip = tsCodes(noSkip.stdout);
  check(
    'parity.app.urlpattern-dup',
    'soft',
    'without skipLibCheck: urlpattern-polyfill globals collide with TS7 lib.dom (TS2300)',
    noSkip.code !== 0 && (codesNoSkip.TS2300 ?? 0) > 0,
    `exit=${noSkip.code} codes=${JSON.stringify(codesNoSkip)}`,
  );

  // Soft: tsc 5.9 on the identical config must NOT be clean — its lib.dom
  // predates the Navigation API / URLPattern globals the sources rely on.
  const tsc = await run(TSC, ['-p', 'tsconfig.json'], { cwd: dir });
  const codesTsc = tsCodes(tsc.stdout);
  check(
    'parity.app.tsc59-libgap',
    'soft',
    'tsc 5.9 diverges on the same sources (TS2304 NavigateEvent, TS2552 navigation, TS2339 globalThis.URLPattern)',
    tsc.code !== 0 && (codesTsc.TS2304 ?? 0) > 0 && (codesTsc.TS2552 ?? 0) > 0 &&
      (codesTsc.TS2339 ?? 0) > 0,
    `exit=${tsc.code} codes=${JSON.stringify(codesTsc)}`,
  );
  findings.appParity = {
    denoExit: deno.code,
    ts7Exit: ts7.code,
    ts7NoSkipLibCheck: codesNoSkip,
    tsc59: codesTsc,
  };
}

async function uiParity(): Promise<void> {
  console.log('== packages/ui TSX/decorator parity ==');
  const deno = await run('deno', ['check', 'src/open-button.tsx'], { cwd: UI_DIR });
  const dir = join(WORK, 'ui-check');
  await symlink(join(ROOT, 'node_modules'), join(dir, 'node_modules'));
  await writeJson(
    join(dir, 'tsconfig.json'),
    makeTsConfig({ include: [join(UI_DIR, 'src', 'open-button.tsx')], jsx: true }),
  );
  const ts7 = await run(TS7, ['-p', 'tsconfig.json'], { cwd: dir });
  const tsc = await run(TSC, ['-p', 'tsconfig.json'], { cwd: dir });
  check(
    'parity.ui.open-button',
    'hard',
    'deno check, ts7 and tsc 5.9 all accept @element/@property TC39-liberal decorator intrinsics + JSX',
    deno.code === 0 && ts7.code === 0 && tsc.code === 0,
    `deno=${deno.code} ts7=${ts7.code} tsc=${tsc.code}`,
  );
  findings.uiParity = { denoExit: deno.code, ts7Exit: ts7.code, tscExit: tsc.code };
}

// --------------------------------------------------------- declaration emit

async function emitApp(): Promise<void> {
  console.log('== declaration emit: packages/app ==');
  const dir = join(WORK, 'app-emit');
  await symlink(join(ROOT, 'node_modules'), join(dir, 'node_modules'));
  const cfg = (outDir: string) =>
    makeTsConfig({
      include: [join(APP_DIR, 'src')],
      emit: { outDir, rootDir: join(ROOT, 'packages') },
    });
  await writeJson(join(dir, 'tsconfig.ts7.json'), cfg(join(dir, 'out-ts7')));
  await writeJson(join(dir, 'tsconfig.tsc.json'), cfg(join(dir, 'out-tsc')));

  const ts7 = await run(TS7, ['-p', 'tsconfig.ts7.json'], { cwd: dir });
  const tsc = await run(TSC, ['-p', 'tsconfig.tsc.json'], { cwd: dir });
  const ts7Dts = (await listFiles(join(dir, 'out-ts7'), '.d.ts')).filter((f) =>
    !f.endsWith('.map')
  );
  const tscDts = (await listFiles(join(dir, 'out-tsc'), '.d.ts')).filter((f) =>
    !f.endsWith('.map')
  );
  const ts7Maps = await listFiles(join(dir, 'out-ts7'), '.d.ts.map');
  const appModuleCount = (await listFiles(join(APP_DIR, 'src'), '.ts')).length;
  const ts7AppDts = ts7Dts.filter((f) => f.includes('/app/'));

  check(
    'emit.app.ts7',
    'hard',
    'ts7 emits declarations + declaration maps for every packages/app module',
    ts7.code === 0 && ts7AppDts.length === appModuleCount && ts7Maps.length > 0,
    `exit=${ts7.code} appDts=${ts7AppDts.length}/${appModuleCount} maps=${ts7Maps.length}`,
  );
  const sameSet = ts7Dts.map((f) => f.replace('out-ts7', '')).join('\n') ===
    tscDts.map((f) => f.replace('out-tsc', '')).join('\n');
  let byteDiffs = 0;
  const byteDiffFiles: string[] = [];
  for (const f of ts7Dts) {
    const other = f.replace('out-ts7', 'out-tsc');
    const a = await Deno.readTextFile(f).catch(() => null);
    const b = await Deno.readTextFile(other).catch(() => null);
    if (a !== b) {
      byteDiffs++;
      byteDiffFiles.push(f.split('/out-ts7/')[1]);
    }
  }
  check(
    'emit.app.tsc-sameset',
    'hard',
    'tsc 5.9 emits the same .d.ts file set on the identical config',
    tsc.code !== 0 && sameSet,
    `tsc exit=${tsc.code} (nonzero expected: lib gap) sameFileSet=${sameSet} byteDiffs=${byteDiffs} ${
      byteDiffFiles.join(',')
    }`,
  );

  // Known divergence: ts7/tsc keep '.ts' specifiers in declarations;
  // rewriteRelativeImportExtensions rewrites JS emit only (verified for both).
  const idx = await Deno.readTextFile(join(dir, 'out-ts7', 'app', 'src', 'index.d.ts'));
  check(
    'emit.app.ts-specifier-retained',
    'soft',
    "ts7 declarations retain '.ts' import specifiers (deno pack rewrites to '.js')",
    idx.includes("from './authoring.ts'"),
    idx.trim().split('\n')[0] ?? '',
  );
  findings.appEmit = {
    ts7Exit: ts7.code,
    tscExit: tsc.code,
    appModules: appModuleCount,
    ts7AppDts: ts7AppDts.length,
    declarationMaps: ts7Maps.length,
    byteDiffs,
    byteDiffFiles,
  };
}

// ------------------------------------------------------- deno pack (scratch)

async function packWs(): Promise<
  { appDts: string[]; elementDts: string[]; appTar: string; elementTar: string }
> {
  console.log('== deno pack scratch workspace (app, element; ui authored) ==');
  const ws = join(WORK, 'pack-ws');
  await Deno.remove(ws, { recursive: true }).catch(() => undefined);
  await copyDir(APP_DIR, join(ws, 'app'));
  await copyDir(ELEMENT_DIR, join(ws, 'element'));
  await symlink(join(ROOT, 'node_modules'), join(ws, 'node_modules'));
  await writeJson(join(ws, 'deno.json'), {
    workspace: ['./app', './element'],
    nodeModulesDir: 'manual',
    compilerOptions: {
      module: 'ESNext',
      moduleResolution: 'bundler',
      lib: ['ES2022', 'DOM', 'DOM.Iterable'],
      strict: true,
      skipLibCheck: true,
      jsx: 'react-jsx',
      jsxImportSource: '@openelement/element',
    },
    imports: {
      '@openelement/url-pattern-list': 'npm:@openelement/url-pattern-list@0.6.0',
      'preact': 'npm:preact@^10.28.0',
      'preact-render-to-string': 'npm:preact-render-to-string@^6.5.0',
      'lit': 'npm:lit@3.3.3',
      '@lit-labs/ssr': 'npm:@lit-labs/ssr@4.1.0',
      '@lit-labs/ssr-client': 'npm:@lit-labs/ssr-client@1.1.8',
      'urlpattern-polyfill': 'npm:urlpattern-polyfill@10.1.0',
      'hono': 'npm:hono@^4.12',
    },
  });

  async function packOne(
    name: string,
  ): Promise<{ dts: string[]; tar: string; dropped: string[]; code: number }> {
    const cwd = join(ws, name);
    await Deno.remove(join(cwd, `${name}.tgz`)).catch(() => undefined);
    const r = await run('deno', ['pack', '--output', `${name}.tgz`, '--allow-dirty'], { cwd });
    // 'Could not generate types' is emitted on stderr on current Deno 2.9.
    const announced = [...(r.stdout + r.stderr).matchAll(/Could not generate types for '([^']+)'/g)]
      .map((m) => m[1].split('/src/')[1] ?? m[1]);
    const tarDir = join(ws, `${name}-tar`);
    await Deno.remove(tarDir, { recursive: true }).catch(() => undefined);
    await Deno.mkdir(tarDir, { recursive: true });
    await run('tar', ['-xzf', join(cwd, `${name}.tgz`), '-C', tarDir]);
    const dts = (await listFiles(tarDir, '.d.ts')).filter((f) => !f.endsWith('.map')).map((f) =>
      f.split('/package/')[1]
    );
    const js = new Set(
      (await listFiles(tarDir, '.js')).map((f) => f.split('/package/')[1].replace(/\.js$/, '')),
    );
    const typed = new Set(dts.map((f) => f.replace(/\.d\.ts$/, '')));
    const dropped = [...js].filter((f) => !typed.has(f)).sort();
    if (announced.length !== dropped.length) {
      findings[`pack.${name}.announcedMismatch`] = { announced, dropped };
    }
    return { dts, tar: join(tarDir, 'package'), dropped, code: r.code };
  }

  const app = await packOne('app');
  const element = await packOne('element');
  check(
    'pack.app.runs',
    'hard',
    'deno pack produces a tarball for @openelement/app (never published)',
    app.code === 0 && app.dts.length > 0,
    `exit=${app.code} dts=${app.dts.length} dropped=[${app.dropped.join(', ')}]`,
  );
  check(
    'pack.drops-types-silently',
    'soft',
    'deno pack fails type generation for some modules with no diagnostic reason (known gap ts7 fills)',
    true,
    `app dropped ${app.dropped.length}: [${
      app.dropped.join(', ')
    }]; element dropped ${element.dropped.length}: [${element.dropped.join(', ')}]`,
  );
  findings.pack = {
    appDropped: app.dropped,
    elementDropped: element.dropped,
    appDts: app.dts.length,
    elementDts: element.dts.length,
  };

  // ts7 d.ts set must cover the deno pack d.ts set (same src-relative names).
  const ts7Dts = (await listFiles(join(WORK, 'app-emit', 'out-ts7'), '.d.ts'))
    .filter((f) => !f.endsWith('.map') && f.includes('/app/'))
    .map((f) => f.split('/app/')[1].replace(/^src\//, 'src/'));
  const missing = app.dts.filter((f) => !ts7Dts.includes(f));
  check(
    'pack.app.ts7-superset',
    'hard',
    'ts7 declarations cover every module deno pack typed',
    missing.length === 0,
    missing.length === 0 ? `${app.dts.length} modules covered` : `missing: ${missing.join(', ')}`,
  );
  return { appDts: app.dts, elementDts: element.dts, appTar: app.tar, elementTar: element.tar };
}

// ------------------------------------------------------- staged pack (ui)

async function stagedUi(): Promise<void> {
  console.log('== compiled-element pack staging (packages/ui) ==');
  const pkgInfo = (name: string, dir: string) => {
    const cfgText = new TextDecoder().decode(Deno.readFileSync(join(dir, 'deno.json')));
    const cfg = JSON.parse(cfgText);
    return {
      name,
      version: cfg.version,
      dir,
      deps: [] as string[],
      exports: cfg.exports,
      importKeys: new Set<string>(Object.keys(cfg.imports ?? {})),
      importValues: (cfg.imports ?? {}) as Record<string, string>,
    };
  };
  const ui = pkgInfo('@openelement/ui', UI_DIR);
  const element = pkgInfo('@openelement/element', ELEMENT_DIR);
  const rootDenoJson = JSON.parse(await Deno.readTextFile(join(ROOT, 'deno.json')));

  const compiled = compilePackageElementModules(ui.dir);
  const staged = await stageCompiledPackWorkspace(ui, [ui, element], rootDenoJson, compiled);
  const stagedRoot = join(staged.packDir, '..');
  findings.staged = { compiledModules: compiled.map((c) => c.relativePath) };

  try {
    await symlink(join(ROOT, 'node_modules'), join(stagedRoot, 'node_modules'));

    // Verify the staged member config carries exactly the two relaxations.
    const memberCfg = JSON.parse(await Deno.readTextFile(join(staged.packDir, 'deno.json')));
    const relax = memberCfg.compilerOptions ?? {};
    check(
      'staged.relaxations-exact',
      'hard',
      'staging relaxes exactly noImplicitOverride + noImplicitAny (tools/lib/compiled-pack-staging.ts)',
      relax.noImplicitOverride === false && relax.noImplicitAny === false,
      JSON.stringify(relax),
    );

    const dir = join(WORK, 'ui-staged');
    const inc = [join(staged.packDir, 'src')];
    const mkCfg = (relaxFlags: boolean, emit?: { outDir: string; rootDir: string }) =>
      // staged element sources, not the repo's
      makeTsConfig({
        include: inc,
        jsx: true,
        relax: relaxFlags,
        emit,
        elementSrcDir: join(stagedRoot, 'element', 'src'),
      });
    await writeJson(join(dir, 'tsconfig.strict.json'), mkCfg(false));
    await writeJson(join(dir, 'tsconfig.relaxed.json'), mkCfg(true));
    await writeJson(
      join(dir, 'tsconfig.emit.json'),
      mkCfg(true, { outDir: join(dir, 'out'), rootDir: stagedRoot }),
    );

    const strict = await run(TS7, ['-p', 'tsconfig.strict.json'], { cwd: dir });
    const strictCodes = tsCodes(strict.stdout);
    const implicitAnyCount = (strictCodes.TS7005 ?? 0) + (strictCodes.TS7006 ?? 0) +
      (strictCodes.TS7034 ?? 0);
    check(
      'staged.strict-fails',
      'hard',
      'compiled-element emission fails full-strict ts7 with implicit-any codes (relaxation is load-bearing)',
      strict.code !== 0 && implicitAnyCount > 0,
      `exit=${strict.code} codes=${JSON.stringify(strictCodes)}`,
    );
    const relaxed = await run(TS7, ['-p', 'tsconfig.relaxed.json'], { cwd: dir });
    check(
      'staged.relaxed-clean',
      'hard',
      'with the two documented relaxations ts7 accepts the staged compiler output',
      relaxed.code === 0,
      `exit=${relaxed.code} ${relaxed.stdout.trim().split('\n')[0] ?? ''}`,
    );
    const emit = await run(TS7, ['-p', 'tsconfig.emit.json'], { cwd: dir });
    const stagedUiDts = (await listFiles(join(dir, 'out'), '.d.ts'))
      .filter((f) => !f.endsWith('.map') && f.includes('/ui/'));
    const stagedUiModules = (await listFiles(join(staged.packDir, 'src'), '.ts'))
      .concat(await listFiles(join(staged.packDir, 'src'), '.tsx'));
    check(
      'staged.emit-complete',
      'hard',
      'ts7 declaration emit covers every staged ui module (incl. all compiled .tsx)',
      emit.code === 0 && stagedUiDts.length === stagedUiModules.length,
      `exit=${emit.code} dts=${stagedUiDts.length}/${stagedUiModules.length}`,
    );

    // The current pack path on the same staged directory.
    const pack = await run('deno', ['pack', '--output', 'ui.tgz', '--allow-dirty'], {
      cwd: staged.packDir,
    });
    const dropped = [
      ...(pack.stdout + pack.stderr).matchAll(/Could not generate types for '([^']+)'/g),
    ]
      .map((m) => m[1]);
    const tarDir = join(dir, 'ui-tar');
    await Deno.remove(tarDir, { recursive: true }).catch(() => undefined);
    await Deno.mkdir(tarDir, { recursive: true });
    await run('tar', ['-xzf', join(staged.packDir, 'ui.tgz'), '-C', tarDir]);
    const packDts = (await listFiles(tarDir, '.d.ts')).filter((f) => !f.endsWith('.map'));
    check(
      'staged.deno-pack-types-gap',
      'soft',
      'deno pack on the staged compiled workspace generates types for few/no modules (ts7 covers all)',
      pack.code === 0,
      `pack exit=${pack.code} dts=${packDts.length} typeGenFailures=${dropped.length}`,
    );
    Object.assign(findings.staged as Record<string, unknown>, {
      strictCodes,
      implicitAnyCount,
      relaxedExit: relaxed.code,
      emitExit: emit.code,
      ts7Dts: stagedUiDts.length,
      stagedModules: stagedUiModules.length,
      denoPackDts: packDts.length,
      denoPackTypeGenFailures: dropped.length,
    });
  } finally {
    await staged.cleanup();
  }
}

// ------------------------------------------------------------- consumer

async function consumer(appTar: string, elementTar: string): Promise<void> {
  console.log('== independent consumer parity (tsc 5.9 vs ts7) ==');
  const dir = join(WORK, 'consumer');
  await Deno.remove(dir, { recursive: true }).catch(() => undefined);
  await Deno.mkdir(join(dir, 'node_modules', '@openelement'), { recursive: true });
  await copyDir(appTar, join(dir, 'node_modules', '@openelement', 'app'));
  await copyDir(elementTar, join(dir, 'node_modules', '@openelement', 'element'));
  for (
    const dep of [
      'hono',
      'preact',
      'preact-render-to-string',
      'lit',
      '@lit-labs',
      'urlpattern-polyfill',
    ]
  ) {
    await symlink(join(ROOT, 'node_modules', dep), join(dir, 'node_modules', dep));
  }
  await symlink(
    join(ROOT, 'node_modules', '@openelement', 'url-pattern-list'),
    join(dir, 'node_modules', '@openelement', 'url-pattern-list'),
  );
  await writeJson(join(dir, 'tsconfig.json'), {
    compilerOptions: {
      strict: true,
      target: 'esnext',
      module: 'esnext',
      moduleResolution: 'bundler',
      lib: ['esnext', 'dom', 'dom.iterable'],
      noEmit: true,
      skipLibCheck: true,
    },
    include: ['main.ts'],
  });
  const valid = [
    "import { definePage, fail, notFound, redirect, createRequestContext } from '@openelement/app';",
    "import type { ActionContext, LoaderContext } from '@openelement/app';",
    "import { RouteTable } from '@openelement/app/router';",
    "import type { RouteRecord } from '@openelement/app/router';",
    "import { OpenElement, createLogger, OpenElementError } from '@openelement/element';",
    '',
    'const table = new RouteTable([]);',
    'const rec: RouteRecord = JSON.parse(\'{"pattern":"/x","page":"x-page"}\');',
    'console.log(table, rec, definePage, fail, notFound, redirect, OpenElementError, OpenElement, createLogger, createRequestContext);',
    'const f = (ctx: LoaderContext) => ctx;',
    'const g = (ctx: ActionContext) => ctx;',
    'console.log(f, g);',
    '',
  ].join('\n');
  await writeText(join(dir, 'main.ts'), valid);
  const tscOk = await run(TSC, ['-p', 'tsconfig.json'], { cwd: dir });
  const ts7Ok = await run(TS7, ['-p', 'tsconfig.json'], { cwd: dir });
  check(
    'consumer.valid',
    'hard',
    'packed declarations typecheck a consumer program clean under BOTH tsc 5.9 and ts7',
    tscOk.code === 0 && ts7Ok.code === 0,
    `tsc=${tscOk.code} ts7=${ts7Ok.code} ${tscOk.stdout.trim().split('\n')[0] ?? ''} ${
      ts7Ok.stdout.trim().split('\n')[0] ?? ''
    }`,
  );

  const invalid = valid.replace(
    'import { definePage,',
    'import { definePage, thisDoesNotExist,', // TS2305 in both
  ).replace('new RouteTable([])', 'new RouteTable()'); // TS2554 in both
  await writeText(join(dir, 'main.ts'), invalid);
  const tscBad = await run(TSC, ['-p', 'tsconfig.json'], { cwd: dir });
  const ts7Bad = await run(TS7, ['-p', 'tsconfig.json'], { cwd: dir });
  const tscCodes = tsCodes(tscBad.stdout);
  const ts7Codes = tsCodes(ts7Bad.stdout);
  const sameCodes = JSON.stringify(tscCodes) === JSON.stringify(ts7Codes);
  check(
    'consumer.invalid-same-codes',
    'hard',
    'both compilers reject the same invalid consumer program with identical diagnostic codes',
    tscBad.code !== 0 && ts7Bad.code !== 0 && sameCodes,
    `tsc=${JSON.stringify(tscCodes)} ts7=${JSON.stringify(ts7Codes)}`,
  );
  findings.consumer = {
    valid: { tsc: tscOk.code, ts7: ts7Ok.code },
    invalid: { tsc: tscCodes, ts7: ts7Codes },
    note:
      'ts7 elaboration is shallower: tsc wraps assignability failures in TS2345, ts7 reports the leaf code (e.g. TS2740) alone; exit codes also differ (tsc=2, ts7=1).',
  };
}

// --------------------------------------------------------------- timings

async function measure(): Promise<void> {
  console.log('== timing + memory (3 runs each, warm caches) ==');
  const timeSupported = (await run('/usr/bin/time', ['-l', 'true'])).code === 0;
  findings.memoryNote = timeSupported
    ? 'peak RSS via /usr/bin/time -l (macOS), bytes'
    : 'memory UNAVAILABLE on this host (/usr/bin/time -l missing) — wall time only';
  await run('deno', ['check', 'src/'], { cwd: APP_DIR }); // warm
  await timed('deno-check-app', 'deno', ['check', 'src/'], APP_DIR);
  await timed('ts7-noemit-app', TS7, ['-p', 'tsconfig.json'], join(WORK, 'app-check'));
  await timed('tsc59-noemit-app', TSC, ['-p', 'tsconfig.json'], join(WORK, 'app-check'));
  await timed('ts7-emit-app', TS7, ['-p', 'tsconfig.ts7.json'], join(WORK, 'app-emit'));
  await timed('tsc59-emit-app', TSC, ['-p', 'tsconfig.tsc.json'], join(WORK, 'app-emit'));
  await timed(
    'deno-pack-app',
    'deno',
    ['pack', '--output', 'app.tgz', '--allow-dirty'],
    join(WORK, 'pack-ws', 'app'),
  );
}

// ------------------------------------------------------------------ main

async function main(): Promise<void> {
  const env = {
    date: new Date().toISOString(),
    os: `${Deno.build.os}/${Deno.build.arch}`,
    deno: (await run('deno', ['--version'])).stdout.split('\n')[0],
    node: (await run('node', ['--version'])).stdout.trim(),
    repoHead: (await run('git', ['rev-parse', 'HEAD'], { cwd: ROOT })).stdout.trim(),
    repoBranch: (await run('git', ['branch', '--show-current'], { cwd: ROOT })).stdout.trim(),
  };
  console.log(
    `repo ${env.repoBranch}@${env.repoHead.slice(0, 12)} | ${env.deno} | node ${env.node}`,
  );

  await Deno.remove(WORK, { recursive: true }).catch(() => undefined);
  await Deno.mkdir(WORK, { recursive: true });
  await Deno.stat(join(ROOT, 'node_modules')).catch(() =>
    blocked('repo root node_modules missing — run the standard repo setup (deno install) first')
  );

  await ensureToolchain();
  await resMatrix();
  await appParity();
  await uiParity();
  await emitApp();
  const { appTar, elementTar } = await packWs();
  await stagedUi();
  await consumer(appTar, elementTar);
  await measure();

  const report = { environment: env, checks, findings, timings };
  await writeJson(join(WORK, 'report.json'), report);

  const hardFails = checks.filter((c) => c.severity === 'hard' && !c.pass);
  const softFails = checks.filter((c) => c.severity === 'soft' && !c.pass);
  console.log('\n== summary ==');
  console.log(
    `hard: ${
      checks.filter((c) => c.severity === 'hard' && c.pass).length
    } pass, ${hardFails.length} fail`,
  );
  console.log(
    `soft: ${
      checks.filter((c) => c.severity === 'soft' && c.pass).length
    } pass, ${softFails.length} fail (recorded, non-gating)`,
  );
  console.log(`report: ${join(WORK, 'report.json')}`);
  if (hardFails.length > 0) {
    for (const f of hardFails) console.log(`  HARD FAIL ${f.id}: ${f.detail}`);
    Deno.exit(1);
  }
}

await main();
