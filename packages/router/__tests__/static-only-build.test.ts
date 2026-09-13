/**
 * @openelement/router — static-only build output contract (#953, #954).
 *
 * Builds the static-only fixture (no renderIntent 'dynamic' routes) and pins
 * the deployable tree:
 *   - #953: no dist/server is emitted for a pure-static project, so the
 *     `cli/start --mode=preview` gate accepts the output and vite preview
 *     actually serves it (previously the leftover SSR bundle directory made
 *     preview look unsupported).
 *   - #954: an app/routes/*.mdx page is discovered by the route scanner and
 *     prerendered with real content.
 *
 * The fixture dist is gitignored; build it on demand (a no-op when present):
 *   deno task fixture:router-static-only:build
 */

import { assert, assertEquals, assertStringIncludes } from '@std/assert';
import { join } from '@std/path';

const fixtureDir = join(import.meta.dirname!, '../../../fixtures/router-static-only');
const distDir = join(fixtureDir, 'dist');
const repoRoot = join(fixtureDir, '../..');

async function ensureFixtureBuild(): Promise<void> {
  // #953: the assertion below requires output from current sources — a stale
  // dist/server from a pre-fix build would falsify the contract, so always
  // rebuild (the build is incremental enough for local runs).
  const build = await new Deno.Command(Deno.execPath(), {
    args: [
      'run',
      '--config',
      join(repoRoot, 'deno.json'),
      '-A',
      join(fixtureDir, '../../packages/router/src/cli/build.ts'),
    ],
    cwd: fixtureDir,
    stdout: 'piped',
    stderr: 'piped',
  }).output();
  const logs = new TextDecoder().decode(build.stdout) + new TextDecoder().decode(build.stderr);
  assertEquals(build.code, 0, `static-only fixture build failed:\n${logs}`);
}

Deno.test('static-only build: no dist/server, mdx route prerendered (#953, #954)', async () => {
  await ensureFixtureBuild();

  assertEquals(
    await Deno.stat(join(distDir, 'index.html')).then(() => true).catch(() => false),
    true,
    'index.html should exist after build',
  );
  // #953: pure-static projects must not ship the build-time SSR bundle.
  assertEquals(
    await Deno.stat(join(distDir, 'server')).then(() => true).catch(() => false),
    false,
    'pure-static build must not emit dist/server',
  );

  // #954: the .mdx route is discovered and prerendered with real content.
  const mdxHtml = await Deno.readTextFile(join(distDir, 'mdx-page', 'index.html'));
  assertStringIncludes(mdxHtml, 'MDX route page');
});

Deno.test({
  name: 'static-only build: preview mode serves the output (#953)',
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    await ensureFixtureBuild();

    const probe = Deno.listen({ hostname: '127.0.0.1', port: 0 });
    const freePort = (probe.addr as Deno.NetAddr).port;
    probe.close();

    const startCli = join(import.meta.dirname!, '../src/cli/start.ts');
    let server: Deno.ChildProcess | undefined;
    try {
      server = new Deno.Command(Deno.execPath(), {
        args: [
          'run',
          '-A',
          startCli,
          '--mode=preview',
          '--port',
          String(freePort),
          '--host',
          '127.0.0.1',
        ],
        cwd: fixtureDir,
        stdout: 'null',
        stderr: 'null',
      }).spawn();

      let response: Response | undefined;
      for (let attempt = 0; attempt < 100; attempt++) {
        try {
          response = await fetch(`http://127.0.0.1:${freePort}/`);
          break;
        } catch {
          await new Promise((resolve) => setTimeout(resolve, 200));
        }
      }
      assert(response, 'preview mode did not come up for a pure-static project (#953)');
      assertEquals(response.status, 200);
      await response.body?.cancel();
    } finally {
      try {
        server?.kill('SIGTERM');
      } catch {
        // The process may have already exited.
      }
      await server?.status.catch(() => undefined);
      // Preview delegates to a `deno run -A npm:vite preview` grandchild;
      // kill it by its unique port argument so no server leaks.
      await new Deno.Command('pkill', {
        args: ['-f', `npm:vite preview --port ${freePort}`],
        stdout: 'null',
        stderr: 'null',
      }).output().catch(() => undefined);
    }
  },
});
