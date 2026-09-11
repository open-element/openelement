#!/usr/bin/env -S deno run --allow-read --allow-write --allow-run --allow-env --allow-net
/**
 * consumer-smoke
 *
 * Post-publish npm smoke test: creates temporary consumer projects and
 * verifies @openelement/element can be consumed from npm in Deno and Node.
 * Also checks the jsDelivr CDN browser-safe export and Nitro build output.
 *
 * This script is a post-publish gate used by the published-consumer workflow,
 * so its
 * availability probes use the canonical verdict contract
 * (tools/gate-verdict.ts) and fail closed. Only a CONFIRMED registry 200
 * whose payload confirms the exact version admits the release; a confirmed
 * 404 is FAIL; timeout, DNS/network failure, 5xx and malformed responses are
 * UNKNOWN — all non-PASS verdicts exit non-zero. There is no skip path:
 * infra uncertainty can never green a release.
 *
 * Usage:
 *   deno run -A tools/consumer-smoke.ts
 *   deno run -A tools/consumer-smoke.ts --local
 *   deno run -A tools/consumer-smoke.ts --version <x.y.z>
 *   deno run -A tools/consumer-smoke.ts --version <x.y.z> --jsdelivr --nitro
 */

import { formatError } from '@openelement/element';
import { admitsRelease, fail, type GateDecision, pass, unknown } from './gate-verdict.ts';
import { getArg, runWithOutput } from './lib/process.ts';

async function readJson<T = unknown>(path: string | URL): Promise<T> {
  return JSON.parse(await Deno.readTextFile(path)) as T;
}

function normalizeSlashes(path: string): string {
  return path.replace(/\\/g, '/');
}

function getArgFlag(flag: string): boolean {
  return Deno.args.includes(flag);
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

async function main(): Promise<void> {
  const { PACKAGE_VERSION } = await import('./project-constants.ts');
  const local = getArgFlag('--local');
  // An empty --version (e.g. an unset workflow input) falls back to the
  // workspace version instead of counting as an explicit npm version.
  const versionArg = getArg('--version');
  const version = versionArg || PACKAGE_VERSION;
  const versionProvided = versionArg !== null && versionArg !== '';
  const projectRoot = normalizeSlashes(Deno.cwd());

  const runJsDelivr = getArgFlag('--jsdelivr') || (versionProvided && !local);
  const runNitro = getArgFlag('--nitro') || (versionProvided && !local);

  console.log('Consumer npm smoke test');
  console.log(`  mode: ${local ? 'local workspace' : `npm @openelement/element@${version}`}`);
  if (runJsDelivr) console.log('  + jsDelivr CDN smoke');
  if (runNitro) console.log('  + Nitro output smoke');

  if (!local) {
    // Release gate, fail closed (#1216): only a confirmed registry 200 with a
    // matching version payload admits the smoke. A confirmed 404 is FAIL;
    // timeout/DNS/5xx/malformed responses are UNKNOWN. Both exit non-zero —
    // infra uncertainty can no longer skip this gate green.
    const availability = await npmAvailabilityDecision('@openelement/element', version);
    if (!admitsRelease(availability)) {
      console.error(`\nnpm availability gate: ${availability.verdict}: ${availability.reason}`);
      console.error('Use --local to smoke against workspace sources instead.');
      Deno.exit(1);
    }
    console.log(`  npm availability: ${availability.reason}`);
  }

  await denoNpmSmoke(version, projectRoot, local);
  await nodeEsmSmoke(version, projectRoot, local);
  if (!local) await exactVersionStarterSmoke(version);

  if (runJsDelivr) {
    await jsdelivrSmoke(version);
  }

  if (runNitro) {
    await nitroSmoke();
  }

  console.log('\nAll smoke tests passed');
}

if (import.meta.main) await main();
