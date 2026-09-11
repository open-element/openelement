/**
 * Packed-artifact starter consumer walkthrough (#1228, B2.5).
 *
 * The observational rule for packaging defects: qualify the PACKED artifact,
 * never the workspace source. This tool installs the five pack:dry-run
 * tarballs into a scratch consumer OUTSIDE the repository (so the adapter's
 * workspace auto-alias in workspace-alias.ts cannot substitute workspace
 * source for the packed modules), scaffolds the canonical starter through the
 * packed @openelement/create CLI, and then exercises the full external
 * consumer lifecycle exactly as an adopter would:
 *
 *   dev      vite dev server boots and SSR-renders / over HTTP
 *   check    the starter's own typecheck task
 *   test     the starter's own test task
 *   build    real SSG build; must emit dist/server/index.js (request-time),
 *            the structured build manifest (6 pages + 1 API route, no page
 *            errors), the prerendered index/freshness pages with the app
 *            shell marker, and the public asset copy
 *   boundary the generated SSR bundle (dist/server/entry.js) imports only the
 *            starter's product import surface — no @openelement/* specifier
 *            outside the generated import map may survive into the bundle
 *            (a packed starter must never need workspace aliases)
 *   start    cli/start serves static + request-time + API routes over HTTP
 *   deploy   the standalone dist/server/serve.mjs serves the same probes
 *   preview  fails closed with start guidance (the starter is dynamic, #601)
 *
 * Every leg asserts over-the-wire output, not just a green exit. Gated in CI
 * via the `consumer:packaged` root task (gate:ci task chain).
 */

import { existsSync } from '@std/fs';
import { join, resolve } from '@std/path';
import { formatJson } from '@openelement/element/build-utils';
import { PACKAGE_VERSION, RETAINED_PACKAGE_NAMES } from './project-constants.ts';
import { readPackages } from './lib/package-graph.ts';
import { tarballPath } from './lib/npm-tarball.ts';
import { extractStaticModuleSpecifiers } from './lib/typescript-ast.ts';

async function readJson<T = unknown>(path: string | URL): Promise<T> {
  return JSON.parse(await Deno.readTextFile(path)) as T;
}

const repoRoot = resolve(import.meta.dirname!, '..');
// Generous ceiling for the starter's real SSG build (vite + nitro); a hung
// packed adapter must fail the tool instead of stalling CI forever.
const BUILD_TIMEOUT_MS = 10 * 60_000;
// Cold-cache vite dev under Deno can take well over a minute before the
// first SSR response; dev/start/deploy legs share this readiness ceiling.
const SERVER_READY_TIMEOUT_MS = 3 * 60_000;

async function run(
  command: string,
  args: string[],
  cwd: string,
  timeoutMs?: number,
): Promise<{ success: boolean; output: string }> {
  // Deno.Command resolves (not rejects) when the signal kills the subprocess,
  // so track the timeout explicitly to report it instead of an empty failure.
  const controller = new AbortController();
  let timedOut = false;
  const timeoutId = timeoutMs === undefined ? undefined : setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  try {
    const result = await new Deno.Command(command, {
      args,
      cwd,
      stdout: 'piped',
      stderr: 'piped',
      ...(timeoutMs === undefined ? {} : { signal: controller.signal }),
    }).output();
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

// Let the OS choose from its ephemeral range (fixed ranges collide with
// parallel CI jobs).
function reservePort(): number {
  const probe = Deno.listen({ hostname: '127.0.0.1', port: 0 });
  const port = (probe.addr as Deno.NetAddr).port;
  probe.close();
  return port;
}

// ─── Import-map boundary helpers ────────────────────────────────────────────
//
// The packed starter must resolve exclusively through its generated import
// map: any @openelement/* bare specifier surviving in the built SSR bundle
// outside that surface would only resolve through workspace aliases a real
// consumer does not have. Ported from the retired local-source consumer's
// --packaged-import-map-check leg.

function isBareSpecifier(specifier: string): boolean {
  return !specifier.startsWith('.') &&
    !specifier.startsWith('/') &&
    !specifier.startsWith('file:') &&
    !specifier.startsWith('http:') &&
    !specifier.startsWith('https:') &&
    !specifier.startsWith('data:') &&
    !specifier.startsWith('node:') &&
    !specifier.startsWith('npm:') &&
    !specifier.startsWith('jsr:');
}

function isMappedSpecifier(
  specifier: string,
  importMap: Record<string, string>,
): boolean {
  if (Object.hasOwn(importMap, specifier)) return true;
  return Object.keys(importMap).some((key) => key.endsWith('/') && specifier.startsWith(key));
}

function findMissingGeneratedImports(
  source: string,
  importMap: Record<string, string>,
): string[] {
  const specifiers = new Set<string>();
  for (const { value } of extractStaticModuleSpecifiers(source)) {
    if (isBareSpecifier(value)) specifiers.add(value);
  }
  return [...specifiers].filter((specifier) => !isMappedSpecifier(specifier, importMap)).sort();
}

/**
 * Boot one long-running lifecycle server (dev/start/deploy), wait for it to
 * answer HTTP, assert every [path, marker] probe over the wire, then stop it.
 * A green exit alone is not lifecycle evidence: the packed artifacts must
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
  const port = reservePort();
  const server = new Deno.Command(command, {
    args: buildArgs(port),
    cwd,
    env: { ...env, OPEN_ELEMENT_PORT: String(port), OPEN_ELEMENT_HOST: '127.0.0.1' },
    stdout: 'piped',
    stderr: 'piped',
  }).spawn();
  let exited = false;
  const status = server.status.then((s) => {
    exited = true;
    return s;
  });
  const stdout = new Response(server.stdout).text();
  const stderr = new Response(server.stderr).text();
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
        `${label} did not become ready within ${SERVER_READY_TIMEOUT_MS}ms:\n${await stdout}\n${await stderr}`,
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
    await status.catch(() => undefined);
    await Promise.all([stdout.catch(() => ''), stderr.catch(() => '')]);
  }
}

const tmp = await Deno.makeTempDir({ prefix: 'openelement-packaged-starter-' });
try {
  // Cover the canonical retained package line (#828) with the shared tarball
  // naming helper (#793) so a new package cannot escape the smoke.
  const workspacePackages = await readPackages();
  const tarballs = RETAINED_PACKAGE_NAMES.map((name) => {
    const pkg = workspacePackages.find((candidate) => candidate.name === name);
    if (!pkg) throw new Error(`Retained package missing from workspace graph: ${name}`);
    return join(repoRoot, tarballPath(pkg));
  });
  for (const tarball of tarballs) {
    if (!existsSync(tarball)) {
      throw new Error(
        `Missing packed release artifact: ${tarball} (run \`deno task pack:dry-run\` first)`,
      );
    }
  }

  // @jsr/* packages are served by JSR's npm compatibility layer at
  // https://npm.jsr.io, not by registry.npmjs.org. The openElement packages
  // themselves are @jsr-free; the mapping is required by the starter's
  // upstream dependency @deno/vite-plugin, whose npm manifest depends on
  // @jsr/deno__loader and @jsr/std__jsonc — #886.
  Deno.writeTextFileSync(
    join(tmp, '.npmrc'),
    '@jsr:registry=https://npm.jsr.io\n',
  );
  const install = await run(
    'npm',
    ['install', '--ignore-scripts', '--no-audit', '--no-fund', ...tarballs],
    tmp,
  );
  if (!install.success) throw new Error(`Packed package installation failed:\n${install.output}`);

  const createCli = join(tmp, 'node_modules', '@openelement', 'create', 'src', 'cli.js');
  const create = await run(Deno.execPath(), ['run', '-A', createCli, 'starter'], tmp);
  if (!create.success) throw new Error(`Packed starter generation failed:\n${create.output}`);

  const starter = join(tmp, 'starter');
  const configPath = join(starter, 'deno.json');
  const config = await readJson(configPath) as {
    imports: Record<string, string>;
    nodeModulesDir?: string;
  };
  // The generated starter must expose exactly the supported product import
  // surface — no more, no less (a missing pin breaks the consumer; an extra
  // one would leak an internal alias into the public contract).
  const productImports = [
    '@deno/vite-plugin',
    '@openelement/element',
    '@openelement/element/build-utils',
    '@openelement/element/jsx-dev-runtime',
    '@openelement/element/jsx-runtime',
    '@openelement/router',
    '@openelement/router/nitro-mount',
    '@openelement/router/vite',
    'hono',
    'vite',
  ];
  if (Object.keys(config.imports).sort().join('\n') !== productImports.join('\n')) {
    throw new Error(
      'Packed starter exposes an unsupported import surface:\n' +
        Object.keys(config.imports).sort().join('\n'),
    );
  }
  const generatedImportMap = { ...config.imports };
  const expectedImports: Record<string, string> = {
    '@openelement/router': `npm:@openelement/router@${PACKAGE_VERSION}`,
    '@openelement/router/vite': `npm:@openelement/router@${PACKAGE_VERSION}/vite`,
    '@openelement/element': `npm:@openelement/element@${PACKAGE_VERSION}`,
    '@openelement/element/jsx-runtime': `npm:@openelement/element@${PACKAGE_VERSION}/jsx-runtime`,
    '@openelement/element/jsx-dev-runtime':
      `npm:@openelement/element@${PACKAGE_VERSION}/jsx-dev-runtime`,
  };
  for (const [key, expected] of Object.entries(expectedImports)) {
    if (config.imports[key] !== expected) {
      throw new Error(`Packed starter import ${key}=${config.imports[key]}, expected=${expected}`);
    }
  }

  // Provision the starter's external npm deps (@deno/vite-plugin, vite, hono)
  // explicitly: the packed tarballs only cover @openelement/*, and scavenging
  // the repo's node_modules is not hermetic — a fresh checkout (or a CI cache
  // miss) has no @deno/vite-plugin and the starter build fails to resolve it.
  // Already-installed transitive deps of the tarballs (vite, hono) are skipped.
  const missingExternals = Object.values(config.imports)
    .filter((spec) => spec.startsWith('npm:') && !spec.startsWith('npm:@openelement/'))
    .map((spec) => spec.slice('npm:'.length))
    .filter((spec) => {
      const name = spec.startsWith('@')
        ? spec.split('/').slice(0, 2).join('/').replace(/@[^/]*$/u, '')
        : spec.split('@')[0];
      return !existsSync(join(tmp, 'node_modules', ...name.split('/')));
    });
  if (missingExternals.length > 0) {
    const provision = await run(
      'npm',
      ['install', '--ignore-scripts', '--no-audit', '--no-fund', ...missingExternals],
      tmp,
    );
    if (!provision.success) {
      throw new Error(`Starter external dependency install failed:\n${provision.output}`);
    }
  }

  // The starter's external deps (vite, @deno/vite-plugin, hono) are NOT inside
  // the local @openelement/* tarballs; npm resolves them via the repo-reachable
  // registries (npmjs.org + @jsr → npm.jsr.io from the .npmrc above). Reuse the
  // repo's already-resolved dependency tree (populated by setup-deno-workspace)
  // by linking any top-level entry the
  // freshly-installed tarballs did not already provide. Symlinks keep the
  // nested .deno structure intact so @deno/vite-plugin can resolve @deno/loader.
  const repoNodeModules = join(repoRoot, 'node_modules');
  if (existsSync(repoNodeModules)) {
    for (const entry of Deno.readDirSync(repoNodeModules)) {
      const dest = join(tmp, 'node_modules', entry.name);
      if (existsSync(dest)) continue; // local tarballs win
      const src = join(repoNodeModules, entry.name);
      await Deno.symlink(src, dest, { type: entry.isDirectory ? 'dir' : 'file' })
        .catch(() => undefined);
    }
  }

  config.nodeModulesDir = 'manual';
  await Deno.writeTextFile(configPath, formatJson(config));
  await Deno.symlink(join(tmp, 'node_modules'), join(starter, 'node_modules'), { type: 'dir' });

  // Lifecycle leg 1 — dev: the packed adapter must boot the real vite dev
  // server and SSR-render the index route over HTTP, not just exit green.
  await exerciseServer(
    'Packed starter dev server',
    Deno.execPath(),
    (port) => ['task', 'dev', '--port', String(port), '--strictPort'],
    starter,
    {},
    [['/', 'Static pages, alive where it counts']],
  );

  // Lifecycle leg 2 — check.
  const check = await run(Deno.execPath(), ['task', 'check'], starter);
  if (!check.success) throw new Error(`Packed starter typecheck failed:\n${check.output}`);
  console.log(`Packed starter typecheck passed for ${PACKAGE_VERSION}.`);

  // Lifecycle leg 3 — test: the starter's own test task must run green
  // (permit-no-files today; the leg pins the task wiring for when the
  // starter ships real tests).
  const test = await run(Deno.execPath(), ['task', 'test'], starter);
  if (!test.success) throw new Error(`Packed starter test task failed:\n${test.output}`);
  console.log('Packed starter test task passed.');

  // Lifecycle leg 4 — build: packed adapter must run the real SSG build.
  const build = await run(Deno.execPath(), ['task', 'build'], starter, BUILD_TIMEOUT_MS);
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
  const buildEvidence = JSON.parse(await Deno.readTextFile(buildEvidencePath)) as {
    success?: boolean;
    manifest?: { routes?: Array<{ kind?: string; path?: string }> };
    pages?: Array<{ path?: string; errors?: string[] }>;
  };
  const manifestRoutes = buildEvidence.manifest?.routes ?? [];
  const pageRoutes = manifestRoutes.filter((route) => route.kind === 'page');
  const apiRoutes = manifestRoutes.filter((route) => route.kind === 'api');
  if (
    buildEvidence.success !== true || pageRoutes.length !== 6 || apiRoutes.length !== 1 ||
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
  const indexHtml = await Deno.readTextFile(indexHtmlPath);
  for (const marker of ['Static pages, alive where it counts', 'data-open-layout="app-shell"']) {
    if (!indexHtml.includes(marker)) {
      throw new Error(`Packed starter dist/index.html missing marker: ${marker}`);
    }
  }
  const freshnessHtmlPath = join(starter, 'dist', 'freshness', 'index.html');
  if (!existsSync(freshnessHtmlPath)) {
    throw new Error('Packed starter build did not prerender the freshness proof route');
  }
  const freshnessHtml = await Deno.readTextFile(freshnessHtmlPath);
  if (!freshnessHtml.includes('Freshness proof')) {
    throw new Error('Packed starter dist/freshness/index.html missing the freshness proof content');
  }
  if (!existsSync(join(starter, 'dist', 'openelement-mark.svg'))) {
    throw new Error('Packed starter build did not copy the public asset dist/openelement-mark.svg');
  }

  // Import-map boundary: the generated SSR bundle must import only the
  // starter's product import surface. A surviving @openelement/* bare
  // specifier outside the generated import map would resolve only through
  // workspace aliases — the packed starter must never need them.
  const ssrBundlePath = join(starter, 'dist', 'server', 'entry.js');
  if (!existsSync(ssrBundlePath)) {
    throw new Error(`Packed starter build emitted no SSR bundle: ${ssrBundlePath}`);
  }
  const ssrBundle = await Deno.readTextFile(ssrBundlePath);
  const missingGeneratedImports = findMissingGeneratedImports(ssrBundle, generatedImportMap);
  const missingProductImports = missingGeneratedImports.filter((specifier) =>
    specifier.startsWith('@openelement/')
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

  // Lifecycle legs 5–6 — start and deploy: serve the built output through the
  // documented production entries (cli/start and the standalone
  // dist/server/serve.mjs a consumer deploys without the CLI) and assert the
  // static route, the request-time route and the API route over HTTP.
  const serveProbes = [
    ['/', 'Static pages, alive where it counts'],
    ['/contact', 'Stay in the loop'],
    ['/api/health', '"framework":"openElement"'],
  ] as const;
  await exerciseServer(
    'Packed starter start server',
    Deno.execPath(),
    () => ['task', 'start'],
    starter,
    {},
    serveProbes,
  );
  await exerciseServer(
    'Packed starter standalone deploy entry (dist/server/serve.mjs)',
    Deno.execPath(),
    () => ['run', '-A', 'dist/server/serve.mjs'],
    starter,
    {},
    serveProbes,
  );

  // Lifecycle leg 7 — preview: the starter ships a request-time route, so the
  // documented preview behavior is a fail-closed refusal that points at
  // `deno task start` (#601); a silent static-only preview would be wrong.
  const preview = await run(Deno.execPath(), ['task', 'preview'], starter);
  if (
    preview.success ||
    !preview.output.includes('request-time routes') ||
    !preview.output.includes('deno task start')
  ) {
    throw new Error(
      `Packed starter preview must fail closed with start guidance for a dynamic app:\n${preview.output}`,
    );
  }
  console.log('Packed starter preview fail-closed guidance passed.');
} finally {
  await Deno.remove(tmp, { recursive: true }).catch(() => undefined);
}
