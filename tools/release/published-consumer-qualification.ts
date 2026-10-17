#!/usr/bin/env node
/**
 * Published-consumer qualification, release-gate verdicts, and post-publish
 * consumer smoke — one tool, two entry surfaces.
 *
 * 1. Qualification matrix (default): exercises the currently published
 *    support distribution from a clean temporary directory. The JSON report
 *    is deliberately portable: CI uploads it even if a platform-specific
 *    command fails, so adopters get the environment and the exact failed
 *    command rather than a truncated Actions log alone. CI enters with
 *    `node tools/release/published-consumer-qualification.ts`.
 *
 * 2. Consumer smoke (`--smoke`): post-publish npm smoke test. Creates
 *    temporary consumer projects and verifies @openelement/element can be
 *    consumed from npm on Node (core imports and the router/vite build
 *    entry). Also checks the exact-version starter, and on request the
 *    jsDelivr CDN browser-safe export and the Nitro build output.
 *
 * This module also owns the canonical release-gate verdict contract (#1216,
 * A10.8; umbrella #1155; ADR-0151). A release
 * gate is production code. Ad-hoc boolean results collapse confirmed failure
 * and infrastructure uncertainty into the same value, which is how
 * `catch { return false }` once turned a registry outage into a silently
 * passing post-publish gate (H6). The smoke's availability probes use the
 * verdict contract and fail closed: only a CONFIRMED registry 200 whose
 * payload confirms the exact version admits the release; a confirmed 404 is
 * FAIL; timeout, DNS/network failure, 5xx and malformed responses are
 * UNKNOWN — all non-PASS verdicts exit non-zero. There is no skip path:
 * infra uncertainty can never green a release.
 */

import { tmpdir } from 'node:os';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { formatError } from '@openelement/element';
import { formatJson } from '@openelement/element/build-utils';
import { PACKAGE_VERSION } from '../repo/project-constants.ts';
import { VITE_DEV_PIN } from '../repo/deps-vite-check.ts';
import { runWithOutput } from '../lib/process.ts';
import { CREATE_BIN } from './npm-manifest.ts';

// ---------------------------------------------------------------------------
// Release-gate verdict contract (#1216, A10.8)
//
// The one shared verdict vocabulary for release-critical gates under tools/:
//
// - PASS          — the gate's claim is positively confirmed by evidence.
// - FAIL          — the gate's claim is positively refuted (e.g. a confirmed
//                   registry 404, a missing release artifact, stale evidence).
// - SKIP_ALLOWED  — the gate did not run and release policy explicitly
//                   sanctions the skip (e.g. infra genuinely absent outside
//                   CI). Never produced for uncertainty; requires an
//                   affirmative policy decision.
// - UNKNOWN       — infrastructure uncertainty: timeout, DNS/network
//                   failure, 5xx, malformed or inconsistent response. NOTHING
//                   can be concluded about the gate's claim.
//
// Release admission is fail closed: only PASS admits by default; FAIL and
// UNKNOWN always block; SKIP_ALLOWED blocks unless the caller passes an
// explicit `{ allowSkip: true }` policy. There is no path from UNKNOWN to
// PASS or SKIP.
// ---------------------------------------------------------------------------

export type GateVerdict = 'PASS' | 'FAIL' | 'SKIP_ALLOWED' | 'UNKNOWN';

export interface GateDecision {
  readonly verdict: GateVerdict;
  /** Human-readable evidence or diagnostic behind the verdict. */
  readonly reason: string;
}

export function pass(reason: string): GateDecision {
  return { verdict: 'PASS', reason };
}

export function fail(reason: string): GateDecision {
  return { verdict: 'FAIL', reason };
}

export function skipAllowed(reason: string): GateDecision {
  return { verdict: 'SKIP_ALLOWED', reason };
}

export function unknown(reason: string): GateDecision {
  return { verdict: 'UNKNOWN', reason };
}

export interface ReleaseAdmissionPolicy {
  /**
   * Admit a SKIP_ALLOWED verdict. Defaults to false: a skip only ever admits
   * a release when the release policy for that gate explicitly says so.
   */
  readonly allowSkip?: boolean;
}

/**
 * Release admission, fail closed: PASS admits; SKIP_ALLOWED admits only under
 * an explicit allow-skip policy; FAIL and UNKNOWN never admit.
 */
export function admitsRelease(
  decision: GateDecision,
  policy: ReleaseAdmissionPolicy = {},
): boolean {
  switch (decision.verdict) {
    case 'PASS':
      return true;
    case 'SKIP_ALLOWED':
      return policy.allowSkip === true;
    case 'FAIL':
    case 'UNKNOWN':
      return false;
  }
}

/** Process exit code for a release gate: 0 only when the release is admitted. */
export function releaseGateExitCode(
  decision: GateDecision,
  policy: ReleaseAdmissionPolicy = {},
): 0 | 1 {
  return admitsRelease(decision, policy) ? 0 : 1;
}

// ---------------------------------------------------------------------------
// Published-consumer qualification matrix
// ---------------------------------------------------------------------------

export type QualificationMode = 'starter' | 'runtime' | 'all';

/**
 * The create npm bin the qualification executes: the packed manifest declares
 * the bins (both spellings point at the same entry), and the sorted-first
 * name keeps the choice deterministic.
 */
function createBinName(): string {
  return Object.keys(CREATE_BIN).sort()[0];
}

export interface QualificationOptions {
  mode: QualificationMode;
  reportPath: string;
  version: string;
}

interface StepReport {
  command: string[];
  cwd: string;
  durationMs: number;
  exitCode: number;
  name: string;
  stderr: string;
  stdout: string;
}

interface QualificationReport {
  environment: Record<string, string>;
  mode: QualificationMode;
  platform: { arch: string; os: string };
  startedAt: string;
  steps: StepReport[];
  version: string;
}

export function parseQualificationOptions(
  args: readonly string[],
  environment: Record<string, string | undefined> = process.env,
): QualificationOptions {
  const read = (flag: string): string | undefined => {
    const index = args.indexOf(flag);
    return index >= 0 ? args[index + 1] : undefined;
  };
  const mode = read('--mode') ?? 'all';
  if (mode !== 'starter' && mode !== 'runtime' && mode !== 'all') {
    throw new Error(`--mode must be starter, runtime, or all; received ${mode}`);
  }
  return {
    mode,
    reportPath: read('--report') ?? 'published-consumer-report.json',
    version: read('--version') || environment.OPEN_ELEMENT_PUBLISHED_VERSION || PACKAGE_VERSION,
  };
}

function tail(output: string): string {
  return output.length > 12_000 ? output.slice(-12_000) : output;
}

/**
 * The runtime-mode node-consumer manifest. `@openelement/router/vite`
 * top-level-imports vite (packages/router/src/vite/plugin-config.ts), and the
 * published router declares vite only as an OPTIONAL peer — npm never
 * auto-installs optional peers, so the verifier's dependency set must carry
 * the canonical dev pin itself (same pin the packaged-element author proof
 * installs through consumer-packaged-element.ts). This is a harness gap, not
 * a product defect: the `./vite` subpath requires vite by definition.
 */
export function nodeConsumerManifest(version: string): {
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
  private: boolean;
  type: 'module';
} {
  return {
    dependencies: Object.fromEntries(
      ['element', 'router'].map((pkg) => [`@openelement/${pkg}`, version]),
    ),
    devDependencies: { vite: VITE_DEV_PIN },
    private: true,
    type: 'module',
  };
}

async function writeReport(path: string, report: QualificationReport): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, formatJson(report));
}

async function qualificationMain(): Promise<void> {
  const options = parseQualificationOptions(process.argv.slice(2));
  const report: QualificationReport = {
    environment: Object.fromEntries(
      ['CI', 'GITHUB_ACTIONS', 'GITHUB_RUN_ID', 'RUNNER_ARCH', 'RUNNER_OS'].flatMap((key) =>
        process.env[key] === undefined ? [] : [[key, process.env[key]!]],
      ),
    ),
    mode: options.mode,
    platform: { arch: process.arch, os: process.platform },
    startedAt: new Date().toISOString(),
    steps: [],
    version: options.version,
  };
  const root = await mkdtemp(join(tmpdir(), 'openelement-published-consumer-'));

  const runStep = async (name: string, command: string, args: string[], cwd: string) => {
    const started = performance.now();
    const result = await runWithOutput(command, args, { cwd });
    const step: StepReport = {
      command: [command, ...args],
      cwd,
      durationMs: Math.round(performance.now() - started),
      exitCode: result.code,
      name,
      stderr: tail(result.stderr),
      stdout: tail(result.stdout),
    };
    report.steps.push(step);
    console.log(`[published-consumer] ${name}: exit ${result.code} (${step.durationMs}ms)`);
    if (!result.success) {
      throw new Error(`${name} failed (exit ${result.code})\n${step.stderr || step.stdout}`);
    }
  };

  try {
    if (options.mode === 'starter' || options.mode === 'all') {
      // The create package declares its npm bins in the packed manifest
      // (npm-manifest.ts CREATE_BIN); the qualification installs the published
      // package into the scratch root and runs the CLI through its real bin —
      // `npm exec <bin>` resolves the local node_modules/.bin shim (which is
      // why the install shares the exec cwd), never the entry file directly
      // (same contract consumer-packaged-starter exercises).
      await writeFile(
        join(root, 'package.json'),
        JSON.stringify({ private: true, type: 'module' }, null, 2),
      );
      await runStep(
        'install the published create CLI',
        'npm',
        [
          'install',
          '--ignore-scripts',
          '--no-audit',
          '--no-fund',
          `@openelement/create@${options.version}`,
        ],
        root,
      );
      await runStep(
        'generate exact-version starter',
        'npm',
        ['exec', createBinName(), '--', 'starter'],
        root,
      );
      const starter = join(root, 'starter');
      const manifest = JSON.parse(await readFile(join(starter, 'package.json'), 'utf8')) as {
        dependencies: Record<string, string>;
        devDependencies: Record<string, string>;
      };
      for (const pkg of ['router', 'element']) {
        const actual = manifest.dependencies[`@openelement/${pkg}`];
        // The scaffold rides the 1.0 line with a caret range (owner ruling
        // 2026-10-09), so the generated specifier names the published version
        // as its lower bound rather than an exact pin.
        const expected = `^${options.version}`;
        if (actual !== expected) {
          throw new Error(
            `starter dependency @openelement/${pkg}=${actual}, expected the published ${expected}`,
          );
        }
      }
      // The published starter is the package-manager-neutral form (alpha15+):
      // it pins `vite` itself at the router's own version and ships no
      // pnpm-only specifier or workspace file. Asserted BEFORE the install so
      // a scaffold that regressed to the retired Vite+ catalog form fails the
      // gate with the precise cause instead of dying inside pnpm's resolver.
      await assertStarterIsPackageManagerNeutral(starter, 'Published starter');
      await runStep('install starter dependencies', 'pnpm', ['install'], starter);
      for (const task of ['typecheck', 'test', 'build']) {
        await runStep(`starter ${task}`, 'pnpm', ['run', task], starter);
      }
    }

    if (options.mode === 'runtime' || options.mode === 'all') {
      const nodeConsumer = join(root, 'node-consumer');
      await mkdir(nodeConsumer);
      await writeFile(
        join(nodeConsumer, 'package.json'),
        JSON.stringify(nodeConsumerManifest(options.version), null, 2),
      );
      await writeFile(join(nodeConsumer, 'smoke.mjs'), NODE_RUNTIME_SMOKE_SOURCE);
      await writeFile(join(nodeConsumer, 'vite-entry.mjs'), VITE_SMOKE_SOURCE);
      await runStep(
        'install Node ESM public runtime dependencies',
        'npm',
        ['install', '--ignore-scripts', '--no-audit', '--no-fund'],
        nodeConsumer,
      );
      await runStep('Node ESM public runtime execution', 'node', ['smoke.mjs'], nodeConsumer);
      await runStep(
        'Node ESM router/vite entry execution',
        'node',
        ['vite-entry.mjs'],
        nodeConsumer,
      );
    }
  } finally {
    await writeReport(options.reportPath, report);
    await rm(root, { recursive: true }).catch(() => undefined);
  }

  console.log(`[published-consumer] ${options.mode} qualification passed for ${options.version}`);
}

// ---------------------------------------------------------------------------
// Scaffold package-manager-neutrality guard (alpha15+)
// ---------------------------------------------------------------------------
//
// The published starter's install runs in the scaffold's own directory, so the
// harness must know what the shipped form is before it runs anything. The
// Vite+ catalog form is RETIRED: the scaffold now pins `vite` itself (at the
// router's own version), declares no `packageManager`, carries no pnpm-only
// `catalog:`/`vite-plus` specifier, and ships NO pnpm-workspace.yaml. A
// create-side regression that reintroduces any of those would make the
// generated project installable only under pnpm — the defect the alpha15
// neutral-scaffold change fixed — and a harness step that still expected the
// retired file would fail with pnpm's ERR_PNPM_CATALOG_ENTRY_NOT_FOUND_FOR_SPEC
// instead of naming the real cause.

/**
 * Assert a scaffolded starter's package.json is the package-manager-neutral
 * form. Pure (text in, verdict out) so both entry surfaces — the qualification
 * matrix and the exact-version smoke — funnel their scaffold reads through one
 * check, and the tests can drive it directly.
 */
export function assertPackageManagerNeutralManifest(manifestText: string, context: string): void {
  let manifest: { packageManager?: string; devDependencies?: Record<string, string> };
  try {
    manifest = JSON.parse(manifestText) as typeof manifest;
  } catch {
    throw new Error(`${context} package.json is unparseable`);
  }
  const devDependencies = manifest.devDependencies ?? {};
  // The scaffold's vite is its own devDependency now (no catalog owns it), and
  // it must be the version the router itself resolves: the generated project
  // builds through the router's Vite plugin, so a drift or a range is a second
  // vite tree in the consumer.
  if (devDependencies.vite !== VITE_DEV_PIN) {
    throw new Error(
      `${context} is not the package-manager-neutral form: devDependency vite=` +
        `${devDependencies.vite ?? '<missing>'}, expected the router's own pin ${VITE_DEV_PIN}`,
    );
  }
  if (devDependencies['vite-plus'] !== undefined) {
    throw new Error(
      `${context} still declares the retired Vite+ dependency: vite-plus=` +
        `${devDependencies['vite-plus']} (the Vite+ catalog form is retired)`,
    );
  }
  if (manifest.packageManager !== undefined) {
    throw new Error(
      `${context} pins a package manager (packageManager=${manifest.packageManager}); the ` +
        'neutral scaffold declares none so the first install decides',
    );
  }
  if (manifestText.includes('catalog:')) {
    throw new Error(
      `${context} carries a pnpm-only \`catalog:\` specifier; the neutral scaffold resolves ` +
        'through ordinary registry specifiers',
    );
  }
}

/**
 * Verify the scaffold ships NO pnpm-specific workspace file, in the directory
 * where the install below runs. The Vite+ form shipped one (the catalog that
 * resolved `vite-plus: "catalog:"`); the neutral scaffold ships none, and the
 * packed-consumer harnesses write their own overrides carrier into their
 * scratch trees instead (owner decision, alpha15 option B). A file here is the
 * create-side regression this guard exists to catch, named before pnpm's
 * resolver can report it as something else. The read is itself the existence
 * check (read-and-expect-ENOENT, no shape probe before it).
 */
export async function assertStarterShipsNoWorkspaceFile(
  starterDir: string,
  context: string,
): Promise<void> {
  let shipped: string | null = null;
  try {
    shipped = await readFile(join(starterDir, 'pnpm-workspace.yaml'), 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT') throw error;
  }
  if (shipped !== null) {
    throw new Error(
      `${context} ships a pnpm-workspace.yaml; the package-manager-neutral scaffold must ` +
        `carry no pnpm-specific file (the Vite+ catalog form is retired):\n${shipped.slice(0, 200)}`,
    );
  }
}

/**
 * The whole neutrality contract for one scaffolded starter directory: manifest
 * form plus the absence of a shipped workspace file. Both entry surfaces call
 * this single function, so the matrix and the smoke can never disagree about
 * what the shipped form is.
 */
export async function assertStarterIsPackageManagerNeutral(
  starterDir: string,
  context: string,
): Promise<void> {
  let manifestText: string;
  try {
    manifestText = await readFile(join(starterDir, 'package.json'), 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') {
      throw new Error(`${context} has no package.json at ${starterDir}`);
    }
    throw error;
  }
  assertPackageManagerNeutralManifest(manifestText, context);
  await assertStarterShipsNoWorkspaceFile(starterDir, context);
}

// ---------------------------------------------------------------------------
// Post-publish consumer smoke (--smoke)
// ---------------------------------------------------------------------------

export interface ConsumerSmokeOptions {
  local: boolean;
  version: string;
  versionProvided: boolean;
  runJsDelivr: boolean;
  runNitro: boolean;
}

export function parseConsumerSmokeOptions(
  args: readonly string[],
  packageVersion: string = PACKAGE_VERSION,
): ConsumerSmokeOptions {
  const local = args.includes('--local');
  const versionIndex = args.indexOf('--version');
  const versionArg =
    versionIndex !== -1 && versionIndex + 1 < args.length ? args[versionIndex + 1] : null;
  // An empty --version (e.g. an unset workflow input) falls back to the
  // workspace version instead of counting as an explicit npm version.
  const version = versionArg || packageVersion;
  const versionProvided = versionArg !== null && versionArg !== '';
  return {
    local,
    version,
    versionProvided,
    runJsDelivr: args.includes('--jsdelivr') || (versionProvided && !local),
    runNitro: args.includes('--nitro') || (versionProvided && !local),
  };
}

async function readJson<T = unknown>(path: string | URL): Promise<T> {
  return JSON.parse(await readFile(path, 'utf8')) as T;
}

// Post-publish smoke surfaces. NODE_RUNTIME_SMOKE_SOURCE covers the plain-Node
// framework core; VITE_SMOKE_SOURCE proves the `@openelement/router/vite`
// build entry imports on the same node host (the packed consumers' build
// cells drive it in-process, this smoke proves the bare-import path).
export const NODE_RUNTIME_SMOKE_SOURCE = [
  "import { HYDRATION_STRATEGIES, OpenElement, renderToString, signal } from '@openelement/element';",
  "import { defineIslandConfig, definePage } from '@openelement/router';",
  'for (const value of [OpenElement, renderToString, signal, defineIslandConfig, definePage]) {',
  "  if (typeof value !== 'function') throw new Error('expected published public function');",
  '}',
  "if (!Array.isArray(HYDRATION_STRATEGIES)) throw new Error('expected hydration strategy list');",
  "console.log('published public runtime imports passed');",
].join('\n');

export const VITE_SMOKE_SOURCE = [
  "import { openPipeline } from '@openelement/router/vite';",
  "if (typeof openPipeline !== 'function') throw new Error('expected published public function');",
].join('\n');

function normalizeSlashes(path: string): string {
  return path.replace(/\\/g, '/');
}

async function run(
  cmd: string,
  args: string[],
  cwd?: string,
): Promise<{ success: boolean; output: string }> {
  const result = await runWithOutput(cmd, args, { cwd });
  return {
    success: result.success,
    output: (result.stdout + result.stderr).slice(0, 2000),
  };
}

const nodeSource = `
import {
  computed,
  escapeAttr,
  escapeHtml,
  HYDRATION_STRATEGIES,
  isValidTagName,
  OpenElement,
  signal,
} from '@openelement/element';

const count = signal(0);
const doubled = computed(() => count.value * 2);
count.value = 21;

console.log('doubled:', doubled.value);
console.log('escapeHtml:', escapeHtml('<b>&"\\'"/></b>'));
console.log('escapeAttr:', escapeAttr('a"b'));
console.log('isValidTagName:', isValidTagName('my-counter'), isValidTagName('invalid'));
console.log('hydration strategies:', HYDRATION_STRATEGIES.join(','));
console.log('OpenElement is a class:', typeof OpenElement === 'function');
if (doubled.value !== 42) throw new Error('signal reactivity broken');
console.log('Smoke test passed!');
`.trim();

async function nodeEsmSmoke(version: string, projectRoot: string, local: boolean): Promise<void> {
  const tmpDir = await mkdtemp(join(tmpdir(), 'openelement-smoke-node-'));
  console.log(`\n[Node ESM consumer] ${tmpDir}`);

  try {
    if (local) {
      // The release toolchain packs the workspace (one pack produces every
      // retained tarball next to the package sources).
      console.log('  pnpm --dir tools/release run pack:dry-run');
      const pack = await run(
        'pnpm',
        ['--dir', 'tools/release', 'run', 'pack:dry-run'],
        projectRoot,
      );
      if (!pack.success) {
        console.error(`  pack failed:\n${pack.output}`);
        process.exit(1);
      }
    }

    const dep = local ? 'file:./openelement-element.tgz' : `^${version}`;
    const localDeps = local
      ? {
          '@openelement/element': 'file:./openelement-element.tgz',
          '@preact/signals-core': '^1.12.1',
        }
      : { '@openelement/element': dep };

    await writeFile(
      `${tmpDir}/package.json`,
      JSON.stringify({ type: 'module', dependencies: localDeps }, null, 2),
    );
    if (local) {
      // The pack:dry-run artifact lands next to the package sources; the
      // consumer's file: dep expects it beside the generated package.json.
      const artifact = join(
        projectRoot,
        'packages',
        'element',
        `openelement-element-${version}.tgz`,
      );
      await copyFile(artifact, `${tmpDir}/openelement-element.tgz`);
    }
    await writeFile(`${tmpDir}/smoke.mjs`, nodeSource);

    console.log('  npm install');
    const install = await run('npm', ['install'], tmpDir);
    if (!install.success) {
      console.error(`  install failed:\n${install.output}`);
      process.exit(1);
    }

    console.log('  node smoke.mjs');
    const exec = await run('node', ['smoke.mjs'], tmpDir);
    if (!exec.success) {
      console.error(`  run failed:\n${exec.output}`);
      process.exit(1);
    }
    console.log(`  ok: ${exec.output.trim().split('\n').slice(-1)[0]}`);
  } finally {
    try {
      await rm(tmpDir, { recursive: true });
    } catch {
      /* ok */
    }
  }
}

async function exactVersionStarterSmoke(version: string): Promise<void> {
  const tmpDir = await mkdtemp(join(tmpdir(), 'openelement-smoke-starter-'));
  console.log(`\n[Exact-version starter] ${tmpDir}`);
  try {
    // The create package ships real npm bins (npm-manifest.ts CREATE_BIN);
    // the smoke installs it into the smoke root and runs the CLI through its
    // bin via npm exec — the documented consumer surface — not by reaching
    // into node_modules for the entry file. The install shares the exec cwd
    // so npm exec resolves the local node_modules/.bin shim.
    await writeFile(
      join(tmpDir, 'package.json'),
      JSON.stringify({ private: true, type: 'module' }, null, 2),
    );
    const install = await run(
      'npm',
      ['install', '--ignore-scripts', '--no-audit', '--no-fund', `@openelement/create@${version}`],
      tmpDir,
    );
    if (!install.success) throw new Error(`create install failed:\n${install.output}`);
    const create = await run('npm', ['exec', createBinName(), '--', 'starter'], tmpDir);
    if (!create.success) throw new Error(`starter generation failed:\n${create.output}`);
    const manifest = (await readJson(`${tmpDir}/starter/package.json`)) as {
      dependencies: Record<string, string>;
      devDependencies: Record<string, string>;
    };
    for (const pkg of ['router', 'element']) {
      // Caret range over the published version (owner ruling 2026-10-09):
      // the starter floats on the 1.0 line rather than pinning it exactly.
      const expected = `^${version}`;
      const actual = manifest.dependencies[`@openelement/${pkg}`];
      if (actual !== expected) {
        throw new Error(`starter dependency @openelement/${pkg}=${actual}, expected=${expected}`);
      }
    }
    // The package-manager-neutral form (alpha15+): the manifest pins `vite`
    // itself at the router's own version and carries no pnpm-only specifier,
    // and the scaffold ships no workspace file — a scaffold that regressed to
    // the retired Vite+ catalog form is named here, before the install.
    await assertStarterIsPackageManagerNeutral(`${tmpDir}/starter`, 'Exact-version starter');
    await run('pnpm', ['install'], `${tmpDir}/starter`);
    const typecheck = await run('pnpm', ['run', 'typecheck'], `${tmpDir}/starter`);
    if (!typecheck.success) throw new Error(`starter typecheck failed:\n${typecheck.output}`);
    console.log('  ok: generated package graph and typecheck use the released version');
  } finally {
    await rm(tmpDir, { recursive: true }).catch(() => undefined);
  }
}

/** Injectable HTTP probe shape: status code plus raw body text. */
export interface RegistryFetchResponse {
  status: number;
  body: string;
}

export type RegistryFetcher = (url: string) => Promise<RegistryFetchResponse>;

const PROBE_TIMEOUT_MS = 15_000;

/** Real network probe; the only IO behind the availability decisions. */
async function httpProbe(url: string): Promise<RegistryFetchResponse> {
  const response = await fetch(url, { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
  return { status: response.status, body: await response.text() };
}

/**
 * Classify a registry `GET /{name}/{version}` response. PASS requires a 200
 * whose JSON payload confirms the exact requested version; a 404 is confirmed
 * absence (FAIL); every other status, a malformed body, or a payload that
 * does not confirm the version is UNKNOWN — infra uncertainty, fail closed.
 */
export function classifyRegistryResponse(
  name: string,
  version: string,
  status: number,
  body: string,
): GateDecision {
  if (status === 404) {
    return fail(`confirmed absence: ${name}@${version} is not published on npm (registry 404)`);
  }
  if (status !== 200) {
    return unknown(
      `registry returned HTTP ${status} for ${name}@${version}; availability cannot be confirmed`,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(body) as unknown;
  } catch {
    return unknown(`malformed registry response for ${name}@${version}; not valid JSON`);
  }
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    Array.isArray(parsed) ||
    (parsed as { version?: unknown }).version !== version
  ) {
    return unknown(`registry response for ${name}@${version} does not confirm version ${version}`);
  }
  return pass(`${name}@${version} confirmed on npm (registry 200, version payload match)`);
}

/**
 * npm availability verdict for the release gate. Network exceptions
 * (DNS failure, timeout, reset) are UNKNOWN, never "absent".
 */
export async function npmAvailabilityDecision(
  name: string,
  version: string,
  fetcher: RegistryFetcher = httpProbe,
): Promise<GateDecision> {
  const url = `https://registry.npmjs.org/${name}/${version}`;
  let response: RegistryFetchResponse;
  try {
    response = await fetcher(url);
  } catch (error) {
    return unknown(`registry probe for ${name}@${version} failed: ${formatError(error)}`);
  }
  return classifyRegistryResponse(name, version, response.status, response.body);
}

/**
 * Classify a jsDelivr CDN response for the browser-safe export. PASS requires
 * a 200 with a non-empty body; a 404 means the CDN artifact for a published
 * package is missing (FAIL); anything else is UNKNOWN.
 */
export function classifyCdnResponse(version: string, status: number, body: string): GateDecision {
  if (status === 404) {
    return fail(`CDN artifact missing: jsDelivr 404 for @openelement/element@${version}/+esm`);
  }
  if (status !== 200) {
    return unknown(
      `jsDelivr returned HTTP ${status} for @openelement/element@${version}; CDN availability cannot be confirmed`,
    );
  }
  if (body.trim().length === 0) {
    return fail(
      `jsDelivr returned an empty browser-safe export for @openelement/element@${version}`,
    );
  }
  return pass(`jsDelivr browser-safe export confirmed for @openelement/element@${version}`);
}

/** jsDelivr CDN availability verdict for the release gate. */
export async function cdnAvailabilityDecision(
  version: string,
  fetcher: RegistryFetcher = httpProbe,
): Promise<GateDecision> {
  const url = `https://cdn.jsdelivr.net/npm/@openelement/element@${version}/+esm`;
  let response: RegistryFetchResponse;
  try {
    response = await fetcher(url);
  } catch (error) {
    return unknown(
      `jsDelivr probe for @openelement/element@${version} failed: ${formatError(error)}`,
    );
  }
  return classifyCdnResponse(version, response.status, response.body);
}

async function jsdelivrSmoke(version: string): Promise<void> {
  console.log(`\n[jsDelivr CDN browser-safe export] @openelement/element@${version}/+esm`);
  const decision = await cdnAvailabilityDecision(version);
  if (!admitsRelease(decision)) {
    console.error(`  ${decision.verdict}: ${decision.reason}`);
    process.exit(1);
  }
  console.log(`  ok: ${decision.reason}`);
}

async function nitroSmoke(): Promise<void> {
  console.log('\n[Nitro output smoke]');

  for (const target of ['node', 'workers']) {
    console.log(`  pnpm --dir tests/fixtures/router-nitro run proof:${target}`);
    const result = await runWithOutput('pnpm', [
      '--dir',
      'tests/fixtures/router-nitro',
      'run',
      `proof:${target}`,
    ]);
    const output = result.stdout + result.stderr;
    if (!result.success) {
      console.error(`  ${target} failed:\n${output.slice(0, 2000)}`);
      process.exit(1);
    }
    if (!output.includes(`nitro proof ${target}:`)) {
      console.error(`  ${target} missing success marker`);
      process.exit(1);
    }
    const lastLine = output.trim().split('\n').slice(-1)[0];
    console.log(`  ok: ${lastLine}`);
  }
}

async function consumerSmokeMain(args: readonly string[]): Promise<void> {
  const options = parseConsumerSmokeOptions(args);
  const projectRoot = normalizeSlashes(process.cwd());

  console.log('Consumer npm smoke test');
  console.log(
    `  mode: ${options.local ? 'local workspace' : `npm @openelement/element@${options.version}`}`,
  );
  if (options.runJsDelivr) console.log('  + jsDelivr CDN smoke');
  if (options.runNitro) console.log('  + Nitro output smoke');

  if (!options.local) {
    // Release gate, fail closed (#1216): only a confirmed registry 200 with a
    // matching version payload admits the smoke. A confirmed 404 is FAIL;
    // timeout/DNS/5xx/malformed responses are UNKNOWN. Both exit non-zero —
    // infra uncertainty can no longer skip this gate green.
    const availability = await npmAvailabilityDecision('@openelement/element', options.version);
    if (!admitsRelease(availability)) {
      console.error(`\nnpm availability gate: ${availability.verdict}: ${availability.reason}`);
      console.error('Use --local to smoke against workspace sources instead.');
      process.exit(1);
    }
    console.log(`  npm availability: ${availability.reason}`);
  }

  await nodeEsmSmoke(options.version, projectRoot, options.local);
  if (!options.local) await exactVersionStarterSmoke(options.version);

  if (options.runJsDelivr) {
    await jsdelivrSmoke(options.version);
  }

  if (options.runNitro) {
    await nitroSmoke();
  }

  console.log('\nAll smoke tests passed');
}

async function main(): Promise<void> {
  if (process.argv.slice(2).includes('--smoke')) {
    await consumerSmokeMain(process.argv.slice(2));
    return;
  }
  await qualificationMain();
}

if (import.meta.main) await main();
