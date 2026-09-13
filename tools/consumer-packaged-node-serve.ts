/**
 * Packed server-serve qualification (1.0.0-alpha.1 admission, Stage 5): prove
 * the PACKED @openelement/router + @openelement/element tarballs — never the
 * workspace source — build a minimal app and serve it under a plain
 * production runtime. Usage: `deno run ... consumer-packaged-node-serve.ts
 * <node|bun>`. The runtime binary must be on PATH (CI provides it per job);
 * the app builds on the Deno-driven toolchain and serves its Nitro output
 * under the target runtime.
 *
 * Cells: install (empty npm cache, explicit timeouts) -> boundary (no dep
 * resolves into the repository) -> build (packed /vite buildApp on the
 * supported Deno-driven toolchain) -> serve (build the Nitro server output
 * from the packed app and boot it under the target runtime, probe the
 * static home and one request-time dynamic route over HTTP).
 *
 * The build deliberately does NOT run under plain node: packed first-party
 * build modules use the Deno API where the Web platform offers no
 * filesystem/process capability (per the Alpha platform doctrine), and the
 * supported build toolchain is Deno-driven (`deno run npm:vite`,
 * `deno run <router>/cli/build`). The deploy target runs the Nitro output:
 * local preview is served by cli/start (Deno.serve from TypeScript source),
 * so plain node (or bun) boots the Nitro server entry built from the packed
 * app via the packed @openelement/router/nitro-mount.
 */
import { copy, existsSync } from '@std/fs';
import { join, resolve } from '@std/path';
import { formatJson } from '@openelement/element/build-utils';
import { PACKAGE_VERSION } from './project-constants.ts';
import { PACKED_STD_ALIASES } from './consumer-packaged-shared.ts';
import { NITRO_VERSION } from './nitro-compatibility.ts';

const repoRoot = resolve(import.meta.dirname!, '..');
const INSTALL_TIMEOUT_MS = 10 * 60_000;
const BUILD_TIMEOUT_MS = 10 * 60_000;
const SERVER_READY_TIMEOUT_MS = 60_000;

const runtime = Deno.args[0];
if (runtime !== 'node' && runtime !== 'bun') {
  throw new Error('usage: consumer-packaged-node-serve.ts <node|bun>');
}

async function run(
  command: string,
  args: string[],
  cwd: string,
  env: Record<string, string>,
  timeoutMs?: number,
): Promise<{ success: boolean; output: string }> {
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
      env,
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
      `Missing packed release artifact: ${tarball} (run \`deno task pack:dry-run\` first)`,
    );
  }
}

const tmp = await Deno.makeTempDir({ prefix: `openelement-packed-serve-${runtime}-` });
let server: Deno.ChildProcess | undefined;
try {
  // @jsr/* packages are served by JSR's npm compatibility layer (same idiom
  // as the other packed-consumer harnesses, #886); without it plain npm
  // cannot install the packed manifests' @jsr/std__* dependencies.
  Deno.writeTextFileSync(join(tmp, '.npmrc'), '@jsr:registry=https://npm.jsr.io\n');
  // Deno-driven build contract (same shape as the packed-app legs): the
  // unpublished @openelement/* pins resolve into the pre-laid node_modules
  // tree instead of the registry, and the @std/* pins cover direct Deno
  // resolution of the packed modules.
  Deno.writeTextFileSync(
    join(tmp, 'deno.json'),
    formatJson({
      imports: {
        '@openelement/router': `npm:@openelement/router@${PACKAGE_VERSION}`,
        '@openelement/router/vite': `npm:@openelement/router@${PACKAGE_VERSION}/vite`,
        '@openelement/element': `npm:@openelement/element@${PACKAGE_VERSION}`,
        'hono': 'npm:hono@4.12.0',
        'vite': 'npm:vite@8.0.16',
        '@std/fs': 'jsr:@std/fs@^1.0.0',
        '@std/fs/': 'jsr:@std/fs@^1.0.0/',
        '@std/jsonc': 'jsr:@std/jsonc@^1.0.0',
        '@std/media-types': 'jsr:@std/media-types@^1.0.0',
        '@std/path': 'jsr:@std/path@^1.0.0',
      },
      nodeModulesDir: 'manual',
      minimumDependencyAge: 0,
    }),
  );
  Deno.writeTextFileSync(
    join(tmp, 'package.json'),
    formatJson({
      name: `openelement-packed-serve-consumer-${runtime}`,
      private: true,
      type: 'module',
      dependencies: {
        '@openelement/router': `file:${routerTarball}`,
        '@openelement/element': `file:${elementTarball}`,
        'vite': '8.0.16',
        'hono': '4.12.0',
        'nitro': NITRO_VERSION,
        // Packed first-party modules keep bare @std/* specifiers; the
        // Nitro server output preserves node_modules imports for serve
        // time, and plain node resolves through node_modules, so alias
        // them to the npm-compat @jsr/std__* dirs (same contract as
        // consumer-packaged-shared.ts).
        ...PACKED_STD_ALIASES,
      },
    }),
  );
  // The pinned Nitro line formally supports the Alpha Vite major in its
  // peer metadata (see tools/nitro-compatibility.ts), so the install runs
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
    const resolved = await Deno.realPath(join(tmp, 'node_modules', ...name.split('/')));
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
    'server/routes/[...path].ts':
      `import { createOpenElementNitroHandler } from '@openelement/router/nitro-mount';
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
  esbuild: { jsx: 'automatic', jsxImportSource: '@openelement/element' },
  plugins: [
    openElement({
      routesDir: 'app/routes',
      componentsDir: 'app/components',
      appShell: false,
      html: { title: 'packed serve proof' },
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
    'app/components/page-live.tsx':
      `import { element, OpenElement, property } from '@openelement/element';

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
    Deno.mkdirSync(join(tmp, path.split('/').slice(0, -1).join('/')), { recursive: true });
    Deno.writeTextFileSync(target, content);
  }

  const build = await run(Deno.execPath(), ['run', '-A', 'build.mjs'], tmp, {}, BUILD_TIMEOUT_MS);
  if (!build.success) throw new Error(`Packed serve build failed:\n${build.output}`);
  for (const artifact of ['dist/server/index.js', 'dist/index.html']) {
    if (!existsSync(join(tmp, artifact))) {
      throw new Error(`Packed build emitted no ${artifact}`);
    }
  }
  console.log(`PASS packed-serve-${runtime} build — packed CLI emitted dist + request-time server`);

  // Publish the prerendered tree for Nitro's static layer. dist/server/*
  // is server code, not a public asset, so it stays out of nitro-public/.
  Deno.mkdirSync(join(tmp, 'nitro-public'), { recursive: true });
  for (const entry of Deno.readDirSync(join(tmp, 'dist'))) {
    if (entry.name === 'server') continue;
    await copy(join(tmp, 'dist', entry.name), join(tmp, 'nitro-public', entry.name), {
      overwrite: true,
    });
  }
  if (existsSync(join(tmp, 'nitro-public', 'server'))) {
    throw new Error('Static publish leaked dist/server into the Nitro public dir');
  }
  const nitroBuild = await run(
    Deno.execPath(),
    ['run', '-A', `npm:nitro@${NITRO_VERSION}`, 'build'],
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

  const probe = Deno.listen({ hostname: '127.0.0.1', port: 0 });
  const port = (probe.addr as Deno.NetAddr).port;
  probe.close();
  server = new Deno.Command(runtime, {
    args: [nitroEntry],
    cwd: tmp,
    env: { PORT: String(port), HOST: '127.0.0.1' },
    stdout: 'piped',
    stderr: 'piped',
  }).spawn();
  let exited = false;
  let exitCode: number | null = null;
  let exitSignal: string | null = null;
  server.status.then((status) => {
    exited = true;
    exitCode = status.code;
    exitSignal = status.signal;
  });
  const serverOutput: Uint8Array[] = [];
  void (async () => {
    try {
      for await (const chunk of server.stdout) serverOutput.push(chunk);
    } catch { /* pipe closed on kill */ }
  })();
  void (async () => {
    try {
      for await (const chunk of server.stderr) serverOutput.push(chunk);
    } catch { /* pipe closed on kill */ }
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
  await Deno.remove(tmp, { recursive: true });
}
