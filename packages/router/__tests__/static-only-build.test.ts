/**
 * @openelement/router — static-only build output contract (#953, #954).
 *
 * Builds the static-only fixture (no renderIntent 'dynamic' routes) and pins
 * the deployable tree:
 *   - #953: no dist/server is emitted for a pure-static project, so the
 *     `cli/start --mode=preview` gate accepts the output and preview
 *     actually serves it (previously the leftover SSR bundle directory made
 *     preview look unsupported).
 *   - #954: an app/routes/*.mdx page is discovered by the route scanner and
 *     prerendered with real content.
 *
 * The fixture dist is gitignored; build it on demand (a no-op when present):
 *   pnpm --dir tests/fixtures/router-static-only run build
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { stat, readFile } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { expect, test } from 'vitest';
import { join } from 'node:path';

const fixtureDir = join(import.meta.dirname!, '../../../tests/fixtures/router-static-only');
const distDir = join(fixtureDir, 'dist');

async function ensureFixtureBuild(): Promise<void> {
  // #953: the assertion below requires output from current sources — a stale
  // dist/server from a pre-fix build would falsify the contract, so always
  // rebuild (the build is incremental enough for local runs).
  // The fixture build runs the Vite native binding: scoped build-host
  // permissions with prompts off, never -A.
  const build = spawn(
    process.execPath,
    [join(fixtureDir, '../../../packages/router/src/cli/build.ts')],
    { cwd: fixtureDir },
  );
  const logs = (await Array.fromAsync(build.stdout)) + (await Array.fromAsync(build.stderr));
  const code = await new Promise<number>((resolve) => build.on('exit', (c) => resolve(c ?? -1)));
  expect(code, `static-only fixture build failed:\n${logs}`).toEqual(0);
}

test('static-only build: no dist/server, mdx route prerendered (#953, #954)', async () => {
  await ensureFixtureBuild();

  expect(
    await stat(join(distDir, 'index.html'))
      .then(() => true)
      .catch(() => false),
    'index.html should exist after build',
  ).toEqual(true);
  // #953: pure-static projects must not ship the build-time SSR bundle.
  expect(
    await stat(join(distDir, 'server'))
      .then(() => true)
      .catch(() => false),
    'pure-static build must not emit dist/server',
  ).toEqual(false);

  // #954: the .mdx route is discovered and prerendered with real content.
  const mdxHtml = await readFile(join(distDir, 'mdx-page', 'index.html'), 'utf8');
  expect(mdxHtml).toContain('MDX route page');
});

test('static-only build: zero islands, zero enhanced forms, zero client JS', async () => {
  // Phase 2 fail-closed hardening (client asset manifest) must not pull a
  // zero-JS build into client output: with no islands, no compiler-proven
  // interaction handlers, and no data-open-enhance routes, buildClient
  // returns before any client build or manifest read, and dist/client (the
  // client bundle, its .vite manifest, and the island manifests) is never
  // emitted.
  await ensureFixtureBuild();

  for (const absent of ['client', 'island-manifests']) {
    expect(
      await stat(join(distDir, absent))
        .then(() => true)
        .catch(() => false),
      `pure-static build must not emit dist/${absent}`,
    ).toEqual(false);
  }
});

test('static-only build: preview mode serves the output (#953)', async () => {
  await ensureFixtureBuild();

  const freePort = await new Promise<number>((resolve) => {
    const probe = createServer();
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address() as AddressInfo;
      probe.close(() => resolve(port));
    });
  });

  const startCli = join(import.meta.dirname!, '../src/cli/start.ts');
  let server: ChildProcess | undefined;
  try {
    server = spawn(
      process.execPath,
      [startCli, '--mode=preview', '--port', String(freePort), '--host', '127.0.0.1'],
      {
        cwd: fixtureDir,
        stdio: 'ignore',
      },
    );

    let response: Response | undefined;
    for (let attempt = 0; attempt < 100; attempt++) {
      try {
        response = await fetch(`http://127.0.0.1:${freePort}/`);
        break;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
    }
    expect(response, 'preview mode did not come up for a pure-static project (#953)').toBeTruthy();
    expect(response.status).toEqual(200);
    await response.body?.cancel();
  } finally {
    try {
      server?.kill('SIGTERM');
    } catch {
      // The process may have already exited.
    }
    if (server) {
      await new Promise<void>((resolve) => {
        server!.once('exit', () => resolve());
        setTimeout(resolve, 5000).unref();
      });
    }
    // Preview serves dist/ in its own process (no `vite preview` grandchild
    // since the static-contract unification), so SIGTERM above ends it.
  }
});
