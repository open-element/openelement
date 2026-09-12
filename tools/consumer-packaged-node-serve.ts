/**
 * Packed server-serve qualification (1.0.0-alpha.1 admission, Stage 5): prove
 * the PACKED @openelement/router + @openelement/element tarballs — never the
 * workspace source — build a minimal app and serve it under a plain
 * production runtime. Usage: `deno run ... consumer-packaged-node-serve.ts
 * <node|bun>`. The runtime binary must be on PATH (CI provides it per job);
 * the app build always runs under plain node.
 *
 * Cells: install (empty npm cache, explicit timeouts) -> boundary (no dep
 * resolves into the repository) -> build (packed /vite buildApp under node)
 * -> serve (boot dist/server/serve.mjs under the target runtime, probe the
 * static home and one request-time dynamic route over HTTP).
 */
import { existsSync } from '@std/fs';
import { join, resolve } from '@std/path';
import { formatJson } from '@openelement/element/build-utils';
import { PACKAGE_VERSION } from './project-constants.ts';

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
      },
    }),
  );
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

  const files: Record<string, string> = {
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

  const build = await run('node', ['build.mjs'], tmp, {}, BUILD_TIMEOUT_MS);
  if (!build.success) throw new Error(`Packed serve build failed:\n${build.output}`);
  for (const artifact of ['dist/server/index.js', 'dist/server/serve.mjs', 'dist/index.html']) {
    if (!existsSync(join(tmp, artifact))) {
      throw new Error(`Packed build emitted no ${artifact}`);
    }
  }
  console.log(`PASS packed-serve-${runtime} build — packed CLI emitted dist + request-time server`);

  const probe = Deno.listen({ hostname: '127.0.0.1', port: 0 });
  const port = (probe.addr as Deno.NetAddr).port;
  probe.close();
  server = new Deno.Command(runtime, {
    args: ['dist/server/serve.mjs'],
    cwd: tmp,
    env: { OPEN_ELEMENT_PORT: String(port), OPEN_ELEMENT_HOST: '127.0.0.1' },
    stdout: 'piped',
    stderr: 'piped',
  }).spawn();
  let exited = false;
  server.status.then(() => {
    exited = true;
  });
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
    throw new Error(`packed serve did not become ready within ${SERVER_READY_TIMEOUT_MS}ms`);
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
    `PASS packed-serve-${runtime} serve — static home + request-time /live green over HTTP under ${runtime}`,
  );
} finally {
  try {
    server?.kill('SIGTERM');
  } catch {
    // Already exited; temp-dir removal below is the cleanup that matters.
  }
  await Deno.remove(tmp, { recursive: true });
}
