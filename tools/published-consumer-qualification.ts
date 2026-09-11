#!/usr/bin/env -S deno run --allow-read --allow-write --allow-run --allow-env --allow-net
/**
 * Published-consumer qualification, release-gate verdicts, and post-publish
 * consumer smoke — one tool, two entry surfaces.
 *
 * 1. Qualification matrix (default): exercises the currently published
 *    support distribution from a clean temporary directory. The JSON report
 *    is deliberately portable: CI uploads it even if a platform-specific
 *    command fails, so adopters get the environment and the exact failed
 *    command rather than a truncated Actions log alone.
 *
 *      deno run -A tools/published-consumer-qualification.ts \
 *        [--mode starter|runtime|all] [--report <path>] [--version <x.y.z>]
 *
 * 2. Consumer smoke (`--smoke`): post-publish npm smoke test. Creates
 *    temporary consumer projects and verifies @openelement/element can be
 *    consumed from npm in Deno and Node. Also checks the exact-version
 *    starter, and on request the jsDelivr CDN browser-safe export and the
 *    Nitro build output.
 *
 *      deno run -A tools/published-consumer-qualification.ts --smoke
 *      deno run -A tools/published-consumer-qualification.ts --smoke --local
 *      deno run -A tools/published-consumer-qualification.ts --smoke --version <x.y.z>
 *      deno run -A tools/published-consumer-qualification.ts --smoke --version <x.y.z> --jsdelivr --nitro
 *
 * This module also owns the canonical release-gate verdict contract (#1216,
 * A10.8; umbrella #1155; ADR-0151), formerly tools/gate-verdict.ts. A release
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

import { dirname, join } from '@std/path';
import { formatError } from '@openelement/element';
import { formatJson } from '@openelement/element/build-utils';
import { PACKAGE_VERSION } from './project-constants.ts';
import { runWithOutput } from './lib/process.ts';

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
  platform: { arch: string; deno: string; os: string };
  startedAt: string;
  steps: StepReport[];
  version: string;
}

export function parseQualificationOptions(
  args: readonly string[],
  environment: Record<string, string | undefined> = Deno.env.toObject(),
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

async function writeReport(path: string, report: QualificationReport): Promise<void> {
  await Deno.mkdir(dirname(path), { recursive: true });
  await Deno.writeTextFile(path, formatJson(report));
}

async function qualificationMain(): Promise<void> {
  const options = parseQualificationOptions(Deno.args);
  const report: QualificationReport = {
    environment: Object.fromEntries(
      ['CI', 'GITHUB_ACTIONS', 'GITHUB_RUN_ID', 'RUNNER_ARCH', 'RUNNER_OS'].flatMap((key) =>
        Deno.env.get(key) === undefined ? [] : [[key, Deno.env.get(key)!]]
      ),
    ),
    mode: options.mode,
    platform: { arch: Deno.build.arch, deno: Deno.version.deno, os: Deno.build.os },
    startedAt: new Date().toISOString(),
    steps: [],
    version: options.version,
  };
  const root = await Deno.makeTempDir({ prefix: 'openelement-published-consumer-' });

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
      await runStep(
        'generate exact-version starter',
        Deno.execPath(),
        [
          'run',
          '-A',
          '--minimum-dependency-age',
          '0',
          `npm:@openelement/create@${options.version}`,
          'starter',
        ],
        root,
      );
      const starter = join(root, 'starter');
      for (const task of ['check', 'test', 'build']) {
        await runStep(`starter deno task ${task}`, Deno.execPath(), ['task', task], starter);
      }
    }

    if (options.mode === 'runtime' || options.mode === 'all') {
      const denoConsumer = join(root, 'deno-consumer');
      await Deno.mkdir(denoConsumer);
      await Deno.writeTextFile(
        join(denoConsumer, 'deno.json'),
        JSON.stringify(
          {
            imports: Object.fromEntries(
              ['element', 'app', 'adapter-vite'].map((
                pkg,
              ) => [`@openelement/${pkg}`, `npm:@openelement/${pkg}@${options.version}`]),
            ),
            minimumDependencyAge: 0,
          },
          null,
          2,
        ),
      );
      const publicSurfaceSource = [
        "import { HYDRATION_STRATEGIES, OpenElement, renderDsd, signal } from '@openelement/element';",
        "import { defineApp, defineIslandConfig, definePage } from '@openelement/router';",
        "import { openPipeline } from '@openelement/adapter-vite';",
        'for (const value of [OpenElement, renderDsd, signal, defineApp, defineIslandConfig, definePage, openPipeline]) {',
        "  if (typeof value !== 'function') throw new Error('expected published public function');",
        '}',
        "if (!Array.isArray(HYDRATION_STRATEGIES)) throw new Error('expected hydration strategy list');",
        "console.log('published public runtime imports passed');",
      ].join('\n');
      const denoRuntimeSource = [
        "import { OpenElement, signal } from '@openelement/element';",
        "import { defineApp, defineIslandConfig, definePage } from '@openelement/router';",
        'for (const value of [OpenElement, signal, defineApp, defineIslandConfig, definePage]) {',
        "  if (typeof value !== 'function') throw new Error('expected published public function');",
        '}',
        "console.log('published Deno runtime imports passed');",
      ].join('\n');
      await Deno.writeTextFile(join(denoConsumer, 'smoke.ts'), publicSurfaceSource);
      await Deno.writeTextFile(join(denoConsumer, 'runtime.ts'), denoRuntimeSource);
      await runStep(
        'Deno public runtime check',
        Deno.execPath(),
        ['check', 'smoke.ts'],
        denoConsumer,
      );
      await runStep(
        'Deno public runtime execution',
        Deno.execPath(),
        ['run', '--allow-env', 'runtime.ts'],
        denoConsumer,
      );

      const nodeConsumer = join(root, 'node-consumer');
      await Deno.mkdir(nodeConsumer);
      await Deno.writeTextFile(
        join(nodeConsumer, 'package.json'),
        JSON.stringify(
          {
            dependencies: Object.fromEntries(
              ['element', 'app', 'adapter-vite'].map((
                pkg,
              ) => [`@openelement/${pkg}`, options.version]),
            ),
            private: true,
            type: 'module',
          },
          null,
          2,
        ),
      );
      await Deno.writeTextFile(join(nodeConsumer, 'smoke.mjs'), publicSurfaceSource);
      await runStep(
        'install Node ESM public runtime dependencies',
        'npm',
        ['install', '--ignore-scripts', '--no-audit', '--no-fund'],
        nodeConsumer,
      );
      await runStep('Node ESM public runtime execution', 'node', ['smoke.mjs'], nodeConsumer);
    }
  } finally {
    await writeReport(options.reportPath, report);
    await Deno.remove(root, { recursive: true }).catch(() => undefined);
  }

  console.log(`[published-consumer] ${options.mode} qualification passed for ${options.version}`);
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
  const versionArg = versionIndex !== -1 && versionIndex + 1 < args.length
    ? args[versionIndex + 1]
    : null;
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
  return JSON.parse(await Deno.readTextFile(path)) as T;
}

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

const denoSource = `
import {
  computed,
  escapeAttr,
  escapeHtml,
  HYDRATION_STRATEGIES,
  isValidTagName,
  OpenElement,
  signal,
} from '@openelement/element';

// The 0.44 public surface: signal reactivity, HTML escaping, tag-name
// predicates, the hydration strategy list, and the compiled OpenElement base
// class (class reference only — instantiating it needs a DOM).
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

async function denoNpmSmoke(version: string, projectRoot: string, local: boolean): Promise<void> {
  const tmpDir = local
    ? await Deno.makeTempDir({ dir: projectRoot, prefix: '.openelement-smoke-deno-' })
    : await Deno.makeTempDir({ prefix: 'openelement-smoke-deno-' });
  console.log(`\n[Deno npm consumer] ${tmpDir}`);

  try {
    await Deno.writeTextFile(`${tmpDir}/smoke.ts`, denoSource);

    if (local) {
      // Run from the workspace root so workspace packages resolve.
      // Sloppy imports are required because core sources use .js extension imports.
      console.log('  deno check smoke.ts (workspace source)');
      const check = await run(
        'deno',
        ['check', '--unstable-sloppy-imports', `${tmpDir}/smoke.ts`],
        projectRoot,
      );
      if (!check.success) {
        console.error(`  check failed:\n${check.output}`);
        Deno.exit(1);
      }

      console.log('  deno run smoke.ts (workspace source)');
      const exec = await run(
        'deno',
        ['run', '--unstable-sloppy-imports', `${tmpDir}/smoke.ts`],
        projectRoot,
      );
      if (!exec.success) {
        console.error(`  run failed:\n${exec.output}`);
        Deno.exit(1);
      }
      console.log(`  ok: ${exec.output.trim().split('\n').slice(-1)[0]}`);
      return;
    }

    await Deno.writeTextFile(
      `${tmpDir}/deno.json`,
      JSON.stringify(
        { imports: { '@openelement/element': `npm:@openelement/element@^${version}` } },
        null,
        2,
      ),
    );

    console.log('  deno check smoke.ts');
    const check = await run('deno', ['check', '--minimum-dependency-age', '0', 'smoke.ts'], tmpDir);
    if (!check.success) {
      console.error(`  check failed:\n${check.output}`);
      Deno.exit(1);
    }

    console.log('  deno run smoke.ts');
    const exec = await run('deno', ['run', '--minimum-dependency-age', '0', 'smoke.ts'], tmpDir);
    if (!exec.success) {
      console.error(`  run failed:\n${exec.output}`);
      Deno.exit(1);
    }
    console.log(`  ok: ${exec.output.trim().split('\n').slice(-1)[0]}`);
  } finally {
    try {
      await Deno.remove(tmpDir, { recursive: true });
    } catch { /* ok */ }
  }
}

async function nodeEsmSmoke(version: string, projectRoot: string, local: boolean): Promise<void> {
  const tmpDir = await Deno.makeTempDir({ prefix: 'openelement-smoke-node-' });
  console.log(`\n[Node ESM consumer] ${tmpDir}`);

  try {
    if (local) {
      const workspacePackages = ['element'];
      for (const pkg of workspacePackages) {
        console.log(`  deno pack packages/${pkg}`);
        const pack = await run(
          'deno',
          ['pack', '--allow-dirty', '-o', `${tmpDir}/openelement-${pkg}.tgz`],
          `${projectRoot}/packages/${pkg}`,
        );
        if (!pack.success) {
          console.error(`  pack failed:\n${pack.output}`);
          Deno.exit(1);
        }
      }
    }

    const dep = local ? 'file:./openelement-element.tgz' : `^${version}`;
    const localDeps = local
      ? {
        '@openelement/element': 'file:./openelement-element.tgz',
        '@preact/signals-core': '^1.12.1',
      }
      : { '@openelement/element': dep };

    await Deno.writeTextFile(
      `${tmpDir}/package.json`,
      JSON.stringify({ type: 'module', dependencies: localDeps }, null, 2),
    );
    await Deno.writeTextFile(`${tmpDir}/smoke.mjs`, nodeSource);

    console.log('  npm install');
    const install = await run('npm', ['install'], tmpDir);
    if (!install.success) {
      console.error(`  install failed:\n${install.output}`);
      Deno.exit(1);
    }

    console.log('  node smoke.mjs');
    const exec = await run('node', ['smoke.mjs'], tmpDir);
    if (!exec.success) {
      console.error(`  run failed:\n${exec.output}`);
      Deno.exit(1);
    }
    console.log(`  ok: ${exec.output.trim().split('\n').slice(-1)[0]}`);
  } finally {
    try {
      await Deno.remove(tmpDir, { recursive: true });
    } catch { /* ok */ }
  }
}

async function exactVersionStarterSmoke(version: string): Promise<void> {
  const tmpDir = await Deno.makeTempDir({ prefix: 'openelement-smoke-starter-' });
  console.log(`\n[Exact-version starter] ${tmpDir}`);
  try {
    const create = await run(
      'deno',
      [
        'run',
        '-A',
        '--minimum-dependency-age',
        '0',
        `npm:@openelement/create@${version}`,
        'starter',
      ],
      tmpDir,
    );
    if (!create.success) throw new Error(`starter generation failed:\n${create.output}`);
    const config = await readJson(`${tmpDir}/starter/deno.json`) as {
      imports: Record<string, string>;
    };
    for (const pkg of ['app', 'adapter-vite', 'element']) {
      const expected = `npm:@openelement/${pkg}@${version}`;
      if (config.imports[`@openelement/${pkg}`] !== expected) {
        throw new Error(
          `starter import @openelement/${pkg}=${
            config.imports[`@openelement/${pkg}`]
          }, expected=${expected}`,
        );
      }
    }
    const check = await run('deno', ['task', 'check'], `${tmpDir}/starter`);
    if (!check.success) throw new Error(`starter check failed:\n${check.output}`);
    console.log('  ok: generated package graph and typecheck use the released version');
  } finally {
    await Deno.remove(tmpDir, { recursive: true }).catch(() => undefined);
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
    typeof parsed !== 'object' || parsed === null || Array.isArray(parsed) ||
    (parsed as { version?: unknown }).version !== version
  ) {
    return unknown(
      `registry response for ${name}@${version} does not confirm version ${version}`,
    );
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
    Deno.exit(1);
  }
  console.log(`  ok: ${decision.reason}`);
}

async function nitroSmoke(): Promise<void> {
  console.log('\n[Nitro output smoke]');

  for (const target of ['node', 'workers']) {
    console.log(`  deno task nitro:proof:${target}`);
    const result = await runWithOutput('deno', ['task', `nitro:proof:${target}`]);
    const output = result.stdout + result.stderr;
    if (!result.success) {
      console.error(`  ${target} failed:\n${output.slice(0, 2000)}`);
      Deno.exit(1);
    }
    if (!output.includes(`nitro proof ${target}:`)) {
      console.error(`  ${target} missing success marker`);
      Deno.exit(1);
    }
    const lastLine = output.trim().split('\n').slice(-1)[0];
    console.log(`  ok: ${lastLine}`);
  }
}

async function consumerSmokeMain(args: readonly string[]): Promise<void> {
  const options = parseConsumerSmokeOptions(args);
  const projectRoot = normalizeSlashes(Deno.cwd());

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
      Deno.exit(1);
    }
    console.log(`  npm availability: ${availability.reason}`);
  }

  await denoNpmSmoke(options.version, projectRoot, options.local);
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
  if (Deno.args.includes('--smoke')) {
    await consumerSmokeMain(Deno.args);
    return;
  }
  await qualificationMain();
}

if (import.meta.main) await main();
