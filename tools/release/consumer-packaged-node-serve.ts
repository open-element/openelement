/**
 * Packed server-serve qualification (1.0.0-alpha.1 admission, Stage 5): prove
 * the PACKED @openelement/router + @openelement/element tarballs — never the
 * workspace source — build a minimal app and serve it under a plain
 * production runtime. Usage: `node tools/release/consumer-packaged-node-serve.ts
 * <node|bun>`. The runtime binary must be on PATH (CI provides it per job);
 * the app builds on the node-hosted toolchain and serves its Nitro output
 * under the target runtime.
 *
 * Cells: install (empty npm cache, explicit timeouts) -> boundary (no dep
 * resolves into the repository) -> build (packed /vite buildApp) -> serve
 * (build the Nitro server output from the packed app and boot it under the
 * target runtime, probe the static home and one request-time dynamic route
 * over HTTP).
 *
 * The deploy target runs the Nitro output: local preview is served by
 * cli/start, so plain node (or bun) boots the Nitro server entry built from
 * the packed app via the packed @openelement/router/nitro-mount.
 */
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { cp, mkdtemp, realpath, rm } from 'node:fs/promises';
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';

import { join, resolve } from 'node:path';
import { formatJson } from '@openelement/element/build-utils';
import { PACKAGE_VERSION } from '../repo/project-constants.ts';
import { VITE_DEV_PIN } from '../repo/deps-vite-check.ts';
import { NITRO_VERSION } from './nitro-compatibility.ts';
import { runProcess } from './consumer-packaged-shared.ts';

const repoRoot = resolve(import.meta.dirname!, '../..');
const INSTALL_TIMEOUT_MS = 10 * 60_000;
const BUILD_TIMEOUT_MS = 10 * 60_000;
const SERVER_READY_TIMEOUT_MS = 60_000;

const runtime = process.argv[2];
if (runtime !== 'node' && runtime !== 'bun') {
  throw new Error('usage: consumer-packaged-node-serve.ts <node|bun>');
}

function run(
  command: string,
  args: string[],
  cwd: string,
  env: Record<string, string>,
  timeoutMs?: number,
): Promise<{ success: boolean; output: string }> {
  return runProcess(command, args, cwd, { timeoutMs, env });
}

const routerTarball = join(
  repoRoot,
  'packages',
  'router',
  `openelement-router-${PACKAGE_VERSION}.tgz`,
);
const elementTarball = join(
  repoRoot,
  'packages',
  'element',
  `openelement-element-${PACKAGE_VERSION}.tgz`,
);
for (const tarball of [routerTarball, elementTarball]) {
  if (!existsSync(tarball)) {
    throw new Error(
      `Missing packed release artifact: ${tarball} (run \`pnpm --dir tools/release run pack:dry-run\` first)`,
    );
  }
}

const tmp = await mkdtemp(join(tmpdir(), `openelement-packed-serve-${runtime}-`));
let server: import('node:child_process').ChildProcess | undefined;
try {
  // The unpublished @openelement/* file: pins resolve into the installed
  // node_modules tree instead of the registry. Since #1557 the packed
  // element/router tarballs carry transitive workspace pins (protocol,
  // compiler at the exact current version); declaring every framework
  // tarball as a direct file: dependency lets npm dedupe satisfy those
  // transitives from the local tarballs pre-publish.
  writeFileSync(
    join(tmp, 'package.json'),
    formatJson({
      name: `openelement-packed-serve-consumer-${runtime}`,
      private: true,
      type: 'module',
      dependencies: {
        '@openelement/router': `file:${routerTarball}`,
        '@openelement/element': `file:${elementTarball}`,
        '@openelement/protocol': `file:${repoRoot}/packages/protocol/openelement-protocol-${PACKAGE_VERSION}.tgz`,
        '@openelement/compiler': `file:${repoRoot}/packages/compiler/openelement-compiler-${PACKAGE_VERSION}.tgz`,
        vite: VITE_DEV_PIN,
        hono: '4.12.0',
        nitro: NITRO_VERSION,
      },
    }),
  );
  // The pinned Nitro line formally supports the Alpha Vite major in its
  // peer metadata (see tools/release/nitro-compatibility.ts), so the install runs
  // without --legacy-peer-deps; a peer conflict fails closed here.
  const install = await run(
    'npm',
    ['install', '--ignore-scripts', '--no-audit', '--no-fund'],
    tmp,
    { NPM_CONFIG_CACHE: join(tmp, '.npm-cache') },
    INSTALL_TIMEOUT_MS,
  );
  if (!install.success) throw new Error(`Packed serve installation failed:\n${install.output}`);
  console.log(`PASS packed-serve-${runtime} install — tarballs installed under an empty npm cache`);

  for (const name of ['@openelement/router', '@openelement/element', 'vite', 'hono']) {
    const resolved = await realpath(join(tmp, 'node_modules', ...name.split('/')));
    if (resolved === repoRoot || resolved.startsWith(`${repoRoot}/`)) {
      throw new Error(`Packed serve consumer resolved ${name} into the repository: ${resolved}`);
    }
  }
  console.log(`PASS packed-serve-${runtime} boundary — no dependency resolves into the repository`);

  // Nitro deploy contract: the packed app is served on the target runtime
  // through the packed nitro-mount. Local preview stays on cli/start; the
  // build generates no second production server.
  const nitroPreset = runtime === 'bun' ? 'bun' : 'node-server';
  const files: Record<string, string> = {
    'nitro.config.ts': `export default defineNitroConfig({
  serverDir: 'server',
  preset: '${nitroPreset}',
  publicAssets: [{ dir: 'nitro-public' }],
  output: { dir: '.output-serve' },
});
`,
    'server/routes/[...path].ts': `import { createOpenElementNitroHandler } from '@openelement/router/nitro-mount';
import openElementServer from '../../dist/server/index.js';

// Catch-all over the Nitro static layer (nitro-public/): prerendered files
// win, everything else — dynamic routes, actions, 404s — falls through to
// the packed request-time server through the standard fetch seam.
export default createOpenElementNitroHandler({
  handler: (request, context) =>
    openElementServer({
      req: request,
      env: (context.env ?? {}) as Record<string, string>,
    }),
});
`,
    'vite.config.js': `import { openElement } from '@openelement/router/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  base: '/',
  oxc: { jsx: { runtime: 'automatic', importSource: '@openelement/element' } },
  plugins: [
    openElement({
      routesDir: 'app/routes',
      componentsDir: 'app/components',
      appShell: false,
      head: { title: 'packed serve proof' },
    }),
  ],
});
`,
    'build.mjs': `import { buildApp } from '@openelement/router/vite';
await buildApp();
`,
    'app/routes/index.tsx': `import { definePage } from '@openelement/router';
import HomePage from '../components/page-home.tsx';

export default definePage(HomePage, { head: { title: 'packed serve proof — home' } });
`,
    'app/components/page-home.tsx': `import { element, OpenElement } from '@openelement/element';

@element('packed-home', { root: 'shadow-open' })
export default class PackedHome extends OpenElement {
  render() {
    return (
      <main>
        <h1 id='home-marker'>packed-node-serve home</h1>
      </main>
    );
  }
}
`,
    'app/routes/live.tsx': `import { definePage, type LoaderContext } from '@openelement/router';
import LivePage from '../components/page-live.tsx';

export function loader(ctx: LoaderContext): { x: string } {
  return { x: new URL(ctx.request.url).searchParams.get('x') ?? '' };
}

export default definePage<{ x: string }>(LivePage, {
  renderIntent: { mode: 'dynamic' },
  head: { title: 'packed serve proof — live' },
  props({ data }) {
    return { xText: \`x=\${data?.x ?? ''}\` };
  },
});
`,
    'app/components/page-live.tsx': `import { element, OpenElement, property } from '@openelement/element';

@element('packed-live', { root: 'shadow-open' })
export default class PackedLive extends OpenElement {
  @property({ reflect: false, attribute: false })
  xText = 'x=';

  render() {
    return (
      <main>
        <h1>packed-node-serve live</h1>
        <p id='x-value'>{this.xText}</p>
      </main>
    );
  }
}
`,
  };
  for (const [path, content] of Object.entries(files)) {
    const target = join(tmp, path);
    mkdirSync(join(tmp, path.split('/').slice(0, -1).join('/')), { recursive: true });
    writeFileSync(target, content);
  }

  // build.mjs drives the packed router vite build (Rolldown native binding)
  // on the plain node host.
  const build = await run(process.execPath, ['build.mjs'], tmp, {}, BUILD_TIMEOUT_MS);
  if (!build.success) throw new Error(`Packed serve build failed:\n${build.output}`);
  for (const artifact of ['dist/server/index.js', 'dist/index.html']) {
    if (!existsSync(join(tmp, artifact))) {
      throw new Error(`Packed build emitted no ${artifact}`);
    }
  }
  console.log(`PASS packed-serve-${runtime} build — packed CLI emitted dist + request-time server`);

  // Publish the prerendered tree for Nitro's static layer. dist/server/*
  // is server code, not a public asset, so it stays out of nitro-public/.
  mkdirSync(join(tmp, 'nitro-public'), { recursive: true });
  for (const entry of readdirSync(join(tmp, 'dist'), { withFileTypes: true })) {
    if (entry.name === 'server') continue;
    await cp(join(tmp, 'dist', entry.name), join(tmp, 'nitro-public', entry.name), {
      force: true,
      recursive: entry.isDirectory(),
    });
  }
  if (existsSync(join(tmp, 'nitro-public', 'server'))) {
    throw new Error('Static publish leaked dist/server into the Nitro public dir');
  }
  // Nitro 3 builds on a Rolldown-based pipeline (native binding). The pinned
  // nitro CLI runs through npx (the temp consumer's own install satisfies the
  // pin without a re-download).
  const nitroBuild = await run(
    'npx',
    ['--yes', `nitro@${NITRO_VERSION}`, 'build'],
    tmp,
    {},
    BUILD_TIMEOUT_MS,
  );
  if (!nitroBuild.success) throw new Error(`Packed Nitro build failed:\n${nitroBuild.output}`);
  const nitroEntry = join(tmp, '.output-serve', 'server', 'index.mjs');
  if (!existsSync(nitroEntry)) {
    throw new Error(`Packed Nitro build emitted no server entry: ${nitroEntry}`);
  }
  console.log(
    `PASS packed-serve-${runtime} nitro — ${nitroPreset} output built from the packed app`,
  );

  // Reserve a loopback port with a bind-and-close probe.
  const port = await new Promise<number>((resolve, reject) => {
    const probe = createServer();
    probe.once('listening', () => {
      const addr = probe.address() as { port: number };
      probe.close(() => resolve(addr.port));
    });
    probe.once('error', reject);
    probe.listen({ port: 0, host: '127.0.0.1' });
  });
  server = spawn(runtime, [nitroEntry], {
    cwd: tmp,
    env: { ...process.env, PORT: String(port), HOST: '127.0.0.1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let exited = false;
  let exitCode: number | null = null;
  let exitSignal: string | null = null;
  server.addListener('exit', (code: number | null, signal: NodeJS.Signals | null) => {
    exited = true;
    exitCode = code;
    exitSignal = signal;
  });
  const serverOutput: Uint8Array[] = [];
  void (async () => {
    try {
      for await (const chunk of server.stdout!) serverOutput.push(chunk);
    } catch {
      /* pipe closed on kill */
    }
  })();
  void (async () => {
    try {
      for await (const chunk of server.stderr!) serverOutput.push(chunk);
    } catch {
      /* pipe closed on kill */
    }
  })();
  const serverLog = () => {
    const text = new TextDecoder().decode(
      serverOutput.reduce((acc, c) => {
        const merged = new Uint8Array(acc.length + c.length);
        merged.set(acc);
        merged.set(c, acc.length);
        return merged;
      }, new Uint8Array(0)),
    );
    return text.slice(-4000);
  };
  const baseUrl = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + SERVER_READY_TIMEOUT_MS;
  let ready = false;
  while (Date.now() < deadline && !exited) {
    try {
      const response = await fetch(`${baseUrl}/`);
      await response.text();
      ready = true;
      break;
    } catch {
      await new Promise((resolveWait) => setTimeout(resolveWait, 200));
    }
  }
  if (!ready) {
    throw new Error(
      `packed serve did not become ready within ${SERVER_READY_TIMEOUT_MS}ms` +
        ` (runtime=${runtime}, exited=${exited}, code=${exitCode}, signal=${exitSignal}, url=${baseUrl}/)\n` +
        `--- server output (tail) ---\n${serverLog()}`,
    );
  }
  const home = await (await fetch(`${baseUrl}/`)).text();
  if (!home.includes('packed-node-serve home')) {
    throw new Error('packed serve / missing the static home marker');
  }
  const live = await (await fetch(`${baseUrl}/live?x=1`)).text();
  if (!live.includes('packed-node-serve live') || !live.includes('x=1')) {
    throw new Error('packed serve /live missing the request-time marker or loader echo');
  }
  console.log(
    `PASS packed-serve-${runtime} serve — Nitro ${nitroPreset} output: static home + request-time /live green over HTTP under ${runtime}`,
  );
} finally {
  try {
    server?.kill('SIGTERM');
  } catch {
    // Already exited; temp-dir removal below is the cleanup that matters.
  }
  await rm(tmp, { recursive: true });
}
