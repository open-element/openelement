/** Packed Router Route Mode consumer: no Element or renderer dependency. */
import { existsSync } from '@std/fs';
import { join, resolve } from '@std/path';
import { PACKAGE_VERSION } from './project-constants.ts';
import { readPackages } from './lib/package-graph.ts';
import { tarballPath } from './lib/npm-tarball.ts';

const repoRoot = resolve(import.meta.dirname!, '..');
const router = (await readPackages()).find((pkg) => pkg.name === '@openelement/router');
if (!router) throw new Error('@openelement/router is missing from the package graph');
const tarball = join(repoRoot, tarballPath(router));
if (!existsSync(tarball)) throw new Error(`Missing ${tarball}; run deno task pack:dry-run first`);

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

const tmp = await Deno.makeTempDir({ prefix: 'openelement-packed-router-' });
try {
  await Deno.writeTextFile(
    join(tmp, 'package.json'),
    JSON.stringify(
      {
        name: 'openelement-router-route-mode-consumer',
        private: true,
        type: 'module',
        dependencies: {
          '@openelement/router': `file:${tarball}`,
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
    JSON.stringify(
      {
        compilerOptions: {
          target: 'ES2022',
          module: 'NodeNext',
          moduleResolution: 'NodeNext',
          strict: true,
          noEmit: true,
          skipLibCheck: true,
        },
        include: ['route-mode.ts'],
      },
      null,
      2,
    ),
  );
  await Deno.writeTextFile(
    join(tmp, 'route-mode.ts'),
    `import { RouteTable, type RouteRecord } from '@openelement/router/router';
import { createRouteMiddleware } from '@openelement/router/http';
import { createRouter, type RouterInstance } from '@openelement/router/router/client';
const records: RouteRecord[] = [{ path: '/items/:id', methods: ['GET'] }];
const table = new RouteTable(records);
void table.resolve(new URL('https://example.test/items/42'), '', 'GET');
void createRouteMiddleware([{ path: '/items/:id', handlers: { GET: (c) => c.text('ok') } }]);
const typedOnly: RouterInstance | undefined = undefined;
void createRouter; void typedOnly;
`,
  );
  await Deno.writeTextFile(
    join(tmp, 'route-mode.mjs'),
    `import { RouteTable } from '@openelement/router/router';
import { createRouteMiddleware } from '@openelement/router/http';
import { Hono } from 'hono';
const table = new RouteTable([{ id: 'item', path: '/items/:id', methods: ['GET'] }]);
const match = table.resolve(new URL('https://example.test/items/42?view=full'), '', 'GET');
if (match.kind !== 'match' || match.params.id !== '42' || match.searchParams.get('view') !== 'full') throw new Error('route resolution failed');
const method = table.resolve(new URL('https://example.test/items/42'), '', 'POST');
if (method.kind !== 'method-not-allowed' || method.allow.join(',') !== 'GET,HEAD') throw new Error('method semantics failed');
const app = new Hono();
app.all('*', createRouteMiddleware([{ path: '/items/:id', handlers: { GET: (c) => c.json({ id: c.get('routeResolution').params.id }) } }]));
const ok = await app.request('/items/7');
if (ok.status !== 200 || (await ok.json()).id !== '7') throw new Error('HTTP route failed');
const wrong = await app.request('/items/7', { method: 'POST' });
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
  console.log(`Packed Router Route Mode passed for ${PACKAGE_VERSION} without Element.`);
} finally {
  await Deno.remove(tmp, { recursive: true }).catch(() => undefined);
}
