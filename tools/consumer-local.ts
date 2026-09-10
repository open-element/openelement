/**
 * Local Workspace Consumer Build - generates a test project from the local
 * workspace create package and builds it. This is faster than the
 * post-publish smoke test because it uses local source directly, making
 * it suitable for running on every PR.
 *
 * Usage: deno run --allow-read --allow-write --allow-run --allow-env --allow-net --allow-ffi tools/consumer-local.ts
 *
 * Exit code 0 = consumer project builds successfully.
 * Exit code 1 = consumer project build failed.
 */

import { dirname, fromFileUrl, join, toFileUrl } from '@std/path';
import { existsSync } from '@std/fs';

import { allPackageAliases } from './lib/package-graph.ts';
import { assertCompatibilityDate } from './lib/compatibility-date.ts';
import { normalizeSlashes } from './lib/path.ts';
import { runWithOutput } from './lib/process.ts';
import { extractStaticModuleSpecifiers } from './lib/typescript-ast.ts';
import { NITRO_COMPATIBILITY_DATE } from './project-constants.ts';

function findMissingGeneratedImports(
  source: string,
  importMap: Record<string, string>,
): string[] {
  const specifiers = extractBareImportSpecifiers(source);
  return [...specifiers].filter((specifier) => !isMappedSpecifier(specifier, importMap)).sort();
}

function extractBareImportSpecifiers(source: string): Set<string> {
  const specifiers = new Set<string>();
  for (const { value } of extractStaticModuleSpecifiers(source)) {
    if (isBareSpecifier(value)) specifiers.add(value);
  }
  return specifiers;
}

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

const __dirname = dirname(fromFileUrl(import.meta.url));
const repoRoot = join(__dirname, '..');

const tmpRoot = Deno.makeTempDirSync({ prefix: 'openelement-consumer-local-' });
const projectName = 'consumer-test-app';
const keepTemp = Deno.env.get('OPEN_ELEMENT_KEEP_CONSUMER_LOCAL') === '1';
const packagedImportMapCheckOnly = Deno.args.includes('--packaged-import-map-check');
let exitCode = 0;

function cleanup(): void {
  if (keepTemp) {
    console.log(`Keeping temp project at ${tmpRoot}`);
    return;
  }
  Deno.removeSync(tmpRoot, { recursive: true });
}

console.log(`Generating test project from local workspace...`);

// Step 1: Generate project using local create package
const createResult = await runWithOutput(Deno.execPath(), [
  'run',
  '-A',
  join(repoRoot, 'packages', 'create', 'src', 'cli.ts'),
  projectName,
], { cwd: tmpRoot });

if (createResult.code !== 0) {
  console.error('Failed to generate consumer project:');
  console.error(createResult.stderr);
  cleanup();
  Deno.exit(1);
}

const appDir = join(tmpRoot, projectName);
console.log(`Project generated at ${appDir}`);

// Step 2: Patch deno.json imports to point to local workspace source
const denoJsonPath = join(appDir, 'deno.json');
const denoJson = JSON.parse(Deno.readTextFileSync(denoJsonPath));
const generatedImportMap = { ...denoJson.imports } as Record<string, string>;
const productImports = [
  '@deno/vite-plugin',
  '@openelement/adapter-vite',
  '@openelement/adapter-vite/nitro-mount',
  '@openelement/app',
  '@openelement/element',
  '@openelement/element/build-utils',
  '@openelement/element/jsx-dev-runtime',
  '@openelement/element/jsx-runtime',
  // The starter maps the app's virtual blog-data module to a local type stub.
  '@openelement/generated/blog-data',
  // Hono is the explicit public runtime dependency of the generated SSG entry.
  'hono',
  'vite',
];
if (Object.keys(generatedImportMap).sort().join('\n') !== productImports.join('\n')) {
  console.error('Generated starter exposes an unsupported import surface.');
  console.error(Object.keys(generatedImportMap).sort().join('\n'));
  cleanup();
  Deno.exit(1);
}

for (const [specifier, url] of allPackageAliases(repoRoot)) {
  denoJson.imports[specifier] = url;
}

denoJson.imports['vite'] = 'npm:vite@8.0.16';
denoJson.imports['@deno/vite-plugin'] = 'npm:@deno/vite-plugin';
denoJson.imports['hono'] = 'npm:hono@4.12.23';
denoJson.imports['@hono/vite-dev-server'] = 'npm:@hono/vite-dev-server@^0.25.3';

// Override build task to use local source
denoJson.tasks.build = `deno run -A ${
  join(repoRoot, 'packages', 'adapter-vite', 'src', 'cli', 'build.ts')
}`;

Deno.writeTextFileSync(denoJsonPath, JSON.stringify(denoJson, null, 2));

// Step 3: Patch Vite only with workspace aliases needed to execute the local
// implementation. The generated app itself remains limited to product imports.
const aliases = [...allPackageAliases(repoRoot)].map(([find, url]) => ({
  find,
  replacement: normalizeSlashes(fromFileUrl(url)),
}));

const viteConfigPath = join(appDir, 'vite.config.ts');
let viteConfig = Deno.readTextFileSync(viteConfigPath);

viteConfig = viteConfig.replace(
  'plugins: [',
  `resolve: { alias: ${JSON.stringify(aliases, null, 4)} },\n  plugins: [`,
);
Deno.writeTextFileSync(viteConfigPath, viteConfig);

// Step 4: Symlink node_modules from repo root
try {
  Deno.symlinkSync(join(repoRoot, 'node_modules'), join(appDir, 'node_modules'), {
    type: 'dir',
  });
} catch {
  // Symlink may already exist or node_modules may not exist
}

// Step 5: Build the project
console.log('Building consumer project...');
const buildResult = await runWithOutput(Deno.execPath(), ['task', 'build'], { cwd: appDir });

const stdout = buildResult.stdout;
const stderr = buildResult.stderr;

if (buildResult.code !== 0) {
  console.error('Consumer build FAILED:');
  console.error(stdout);
  console.error(stderr);
  cleanup();
  Deno.exit(1);
}

const buildEvidencePath = join(appDir, '.openElement', 'build-artifacts.json');
if (!existsSync(buildEvidencePath)) {
  console.error('Structured build manifest was not emitted.');
  cleanup();
  Deno.exit(1);
}
const buildEvidence = JSON.parse(Deno.readTextFileSync(buildEvidencePath)) as {
  success?: boolean;
  manifest?: { routes?: Array<{ kind?: string; path?: string }> };
  pages?: Array<{ path?: string; errors?: string[] }>;
};
const manifestRoutes = buildEvidence.manifest?.routes ?? [];
const pageRoutes = manifestRoutes.filter((route) => route.kind === 'page');
const apiRoutes = manifestRoutes.filter((route) => route.kind === 'api');
// Pages: index, freshness, blog index + post (starter blog routes), the
// contact action page, and the styled 404 (#923).
if (
  buildEvidence.success !== true || pageRoutes.length !== 6 || apiRoutes.length !== 1 ||
  (buildEvidence.pages ?? []).some((page) => (page.errors?.length ?? 0) > 0)
) {
  console.error('Structured build manifest did not contain the expected page/API surface.');
  console.error(JSON.stringify(buildEvidence, null, 2));
  cleanup();
  Deno.exit(1);
}

// Step 6: Verify output
const indexHtmlPath = join(appDir, 'dist', 'index.html');
if (!existsSync(indexHtmlPath)) {
  console.error('dist/index.html not found; consumer build produced no output');
  console.error(stdout);
  console.error(stderr);
  cleanup();
  Deno.exit(1);
}

const freshnessHtmlPath = join(appDir, 'dist', 'freshness', 'index.html');
if (!existsSync(freshnessHtmlPath)) {
  console.error(
    'dist/freshness/index.html not found; static prerender proof route was not generated',
  );
  console.error(stdout);
  console.error(stderr);
  cleanup();
  Deno.exit(1);
}

const assetPath = join(appDir, 'dist', 'openelement-mark.svg');
if (!existsSync(assetPath)) {
  console.error('dist/openelement-mark.svg not found; public asset was not copied');
  console.error(stdout);
  console.error(stderr);
  cleanup();
  Deno.exit(1);
}

const indexHtml = Deno.readTextFileSync(indexHtmlPath);
if (!indexHtml.includes('Static pages, alive where it counts')) {
  console.error('dist/index.html does not contain expected content');
  console.error('Last 300 chars:', indexHtml.substring(indexHtml.length - 300));
  cleanup();
  Deno.exit(1);
}

if (!indexHtml.includes('data-open-layout="app-shell"')) {
  console.error('dist/index.html does not contain expected app shell marker');
  console.error('Last 300 chars:', indexHtml.substring(indexHtml.length - 300));
  cleanup();
  Deno.exit(1);
}

const freshnessHtml = Deno.readTextFileSync(freshnessHtmlPath);
if (!freshnessHtml.includes('Freshness proof')) {
  console.error('dist/freshness/index.html does not contain expected freshness proof content');
  console.error('Last 300 chars:', freshnessHtml.substring(freshnessHtml.length - 300));
  cleanup();
  Deno.exit(1);
}

const serverEntryPath = join(appDir, 'dist', 'server', 'entry.js');
if (!existsSync(serverEntryPath)) {
  console.error('dist/server/entry.js not found; SSR bundle was not generated');
  console.error(stdout);
  console.error(stderr);
  cleanup();
  Deno.exit(1);
}

const serverEntry = Deno.readTextFileSync(serverEntryPath);
const missingGeneratedImports = findMissingGeneratedImports(serverEntry, generatedImportMap);
const missingProductImports = missingGeneratedImports.filter((specifier) =>
  specifier.startsWith('@openelement/')
);
if (missingProductImports.length > 0) {
  console.error(
    'Generated SSR bundle leaks non-product OpenElement imports. ' +
      'A consumer must not need internal package aliases.',
  );
  for (const specifier of missingProductImports) {
    console.error(`- ${specifier}`);
  }
  cleanup();
  Deno.exit(1);
}

if (missingGeneratedImports.length > 0) {
  console.log(
    'Local bundle contains third-party runtime dependencies; packed npm smoke validates their ' +
      'published dependency metadata.',
  );
}

if (packagedImportMapCheckOnly) {
  console.log('Packaged starter import-map smoke passed.');
  cleanup();
  Deno.exit(0);
}

console.log(
  'Local consumer build passed; pages, app shell, island, API route, asset, and static prerender surface verified.',
);

// Step 7: Mount the generated server entry in a real Nitro node output.
console.log('Building generated app through Nitro node preset...');
assertCompatibilityDate(NITRO_COMPATIBILITY_DATE);
Deno.writeTextFileSync(
  join(appDir, 'nitro.config.ts'),
  `export default defineNitroConfig({
  srcDir: 'server',
  preset: 'node-server',
  publicAssets: [{ dir: '../public' }],
  output: { dir: '.output-node' },
  compatibilityDate: '${NITRO_COMPATIBILITY_DATE}',
});
`,
);

const nitroRouteDir = join(appDir, 'server', 'routes');
await Deno.mkdir(nitroRouteDir, { recursive: true });
Deno.writeTextFileSync(
  join(nitroRouteDir, '[...path].ts'),
  `import { createOpenElementNitroHandler } from '${
    toFileUrl(join(repoRoot, 'packages', 'adapter-vite', 'src', 'nitro-mount.ts')).href
  }';
import { eventHandler } from 'h3';
import { openElementHandler } from '../../dist/server/entry.js';

const handler = createOpenElementNitroHandler({
  handler: openElementHandler,
});

// Nitro v3 hands over a standard Request via event.req; the mount is a
// near pass-through (#857). Platform fallbacks keep the starter smoke
// independent of the preset runtime.
export default eventHandler((event) => handler(event));
`,
);

const nitroResult = await runWithOutput(Deno.execPath(), [
  'run',
  '--node-modules-dir=auto',
  '-A',
  'npm:nitro@3.0.0',
  'build',
], { cwd: appDir });

if (nitroResult.code !== 0) {
  console.error('Generated app Nitro build FAILED:');
  console.error(nitroResult.stdout);
  console.error(nitroResult.stderr);
  cleanup();
  Deno.exit(1);
}

const nitroServerEntry = join(appDir, '.output-node', 'server', 'index.mjs');
if (!existsSync(nitroServerEntry)) {
  console.error(`Nitro node server entry missing: ${nitroServerEntry}`);
  console.error(nitroResult.stdout);
  console.error(nitroResult.stderr);
  cleanup();
  Deno.exit(1);
}

// Let the OS choose from its ephemeral range. The previous fixed 48000-48999
// range collides with parallel CI jobs often enough to make this proof flaky.
// There is still a small bind-after-close window, but avoiding the shared fixed
// range removes the deterministic cross-job collision seen in GitHub Actions.
const portProbe = Deno.listen({ hostname: '127.0.0.1', port: 0 });
const port = (portProbe.addr as Deno.NetAddr).port;
portProbe.close();
const server = new Deno.Command('node', {
  args: [nitroServerEntry],
  cwd: appDir,
  env: {
    HOST: '127.0.0.1',
    PORT: String(port),
  },
  stdout: 'piped',
  stderr: 'piped',
}).spawn();
let serverExited = false;
const serverStatus = server.status.then((status) => {
  serverExited = true;
  return status;
});
const serverStdout = new Response(server.stdout).text();
const serverStderr = new Response(server.stderr).text();

let nitroSmokeFailed = false;
try {
  const baseUrl = `http://127.0.0.1:${port}`;
  let ready = false;
  for (let attempt = 0; attempt < 150; attempt++) {
    try {
      await fetch(`${baseUrl}/api/health`);
      // Any HTTP response proves the server is listening. Route correctness is
      // asserted below with the full status and payload so a 4xx/5xx is not
      // misreported as a startup timeout.
      ready = true;
      break;
    } catch {
      // wait below
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (!ready) {
    console.error('Generated app Nitro smoke failed: server did not become ready.');
    const status = serverExited ? await serverStatus : null;
    if (status) {
      console.error(JSON.stringify({ serverStatus: status }, null, 2));
      const [stdout, stderr] = await Promise.all([
        serverStdout.catch(() => ''),
        serverStderr.catch(() => ''),
      ]);
      if (stdout) console.error(stdout);
      if (stderr) console.error(stderr);
    }
    nitroSmokeFailed = true;
  }

  if (!nitroSmokeFailed) {
    const health = await fetch(`${baseUrl}/api/health`);
    const healthPayload = await health.json() as {
      ok?: boolean;
      framework?: string;
      route?: string;
    };
    if (
      health.status !== 200 ||
      healthPayload.ok !== true ||
      healthPayload.framework !== 'openElement' ||
      healthPayload.route !== '/api/health'
    ) {
      console.error(JSON.stringify({ status: health.status, healthPayload }, null, 2));
      nitroSmokeFailed = true;
    }
  }

  if (!nitroSmokeFailed) {
    const home = await fetch(`${baseUrl}/`);
    const homeHtml = await home.text();
    if (
      home.status !== 200 ||
      !homeHtml.includes('Static pages, alive where it counts') ||
      !homeHtml.includes('data-open-layout="app-shell"')
    ) {
      console.error(JSON.stringify({ status: home.status, body: homeHtml.slice(-500) }, null, 2));
      nitroSmokeFailed = true;
    }
  }

  if (!nitroSmokeFailed) {
    const freshness = await fetch(`${baseUrl}/freshness`);
    const freshnessHtml = await freshness.text();
    if (
      freshness.status !== 200 ||
      !freshnessHtml.includes('Freshness proof') ||
      !freshnessHtml.includes('data-open-layout="app-shell"')
    ) {
      console.error(JSON.stringify(
        {
          status: freshness.status,
          body: freshnessHtml.slice(-500),
        },
        null,
        2,
      ));
      nitroSmokeFailed = true;
    }
  }

  if (!nitroSmokeFailed) {
    const asset = await fetch(`${baseUrl}/openelement-mark.svg`);
    const assetBody = await asset.text();
    if (
      asset.status !== 200 ||
      !assetBody.includes('<svg') ||
      !assetBody.includes('&lt;open/&gt; mark')
    ) {
      console.error(
        JSON.stringify({ status: asset.status, body: assetBody.slice(0, 200) }, null, 2),
      );
      nitroSmokeFailed = true;
    }
  }

  // 0.42 request-time action route (#571): the starter's /contact page must
  // render per request and answer the form protocol — empty submission is a
  // 422 echo, a valid one a 303 PRG redirect.
  if (!nitroSmokeFailed) {
    const contact = await fetch(`${baseUrl}/contact`);
    const contactHtml = await contact.text();
    if (contact.status !== 200 || !contactHtml.includes('Stay in the loop')) {
      console.error(
        JSON.stringify({ status: contact.status, body: contactHtml.slice(-500) }, null, 2),
      );
      nitroSmokeFailed = true;
    }
  }

  if (!nitroSmokeFailed) {
    const invalid = await fetch(`${baseUrl}/contact`, {
      method: 'POST',
      body: new URLSearchParams({ email: '' }),
    });
    const invalidHtml = await invalid.text();
    if (invalid.status !== 422 || !invalidHtml.includes('a valid email is required')) {
      console.error(
        JSON.stringify({ status: invalid.status, body: invalidHtml.slice(-500) }, null, 2),
      );
      nitroSmokeFailed = true;
    }
  }

  if (!nitroSmokeFailed) {
    const valid = await fetch(`${baseUrl}/contact`, {
      method: 'POST',
      body: new URLSearchParams({ email: 'ada@example.com' }),
      redirect: 'manual',
    });
    const location = valid.headers.get('location');
    if (valid.status !== 303 || location !== '/contact?subscribed=ada%40example.com') {
      console.error(JSON.stringify({ status: valid.status, location }, null, 2));
      nitroSmokeFailed = true;
    }
  }
} finally {
  if (!serverExited) {
    try {
      server.kill('SIGTERM');
    } catch (err) {
      if (!(err instanceof TypeError)) {
        console.error('[consumer-local] failed to stop Nitro smoke server:', err);
      }
    }
  }
  await serverStatus.catch(() => undefined);
}

if (nitroSmokeFailed) {
  const [stdout, stderr] = await Promise.all([
    serverStdout.catch(() => ''),
    serverStderr.catch(() => ''),
  ]);
  if (stdout) console.error(stdout);
  if (stderr) console.error(stderr);
}

if (nitroSmokeFailed) exitCode = 1;
else console.log('Generated app Nitro node smoke passed.');

// Cleanup
cleanup();
if (exitCode !== 0) Deno.exit(exitCode);
