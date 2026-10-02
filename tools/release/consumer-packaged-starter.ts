/**
 * Packed-artifact starter consumer walkthrough (#1228, B2.5).
 *
 * The observational rule for packaging defects: qualify the PACKED artifact,
 * never the workspace source. This tool installs the five pack:dry-run
 * tarballs into a scratch consumer OUTSIDE the repository (so the adapter's
 * workspace auto-alias in workspace-alias.ts cannot substitute workspace
 * source for the packed modules), scaffolds the canonical starter through the
 * packed @openelement/create CLI, installs the starter's own dependency
 * surface through pnpm (the @openelement/* pins rewired to the same current-
 * SHA tarballs), and then exercises the full external consumer lifecycle
 * exactly as an adopter would on the B5 Node/pnpm surface (ADR-0161):
 *
 *   install  the starter's package.json resolves through a real pnpm install
 *   dev      vite dev server boots and SSR-renders / over HTTP
 *   check    the starter's own `check` script (tsc)
 *   test     the starter's own `test` script
 *   build    real SSG build; must emit dist/server/index.js (request-time),
 *            the structured build manifest (6 pages + 1 API route, no page
 *            errors), the prerendered index/freshness pages with the app
 *            shell marker, and the public asset copy
 *   boundary the generated SSR bundle (dist/server/entry.js) imports only the
 *            starter's product dependency surface — no @openelement/*
 *            specifier outside package.json may survive into the bundle
 *            (a packed starter must never need workspace aliases)
 *   start    the `start` script (cli/start) serves static + request-time +
 *            API routes over HTTP
 *   browser  packed three-browser matrix (chromium+firefox+webkit): the
 *            starter island hydrates in place, interaction patches without a
 *            full reload, and request-time navigation renders. One probe
 *            invocation per browser with its own OK marker; any single
 *            browser failure fails the gate (workspace-fixture results never
 *            substitute for this packed consumer).
 *   preview  fails closed with start guidance (the starter is dynamic, #601)
 *
 * Every leg asserts over-the-wire output, not just a green exit. Gated in CI
 * via the `consumer:packaged` root task (verify:core task chain).
 */

import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { commandOutput } from '../repo/node-command.ts';
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { readdirSync } from 'node:fs';
import { existsSync } from '@std/fs';
import { join, resolve } from '@std/path';
import { PACKAGE_VERSION, RETAINED_PACKAGE_NAMES } from '../repo/project-constants.ts';
import { readPackages } from '../lib/package-graph.ts';
import { tarballPath } from '../lib/npm-tarball.ts';
import { extractStaticModuleSpecifiers } from '../lib/typescript-ast.ts';
import { PACKED_PROBE_PERMISSIONS } from './consumer-packaged-shared.ts';

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
// Cold-cache vite dev under Deno can take well over a minute before the
// first SSR response; dev/start/deploy legs share this readiness ceiling.
const SERVER_READY_TIMEOUT_MS = 3 * 60_000;

async function run(
  command: string,
  args: string[],
  cwd: string,
  timeoutMs?: number,
  env?: Record<string, string>,
): Promise<{ success: boolean; output: string }> {
  // Deno.Command resolves (not rejects) when the signal kills the subprocess,
  // so track the timeout explicitly to report it instead of an empty failure.
  const controller = new AbortController();
  let timedOut = false;
  const timeoutId =
    timeoutMs === undefined
      ? undefined
      : setTimeout(() => {
          timedOut = true;
          controller.abort();
        }, timeoutMs);
  try {
    const result = await commandOutput(command, {
      args,
      cwd,
      stdout: 'piped',
      stderr: 'piped',
      env,
      ...(timeoutMs === undefined ? {} : { signal: controller.signal }),
    });
    const decoder = new TextDecoder();
    const output = decoder.decode(result.stdout) + decoder.decode(result.stderr);
    if (timedOut) {
      return {
        success: false,
        output: `Timed out after ${timeoutMs}ms: ${command} ${args.join(' ')}\n${output}`,
      };
    }
    return { success: result.success, output };
  } finally {
    clearTimeout(timeoutId);
  }
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
// aliases a real consumer does not have. Ported from the retired
// local-source consumer's --packaged-import-map-check leg (B5 renamed the
// universe from the deno.json import map to package.json dependencies).

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

/**
 * Boot one long-running lifecycle server (dev/start/deploy), wait for it to
 * answer HTTP, assert every [path, marker] probe over the wire, then stop it.
 * A green exit alone is not lifecycle evidence: the packed artifacts must
 * actually serve the documented routes.
 */
// ─── Packed three-browser matrix (starter island hydration + continuation) ─
//
// Playwright runs as a scoped-permission child against the repo config (which
// maps @playwright/test), matching consumer-packaged-element.ts and the
// fixture e2e tasks (--deny-ffi --no-prompt: browser automation needs no
// native binding). Args: <baseUrl> <chromium|firefox|webkit>.
const PW_STARTER_PROBE_SCRIPT = `import { chromium, firefox, webkit } from '@playwright/test';

const [baseUrl, browserName] = Deno.args;
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
  // Request-time navigation renders through the packed server entry.
  await page.goto(baseUrl + '/contact', { waitUntil: 'load' });
  await page.getByText('Stay in the loop').waitFor({ timeout: 30000 });
  console.log('STARTER-BROWSER-OK ' + browserName + ' ' + browser.version());
} finally {
  await browser.close();
}
`;

/** Boot the starter's `start` script, run the three-browser matrix, then stop it. */
async function runStarterBrowserMatrix(starter: string, tmp: string): Promise<void> {
  const port = await reservePort();
  const server = spawn('pnpm', ['run', 'start'], {
    cwd: starter,
    env: { ...process.env, OPEN_ELEMENT_PORT: String(port), OPEN_ELEMENT_HOST: '127.0.0.1' },
    stdio: ['ignore', 'pipe', 'pipe'],
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
    const probePath = join(tmp, 'pw-starter-probe.ts');
    await writeFile(probePath, PW_STARTER_PROBE_SCRIPT);
    const failures: string[] = [];
    for (const browserName of PACKED_BROWSERS) {
      const probe = await run(
        'deno',
        [
          'run',
          '--no-lock',
          '--no-check',
          ...PACKED_PROBE_PERMISSIONS,
          probePath,
          baseUrl,
          browserName,
        ],
        repoRoot,
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
        server.kill('SIGTERM');
      } catch (error) {
        if (!(error instanceof TypeError)) {
          console.error('[consumer-packaged-starter] failed to stop browser host:', error);
        }
      }
    }
    await new Promise((resolveSettled) => {
      if (exited) resolveSettled(null);
      else server.addListener('exit', () => resolveSettled(null));
    });
  }
}

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
        server.kill('SIGTERM');
      } catch (error) {
        if (!(error instanceof TypeError)) {
          console.error(`[consumer-packaged-starter] failed to stop ${label} server:`, error);
        }
      }
    }
    await new Promise((resolveSettled) => {
      if (exited) resolveSettled(null);
      else server.addListener('exit', () => resolveSettled(null));
    });
  }
}

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

  const createCli = join(tmp, 'node_modules', '@openelement', 'create', 'src', 'cli.js');
  // The packed Create CLI is node-hosted (its source is node:*-ported) and
  // only scaffolds files: no prompts, no native bindings.
  const create = await run('node', [createCli, 'starter'], tmp);
  if (!create.success) throw new Error(`Packed starter generation failed:\n${create.output}`);

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
  // own exports maps and are never separate pins.
  const productDependencies = [
    '@hono/vite-dev-server',
    '@openelement/element',
    '@openelement/router',
    'hono',
  ];
  if (Object.keys(manifest.dependencies).sort().join('\n') !== productDependencies.join('\n')) {
    throw new Error(
      'Packed starter exposes an unsupported dependency surface:\n' +
        Object.keys(manifest.dependencies).sort().join('\n'),
    );
  }
  const generatedDependencies = {
    ...manifest.dependencies,
    ...manifest.devDependencies,
  } as Record<string, string>;
  const expectedPins: Record<string, string> = {
    '@openelement/router': PACKAGE_VERSION,
    '@openelement/element': PACKAGE_VERSION,
  };
  for (const [name, expected] of Object.entries(expectedPins)) {
    if (manifest.dependencies[name] !== expected) {
      throw new Error(
        `Packed starter dependency ${name}=${manifest.dependencies[name]}, expected=${expected}`,
      );
    }
  }
  // The lifecycle is the starter's own pnpm scripts (ADR-0161); the legs
  // below run them exactly as an adopter would.
  for (const script of ['dev', 'check', 'test', 'build', 'start', 'preview']) {
    if (typeof manifest.scripts[script] !== 'string') {
      throw new Error(`Packed starter is missing the '${script}' script.`);
    }
  }

  // Install the starter's own dependency surface: the @openelement/* pins are
  // rewired to the SAME current-SHA tarballs installed above, so the legs
  // qualify the packed artifacts end-to-end; everything else resolves from
  // the registry. pnpm is the scaffolded package manager (packageManager pin).
  manifest.dependencies['@openelement/router'] = pathToFileURL(routerTarball).href;
  manifest.dependencies['@openelement/element'] = pathToFileURL(elementTarball).href;
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  const installStarter = await run(
    'pnpm',
    ['install', '--ignore-workspace'],
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
  // server and SSR-render the index route over HTTP, not just exit green.
  // The host is pinned: vite's default 'localhost' binding is IPv6-first on
  // some platforms while the HTTP probes target 127.0.0.1.
  await exerciseServer(
    'Packed starter dev server',
    'pnpm',
    (port) => ['run', 'dev', '--port', String(port), '--host', '127.0.0.1', '--strictPort'],
    starter,
    {},
    [['/', 'Static pages, alive where it counts']],
  );

  // Lifecycle leg 2 — check.
  const check = await run('pnpm', ['run', 'check'], starter);
  if (!check.success) throw new Error(`Packed starter typecheck failed:\n${check.output}`);
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
  // it (this regression once slipped through when only `task check` ran here).
  const serverEntry = join(starter, 'dist', 'server', 'index.js');
  if (!existsSync(serverEntry)) {
    throw new Error(
      `Packed starter SSG build emitted no request-time server entry: ${serverEntry}`,
    );
  }

  // Structured build manifest: the packed build must report the starter's
  // full route surface — index, freshness, blog index + post, the contact
  // action page, and the styled 404 (#923) as pages; /api/health as the one
  // API route — with no per-page errors.
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
    pageRoutes.length !== 6 ||
    apiRoutes.length !== 1 ||
    (buildEvidence.pages ?? []).some((page) => (page.errors?.length ?? 0) > 0)
  ) {
    throw new Error(
      'Packed starter structured build manifest did not contain the expected page/API surface:\n' +
        JSON.stringify(buildEvidence, null, 2),
    );
  }

  // Prerendered output: the static home and the freshness proof route must be
  // prerendered through the app shell, and the public asset must be copied.
  const indexHtmlPath = join(starter, 'dist', 'index.html');
  if (!existsSync(indexHtmlPath)) {
    throw new Error('Packed starter build emitted no prerendered dist/index.html');
  }
  const indexHtml = await readFile(indexHtmlPath, 'utf8');
  for (const marker of ['Static pages, alive where it counts', 'data-open-layout="app-shell"']) {
    if (!indexHtml.includes(marker)) {
      throw new Error(`Packed starter dist/index.html missing marker: ${marker}`);
    }
  }
  const freshnessHtmlPath = join(starter, 'dist', 'freshness', 'index.html');
  if (!existsSync(freshnessHtmlPath)) {
    throw new Error('Packed starter build did not prerender the freshness proof route');
  }
  const freshnessHtml = await readFile(freshnessHtmlPath, 'utf8');
  if (!freshnessHtml.includes('Freshness proof')) {
    throw new Error('Packed starter dist/freshness/index.html missing the freshness proof content');
  }
  if (!existsSync(join(starter, 'dist', 'openelement-mark.svg'))) {
    throw new Error('Packed starter build did not copy the public asset dist/openelement-mark.svg');
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
    ['/', 'Static pages, alive where it counts'],
    ['/contact', 'Stay in the loop'],
    ['/api/health', '"framework":"openElement"'],
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
  await runStarterBrowserMatrix(starter, tmp);
  // Lifecycle leg 7 — preview: the starter ships a request-time route, so the
  // documented preview behavior is a fail-closed refusal that points at the
  // `start` script (#601); a silent static-only preview would be wrong.
  const preview = await run('pnpm', ['run', 'preview'], starter);
  if (
    preview.success ||
    !preview.output.includes('request-time routes') ||
    !preview.output.includes('pnpm start')
  ) {
    throw new Error(
      `Packed starter preview must fail closed with start guidance for a dynamic app:\n${preview.output}`,
    );
  }
  console.log('Packed starter preview fail-closed guidance passed.');
} finally {
  await rm(tmp, { recursive: true }).catch(() => undefined);
}
