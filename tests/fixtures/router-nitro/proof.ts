import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { readFile, rename, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import process from 'node:process';
import { setTimeout } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import {
  checkPackagedPublicFiles,
  checkPublishOutput,
} from '../../../packages/router/src/vite/internal/publish-manifest.ts';
import { assertCompatibilityDate } from '../../../tools/lib/compatibility-date.ts';
import { runCaptured } from '../../../tools/lib/process.ts';
import {
  NITRO_COMPATIBILITY_DATE,
  NITRO_VERSION,
} from '../../../tools/release/nitro-compatibility.ts';
import {
  asRequest,
  assertIdentity,
  assertRuntime,
  assertTransport,
  type FetchLike,
  NODE_TOKEN,
  WORKER_TOKEN,
} from './acceptance.ts';

const {
  positionals: [preset],
  values,
} = parseArgs({
  options: { origin: { type: 'string' } },
  allowPositionals: true,
});

assert.ok(preset === 'node' || preset === 'workers', 'Expected preset: node or workers');

const fixture = new URL('./', import.meta.url);
const output = new URL(`.output-${preset}/`, fixture);
const serverPreset = preset === 'workers' ? 'cloudflare_module' : 'node-server';

type NitroManifest = {
  preset: string;
  serverEntry: string;
  publicDir: string;
  config?: { cloudflare?: { nodeCompat?: boolean } };
};

async function build(): Promise<NitroManifest> {
  assertCompatibilityDate(NITRO_COMPATIBILITY_DATE);
  await runCaptured(
    [
      'vp',
      'run',
      '--no-cache',
      '--fail-if-no-match',
      '--filter',
      '@openelement/fixture-router-request-time',
      'build',
    ],
    { cwd: fixture },
  );

  const staging = new URL('.output/', fixture);
  await rm(staging, { recursive: true, force: true });
  await rm(output, { recursive: true, force: true });
  const log = await runCaptured(
    [
      'npx',
      '--yes',
      `nitro@${NITRO_VERSION}`,
      'build',
      '--dir',
      fileURLToPath(fixture),
      '--preset',
      serverPreset,
    ],
    { cwd: fixture },
  );
  assert.doesNotMatch(log, /Node\.js compatibility is not enabled/);
  await rename(staging, output);

  const manifest = JSON.parse(
    await readFile(new URL('nitro.json', output), 'utf8'),
  ) as NitroManifest;
  assert.equal(manifest.preset, preset === 'workers' ? 'cloudflare-module' : 'node-server');
  return manifest;
}

async function verifyArtifacts(manifest: NitroManifest): Promise<URL> {
  const { files } = checkPublishOutput(
    fileURLToPath(new URL('../router-request-time/dist', fixture)),
  );
  const publicDir = new URL(`${manifest.publicDir}/`, output);
  checkPackagedPublicFiles(
    fileURLToPath(publicDir),
    files,
    preset === 'workers' ? '_headers' : undefined,
  );
  if (preset === 'workers') {
    assert.equal(manifest.config?.cloudflare?.nodeCompat, true);
    const configUrl = new URL('server/wrangler.json', output);
    const config = JSON.parse(await readFile(configUrl, 'utf8')) as {
      assets: { binding: string; directory: string };
    };
    assert.equal(config.assets.binding, 'ASSETS');
    assert.equal(new URL(config.assets.directory + '/', configUrl).href, publicDir.href);
  }
  return publicDir;
}

async function freePort(): Promise<number> {
  const probe = createServer();
  probe.listen(0, '127.0.0.1');
  await once(probe, 'listening');
  const address = probe.address();
  assert.ok(address && typeof address === 'object');
  probe.close();
  await once(probe, 'close');
  return address.port;
}

async function checkNode(serverEntry: URL, publicDir: URL): Promise<void> {
  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  const server = spawn(process.execPath, [fileURLToPath(serverEntry)], {
    env: { ...process.env, PORT: String(port), HOST: '127.0.0.1' },
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  const exited = once(server, 'exit');
  try {
    let ready = false;
    for (let attempt = 0; attempt < 50 && server.exitCode === null; attempt++) {
      const response = await fetch(origin).catch(() => undefined);
      if (response) {
        await response.body?.cancel();
        ready = true;
        break;
      }
      await setTimeout(100);
    }
    assert.ok(ready, 'Nitro node-server did not become ready');
    await checkApp(fetch, origin, publicDir, false);
  } finally {
    server.kill();
    await exited;
  }
}

type WorkerEnv = {
  REQUEST_TIME_PROOF_TOKEN?: string;
  ASSETS: { fetch: FetchLike };
};

type WorkerFetch = (
  request: Request,
  env: WorkerEnv,
  context: { waitUntil(promise: Promise<unknown>): void; passThroughOnException(): void },
) => Promise<Response>;

async function checkWorkers(serverEntry: URL, publicDir: URL): Promise<void> {
  const imported = (await import(serverEntry.href)) as { default?: { fetch?: WorkerFetch } };
  const workerFetch = imported.default?.fetch;
  assert.equal(typeof workerFetch, 'function', 'Expected the generated Worker default.fetch');
  assert.ok(workerFetch);

  const assets = { fetch: (request: Request) => fetchAsset(publicDir, request) };
  const context = { waitUntil: () => {}, passThroughOnException: () => {} };
  const origin = 'https://fixture.example';
  await checkApp(
    (request) =>
      workerFetch(request, { ASSETS: assets, REQUEST_TIME_PROOF_TOKEN: WORKER_TOKEN }, context),
    origin,
    publicDir,
    true,
  );

  const checkBinding = async (token: string, binding: string | undefined, valid: boolean) => {
    const request = asRequest(origin, '/set-header', {
      headers: { authorization: `Bearer ${token}` },
    });
    const response = await workerFetch(
      request,
      { ASSETS: assets, REQUEST_TIME_PROOF_TOKEN: binding },
      context,
    );
    await assertIdentity(response, valid ? 'bearer' : 'anonymous', token);
  };
  // Reuse the same Worker module and pathname with overlapping bindings.
  await Promise.all([
    checkBinding(WORKER_TOKEN, WORKER_TOKEN, true),
    checkBinding('fixture-other-worker-token', 'fixture-other-worker-token', true),
    checkBinding(WORKER_TOKEN, 'fixture-other-worker-token', false),
    checkBinding(NODE_TOKEN, undefined, false),
  ]);
}

async function checkApp(fetchRuntime: FetchLike, origin: string, publicDir: URL, worker: boolean) {
  const home = {
    path: worker ? '/index.html' : '/',
    html: await readFile(new URL('index.html', publicDir), 'utf8'),
  };
  const guestbook = {
    path: worker ? '/guestbook/index.html' : '/guestbook',
    html: await readFile(new URL('guestbook/index.html', publicDir), 'utf8'),
  };
  await assertRuntime(fetchRuntime, origin, worker ? WORKER_TOKEN : NODE_TOKEN, home, guestbook);
  await assertTransport(fetchRuntime, origin);
}

async function fetchAsset(publicDir: URL, request: Request): Promise<Response> {
  const file = new URL(`.${new URL(request.url).pathname}`, publicDir);
  if (!file.href.startsWith(publicDir.href)) return new Response(null, { status: 404 });
  try {
    const bytes = await readFile(file);
    return new Response(request.method === 'HEAD' ? null : bytes);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT')
      return new Response(null, { status: 404 });
    throw error;
  }
}

if (values.origin) {
  const url = new URL(values.origin);
  assert.ok(
    ['http:', 'https:'].includes(url.protocol) && url.href === url.origin + '/',
    'Expected the HTTP(S) origin of a deployed router-nitro fixture',
  );
  await assertRuntime(
    fetch,
    url.origin,
    preset === 'workers' ? WORKER_TOKEN : NODE_TOKEN,
    {
      path: '/',
    },
    {
      path: preset === 'workers' ? '/guestbook/' : '/guestbook',
    },
  );
  console.log(`nitro proof ${preset}: deployed Router fixture passed at ${url.origin}`);
} else {
  const manifest = await build();
  const publicDir = await verifyArtifacts(manifest);
  const serverEntry = new URL(manifest.serverEntry, output);
  if (preset === 'node') {
    await checkNode(serverEntry, publicDir);
  } else {
    await checkWorkers(serverEntry, publicDir);
  }
  console.log(
    `nitro proof ${preset}: Router build, public inventory, and ${manifest.preset} runtime passed`,
  );
}
