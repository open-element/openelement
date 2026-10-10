/**
 * Packed-artifact starter consumer walkthrough.
 *
 * The observational rule for packaging defects: qualify the PACKED artifact,
 * never the workspace source. This tool installs the five pack:dry-run
 * tarballs into a scratch consumer OUTSIDE the repository (so the adapter's
 * workspace auto-alias in workspace-alias.ts cannot substitute workspace
 * source for the packed modules), scaffolds the canonical starter through the
 * packed @openelement/create CLI (non-interactive, so the Tailwind-ON
 * default form, #1524), installs the starter's own dependency
 * surface through pnpm (the @openelement/* pins rewired to the same current-
 * SHA tarballs), and then exercises the full external consumer lifecycle
 * exactly as an adopter would on the B5 Node/pnpm surface (ADR-0161):
 *
 *   install  the starter's package.json resolves through a real pnpm install
 *            (the `vite-plus: "catalog:"` devDependency resolves through the
 *            scaffold's own pnpm-workspace.yaml catalog, and the `vite@*`
 *            override points the whole vite tree at the Vite+ core build)
 *   dev      the Vite+ dev server (`vp dev`) boots and SSR-renders / over HTTP
 *   typecheck the starter's own `typecheck` script (tsc --noEmit)
 *   test     the starter's own `test` script
 *   build    real SSG build; must emit dist/server/index.js (request-time),
 *            the structured build manifest (6 pages + 1 API route, no page
 *            errors), the prerendered index/freshness pages with the app
 *            shell marker, and the public asset copy
 *   boundary the generated SSR bundle (dist/server/entry.js) imports only the
 *            starter's product dependency surface — no @openelement/*
 *            specifier outside package.json may survive into the bundle
 *            (a packed starter must never need workspace aliases)
 *   start    the `start` script (the router's `oe` bin) serves
 *            static + request-time + API routes over HTTP
 *   browser  packed three-browser matrix (chromium+firefox+webkit): the
 *            starter island hydrates in place, interaction patches without a
 *            full reload, and request-time navigation renders. One probe
 *            invocation per browser with its own OK marker; any single
 *            browser failure fails the gate (workspace-fixture results never
 *            substitute for this packed consumer).
 *   preview  the router bin's `start --mode=preview` fails closed with start
 *            guidance (the starter is dynamic, #601); the starter ships no
 *            preview script (owner ruling 2026-10-09)
 *
 * Every leg asserts over-the-wire output, not just a green exit. Gated in CI
 * via the `consumer:packaged` root task (verify:core task chain).
 */

import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { existsSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { runProcess } from './consumer-packaged-shared.ts';
import { PACKAGE_VERSION, RETAINED_PACKAGE_NAMES } from '../repo/project-constants.ts';
import { readPackages } from '../lib/package-graph.ts';
import { tarballPath } from '../lib/npm-tarball.ts';
import { CREATE_BIN } from './npm-manifest.ts';
import { extractStaticModuleSpecifiers } from '../lib/typescript-ast.ts';
// The scaffold's devDependency pins (#1530 showcase form) — the create CLI's
// embedded copies are anchored by the create tests; this consumer reads the
// same source module so a pin drift fails here, on the packed surface. (The
// vite pin itself retired with the Vite+ form: the manifest carries
// `vite-plus: "catalog:"` and the workspace file's catalog owns the version.)
import {
  CREATE_VERSION,
  DEV_SERVER_STARTER_PIN,
  HONO_STARTER_PIN,
  TAILWIND_STARTER_PIN,
} from '../../packages/create/src/version.ts';

async function readJson<T = unknown>(path: string | URL): Promise<T> {
  return JSON.parse(await readFile(path, 'utf8')) as T;
}

const repoRoot = resolve(import.meta.dirname!, '../..');
// Generous ceiling for the starter's real SSG build (vite + nitro); a hung
// packed adapter must fail the tool instead of stalling CI forever.
const BUILD_TIMEOUT_MS = 10 * 60_000;
const NPM_INSTALL_TIMEOUT_MS = 5 * 60_000;
const BROWSER_TIMEOUT_MS = 5 * 60_000;
// One browser per probe invocation so every starter x browser pair is an
// individually identifiable PASS/FAIL unit in the gate output.
const PACKED_BROWSERS = ['chromium', 'firefox', 'webkit'] as const;
// Cold-cache vite dev can take well over a minute before the first SSR
// response; the dev/start/browser legs share this readiness ceiling.
const SERVER_READY_TIMEOUT_MS = 3 * 60_000;

function run(
  command: string,
  args: string[],
  cwd: string,
  timeoutMs?: number,
  env?: Record<string, string>,
): Promise<{ success: boolean; output: string }> {
  return runProcess(command, args, cwd, { timeoutMs, env });
}

async function assertConsumerDoesNotResolveIntoRepository(nodeModules: string): Promise<void> {
  const candidates: string[] = [];
  for (const entry of readdirSync(nodeModules, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const path = join(nodeModules, entry.name);
    if (entry.name.startsWith('@') && entry.isDirectory()) {
      for (const nested of readdirSync(path, { withFileTypes: true })) {
        candidates.push(join(path, nested.name));
      }
    } else {
      candidates.push(path);
    }
  }
  for (const path of candidates) {
    const resolved = await realpath(path).catch(() => path);
    if (resolved === repoRoot || resolved.startsWith(`${repoRoot}/`)) {
      throw new Error(
        `Packed consumer resolved a dependency into the repository: ${path} -> ${resolved}`,
      );
    }
  }
}

// Let the OS choose from its ephemeral range (fixed ranges collide with
// parallel CI jobs).
function reservePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('listening', () => {
      const addr = probe.address() as { port: number };
      probe.close(() => resolve(addr.port));
    });
    probe.once('error', reject);
    probe.listen({ port: 0, host: '127.0.0.1' });
  });
}

// ─── Dependency-surface boundary helpers ────────────────────────────────────
//
// The packed starter must resolve exclusively through its package.json
// dependency surface: any @openelement/* bare specifier surviving in the
// built SSR bundle outside that surface would only resolve through workspace
// aliases a real consumer does not have.

function isBareSpecifier(specifier: string): boolean {
  return (
    !specifier.startsWith('.') &&
    !specifier.startsWith('/') &&
    !specifier.startsWith('file:') &&
    !specifier.startsWith('http:') &&
    !specifier.startsWith('https:') &&
    !specifier.startsWith('data:') &&
    !specifier.startsWith('node:') &&
    !specifier.startsWith('npm:')
  );
}

function isCoveredByDependency(specifier: string, dependencies: Record<string, string>): boolean {
  if (Object.hasOwn(dependencies, specifier)) return true;
  return Object.keys(dependencies).some((name) => specifier.startsWith(`${name}/`));
}

function findMissingGeneratedImports(
  source: string,
  dependencies: Record<string, string>,
): string[] {
  const specifiers = new Set<string>();
  for (const { value } of extractStaticModuleSpecifiers(source)) {
    if (isBareSpecifier(value)) specifiers.add(value);
  }
  return [...specifiers]
    .filter((specifier) => !isCoveredByDependency(specifier, dependencies))
    .sort();
}

// ─── Packed three-browser matrix (starter island hydration + continuation) ─
//
// The probe is written INSIDE the generated starter and resolves
// @playwright/test through a devDependency the QUALIFICATION adds to the
// scaffolded manifest before installing (PW_PROBE_PIN below; the shipped
// starter template deliberately carries no browser dependency — owner ruling
// 2026-10-09): node_modules resolution walks up from the probe file, so a
// probe outside the starter has no declaring package.json and fails to resolve
// the import (the alpha.7 CI defect). It runs as a plain node child with
// cwd=starter, matching consumer-packaged-element.ts and the fixture e2e
// tasks.
// Args: <baseUrl> <chromium|firefox|webkit>.

/**
 * The probe's own Playwright pin, added to the scaffolded starter by this gate.
 *
 * Exported so consumer-packaged-starter.test.ts can anchor it against the root
 * manifest's devDependencies['@playwright/test']: CI installs the browser
 * builds for the ROOT pin, so a root upgrade that leaves this copy behind must
 * fail a gate instead of surfacing as a launch failure at the far end of the
 * release train. check-package-graph.ts reads this same declaration out of the
 * file text (probePlaywrightPinFailures), so no comment above it may restate
 * the declaration's assignment pattern — that text anchor takes the FIRST
 * match in the file.
 */
export const PW_PROBE_PIN = '1.59.1';

const PW_STARTER_PROBE_SCRIPT = `import { chromium, firefox, webkit } from '@playwright/test';

const [baseUrl, browserName] = process.argv.slice(2);
const browserType = browserName === 'chromium'
  ? chromium
  : browserName === 'firefox'
  ? firefox
  : browserName === 'webkit'
  ? webkit
  : null;
if (!baseUrl || !browserType) {
  throw new Error('usage: pw-starter-probe.ts <baseUrl> <chromium|firefox|webkit>');
}
const browser = await browserType.launch({ headless: true });
try {
  const page = await browser.newPage();
  await page.goto(baseUrl + '/', { waitUntil: 'load' });
  // A full document reload would drop this marker; island interaction must
  // not reload.
  await page.evaluate(() => {
    (globalThis as { __starterContinuation?: string }).__starterContinuation = 'alive';
  });
  // The idle island hydrates in place: the SSR node identity must survive
  // activation and interaction (no re-render, no reload). The packed SSR
  // nests page hosts inside the shell DSD, so the island is found through a
  // shadow-piercing search (same deep traversal the starter-smoke matrix
  // uses) rather than a document-level querySelector.
  const countText = (expected: string): string =>
    '(function(){var deep=function(r){var d=r.querySelector("my-counter");' +
    'if(d)return d;var els=r.querySelectorAll("*");' +
    'for(var k=0;k<els.length;k++){var sh=els[k].shadowRoot;' +
    'if(sh){var f=deep(sh);if(f)return f}}return null;};' +
    'var c=deep(document);' +
    'var s=c&&c.shadowRoot&&c.shadowRoot.querySelector("#count");' +
    'return !!(s&&s.textContent==="' + expected + '");})()';
  await page.waitForFunction(countText('0'), undefined, { timeout: 60000 });
  const count = page.locator('my-counter #count');
  const ssrCount = await count.elementHandle();
  const plus = page.locator('my-counter').getByRole('button', { name: '+' });
  await plus.click();
  await page.waitForFunction(countText('1'), undefined, { timeout: 60000 });
  const activeCount = await count.elementHandle();
  if (!await ssrCount!.evaluate((node, candidate) => node === candidate, activeCount)) {
    throw new Error('starter island re-rendered instead of claiming the SSR node');
  }
  const marker = await page.evaluate(() =>
    (globalThis as { __starterContinuation?: string }).__starterContinuation ?? null
  );
  if (marker !== 'alive') throw new Error('starter island interaction caused a full reload');
  // Static navigation through the packed server output (the showcase About
  // page is the zero-JS static route).
  await page.goto(baseUrl + '/about', { waitUntil: 'load' });
  await page.getByText('Static first, interactive where it counts').waitFor({ timeout: 30000 });
  console.log('STARTER-BROWSER-OK ' + browserName + ' ' + browser.version());
} finally {
  await browser.close();
}
`;

/** Boot the starter's `start` script, run the three-browser matrix, then stop it. */
async function runStarterBrowserMatrix(starter: string): Promise<void> {
  const port = await reservePort();
  const server = spawn('pnpm', ['run', 'start'], {
    cwd: starter,
    env: { ...process.env, OPEN_ELEMENT_PORT: String(port), OPEN_ELEMENT_HOST: '127.0.0.1' },
    stdio: ['ignore', 'pipe', 'pipe'],
    // Own process group: the stop below must signal pnpm's node/sh
    // grandchildren (vite, cli/start) too, not just pnpm. Orphaned
    // grandchildren keep the inherited stdio pipes open, and the piped-output
    // pumps above keep this process alive — the success path never exits
    // (observed on macOS: vite + cli/start survivors on the walkthrough ports).
    detached: true,
  });
  let exited = false;
  server.addListener('exit', () => {
    exited = true;
  });
  const stdoutChunks: Uint8Array[] = [];
  const stderrChunks: Uint8Array[] = [];
  void (async () => {
    for await (const chunk of server.stdout!) stdoutChunks.push(chunk);
  })();
  void (async () => {
    for await (const chunk of server.stderr!) stderrChunks.push(chunk);
  })();
  const stdoutText = () =>
    new TextDecoder().decode(Buffer.concat(stdoutChunks.map((c) => Buffer.from(c))));
  const stderrText = () =>
    new TextDecoder().decode(Buffer.concat(stderrChunks.map((c) => Buffer.from(c))));
  try {
    const baseUrl = `http://127.0.0.1:${port}`;
    let ready = false;
    const deadline = Date.now() + SERVER_READY_TIMEOUT_MS;
    while (Date.now() < deadline && !exited) {
      try {
        const response = await fetch(`${baseUrl}/`);
        await response.text();
        ready = true;
        break;
      } catch {
        await new Promise((resolveWait) => setTimeout(resolveWait, 150));
      }
    }
    if (!ready) {
      throw new Error(
        `Packed starter browser host did not become ready within ${SERVER_READY_TIMEOUT_MS}ms:\n${stdoutText()}\n${stderrText()}`,
      );
    }
    const probePath = join(starter, 'pw-starter-probe.ts');
    await writeFile(probePath, PW_STARTER_PROBE_SCRIPT);
    const failures: string[] = [];
    for (const browserName of PACKED_BROWSERS) {
      const probe = await run(
        process.execPath,
        [probePath, baseUrl, browserName],
        starter,
        BROWSER_TIMEOUT_MS,
      );
      if (probe.success && probe.output.includes(`STARTER-BROWSER-OK ${browserName}`)) {
        console.log(`PASS starter / ${browserName} / pass`);
      } else {
        failures.push(`starter / ${browserName} / FAIL:\n${probe.output.slice(-2000)}`);
        console.log(`FAIL starter / ${browserName} / fail`);
      }
    }
    if (failures.length > 0) {
      throw new Error(
        `Packed starter browser matrix failed (${failures.length}/${PACKED_BROWSERS.length} browsers):\n` +
          failures.join('\n'),
      );
    }
    console.log('Packed starter browser matrix passed (chromium+firefox+webkit).');
  } finally {
    if (!exited) {
      try {
        // Negative pid: signal the whole process group (see detached above).
        process.kill(-server.pid!, 'SIGTERM');
      } catch {
        // process group already gone
      }
    }
    await new Promise((resolveSettled) => {
      if (exited) resolveSettled(null);
      else server.addListener('exit', () => resolveSettled(null));
    });
  }
}

/**
 * Boot one long-running lifecycle server (dev/start), wait for it to answer
 * HTTP, assert every [path, marker] probe over the wire, then stop it. A
 * green exit alone is not lifecycle evidence: the packed artifacts must
 * actually serve the documented routes.
 */
async function exerciseServer(
  label: string,
  command: string,
  buildArgs: (port: number) => string[],
  cwd: string,
  env: Record<string, string>,
  probes: ReadonlyArray<readonly [string, string]>,
): Promise<void> {
  const port = await reservePort();
  const server = spawn(command, buildArgs(port), {
    cwd,
    env: {
      ...process.env,
      ...env,
      OPEN_ELEMENT_PORT: String(port),
      OPEN_ELEMENT_HOST: '127.0.0.1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    // Own process group: the stop below must signal pnpm's node/sh
    // grandchildren (vite, cli/start) too, not just pnpm — otherwise they
    // survive orphaned, hold the inherited stdio pipes open, and the piped
    // pumps keep this process from ever exiting the success path.
    detached: true,
  });
  let exited = false;
  server.addListener('exit', () => {
    exited = true;
  });
  const stdoutChunks: Uint8Array[] = [];
  const stderrChunks: Uint8Array[] = [];
  void (async () => {
    for await (const chunk of server.stdout!) stdoutChunks.push(chunk);
  })();
  void (async () => {
    for await (const chunk of server.stderr!) stderrChunks.push(chunk);
  })();
  const stdoutText = () =>
    new TextDecoder().decode(Buffer.concat(stdoutChunks.map((c) => Buffer.from(c))));
  const stderrText = () =>
    new TextDecoder().decode(Buffer.concat(stderrChunks.map((c) => Buffer.from(c))));
  try {
    const baseUrl = `http://127.0.0.1:${port}`;
    let ready = false;
    const deadline = Date.now() + SERVER_READY_TIMEOUT_MS;
    while (Date.now() < deadline && !exited) {
      try {
        const response = await fetch(`${baseUrl}${probes[0][0]}`);
        await response.text();
        ready = true;
        break;
      } catch {
        await new Promise((resolveWait) => setTimeout(resolveWait, 150));
      }
    }
    if (!ready) {
      throw new Error(
        `${label} did not become ready within ${SERVER_READY_TIMEOUT_MS}ms:\n${stdoutText()}\n${stderrText()}`,
      );
    }
    for (const [path, marker] of probes) {
      const response = await fetch(`${baseUrl}${path}`);
      const body = await response.text();
      if (response.status !== 200 || !body.includes(marker)) {
        throw new Error(
          `${label} probe ${path} failed: status=${response.status}, missing marker ${marker}`,
        );
      }
    }
    console.log(`${label} passed (port ${port}).`);
  } finally {
    if (!exited) {
      try {
        // Negative pid: signal the whole process group (see detached above).
        process.kill(-server.pid!, 'SIGTERM');
      } catch {
        // process group already gone
      }
    }
    await new Promise((resolveSettled) => {
      if (exited) resolveSettled(null);
      else server.addListener('exit', () => resolveSettled(null));
    });
  }
}

// The walkthrough is guarded by `import.meta.main` (the node-hosted tool
// convention, npm-manifest.ts): this module must be importable — for the
// PW_PROBE_PIN anchor test — without executing the whole packed-consumer
// walkthrough as a side effect.
async function main(): Promise<void> {
  const tmp = await mkdtemp(join(tmpdir(), 'openelement-packaged-starter-'));
  try {
    const npmEnv = { NPM_CONFIG_CACHE: join(tmp, '.npm-cache') };
    // Cover the canonical retained package line (#828) with the shared tarball
    // naming helper (#793) so a new package cannot escape the smoke.
    const workspacePackages = await readPackages();
    const tarballFor = (name: string): string => {
      const pkg = workspacePackages.find((candidate) => candidate.name === name);
      if (!pkg) throw new Error(`Retained package missing from workspace graph: ${name}`);
      return join(repoRoot, tarballPath(pkg));
    };
    const tarballs = RETAINED_PACKAGE_NAMES.map(tarballFor);
    const routerTarball = tarballFor('@openelement/router');
    const elementTarball = tarballFor('@openelement/element');
    for (const tarball of tarballs) {
      if (!existsSync(tarball)) {
        throw new Error(
          `Missing packed release artifact: ${tarball} (run \`pnpm --dir tools/release run pack:dry-run\` first)`,
        );
      }
    }

    const install = await run(
      'npm',
      [
        'install',
        '--ignore-scripts',
        '--no-audit',
        '--no-fund',
        '--fetch-timeout=30000',
        ...tarballs,
      ],
      tmp,
      NPM_INSTALL_TIMEOUT_MS,
      npmEnv,
    );
    if (!install.success) throw new Error(`Packed package installation failed:\n${install.output}`);

    // The packed Create CLI runs through its real npm bin: the manifest declares
    // the bins (npm-manifest.ts CREATE_BIN), npm materializes them as
    // node_modules/.bin shims at install time, and `npm exec <bin> -- <args>`
    // resolves the local shim without touching the registry. The packed CLI is
    // node-hosted (its source is node:*-ported, shebang `#!/usr/bin/env node`)
    // and only scaffolds files: no prompts, no native bindings.
    const createBinName = Object.keys(CREATE_BIN).sort()[0];
    // --no-install: this consumer rewires the framework dependencies to this
    // checkout's tarballs before installing; the CLI's default registry install
    // would fetch published copies the rewire immediately discards.
    const create = await run(
      'npm',
      ['exec', createBinName, '--', 'starter', '--no-install'],
      tmp,
      NPM_INSTALL_TIMEOUT_MS,
      npmEnv,
    );
    if (!create.success) throw new Error(`Packed starter generation failed:\n${create.output}`);
    // The handoff box carries the generator version that actually produced the
    // scaffold: a cached `npx`/`npm exec` run resolves whatever copy it first
    // downloaded, so this line is the only signal a stale generator leaves.
    // Compared against the packed CLI's own CREATE_VERSION on the packed
    // surface, not against a hand-written literal.
    if (!create.output.includes(`@openelement/create ${CREATE_VERSION}`)) {
      throw new Error(
        `Packed create CLI handoff box does not name its version ` +
          `(@openelement/create ${CREATE_VERSION}):\n${create.output}`,
      );
    }

    const starter = join(tmp, 'starter');
    const manifestPath = join(starter, 'package.json');
    const manifest = (await readJson(manifestPath)) as {
      dependencies: Record<string, string>;
      devDependencies: Record<string, string>;
      scripts: Record<string, string>;
    };
    // The generated starter must expose exactly the supported product
    // dependency surface — no more, no less (a missing pin breaks the consumer;
    // an extra one would leak an internal alias into the public contract).
    // Subpaths (jsx-runtime, /vite, /nitro-mount) resolve through the packages'
    // own exports maps and are never separate pins. The #1530 showcase scaffold
    // keeps all styling in platform CSS files, so the runtime surface is the two
    // framework packages; the dev-server pair
    // (`@hono/vite-dev-server` + its `hono` peer) rides devDependencies — it is
    // loaded lazily by the dev server only, so a production install
    // (`npm install --omit=dev`) never pulls it (owner ruling 2026-10-09).
    const productDependencies = ['@openelement/element', '@openelement/router'];
    if (Object.keys(manifest.dependencies).sort().join('\n') !== productDependencies.join('\n')) {
      throw new Error(
        'Packed starter exposes an unsupported dependency surface:\n' +
          Object.keys(manifest.dependencies).sort().join('\n'),
      );
    }
    for (const [name, expected] of Object.entries({
      '@hono/vite-dev-server': DEV_SERVER_STARTER_PIN,
      hono: HONO_STARTER_PIN,
    })) {
      if (manifest.devDependencies[name] !== expected) {
        throw new Error(
          `Packed starter is missing the dev-server peer as a devDependency: ` +
            `${name}=${manifest.devDependencies[name] ?? '<missing>'}, expected ${expected}`,
        );
      }
    }
    // The CLI runs non-interactively here, so the scaffold must be the ONE
    // default form: Tailwind-ON (owner ruling 2026-10-08 — one default, no
    // variant, no flag) carrying the #1530 showcase pages. The toolchain is
    // the Vite+ form: no `vite` devDependency anymore — the manifest asks for
    // `vite-plus: "catalog:"` and the scaffold's own pnpm-workspace.yaml
    // catalog (asserted below, before the overrides fold) owns the version,
    // so a surviving vite pin is the retired form.
    if (manifest.devDependencies.vite !== undefined) {
      throw new Error(
        `Packed starter is not the Vite+ form: devDependency vite=` +
          `${manifest.devDependencies.vite} must be gone (the vite tree is catalog-managed)`,
      );
    }
    if (manifest.devDependencies['vite-plus'] !== 'catalog:') {
      throw new Error(
        `Packed starter is not the Vite+ form: devDependency vite-plus=` +
          `${manifest.devDependencies['vite-plus'] ?? '<missing>'}, expected catalog:`,
      );
    }
    for (const [name, expected] of Object.entries({
      '@tailwindcss/vite': TAILWIND_STARTER_PIN,
      tailwindcss: TAILWIND_STARTER_PIN,
    })) {
      if (manifest.devDependencies[name] !== expected) {
        throw new Error(
          `Packed starter is not the Tailwind-ON default form: devDependency ` +
            `${name}=${manifest.devDependencies[name] ?? '<missing>'}, expected ${expected}`,
        );
      }
    }
    for (const sheet of ['theme.css', 'recipes.css']) {
      if (!existsSync(join(starter, 'app', 'styles', sheet))) {
        throw new Error(`Packed starter is missing app/styles/${sheet}`);
      }
    }
    const generatedDependencies = {
      ...manifest.dependencies,
      ...manifest.devDependencies,
    } as Record<string, string>;
    // Owner ruling 2026-10-09: the scaffold rides the 1.0 line with caret
    // ranges, so the generated range must name the current release as its
    // LOWER BOUND (`^<version>`) — a bare exact pin or an older floor would
    // freeze adopters out of the line. This assertion runs before the rewire
    // below turns the specifiers into file: URLs.
    const expectedPins: Record<string, string> = {
      '@openelement/router': `^${PACKAGE_VERSION}`,
      '@openelement/element': `^${PACKAGE_VERSION}`,
    };
    for (const [name, expected] of Object.entries(expectedPins)) {
      if (manifest.dependencies[name] !== expected) {
        throw new Error(
          `Packed starter dependency ${name}=${manifest.dependencies[name]}, expected=${expected}`,
        );
      }
    }
    // The lifecycle is the starter's own pnpm scripts (ADR-0161); the legs
    // below run them exactly as an adopter would. `preview` is deliberately
    // absent (owner ruling 2026-10-09): the default starter ships /api/ping, so
    // a preview script could only ever refuse, and the documented spelling is
    // the router bin's `start --mode=preview` (exercised below). The Vite+
    // lifecycle renames `check` to `typecheck` (`tsc --noEmit`) and adds the
    // `fmt`/`lint` toolchain entries this gate does not drive.
    for (const script of ['dev', 'typecheck', 'test', 'build', 'start']) {
      if (typeof manifest.scripts[script] !== 'string') {
        throw new Error(`Packed starter is missing the '${script}' script.`);
      }
    }
    if (manifest.scripts.preview !== undefined) {
      throw new Error(
        "Packed starter still ships a 'preview' script; the lifecycle is " +
          'dev/typecheck/test/build/start and preview mode lives on the router bin.',
      );
    }
    // The Vite+ dev entry: the vite-plus bin (`vp dev`), the one documented
    // spelling — the dev leg below rides it with vite's pass-through flags.
    if (manifest.scripts.dev !== 'vp dev') {
      throw new Error(
        `Packed starter script 'dev' is not the Vite+ form (vp dev): ${manifest.scripts.dev}`,
      );
    }
    // The bin seam, read off the realized artifact: `build`/`start` must call
    // the router bin npm materializes from the packed router manifest — `oe`
    // (the short alias the scaffold spells) or `openelement` (the long name;
    // both bins are the same dispatcher) — never a path into the installed
    // tree.
    for (const script of ['build', 'start']) {
      if (!/\b(?:oe|openelement)\b/.test(manifest.scripts[script])) {
        throw new Error(
          `Packed starter script '${script}' does not run the router bin: ` +
            `${manifest.scripts[script]}`,
        );
      }
    }
    for (const script of ['build', 'start', 'preview']) {
      if (manifest.scripts[script]?.includes('node_modules')) {
        throw new Error(
          `Packed starter script '${script}' names an installed-tree path: ` +
            `${manifest.scripts[script]}`,
        );
      }
    }

    // Install the starter's own dependency surface: the @openelement/* pins are
    // rewired to the SAME current-SHA tarballs installed above, so the legs
    // qualify the packed artifacts end-to-end; everything else resolves from
    // the registry. pnpm is the scaffolded package manager (packageManager pin).
    manifest.dependencies['@openelement/router'] = pathToFileURL(routerTarball).href;
    manifest.dependencies['@openelement/element'] = pathToFileURL(elementTarball).href;
    // The browser-matrix probe (PW_STARTER_PROBE_SCRIPT) resolves
    // @playwright/test from inside the starter, so this gate supplies the pin as
    // a devDependency of the QUALIFICATION — the shipped template carries no
    // browser dependency (owner ruling 2026-10-09), and the declared dependency
    // surface above is asserted before this point.
    manifest.devDependencies['@playwright/test'] = PW_PROBE_PIN;
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    // The scaffold's own pnpm-workspace.yaml is load-bearing for the Vite+
    // form: its catalog resolves `vite-plus: "catalog:"` in the manifest and
    // the `vite@*: "catalog:"` override points every peer's vite at the Vite+
    // core build. Assert the packed scaffold carries it (same fragments the
    // starter-smoke setup anchors) BEFORE this gate touches the file.
    const workspacePath = join(starter, 'pnpm-workspace.yaml');
    if (!existsSync(workspacePath)) {
      throw new Error(
        'Packed starter is missing pnpm-workspace.yaml (the Vite+ catalog/override form ships it)',
      );
    }
    const workspaceYaml = await readFile(workspacePath, 'utf8');
    for (const fragment of [
      'npm:@voidzero-dev/vite-plus-core@1.1.0',
      'vite-plus: 1.1.0',
      'vite@*: "catalog:"',
    ]) {
      if (!workspaceYaml.includes(fragment)) {
        throw new Error(
          `Packed starter pnpm-workspace.yaml is not the Vite+ form: missing ${fragment}`,
        );
      }
    }
    // Since #1557 the packed element/router tarballs carry transitive workspace
    // pins (protocol, compiler at the exact current version) the registry does
    // not have before release day — pnpm 12 reads overrides from the workspace
    // file, so the qualification pins every framework package to this
    // checkout's tarballs. The file:// pins fold INTO the scaffold's own
    // `overrides:` block so every shipped entry stays verbatim: rebuilding the
    // file would drop the catalog and leave `vite-plus: "catalog:"`
    // unresolvable at install (same fold the starter-smoke setup performs).
    const frameworkTarballs: Array<[string, string]> = [
      ['@openelement/protocol', tarballFor('@openelement/protocol')],
      ['@openelement/element', elementTarball],
      ['@openelement/compiler', tarballFor('@openelement/compiler')],
      ['@openelement/router', routerTarball],
    ];
    const overridesKey = /^overrides:\n/m;
    if (!overridesKey.test(workspaceYaml)) {
      throw new Error(
        'Packed starter pnpm-workspace.yaml has no overrides block to extend; ' +
          'the Vite+ scaffold form changed under this gate',
      );
    }
    await writeFile(
      workspacePath,
      workspaceYaml.replace(
        overridesKey,
        `overrides:\n${frameworkTarballs
          .map(([name, path]) => `  "${name}": ${pathToFileURL(path).href}`)
          .join('\n')}\n`,
      ),
    );
    const installStarter = await run(
      'pnpm',
      ['install', '--no-frozen-lockfile'],
      starter,
      NPM_INSTALL_TIMEOUT_MS,
    );
    if (!installStarter.success) {
      throw new Error(`Starter dependency install failed:\n${installStarter.output}`);
    }

    // A packed consumer is a closed world. Neither node_modules tree — the
    // tarball install above nor the starter's own pnpm install — may borrow
    // missing modules from this repository.
    await assertConsumerDoesNotResolveIntoRepository(join(tmp, 'node_modules'));
    await assertConsumerDoesNotResolveIntoRepository(join(starter, 'node_modules'));

    // Lifecycle leg 1 — dev: the packed adapter must boot the real vite dev
    // server (the Vite+ core, through the starter's `vp dev` script) and
    // SSR-render the index route over HTTP, not just exit green.
    // The host is pinned: vite's default 'localhost' binding is IPv6-first on
    // some platforms while the HTTP probes target 127.0.0.1.
    await exerciseServer(
      'Packed starter dev server',
      'pnpm',
      (port) => ['run', 'dev', '--port', String(port), '--host', '127.0.0.1', '--strictPort'],
      starter,
      {},
      [['/', 'Rendered before JavaScript arrives']],
    );

    // Lifecycle leg 2 — typecheck (the check→typecheck rename of the Vite+
    // lifecycle): `tsc --noEmit` through the starter's own script.
    const typecheck = await run('pnpm', ['run', 'typecheck'], starter);
    if (!typecheck.success) {
      throw new Error(`Packed starter typecheck failed:\n${typecheck.output}`);
    }
    console.log(`Packed starter typecheck passed for ${PACKAGE_VERSION}.`);

    // Lifecycle leg 3 — test: the starter's own test script must run green
    // (no test files today; the leg pins the script wiring for when the
    // starter ships real tests).
    const test = await run('pnpm', ['run', 'test'], starter);
    if (!test.success) throw new Error(`Packed starter test script failed:\n${test.output}`);
    console.log('Packed starter test script passed.');

    // Lifecycle leg 4 — build: packed adapter must run the real SSG build.
    const build = await run('pnpm', ['run', 'build'], starter, BUILD_TIMEOUT_MS);
    if (!build.success) throw new Error(`Packed starter SSG build failed:\n${build.output}`);

    // A green exit alone is not enough: the packed adapter must actually emit the
    // request-time server entry. The starter's /contact route renders
    // request-time, so a build that skips the server bundle would silently drop
    // it.
    const serverEntry = join(starter, 'dist', 'server', 'index.js');
    if (!existsSync(serverEntry)) {
      throw new Error(
        `Packed starter SSG build emitted no request-time server entry: ${serverEntry}`,
      );
    }

    // Structured build manifest: the packed build must report the showcase
    // route surface (#1530) — index and the zero-JS About page as pages plus
    // the styled 404 (#923); /api/ping as the one API route — with no per-page
    // errors.
    const buildEvidencePath = join(starter, '.openElement', 'build-artifacts.json');
    if (!existsSync(buildEvidencePath)) {
      throw new Error('Packed starter build emitted no structured build manifest.');
    }
    const buildEvidence = JSON.parse(await readFile(buildEvidencePath, 'utf8')) as {
      success?: boolean;
      manifest?: { routes?: Array<{ kind?: string; path?: string }> };
      pages?: Array<{ path?: string; errors?: string[] }>;
    };
    const manifestRoutes = buildEvidence.manifest?.routes ?? [];
    const pageRoutes = manifestRoutes.filter((route) => route.kind === 'page');
    const apiRoutes = manifestRoutes.filter((route) => route.kind === 'api');
    if (
      buildEvidence.success !== true ||
      pageRoutes.length !== 3 ||
      apiRoutes.length !== 1 ||
      (buildEvidence.pages ?? []).some((page) => (page.errors?.length ?? 0) > 0)
    ) {
      throw new Error(
        'Packed starter structured build manifest did not contain the expected page/API surface:\n' +
          JSON.stringify(buildEvidence, null, 2),
      );
    }

    // Prerendered output: the static home and the zero-JS About page must be
    // prerendered, and the public asset must be copied.
    const indexHtmlPath = join(starter, 'dist', 'index.html');
    if (!existsSync(indexHtmlPath)) {
      throw new Error('Packed starter build emitted no prerendered dist/index.html');
    }
    const indexHtml = await readFile(indexHtmlPath, 'utf8');
    for (const marker of ['Rendered before JavaScript arrives', 'Interactive island']) {
      if (!indexHtml.includes(marker)) {
        throw new Error(`Packed starter dist/index.html missing marker: ${marker}`);
      }
    }
    // Showcase delivery (#1530 + #1558): the authored tokens/recipes sheets
    // ride the build as content-addressed client assets, and the static page
    // carries its critical styles inline — link-adopted or inline sheets, never
    // a JS-embedded style blob (that form retired with css``).
    const clientAssets = join(starter, 'dist', 'client', 'assets');
    const emittedSheets = existsSync(clientAssets)
      ? readdirSync(clientAssets).filter((name) => name.endsWith('.css'))
      : [];
    if (emittedSheets.length === 0) {
      throw new Error(
        'Packed starter build emitted no content-addressed client css asset ' +
          `(expected at least one under ${clientAssets})`,
      );
    }
    if (!indexHtml.includes('<style')) {
      throw new Error('Packed starter dist/index.html carries no inline critical styles');
    }
    const aboutHtmlPath = join(starter, 'dist', 'about', 'index.html');
    if (!existsSync(aboutHtmlPath)) {
      throw new Error('Packed starter build did not prerender the zero-JS About page');
    }
    const aboutHtml = await readFile(aboutHtmlPath, 'utf8');
    if (!aboutHtml.includes('Static first, interactive where it counts')) {
      throw new Error('Packed starter dist/about/index.html missing the About heading');
    }
    if (!existsSync(join(starter, 'dist', 'openelement-mark.svg'))) {
      throw new Error(
        'Packed starter build did not copy the public asset dist/openelement-mark.svg',
      );
    }

    // Dependency-surface boundary: the generated SSR bundle must import only
    // the starter's package.json dependency surface. A surviving
    // @openelement/* bare specifier outside that surface would resolve only
    // through workspace aliases — the packed starter must never need them.
    const ssrBundlePath = join(starter, 'dist', 'server', 'entry.js');
    if (!existsSync(ssrBundlePath)) {
      throw new Error(`Packed starter build emitted no SSR bundle: ${ssrBundlePath}`);
    }
    const ssrBundle = await readFile(ssrBundlePath, 'utf8');
    const missingGeneratedImports = findMissingGeneratedImports(ssrBundle, generatedDependencies);
    const missingProductImports = missingGeneratedImports.filter((specifier) =>
      specifier.startsWith('@openelement/'),
    );
    if (missingProductImports.length > 0) {
      throw new Error(
        'Packed starter SSR bundle leaks non-product OpenElement imports. ' +
          'A consumer must not need internal package aliases.\n' +
          missingProductImports.map((specifier) => `- ${specifier}`).join('\n'),
      );
    }
    if (missingGeneratedImports.length > 0) {
      console.log(
        'Packed starter bundle references third-party runtime dependencies; their published ' +
          'dependency metadata is validated by the install legs.',
      );
    }
    console.log(`Packed starter SSG build passed for ${PACKAGE_VERSION}.`);

    // Lifecycle leg 5 — start: serve the built output through the documented
    // local entry (cli/start) and assert the static route, the request-time
    // route and the API route over HTTP. Production deploys go through the
    // Nitro mount (qualified by nitro:proof and the packed serve consumer).
    const serveProbes = [
      ['/', 'Rendered before JavaScript arrives'],
      ['/about', 'Static first, interactive where it counts'],
      ['/api/ping', '"pong":true'],
    ] as const;
    await exerciseServer(
      'Packed starter start server',
      'pnpm',
      () => ['run', 'start'],
      starter,
      {},
      serveProbes,
    );
    // Lifecycle leg 6 — browser: packed three-browser matrix over cli/start.
    // #1425 root cause: the packed `@openelement/element` manifest declared
    // `sideEffects: false` while the default entry installs the compiled claim
    // executor through an import-time seam, so the consumer's own client build
    // tree-shook the install away and every island threw instead of hydrating.
    // The declaration now names both the entry and the installer
    // (tools/release/npm-manifest.ts, guarded by tools/release#pack-surface:check);
    // this leg is unconditionally required, and fails the gate on any browser.
    await runStarterBrowserMatrix(starter);
    // Lifecycle leg 7 — preview, through the router bin the starter's scripts
    // call: the starter ships a request-time route, so preview is a fail-closed
    // refusal that points at `start` (#601). A silent static-only preview would
    // be wrong, and the starter no longer offers a preview script at all.
    // Invoked through `npm exec` like the packed create bin above, so the shim
    // resolves on every host (a raw `node_modules/.bin/openelement` path has no
    // `.cmd` form on Windows).
    const preview = await run(
      'npm',
      ['exec', 'openelement', '--', 'start', '--mode=preview'],
      starter,
      NPM_INSTALL_TIMEOUT_MS,
      npmEnv,
    );
    if (
      preview.success ||
      !preview.output.includes('request-time routes') ||
      !preview.output.includes('pnpm start')
    ) {
      throw new Error(
        `Packed router bin preview must fail closed with start guidance for a dynamic app:\n${preview.output}`,
      );
    }
    console.log('Packed router bin preview fail-closed guidance passed.');
  } finally {
    await rm(tmp, { recursive: true }).catch(() => undefined);
  }
}

if (import.meta.main) await main();
