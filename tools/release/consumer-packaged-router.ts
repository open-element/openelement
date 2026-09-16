/**
 * Strict, isolated packed Router consumers.
 *
 * Two contracts are proven against the final tarballs, never workspace source:
 *
 *  1. Route Mode (`@openelement/router/router`, `/http`, `/router/client`)
 *     installs and typechecks with Element absent, `strict`, and
 *     `skipLibCheck: false` on the supported TypeScript floor (5.9.3).
 *  2. Framework Mode (the package root) installs Element alongside Router,
 *     typechecks the documented root with the same strict settings, and
 *     matches Router's declared dependency/peer metadata.
 *
 * The declaration graph must resolve without undeclared globals: the
 * URLPattern types are Router-owned per `route-table.ts`, not a DOM-lib
 * version assumption.
 */
import { existsSync } from '@std/fs';
import { join, resolve } from '@std/path';
import { PACKAGE_VERSION } from '../repo/project-constants.ts';
import { readPackages } from '../lib/package-graph.ts';
import { tarballPath } from '../lib/npm-tarball.ts';

const repoRoot = resolve(import.meta.dirname!, '../..');
const packages = await readPackages();
const router = packages.find((pkg) => pkg.name === '@openelement/router');
const element = packages.find((pkg) => pkg.name === '@openelement/element');
if (!router) throw new Error('@openelement/router is missing from the package graph');
if (!element) throw new Error('@openelement/element is missing from the package graph');
const routerTarball = join(repoRoot, tarballPath(router));
const elementTarball = join(repoRoot, tarballPath(element));
for (const tarball of [routerTarball, elementTarball]) {
  if (!existsSync(tarball)) throw new Error(`Missing ${tarball}; run deno task pack:dry-run first`);
}

async function run(command: string, args: string[], cwd: string): Promise<string> {
  const result = await new Deno.Command(command, {
    args,
    cwd,
    stdout: 'piped',
    stderr: 'piped',
  }).output();
  const output = new TextDecoder().decode(result.stdout) + new TextDecoder().decode(result.stderr);
  if (!result.success) throw new Error(`${command} ${args.join(' ')} failed:\n${output}`);
  return output;
}

const STRICT_TSCONFIG = {
  compilerOptions: {
    target: 'ES2022',
    module: 'NodeNext',
    moduleResolution: 'NodeNext',
    strict: true,
    noEmit: true,
    skipLibCheck: false,
  },
};

async function routeModeConsumer(tmp: string): Promise<void> {
  await Deno.writeTextFile(
    join(tmp, 'package.json'),
    JSON.stringify(
      {
        name: 'openelement-router-route-mode-consumer',
        private: true,
        type: 'module',
        dependencies: {
          '@openelement/router': `file:${routerTarball}`,
          hono: '4.13.7',
        },
        devDependencies: { typescript: '5.9.3' },
      },
      null,
      2,
    ),
  );
  await Deno.writeTextFile(
    join(tmp, 'tsconfig.json'),
    JSON.stringify({ ...STRICT_TSCONFIG, include: ['route-mode.ts'] }, null, 2),
  );
  await Deno.writeTextFile(
    join(tmp, 'route-mode.ts'),
    `import { RouteTable, type RouteRecord } from '@openelement/router/router';
import { createRouteMiddleware } from '@openelement/router/http';
import { createRouter, type RouterInstance } from '@openelement/router/router/client';
const records: RouteRecord[] = [{ path: '/items/:id', methods: ['GET'] }];
const table = new RouteTable(records);
const resolved = table.resolve(new URL('https://example.test/items/42'), '', 'GET');
if (resolved.kind === 'match') {
  const groups: Record<string, string | undefined> = resolved.patternResult.pathname.groups;
  void groups; void resolved.params;
}
void createRouteMiddleware([{ path: '/items/:id', handlers: { GET: () => new Response('ok') } }]);
const typedOnly: RouterInstance | undefined = undefined;
void createRouter; void typedOnly;
`,
  );
  await Deno.writeTextFile(
    join(tmp, 'route-mode.mjs'),
    `import { RouteTable } from '@openelement/router/router';
import { createRouteMiddleware } from '@openelement/router/http';
const table = new RouteTable([{ id: 'item', path: '/items/:id', methods: ['GET'] }]);
const match = table.resolve(new URL('https://example.test/items/42?view=full'), '', 'GET');
if (match.kind !== 'match' || match.params.id !== '42' || match.searchParams.get('view') !== 'full') throw new Error('route resolution failed');
const method = table.resolve(new URL('https://example.test/items/42'), '', 'POST');
if (method.kind !== 'method-not-allowed' || method.allow.join(',') !== 'GET,HEAD') throw new Error('method semantics failed');
const routeMiddleware = createRouteMiddleware([{ path: '/items/:id', handlers: { GET: (_request, context) => Response.json({ id: context.params.id }) } }]);
const hostNext = () => Promise.resolve(new Response('host fallthrough', { status: 404 }));
const ok = await routeMiddleware(new Request('https://example.test/items/7'), hostNext);
if (ok.status !== 200 || (await ok.json()).id !== '7') throw new Error('HTTP route failed');
const wrong = await routeMiddleware(new Request('https://example.test/items/7', { method: 'POST' }), hostNext);
if (wrong.status !== 405 || wrong.headers.get('allow') !== 'GET, HEAD') throw new Error('HTTP 405 failed');
const controller = new AbortController(); controller.abort();
if (!controller.signal.aborted) throw new Error('cancellation cleanup failed');
console.log('packed Router Route Mode PASS');
`,
  );
  await run('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund'], tmp);
  for (
    const absent of [
      'node_modules/@openelement/element',
      'node_modules/preact',
      'node_modules/lit',
      'node_modules/@lit-labs/ssr',
    ]
  ) {
    if (existsSync(join(tmp, absent))) {
      throw new Error(`Route Mode installed optional runtime: ${absent}`);
    }
  }
  await run('node', ['node_modules/typescript/bin/tsc'], tmp);
  const output = await run('node', ['route-mode.mjs'], tmp);
  if (!output.includes('packed Router Route Mode PASS')) {
    throw new Error('Router probe did not run');
  }
}

async function frameworkRootConsumer(tmp: string): Promise<void> {
  await Deno.writeTextFile(
    join(tmp, 'package.json'),
    JSON.stringify(
      {
        name: 'openelement-router-root-consumer',
        private: true,
        type: 'module',
        dependencies: {
          '@openelement/router': `file:${routerTarball}`,
          '@openelement/element': `file:${elementTarball}`,
        },
        devDependencies: { typescript: '5.9.3' },
      },
      null,
      2,
    ),
  );
  await Deno.writeTextFile(
    join(tmp, 'tsconfig.json'),
    JSON.stringify(
      {
        ...STRICT_TSCONFIG,
        compilerOptions: { ...STRICT_TSCONFIG.compilerOptions },
        include: ['root.ts'],
      },
      null,
      2,
    ),
  );
  // The documented root: Framework Mode authoring. Element must resolve for
  // these declarations; the consumer installs it exactly as the README says.
  await Deno.writeTextFile(
    join(tmp, 'root.ts'),
    `import { createRequestContext, definePage } from '@openelement/router';
import type { LoaderContext, OpenElementPageDescriptor } from '@openelement/router';
import type { OpenElement } from '@openelement/element';
const authoring: typeof definePage = definePage;
const descriptor: OpenElementPageDescriptor | undefined = undefined;
const elementCtor: typeof OpenElement | undefined = undefined;
void authoring; void descriptor; void elementCtor;
async function loader(context: LoaderContext<Record<string, unknown>>) {
  return { url: context.request.url };
}
void loader;
const context = createRequestContext({
  request: new Request('https://example.test/items/42?view=full'),
  params: { id: '42' },
});
if (context.path !== '/items/42') throw new Error('request context failed');
`,
  );
  await run('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund'], tmp);
  if (!existsSync(join(tmp, 'node_modules/@openelement/element'))) {
    throw new Error('Framework Mode root did not install the declared Element peer');
  }
  await run('node', ['node_modules/typescript/bin/tsc'], tmp);
  await Deno.writeTextFile(
    join(tmp, 'root.mjs'),
    `import { createRequestContext } from '@openelement/router';
const context = createRequestContext({ request: new Request('https://example.test/items/42?view=full') });
if (context.path !== '/items/42' || context.searchParams.get('view') !== 'full') throw new Error('request context failed');
console.log('packed Router Framework Mode root PASS');
`,
  );
  const output = await run('node', ['root.mjs'], tmp);
  if (!output.includes('packed Router Framework Mode root PASS')) {
    throw new Error('Framework Mode root probe did not run');
  }
}

const routeModeTmp = await Deno.makeTempDir({ prefix: 'openelement-packed-router-routemode-' });
const rootTmp = await Deno.makeTempDir({ prefix: 'openelement-packed-router-root-' });
try {
  await routeModeConsumer(routeModeTmp);
  console.log(`Packed Router Route Mode passed for ${PACKAGE_VERSION} without Element.`);
  await frameworkRootConsumer(rootTmp);
  console.log(`Packed Router Framework Mode root passed for ${PACKAGE_VERSION} with Element.`);
} finally {
  await Deno.remove(routeModeTmp, { recursive: true }).catch(() => undefined);
  await Deno.remove(rootTmp, { recursive: true }).catch(() => undefined);
}
