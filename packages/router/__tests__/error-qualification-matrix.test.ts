/**
 * The error-reporting and recovery qualification matrix (#1616).
 *
 * One cross-cutting contract, asserted PER FATAL CLASS — every coded failure an
 * application can hit at build/dev/SSG time (a) REACHES the operator (never
 * swallowed), (b) NAMES its code per the diagnostics envelope (#1612), and (c)
 * leaves the server in the DOCUMENTED SAFE STATE. The classes and their raise
 * sites:
 *
 * ┌ class ────────────────────────────────┬ code ─────────────────────────────────────┬ raise site ─────────────────────────────────┐
 * │ scan: explicit package missing        │ OE_PACKAGE_ISLAND_PACKAGE_MISSING         │ island-scanner.ts scanPackageManifests      │
 * │ scan: manifest absent (claimed)       │ PACKAGE_MANIFEST_ERROR                    │ island-scanner.ts scanPackageManifests      │
 * │ scan: manifest invalid                │ PACKAGE_MANIFEST_ERROR                    │ island-scanner.ts scanPackageManifests      │
 * │ scan: manifest transport failure      │ PACKAGE_SCAN_ERROR                        │ island-scanner.ts scanPackageManifests      │
 * │ scan: derived manifest invalid        │ PACKAGE_MANIFEST_ERROR                    │ derived-admission.ts deriveAdmittedPackages │
 * │ scan: derived tag conflict            │ OE_PACKAGE_ADMISSION_TAG_CONFLICT         │ derived-admission.ts mergeAdmittedManifests │
 * │ scan: buildStart wrapper              │ ROUTE_SCAN_ERROR                          │ plugin-scanners.ts createBuildStartHook     │
 * │ ssg: routeInfo missing/empty, no app, │ OE_SSG_*                                  │ ssg-render.ts ssgRender                     │
 * │      static non-200                   │                                           │                                             │
 * │ recovery: style configuration reload  │ OE_PRESET_UNOCSS_CONFIG_UNLOADABLE        │ dev-style-session.ts rebuild                │
 * │ recovery: descriptor rescan           │ OE_ROUTE_SCAN_* (the cause's code)        │ plugin-watch.ts rescan queue                │
 * └───────────────────────────────────────┴───────────────────────────────────────────┴─────────────────────────────────────────────┘
 *
 * THE SWALLOW CLASS AND ITS GUARD. On rolldown-vite 8 the bundler's buildStart
 * error surface does not carry the thrown message to the CLI (pre-existing;
 * verified on the alpha15 baseline): a scan-phase fatal that only THROWS never
 * reaches the developer — the build walks on with a half-empty scan and fails
 * later with a misleading downstream error. The interim contract is
 * log-before-throw through ONE seam (`reportScanFatal`): every scan-phase fatal
 * reports its envelope on the build log and into the machine-readable exit
 * record BEFORE throwing. The workaround itself is guarded: every scan row
 * below drives the REAL raise site and fails unless the `[CODE]` line reached
 * the console AND the envelope was recorded — deleting the report call on any
 * class turns its row (and the matrix) red.
 *
 * The bundled failure is proven END TO END once: a real CLI build of an
 * external-layout app whose scan fails must print the scan fatal's coded line
 * and carry the same codes in the `--diagnostics-file` document, beside the
 * downstream SSG verdict, exiting 1.
 *
 * The hydration fatals' reporting half of the matrix is ELEMENT-owned:
 * packages/element/__tests__/hydration-fatal-qualification.test.ts.
 */

import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { statSync } from 'node:fs';
import { afterAll, expect, test, vi, type MockInstance } from 'vitest';
import type { RouteEntry } from '@openelement/protocol/framework';
import type { ViteDevServer } from 'vite';
import { OpenElementError } from '@openelement/element/authoring';
import { createClassCandidateRegistry } from '@openelement/compiler';
import { DIAGNOSTIC_REPORT_FORMAT, type DiagnosticReport } from '@openelement/protocol/diagnostics';
import {
  buildFailureEnvelopes,
  resetBuildExitRecords,
  takeBuildDiagnostics,
} from '../src/vite/internal/build-diagnostics.ts';
import {
  PackageAdmissionErrorCode,
  PackageIslandErrorCode,
  SsgRenderErrorCode,
} from '../src/internal/error-codes.ts';
import {
  scanPackageManifests,
  loadPackageManifest,
} from '../src/vite/internal/ssg/island-scanner.ts';
import {
  deriveAdmittedPackages,
  mergeAdmittedManifests,
} from '../src/vite/internal/ssg/derived-admission.ts';
import type { OpenElementPackageManifest } from '../src/vite/framework.ts';
import type { ModuleWalkResolver } from '../src/vite/internal/module-graph-walk.ts';
import {
  ssgRender,
  type SsgRenderOptions,
  type SsrBundle,
} from '../src/vite/internal/ssg/index.ts';
import { createOpenPlugin } from '../src/vite/plugin.ts';
import { createDevStyleSession } from '../src/vite/internal/dev-style-session.ts';
import { collectShadowClassCandidates } from '../src/vite/internal/collect-shadow-candidates.ts';
import { OpenElementBuildContext } from '../src/vite/build-context.ts';
import type { OpenPluginState } from '../src/vite/plugin-config.ts';
import { RESOLVED_ENTRY_ID } from '../src/vite/plugin-virtual-modules.ts';

const REPO_ROOT = join(import.meta.dirname!, '..', '..', '..');
const ROUTER_CLI = join(REPO_ROOT, 'packages', 'router', 'src', 'cli', 'cli.ts');

const tempRoots: string[] = [];

afterAll(async () => {
  for (const root of tempRoots.splice(0)) await rm(root, { recursive: true, force: true });
});

// ─── Harness ─────────────────────────────────────────────────────────

async function write(root: string, path: string, source: string): Promise<void> {
  const file = join(root, path);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, source, 'utf8');
}

/** Capture console.error — the human channel every report seam writes through. */
function captureConsoleError(): { lines: string[]; spy: MockInstance } {
  const lines: string[] = [];
  const spy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    lines.push(args.map((argument) => String(argument)).join(' '));
  });
  return { lines, spy };
}

/** Wait until predicate() holds; fails the test after ~5s. */
async function waitFor(predicate: () => boolean, what: string): Promise<void> {
  const deadline = Date.now() + 5000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for: ${what}`);
    await new Promise((r) => setTimeout(r, 10));
  }
}

interface FatalRow {
  /** The class the row qualifies. */
  name: string;
  /** The code the envelope must name. */
  code: string;
  /** Drive the REAL raise site; must reject. */
  drive: () => Promise<unknown>;
}

/**
 * One matrix row: the class's fatal must (a) reach — the `[CODE]` line is on
 * the console BEFORE the throw (the log-before-throw guard: deleting the
 * report call turns this red), (b) name its code on BOTH channels — the human
 * line and the recorded envelope the machine-readable exit replays — and
 * (c) stay fail-closed (the drive rejects; the scan never returns half work).
 */
async function expectScanFatalRow(row: FatalRow): Promise<void> {
  resetBuildExitRecords();
  const capture = captureConsoleError();
  let thrown: unknown;
  try {
    await row.drive();
  } catch (error) {
    thrown = error;
  } finally {
    capture.spy.mockRestore();
  }
  expect(thrown, `${row.name}: the class stays fail-closed`).toBeInstanceOf(OpenElementError);
  expect((thrown as OpenElementError).code, `${row.name}: the code`).toEqual(row.code);

  const humanLine = capture.lines.find((line) => line.includes(`[${row.code}]`));
  expect(
    humanLine,
    `${row.name}: the coded line must reach the build log before the throw ` +
      `(log-before-throw, #1616); saw: ${JSON.stringify(capture.lines)}`,
  ).toBeTruthy();

  const envelopes = takeBuildDiagnostics();
  const envelope = envelopes.find((candidate) => candidate.code === row.code);
  expect(
    envelope,
    `${row.name}: the envelope must be recorded for the machine-readable exit; ` +
      `recorded: ${envelopes.map((candidate) => candidate.code).join(', ')}`,
  ).toBeTruthy();
  expect(envelope?.severity, `${row.name}: a fatal is an error`).toEqual('error');
  expect(envelope?.phase, `${row.name}: the scan is a build-phase fact`).toEqual('build');
}

// ─── §1 The scan-phase fatal class (the buildStart swallow class) ────

test('matrix · scan: an explicitly listed package that is not installed reports and fails closed', async () => {
  await expectScanFatalRow({
    name: 'scan: explicit package missing',
    code: PackageIslandErrorCode.PACKAGE_MISSING,
    drive: () => scanPackageManifests(['oe-matrix-not-installed-pkg']),
  });
});

test('matrix · scan: a listed package with no manifest export reports and fails closed', async () => {
  // @openelement/element resolves and imports but exports no manifest — the
  // root-entry fallback's verdict, distinguishable from a missing package.
  await expectScanFatalRow({
    name: 'scan: manifest absent',
    code: 'PACKAGE_MANIFEST_ERROR',
    drive: () => scanPackageManifests(['@openelement/element']),
  });
});

test('matrix · scan: a listed package with a broken manifest reports and fails closed', async () => {
  const root = await mkdtemp(join(tmpdir(), 'oe-matrix-invalid-'));
  tempRoots.push(root);
  await write(
    root,
    ['node_modules', '@acme', 'broken', 'package.json'].join('/'),
    JSON.stringify({
      name: '@acme/broken',
      version: '1.0.0',
      type: 'module',
      exports: { './manifest': './manifest.js' },
    }),
  );
  // Present but not the contract: no packageName — the invalid shape.
  await write(
    root,
    ['node_modules', '@acme', 'broken', 'manifest.js'].join('/'),
    'export const manifest = { declarations: [] };\n',
  );
  await expectScanFatalRow({
    name: 'scan: manifest invalid',
    code: 'PACKAGE_MANIFEST_ERROR',
    drive: () => scanPackageManifests(['@acme/broken'], root),
  });
});

test('matrix · scan: a manifest import that fails in transport classifies and stays fail-closed', async () => {
  // The transport class is the package-root anchor's verdict (the DERIVED
  // path's loader — the anchor every auto-admitted package is read through).
  // The loader never throws; the derivation rethrows the transport verdict
  // RAW (fail-closed), and the buildStart wrapper is the report surface that
  // carries it to the operator (pinned by the wrapper row above).
  const root = await mkdtemp(join(tmpdir(), 'oe-matrix-transport-'));
  tempRoots.push(root);
  await write(
    root,
    'app/routes/index.tsx',
    [
      "import { element, OpenElement } from '@openelement/element';",
      "import '@acme/transport/widget';",
      '',
      "@element('index-page', { root: 'shadow-open' })",
      'export default class IndexPage extends OpenElement {',
      '  render() { return <main>matrix</main>; }',
      '}',
      '',
    ].join('\n'),
  );
  const packageDir = ['node_modules', '@acme', 'transport'].join('/');
  await write(
    root,
    `${packageDir}/package.json`,
    JSON.stringify({
      name: '@acme/transport',
      version: '1.0.0',
      type: 'module',
      exports: { './widget': './src/widget.tsx', './manifest': './manifest.js' },
    }),
  );
  await write(
    root,
    `${packageDir}/src/widget.tsx`,
    [
      "import { element, OpenElement } from '@openelement/element';",
      '',
      "@element('transport-widget', { root: 'shadow-open' })",
      'export class TransportWidget extends OpenElement {',
      '  render() { return <span>t</span>; }',
      '}',
      '',
    ].join('\n'),
  );
  await write(root, `${packageDir}/manifest.js`, 'throw new Error("matrix transport probe");\n');

  // The loader's own verdict: transport, with the cause carried.
  const anchorRoot = join(root, ...packageDir.split('/'));
  const load = await loadPackageManifest('@acme/transport', { packageRoot: anchorRoot });
  expect(load.status, 'the throwing import classifies as transport').toEqual('transport');
  expect((load as { error?: unknown }).error).toBeInstanceOf(Error);

  // The derivation fails closed on it — never admits, never swallows.
  let thrown: unknown;
  try {
    await deriveAdmittedPackages({
      root,
      resolve: resolverFor(root),
      routes: ROUTES,
      routesDir: 'app/routes',
      islandsDir: 'app/islands',
      islandFiles: [],
    });
  } catch (error) {
    thrown = error;
  }
  expect(thrown, 'a transport failure fails the scan').toBeInstanceOf(Error);
  expect((thrown as Error).message, 'the cause survives the rethrow').toContain(
    'matrix transport probe',
  );
  // The wrapper's report of this subclass is envelope-shaped: the raw error
  // walks as UNKNOWN plus its cause — recorded so the exit carries it.
  const envelopes = buildFailureEnvelopes(thrown).map((envelope) => envelope.code);
  expect(envelopes, 'the raw transport error still walks into the envelope').toContain('UNKNOWN');
});

// The derived rows share the unit harness shape: a temp app with an installed
// package layout and a resolver double (the bundler's own resolution is the
// build-level proof, package-import-admission-probe.test.ts).

const ROUTES: RouteEntry[] = [
  { path: '/', filePath: 'index.tsx', type: 'page', varName: 'pageIndex' },
];

function resolverFor(root: string): ModuleWalkResolver {
  const probe = (base: string): string | undefined => {
    for (const extension of ['.tsx', '.ts', '.jsx', '.js', '']) {
      const candidate = base + extension;
      try {
        if (statSync(candidate).isFile()) return candidate;
      } catch {
        // keep probing
      }
    }
    return undefined;
  };
  return {
    resolve(specifier: string, importer?: string) {
      if (specifier.startsWith('.')) {
        if (importer === undefined) return Promise.resolve(null);
        const resolved = probe(join(dirname(importer), specifier));
        return Promise.resolve(resolved === undefined ? null : { id: resolved });
      }
      if (specifier === '@openelement/element') {
        const resolved = probe(join(REPO_ROOT, 'packages', 'element', 'src', 'index.ts'));
        return Promise.resolve(resolved === undefined ? null : { id: resolved });
      }
      const parts = specifier.split('/');
      let id = probe(join(root, 'node_modules', ...parts));
      if (id === undefined) {
        id = probe(join(root, 'node_modules', ...parts.slice(0, -1), 'src', ...parts.slice(-1)));
      }
      return Promise.resolve(id === undefined ? null : { id });
    },
  };
}

async function deriveInputRoot(manifest: object): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'oe-matrix-derived-'));
  tempRoots.push(root);
  await write(root, 'package.json', JSON.stringify({ name: 'matrix-app', private: true }));
  await write(
    root,
    'app/routes/index.tsx',
    [
      "import { element, OpenElement } from '@openelement/element';",
      "import '@acme/ui/widget';",
      '',
      "@element('index-page', { root: 'shadow-open' })",
      'export default class IndexPage extends OpenElement {',
      '  render() { return <main><acme-widget>x</acme-widget></main>; }',
      '}',
      '',
    ].join('\n'),
  );
  await write(
    root,
    ['node_modules', '@acme', 'ui', 'package.json'].join('/'),
    JSON.stringify({
      name: '@acme/ui',
      version: '1.0.0',
      type: 'module',
      exports: { './widget': './src/widget.tsx', './manifest': './manifest.js' },
    }),
  );
  await write(
    root,
    ['node_modules', '@acme', 'ui', 'src', 'widget.tsx'].join('/'),
    [
      "import { element, OpenElement } from '@openelement/element';",
      '',
      "@element('acme-widget', { root: 'shadow-open' })",
      'export class AcmeWidget extends OpenElement {',
      '  render() { return <span>acme</span>; }',
      '}',
      '',
    ].join('\n'),
  );
  await write(
    root,
    ['node_modules', '@acme', 'ui', 'manifest.js'].join('/'),
    `export const manifest = ${JSON.stringify(manifest)};\n`,
  );
  return root;
}

function deriveInput(root: string): Parameters<typeof deriveAdmittedPackages>[0] {
  return {
    root,
    resolve: resolverFor(root),
    routes: ROUTES,
    routesDir: 'app/routes',
    islandsDir: 'app/islands',
    islandFiles: [],
  };
}

test('matrix · scan: a derived owner with a broken manifest reports and fails closed', async () => {
  // Present but not the contract (no packageName) — the derivation's own
  // verdict, reported through the same seam as the explicit scan.
  const root = await deriveInputRoot({ declarations: [] });
  await expectScanFatalRow({
    name: 'scan: derived manifest invalid',
    code: 'PACKAGE_MANIFEST_ERROR',
    drive: () => deriveAdmittedPackages(deriveInput(root)),
  });
});

test('matrix · scan: two derived owners claiming one tag report the conflict and fail closed', async () => {
  const manifest = (packageName: string): OpenElementPackageManifest =>
    ({
      packageName,
      declarations: [
        {
          tagName: 'matrix-widget',
          className: 'W',
          openElement: { module: `${packageName}/widget`, ssr: true, dsd: true },
        },
      ],
    }) as unknown as OpenElementPackageManifest;
  await expectScanFatalRow({
    name: 'scan: derived tag conflict',
    code: PackageAdmissionErrorCode.TAG_CONFLICT,
    drive: () =>
      mergeAdmittedManifests({ explicit: [], derived: [manifest('@a/one'), manifest('@a/two')] }),
  });
});

const ROUTE_MODULE = `import { definePage } from '@openelement/router';
export default definePage({
  render() { return null; },
});
`;

test('matrix · scan: a buildStart scan failure is reported through the wrapper, with its cause', async () => {
  // Two route files folding to one shape: scanRoutes' own coded refusal
  // (OE_ROUTE_SCAN_EQUIVALENT_FILES), which the buildStart boundary wraps as
  // the phase-surface class. The wrapper must REPORT (the bundler swallows the
  // throw on rolldown-vite 8) and preserve the cause for the exit walk.
  const dir = await mkdtemp(join(tmpdir(), 'oe-matrix-wrapper-'));
  tempRoots.push(dir);
  const routesDir = join(dir, 'routes');
  await mkdir(routesDir, { recursive: true });
  await writeFile(join(routesDir, 'index.tsx'), ROUTE_MODULE, 'utf8');
  await writeFile(join(routesDir, 'about.tsx'), ROUTE_MODULE, 'utf8');
  await write(dir, 'routes/about/index.tsx', ROUTE_MODULE);

  const plugins = createOpenPlugin({ routesDir }) as Array<{
    name?: string;
    buildStart?: () => Promise<void>;
  }>;
  const core = plugins.find((plugin) => plugin.name === 'open:core')!;

  resetBuildExitRecords();
  const capture = captureConsoleError();
  let thrown: unknown;
  try {
    await core.buildStart!();
  } catch (error) {
    thrown = error;
  } finally {
    capture.spy.mockRestore();
  }
  expect(thrown, 'the wrapper stays fail-closed').toBeInstanceOf(OpenElementError);
  expect((thrown as OpenElementError).code).toEqual('ROUTE_SCAN_ERROR');
  expect(
    capture.lines.some((line) => line.includes('[ROUTE_SCAN_ERROR]')),
    'the wrapper reports before throwing',
  ).toBeTruthy();
  const envelopes = takeBuildDiagnostics();
  expect(envelopes.map((candidate) => candidate.code)).toContain('ROUTE_SCAN_ERROR');
  const envelope = envelopes.find((candidate) => candidate.code === 'ROUTE_SCAN_ERROR')!;
  expect(envelope.severity).toEqual('error');
  expect(envelope.phase).toEqual('build');
  // The cause survives: the producer's verdict rides the exit walk even when
  // the bundler drops the wrapper itself.
  expect((thrown as OpenElementError).cause).toBeInstanceOf(Error);
  expect(((thrown as OpenElementError).cause as Error).message).toContain('Equivalent route files');
  expect(
    buildFailureEnvelopes(thrown).map((candidate) => candidate.code),
    'the exit walk carries the producer code under the phase surface',
  ).toContain('OE_ROUTE_SCAN_EQUIVALENT_FILES');
});

// ─── §2 The SSG fatal class ──────────────────────────────────────────

/**
 * Drive `ssgRender` with a bundle fake that trips one SSG fatal class, and
 * qualify the class: the pipeline fails CLOSED with its code, and the exit
 * walker carries the code into the machine-readable report — the SSG fatals
 * already reach, and the matrix pins the mechanism per class.
 */
async function expectSsgFatalRow(row: {
  name: string;
  code: string;
  bundle: Partial<SsrBundle>;
}): Promise<void> {
  const outDir = await mkdtemp(join(tmpdir(), 'oe-matrix-ssg-'));
  tempRoots.push(outDir);
  const options: SsgRenderOptions = { root: dirname(outDir), outDir: join(outDir, 'dist') };
  let thrown: unknown;
  try {
    await ssgRender({ ...row.bundle } as SsrBundle, options, {});
  } catch (error) {
    thrown = error;
  }
  expect(thrown, `${row.name}: the pipeline fails closed`).toBeInstanceOf(Error);
  expect((thrown as { code?: string }).code, `${row.name}: the code`).toEqual(row.code);
  const codes = buildFailureEnvelopes(thrown).map((envelope) => envelope.code);
  expect(codes, `${row.name}: the exit walker carries the code`).toContain(row.code);
}

test('matrix · ssg: every dispatch-contract fatal reaches, codes, and fails the build', async () => {
  await expectSsgFatalRow({
    name: 'ssg: routeInfo missing',
    code: SsgRenderErrorCode.ROUTE_INFO_MISSING,
    bundle: { routeInfo: undefined },
  });
  await expectSsgFatalRow({
    name: 'ssg: routeInfo empty',
    code: SsgRenderErrorCode.ROUTE_INFO_EMPTY,
    bundle: { routeInfo: [] },
  });
  await expectSsgFatalRow({
    name: 'ssg: no dispatchable app',
    code: SsgRenderErrorCode.APP_MISSING,
    bundle: {
      routeInfo: [{ path: '/', tagName: 'index-page', isDynamic: false, paramNames: [] }],
      default: undefined,
    } as Partial<SsrBundle>,
  });
});

test('matrix · ssg: static non-200 routes reach, code, and write no failed page', async () => {
  const outDir = await mkdtemp(join(tmpdir(), 'oe-matrix-ssg-non200-'));
  tempRoots.push(outDir);
  const root = dirname(outDir);
  const options: SsgRenderOptions = { root, outDir: join(outDir, 'dist') };
  const app = {
    fetch: (): Promise<Response> =>
      Promise.resolve(
        new Response('<html><body>gone</body></html>', {
          status: 404,
          headers: { 'Content-Type': 'text/html; charset=UTF-8' },
        }),
      ),
  };
  let thrown: unknown;
  try {
    await ssgRender(
      {
        default: app,
        routeInfo: [
          { path: '/missing', tagName: 'missing-page', isDynamic: false, paramNames: [] },
        ],
      } as unknown as SsrBundle,
      options,
      {},
    );
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(Error);
  expect((thrown as { code?: string }).code).toEqual(SsgRenderErrorCode.STATIC_NON_200);
  expect(
    buildFailureEnvelopes(thrown).map((envelope) => envelope.code),
    'the exit walker carries the code',
  ).toContain(SsgRenderErrorCode.STATIC_NON_200);
  // Safe state: the failed page is not shipped.
  await expect(readFile(join(outDir, 'dist', 'missing.html'), 'utf8')).rejects.toThrow();
});

// ─── §3 The dev recovery class ───────────────────────────────────────

test('matrix · recovery: a style configuration reload failure keeps serving and reports by code', async () => {
  const root = await mkdtemp(join(tmpdir(), 'oe-matrix-style-recovery-'));
  tempRoots.push(root);
  await write(root, 'uno.config.ts', 'export default {};\n');
  // The engine resolves from the APPLICATION's tree — link the router dev
  // dependency's install so the session builds against the real peer.
  await mkdir(join(root, 'node_modules'), { recursive: true });
  await symlink(
    join(REPO_ROOT, 'packages', 'router', 'node_modules', 'unocss'),
    join(root, 'node_modules', 'unocss'),
  );

  const state = {
    ctx: new OpenElementBuildContext({}),
    resolvedOptions: { tailwind: undefined, unocss: true },
    classCandidates: createClassCandidateRegistry(),
  } as unknown as OpenPluginState;
  const session = createDevStyleSession(state);
  session.setRoot(root);
  const serving = await session.resolve();
  expect(serving?.provider.id, 'the session preconditions: a live unocss engine').toEqual('unocss');

  const watcher = new EventEmitter();
  (watcher as EventEmitter & { add: () => void }).add = () => {};
  // attach() only touches server.watcher — the session needs no live dev server.
  session.attach({ watcher } as unknown as ViteDevServer);

  // Break the configuration, then move the watched input: the reload fails,
  // and the handled failure is the operator's ONLY signal.
  await write(root, 'uno.config.ts', 'throw new Error("matrix broken uno config");\n');
  resetBuildExitRecords();
  const capture = captureConsoleError();
  watcher.emit('change', join(root, 'uno.config.ts'));
  try {
    await waitFor(
      () => capture.lines.some((line) => line.includes('previously loaded configuration')),
      'the recovery report naming the safe state',
    );
  } finally {
    capture.spy.mockRestore();
  }
  const report = capture.lines.find((line) => line.includes('previously loaded configuration'))!;
  expect(report, 'the recovery report names the failure per the envelope (#1612)').toContain(
    '[OE_PRESET_UNOCSS_CONFIG_UNLOADABLE]',
  );
  expect(session.current(), 'SAFE STATE: the previous integration keeps serving').toBe(serving);

  // Recovery without a restart: a fixed configuration rebuilds on the next
  // change — the failure never poisoned the session.
  await write(root, 'uno.config.ts', 'export default {};\n');
  watcher.emit('change', join(root, 'uno.config.ts'));
  await waitFor(
    () => session.current() !== undefined && session.current() !== serving,
    'the rebuilt integration',
  );
  expect(session.current()).not.toBe(serving);
});

test('matrix · recovery: a failed dev rescan keeps the last good entry and never poisons the queue', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'oe-matrix-rescan-'));
  tempRoots.push(dir);
  const routesDir = join(dir, 'routes');
  await mkdir(routesDir, { recursive: true });
  await writeFile(join(routesDir, 'index.tsx'), ROUTE_MODULE, 'utf8');

  const plugins = createOpenPlugin({ routesDir }) as Array<{
    name?: string;
    buildStart?: () => Promise<void>;
    configureServer?: (server: unknown) => Promise<void>;
    load?: (id: string) => unknown;
  }>;
  const core = plugins.find((plugin) => plugin.name === 'open:core')!;
  const virtualEntry = plugins.find((plugin) => plugin.name === 'open:virtual-entry')!;
  await core.buildStart!();

  const watcher = new EventEmitter();
  (watcher as EventEmitter & { add: () => void }).add = () => {};
  const sent: unknown[] = [];
  await core.configureServer!({
    config: { root: dir },
    watcher,
    hot: { send: (payload: unknown) => sent.push(payload) },
    moduleGraph: {
      getModuleById: (id: string) => ({ id }),
      invalidateModule: () => {},
      idToModuleMap: new Map(),
    },
    httpServer: null,
  });

  // A good edit first: the baseline the safe state is measured against.
  await write(dir, 'routes/good.tsx', ROUTE_MODULE);
  watcher.emit('add', join(routesDir, 'good.tsx'));
  await waitFor(() => sent.length === 1, 'the baseline full-reload');

  // The broken edit: two route files folding to one shape. The rescan fails,
  // and the handled failure is the operator's only signal.
  await write(dir, 'routes/good/index.tsx', ROUTE_MODULE);
  resetBuildExitRecords();
  const capture = captureConsoleError();
  watcher.emit('add', join(routesDir, 'good', 'index.tsx'));
  try {
    await waitFor(
      () => capture.lines.some((line) => line.includes('Descriptor rescan failed')),
      'the rescan recovery report',
    );
  } finally {
    capture.spy.mockRestore();
  }
  expect(
    capture.lines.find((line) => line.includes('Descriptor rescan failed')),
    'the report names the failure per the envelope (#1612)',
  ).toContain('[OE_ROUTE_SCAN_EQUIVALENT_FILES]');
  // SAFE STATE: the last good descriptor still serves, and the failed pass
  // triggered no reload.
  const entry = String(virtualEntry.load!(RESOLVED_ENTRY_ID));
  expect(entry).toContain('good.tsx');
  expect(sent, 'the failed pass reloads nothing').toEqual([
    expect.objectContaining({ type: 'full-reload' }),
  ]);

  // The queue was not poisoned: the next good edit rescans and reloads.
  await rm(join(dir, 'routes', 'good', 'index.tsx'), { force: true });
  watcher.emit('unlink', join(routesDir, 'good', 'index.tsx'));
  await waitFor(() => sent.length === 2, 'the full-reload after the fix');
});

test('matrix · recovery: the re-register pass cannot reject, so the sheet never moves on broken source', async () => {
  // The component sheet's recovery branch (dev-style-components.ts) is
  // DEFENSIVE: the collection pass skips a module it cannot read or compile by
  // design (the authoritative SSR compile is the one that reports
  // diagnostics), so the served sheet keeps its previous facts without ever
  // taking the recovery path. Pinning the invariant here keeps the safe state
  // honest: a broken source contributes nothing and rejects nothing.
  const dir = await mkdtemp(join(tmpdir(), 'oe-matrix-reregister-'));
  tempRoots.push(dir);
  await write(dir, 'broken.tsx', 'export default ((() => {');
  const candidates = createClassCandidateRegistry();
  await expect(
    collectShadowClassCandidates({
      root: dir,
      modules: [{ path: 'broken.tsx' }, { path: 'missing.tsx' }],
      candidates,
    }),
  ).resolves.toEqual(0);
  expect(candidates.all()).toEqual([]);
});

// ─── §4 The end-to-end transcript (a real build through the bundler) ──

/**
 * The swallowed-class proof, end to end: an external-layout app whose scan
 * fails at buildStart. On rolldown-vite 8 the bundler drops the thrown error —
 * before #1616 the transcript carried NO trace of it and the operator saw only
 * the downstream `OE_SSG_ROUTE_INFO_EMPTY`. The contract now: the scan fatal's
 * coded line reaches the human transcript, the machine-readable file carries
 * the scan envelope beside the SSG verdict, and the build still exits 1.
 */
test('matrix · e2e: a real build whose scan fails reports the fatal through both channels', async () => {
  const created = await mkdtemp(join(tmpdir(), 'oe-matrix-e2e-'));
  const root = await realpath(created);
  tempRoots.push(created);
  const appDir = join(root, 'app');
  await mkdir(join(appDir, 'node_modules', '@openelement'), { recursive: true });
  for (const name of ['router', 'element', 'protocol', 'compiler']) {
    await symlink(
      join(REPO_ROOT, 'packages', name),
      join(appDir, 'node_modules', '@openelement', name),
    );
  }
  await symlink(join(REPO_ROOT, 'node_modules', 'vite'), join(appDir, 'node_modules', 'vite'));
  await symlink(
    join(REPO_ROOT, 'packages', 'router', 'node_modules', 'hono'),
    join(appDir, 'node_modules', 'hono'),
  );
  await write(
    appDir,
    'package.json',
    JSON.stringify({ name: 'oe-matrix-e2e', private: true, type: 'module' }),
  );
  await write(
    appDir,
    'vite.config.ts',
    [
      "import { openElement } from '@openelement/router/vite';",
      "import { defineConfig } from 'vite';",
      '',
      'export default defineConfig({ base: "/", plugins: [openElement()] });',
      '',
    ].join('\n'),
  );
  // The authored mistake: a packageIslands entry naming an uninstalled package
  // — a scan-phase fatal raised inside buildStart, the bundler's swallow zone.
  await write(
    appDir,
    'openelement.config.ts',
    [
      "import { defineConfig } from '@openelement/router';",
      "export default defineConfig({ packageIslands: ['oe-matrix-e2e-missing-pkg'] });",
      '',
    ].join('\n'),
  );
  await write(
    appDir,
    'app/components/matrix-page.tsx',
    [
      "import { element, OpenElement } from '@openelement/element';",
      '',
      "@element('matrix-page', { root: 'shadow-open' })",
      'export default class MatrixPage extends OpenElement {',
      '  render() { return <main>matrix</main>; }',
      '}',
      '',
    ].join('\n'),
  );
  await write(
    appDir,
    'app/routes/index.tsx',
    [
      "import { definePage } from '@openelement/router';",
      "import MatrixPage from '../components/matrix-page.tsx';",
      '',
      'export default definePage(MatrixPage, { head: { title: "matrix" } });',
      '',
    ].join('\n'),
  );

  const build = spawn(
    process.execPath,
    [ROUTER_CLI, 'build', '--diagnostics-file=oe-matrix-diagnostics.json'],
    { cwd: appDir },
  );
  let transcript = '';
  build.stdout.on('data', (chunk) => (transcript += chunk));
  build.stderr.on('data', (chunk) => (transcript += chunk));
  const exitCode = await new Promise<number>((resolve) =>
    build.on('exit', (code) => resolve(code ?? -1)),
  );

  // (c) SAFE STATE: the build fails; nothing green is pretended.
  expect(exitCode, `the build must fail:\n${transcript}`).toEqual(1);
  // (a) REACH: the scan fatal's coded line is on the transcript — the line the
  // bundler's swallow would otherwise bury. Deleting any scan-fatal
  // log-before-throw turns this assertion red.
  expect(transcript, 'the wrapper report reaches the transcript').toContain('[ROUTE_SCAN_ERROR]');
  // (b) CODE: the machine channel carries the scan envelope beside the
  // downstream SSG verdict — the harness JSON.parses the FILE, never greps.
  const report = JSON.parse(
    await readFile(join(appDir, 'oe-matrix-diagnostics.json'), 'utf8'),
  ) as DiagnosticReport;
  expect(report.format).toEqual(DIAGNOSTIC_REPORT_FORMAT);
  expect(report.ok).toEqual(false);
  const codes = report.diagnostics.map((diagnostic) => diagnostic.code);
  expect(
    codes.filter((code) => code.startsWith('PACKAGE_')),
    `the scan fatal rides the machine report; codes: ${codes.join(', ')}`,
  ).not.toEqual([]);
  expect(codes, 'the downstream SSG fatal is on the same aggregate').toContain(
    SsgRenderErrorCode.ROUTE_INFO_EMPTY,
  );
}, 240_000);
