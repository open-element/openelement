import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, readFile, rename, rm } from 'node:fs/promises';
import process from 'node:process';
import { createInterface } from 'node:readline';
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
const buildLock = new URL('.output-proof-lock/', fixture);
const serverPreset = preset === 'workers' ? 'cloudflare_module' : 'node-server';

type NitroManifest = {
  preset: string;
  serverEntry: string;
  publicDir: string;
  config?: { cloudflare?: { nodeCompat?: boolean } };
};

async function acquireBuildLock(): Promise<void> {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    try {
      await mkdir(buildLock);
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      await setTimeout(200);
    }
  }
  throw new Error(
    `Timed out waiting for the Nitro fixture build lock at ${fileURLToPath(buildLock)}`,
  );
}

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
      name: string;
      assets: {
        binding: string;
        directory: string;
        run_worker_first: string[];
        html_handling: string;
      };
    };
    assert.equal(config.name, 'openelement-router-nitro-proof');
    assert.equal(config.assets.binding, 'ASSETS');
    assert.deepEqual(config.assets.run_worker_first, ['/guestbook']);
    assert.equal(config.assets.html_handling, 'drop-trailing-slash');
    assert.equal(new URL(config.assets.directory + '/', configUrl).href, publicDir.href);
  }
  return publicDir;
}

async function checkNode(serverEntry: URL, publicDir: URL): Promise<void> {
  const server = spawn(process.execPath, [fileURLToPath(serverEntry)], {
    env: {
      ...process.env,
      NITRO_PORT: '0',
      NITRO_HOST: '127.0.0.1',
      NITRO_SSL_CERT: '',
      NITRO_SSL_KEY: '',
    },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  const exited = once(server, 'close');
  const lines = createInterface({ input: server.stdout });
  const listening = new Promise<string>((resolve) => {
    lines.on('line', (line) => {
      const origin = /Listening on: (http:\/\/127\.0\.0\.1:\d+)\//.exec(line)?.[1];
      if (origin) resolve(origin);
    });
  });
  try {
    const origin = await Promise.race([
      listening,
      exited.then(() => undefined),
      setTimeout(5_000, undefined, { ref: false }),
    ]);
    assert.ok(origin, 'Nitro node-server did not announce a loopback address');
    await checkApp(fetch, origin, publicDir, false);
  } finally {
    lines.close();
    server.stdout.resume();
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
    path: '/guestbook',
    html: await readFile(new URL('guestbook/index.html', publicDir), 'utf8'),
  };
  await assertRuntime(fetchRuntime, origin, worker ? WORKER_TOKEN : NODE_TOKEN, home, guestbook);
  await assertTransport(fetchRuntime, origin);
}

async function fetchAsset(publicDir: URL, request: Request): Promise<Response> {
  const { pathname } = new URL(request.url);
  const asset = pathname === '/guestbook' ? '/guestbook/index.html' : pathname;
  const file = new URL(`.${asset}`, publicDir);
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
      path: '/guestbook',
    },
  );
  await assertTransport(fetch, url.origin);
  console.log(`nitro proof ${preset}: HTTP fixture passed at ${url.origin}`);
} else {
  // Both presets consume the same Router build directory and Nitro staging
  // directory. Hold the lock through artifact verification and execution.
  await acquireBuildLock();
  try {
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
  } finally {
    await rm(buildLock, { recursive: true });
  }
}
