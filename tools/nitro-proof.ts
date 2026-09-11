import { walkSync } from '@std/fs/walk';
import { assertCompatibilityDate } from './lib/compatibility-date.ts';
import { exists, readJson } from './lib/fs.ts';
import { runWithOutput } from './lib/process.ts';
import { NITRO_COMPATIBILITY_DATE } from './nitro-compatibility.ts';

const preset = Deno.args[0];

if (preset !== 'node' && preset !== 'workers') {
  console.error('Usage: deno run tools/nitro-proof.ts <node|workers>');
  Deno.exit(2);
}

const root = new URL('../', import.meta.url);
const fixture = new URL('packages/adapter-vite/__fixtures__/nitro-proof/', root);
const outputName = preset === 'workers' ? '.output-workers' : '.output-node';
const output = new URL(`${outputName}/`, fixture);
const nitroPreset = preset === 'workers' ? 'cloudflare_module' : 'node-server';

async function removeIfExists(url: URL): Promise<void> {
  if (await exists(url)) {
    await Deno.remove(url, { recursive: true });
  }
}

async function run(command: string[], env: Record<string, string> = {}): Promise<string> {
  const result = await runWithOutput(command[0], command.slice(1), { cwd: fixture, env });
  if (!result.success) {
    console.error(result.stdout);
    console.error(result.stderr);
    Deno.exit(result.code);
  }
  return `${result.stdout}\n${result.stderr}`;
}

async function assertFile(url: URL, label: string): Promise<void> {
  if (!(await exists(url))) {
    console.error(`${label} missing: ${url.pathname}`);
    Deno.exit(1);
  }
}

function assertIncludes(text: string, expected: string, label: string): void {
  if (!text.includes(expected)) {
    console.error(`${label} missing expected text: ${expected}`);
    Deno.exit(1);
  }
}

function assertNotIncludes(text: string, unexpected: string, label: string): void {
  if (text.includes(unexpected)) {
    console.error(`${label} included unexpected text: ${unexpected}`);
    Deno.exit(1);
  }
}

async function readTextFiles(dir: URL, suffix: string): Promise<string> {
  let content = '';
  for (
    const entry of walkSync(dir.pathname, { includeDirs: false })
  ) {
    if (!entry.name.endsWith(suffix)) continue;
    content += await Deno.readTextFile(entry.path);
  }
  return content;
}

type FetchLike = (request: Request) => Promise<Response> | Response;

async function assertRuntimeRoutes(fetchRuntime: FetchLike): Promise<void> {
  const proof = await fetchRuntime(new Request('http://127.0.0.1/api/proof'));
  const payload = await proof.json() as {
    ok?: boolean;
    framework?: string;
    runtime?: string;
    path?: string;
    env?: string;
  };
  if (
    proof.status !== 200 ||
    payload.ok !== true ||
    payload.framework !== 'openElement' ||
    payload.runtime !== 'nitro' ||
    payload.path !== '/api/proof' ||
    payload.env !== 'nitro'
  ) {
    console.error(JSON.stringify({ status: proof.status, payload }, null, 2));
    Deno.exit(1);
  }

  const staticHtml = await fetchRuntimeText(fetchRuntime, '/static', 200);
  assertIncludes(staticHtml, 'data-route="static"', 'static route');
  assertNotIncludes(staticHtml, '<script', 'static zero-JS route');
  assertNotIncludes(staticHtml, 'open-element-island-visible.js', 'static zero-JS route');
  assertNotIncludes(staticHtml, 'open-element-client-only.js', 'static zero-JS route');

  const loadHtml = await fetchRuntimeText(fetchRuntime, '/load', 200);
  assertIncludes(loadHtml, 'data-load="nitro-data"', 'load route');

  const layoutHtml = await fetchRuntimeText(fetchRuntime, '/layout', 200);
  assertIncludes(layoutHtml, 'data-layout="shell"', 'layout route');
  assertIncludes(layoutHtml, 'data-route="layout"', 'layout route');

  const redirect = await fetchRuntime(
    new Request('http://127.0.0.1/redirect', { redirect: 'manual' }),
  );
  if (redirect.status !== 302 || redirect.headers.get('location') !== '/static') {
    console.error(
      JSON.stringify(
        { status: redirect.status, location: redirect.headers.get('location') },
        null,
        2,
      ),
    );
    Deno.exit(1);
  }

  const notFoundHtml = await fetchRuntimeText(fetchRuntime, '/not-found', 404);
  assertIncludes(notFoundHtml, 'data-route="not-found"', 'not-found route');

  const errorHtml = await fetchRuntimeText(fetchRuntime, '/error', 500);
  assertIncludes(errorHtml, 'data-route="error"', 'error route');

  const islandHtml = await fetchRuntimeText(fetchRuntime, '/island', 200);
  assertIncludes(islandHtml, 'data-hydrate="visible"', 'explicit island route');
  assertIncludes(islandHtml, 'open-element-island-visible.js', 'explicit island route');
  assertNotIncludes(islandHtml, 'open-element-client-only.js', 'explicit island route');

  const clientOnlyHtml = await fetchRuntimeText(fetchRuntime, '/client-only', 200);
  assertIncludes(clientOnlyHtml, 'data-hydrate="only"', 'client-only route');
  assertIncludes(clientOnlyHtml, 'open-element-client-only.js', 'client-only route');
  assertNotIncludes(clientOnlyHtml, 'open-element-island-visible.js', 'client-only route');

  // Host-level cache route rule (Nitro routeRules) passthrough proof. This is
  // the host platform's cache feature, not a framework capability — v0.44
  // ships no framework ISR semantics (#1217).
  const cached = await fetchRuntime(new Request('http://127.0.0.1/cached'));
  const cachedText = await cached.text();
  if (
    cached.status !== 200 ||
    !cachedText.includes('data-route="cached"') ||
    cached.headers.get('x-open-element-cache-intent') !== 'host-cache; max-age=60' ||
    cached.headers.get('cache-control') !== 'public, max-age=60, s-maxage=60'
  ) {
    console.error(
      JSON.stringify(
        {
          status: cached.status,
          cacheIntent: cached.headers.get('x-open-element-cache-intent'),
          cacheControl: cached.headers.get('cache-control'),
          body: cachedText,
        },
        null,
        2,
      ),
    );
    Deno.exit(1);
  }
}

async function fetchRuntimeText(
  fetchRuntime: FetchLike,
  path: string,
  expectedStatus: number,
): Promise<string> {
  const response = await fetchRuntime(new Request(`http://127.0.0.1${path}`));
  const text = await response.text();
  if (response.status !== expectedStatus) {
    console.error(JSON.stringify({ path, expectedStatus, status: response.status, text }, null, 2));
    Deno.exit(1);
  }
  return text;
}

async function smokeNode(serverEntry: URL): Promise<void> {
  for (let attempt = 1; attempt <= 3; attempt++) {
    const listener = Deno.listen({ hostname: '127.0.0.1', port: 0 });
    const port = (listener.addr as Deno.NetAddr).port;
    listener.close();
    if (await smokeNodeAtPort(serverEntry, port)) return;
  }
  throw new Error('node smoke failed after 3 dynamic-port attempts');
}

async function smokeNodeAtPort(serverEntry: URL, port: number): Promise<boolean> {
  const baseUrl = `http://127.0.0.1:${port}`;
  const server = new Deno.Command('node', {
    args: [serverEntry.pathname],
    env: {
      PORT: String(port),
      HOST: '127.0.0.1',
    },
    stdout: 'null',
    stderr: 'null',
  }).spawn();

  try {
    let response: Response | undefined;
    for (let attempt = 0; attempt < 50; attempt++) {
      try {
        response = await fetch(`${baseUrl}/api/proof`);
        break;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }

    if (!response) {
      return false;
    }

    if (response.status !== 200) {
      console.error(
        JSON.stringify({ status: response.status, body: await response.text() }, null, 2),
      );
      Deno.exit(1);
    }

    await assertRuntimeRoutes((request) => {
      const url = new URL(request.url);
      return fetch(new Request(`${baseUrl}${url.pathname}${url.search}`, request));
    });

    await assertPublicAsset(baseUrl, '/open-element-proof.txt', 'openElement Nitro public asset');
    await assertPublicAsset(baseUrl, '/open-element-island-visible.js', 'open-proof-island');
    await assertPublicAsset(baseUrl, '/open-element-client-only.js', 'open-proof-client-only');
    return true;
  } finally {
    try {
      server.kill('SIGTERM');
    } catch {
      // The process may have already exited after losing a port race.
    }
    await server.status.catch(() => undefined);
  }
}

async function assertPublicAsset(baseUrl: string, path: string, marker: string): Promise<void> {
  const asset = await fetch(`${baseUrl}${path}`);
  const text = await asset.text();
  if (asset.status !== 200 || !text.includes(marker)) {
    console.error(JSON.stringify({ path, status: asset.status, text }, null, 2));
    Deno.exit(1);
  }
}

type CloudflareWorkerModule = {
  default?: {
    fetch?: (
      request: Request,
      env: CloudflareWorkerEnv,
      context: CloudflareWorkerContext,
    ) => Promise<Response> | Response;
  };
};

type CloudflareWorkerEnv = {
  OPEN_ELEMENT_PROOF: string;
  ASSETS: { fetch: FetchLike };
};

type CloudflareWorkerContext = {
  waitUntil: (promise: Promise<unknown>) => void;
  passThroughOnException: () => void;
};

async function smokeWorkers(serverEntry: URL, publicDir: URL): Promise<void> {
  const imported = await import(`${serverEntry.href}?t=${Date.now()}`) as CloudflareWorkerModule;
  const workerFetch = imported.default?.fetch;
  if (!workerFetch) {
    console.error(
      'Cloudflare Workers smoke failed: generated module does not export default.fetch',
    );
    Deno.exit(1);
  }

  const env: CloudflareWorkerEnv = {
    OPEN_ELEMENT_PROOF: 'nitro',
    ASSETS: {
      fetch: (request) => fetchPublicAsset(publicDir, request),
    },
  };
  const context: CloudflareWorkerContext = {
    waitUntil: () => undefined,
    passThroughOnException: () => undefined,
  };
  const fetchRuntime: FetchLike = (request) => workerFetch(request, env, context);

  await assertRuntimeRoutes(fetchRuntime);

  await assertRuntimePublicAsset(
    fetchRuntime,
    '/open-element-proof.txt',
    'openElement Nitro public asset',
  );
  await assertRuntimePublicAsset(
    fetchRuntime,
    '/open-element-island-visible.js',
    'open-proof-island',
  );
  await assertRuntimePublicAsset(
    fetchRuntime,
    '/open-element-client-only.js',
    'open-proof-client-only',
  );
}

async function fetchPublicAsset(publicDir: URL, request: Request): Promise<Response> {
  const pathname = new URL(request.url).pathname;
  const fileUrl = new URL(`.${pathname}`, publicDir);
  const rootPath = await Deno.realPath(publicDir);
  const filePath = await Deno.realPath(fileUrl).catch(() => '');
  if (!filePath.startsWith(rootPath)) {
    return new Response('Not Found', { status: 404 });
  }
  try {
    return new Response(await Deno.readFile(fileUrl), { status: 200 });
  } catch {
    return new Response('Not Found', { status: 404 });
  }
}

async function assertRuntimePublicAsset(
  fetchRuntime: FetchLike,
  path: string,
  marker: string,
): Promise<void> {
  const asset = await fetchRuntime(new Request(`http://127.0.0.1${path}`));
  const text = await asset.text();
  if (asset.status !== 200 || !text.includes(marker)) {
    console.error(JSON.stringify({ path, status: asset.status, text }, null, 2));
    Deno.exit(1);
  }
}

assertCompatibilityDate(NITRO_COMPATIBILITY_DATE);
await removeIfExists(output);
const buildLog = await run([
  'deno',
  'run',
  '--node-modules-dir=auto',
  '-A',
  'npm:nitro@3.0.0',
  'build',
], {
  OPEN_ELEMENT_NITRO_PRESET: nitroPreset,
});
assertNotIncludes(buildLog, 'Node.js compatibility is not enabled', 'Nitro build log');
const serializationWarning =
  'Runtime config option `nitro.routeRules./cached.cache` may not be able to be serialized.';
if (buildLog.includes(serializationWarning)) {
  console.log(
    'Nitro emitted the known cache serialization warning; generated route-rule markers will be asserted.',
  );
}

type NitroManifest = {
  preset?: string;
  serverEntry?: string;
  publicDir?: string;
  config?: { cloudflare?: { nodeCompat?: boolean } };
};

const manifest = await readJson<NitroManifest>(new URL('nitro.json', output));
const expectedPreset = preset === 'workers' ? 'cloudflare-module' : 'node-server';

if (manifest.preset !== expectedPreset) {
  console.error(JSON.stringify({ expectedPreset, manifest }, null, 2));
  Deno.exit(1);
}

const serverEntry = new URL(manifest.serverEntry || 'server/index.mjs', output);
await assertFile(serverEntry, 'Nitro server entry');
await assertFile(
  new URL(`${manifest.publicDir || 'public'}/open-element-proof.txt`, output),
  'Nitro public asset',
);
await assertFile(
  new URL(`${manifest.publicDir || 'public'}/open-element-island-visible.js`, output),
  'Nitro visible island chunk',
);
await assertFile(
  new URL(`${manifest.publicDir || 'public'}/open-element-client-only.js`, output),
  'Nitro client-only island chunk',
);

const outputServerCode = (await readTextFiles(new URL('server/', output), '.mjs')).replaceAll(
  '\\"',
  '"',
);
assertNitroCacheRouteRule(outputServerCode);

if (preset === 'node') {
  await smokeNode(serverEntry);
} else {
  if (manifest.config?.cloudflare?.nodeCompat !== true) {
    console.error('Cloudflare Workers output did not preserve nodeCompat=true');
    Deno.exit(1);
  }
  await smokeWorkers(serverEntry, new URL(`${manifest.publicDir || 'public'}/`, output));
}

console.log(`nitro proof ${preset}: real Nitro ${expectedPreset} output passed`);

function assertNitroCacheRouteRule(serverCode: string): void {
  for (
    const [label, pattern] of [
      ['route', /["']\/cached["']/],
      ['cache middleware', /["']cache["']/],
      ['maxAge', /["']?maxAge["']?\s*:\s*60/],
      ['swr', /["']?swr["']?\s*:\s*(?:true|!0)/],
    ] as const
  ) {
    if (!pattern.test(serverCode)) {
      console.error(`Nitro cache route rule missing ${label}: ${pattern}`);
      Deno.exit(1);
    }
  }
}
