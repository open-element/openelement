/**
 * Local alpha5 streamed-GET comparison. MANUAL benchmark — `pnpm run bench`
 * (the vitest benchmarks project covers benchmarks/micro only) and CI never
 * run it. After building the Native fixture:
 * node benchmarks/streaming/measure.ts --samples 10 --delay 100 \
 *   --out .artifacts/stream-alpha5-local.json
 */
import { mkdir, stat, writeFile } from 'node:fs/promises';
import process from 'node:process';
import { chromium } from '@playwright/test';
import { dirname, fromFileUrl } from '@std/path';
import { commandOutput } from '../../tools/repo/node-command.ts';
import { serveFetch } from '../../packages/router/src/internal/node-http.ts';
import {
  dispatchRequest,
  importRequestTimeServer,
} from '../../packages/router/src/vite/internal/static-serve.ts';

const fixture = new URL('../../tests/fixtures/router-native-framework/', import.meta.url);
const distDir = new URL('dist/', fixture);
const serverEntry = new URL('dist/server/index.js', fixture);
const message = 'Rendered as data resolves';

function option(name: string, fallback?: string): string | undefined {
  const argv = process.argv.slice(2);
  const index = argv.indexOf(name);
  return index < 0 ? fallback : argv[index + 1];
}

function envRecord(): Record<string, string> {
  // Mirrors the start CLI's processEnvRecord: node's process.env carries
  // `string | undefined` values; the dispatch contract wants plain strings.
  const record: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) record[key] = value;
  }
  return record;
}

function median(values: number[]): number {
  const ordered = [...values].sort((a, b) => a - b);
  const middle = ordered.length / 2;
  return ordered.length % 2
    ? ordered[Math.floor(middle)]
    : (ordered[middle - 1] + ordered[middle]) / 2;
}

async function git(args: string[]): Promise<string> {
  const result = await commandOutput('git', { args, cwd: fixture.pathname });
  if (!result.success) throw new Error(`git ${args.join(' ')} failed`);
  return new TextDecoder().decode(result.stdout).trim();
}

async function ready(base: string): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      const response = await fetch(base);
      await response.body?.cancel();
      if (response.ok) return;
    } catch {
      // The server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('fixture server did not start');
}

const samples = Number(option('--samples', '10'));
const delay = Number(option('--delay', '100'));
const out = option('--out');
if (
  !out ||
  !Number.isInteger(samples) ||
  samples < 2 ||
  samples > 100 ||
  !Number.isInteger(delay) ||
  delay < 5 ||
  delay > 100
) {
  throw new Error('pass --out <path>, --samples 2..100 and --delay 5..100');
}
await stat(fromFileUrl(serverEntry));

// One serving socket owns the port for the whole measurement. The previous
// shape bound port 0, read the port, closed the listener and hoped the
// generated server would win the re-bind — a window in which any process on
// the machine can take the port. The node:http ↔ fetch adapter
// (`serveFetch` in packages/router/src/internal/node-http.ts — the same
// server the start CLI and the shared static test server run on) picks the
// port and this same server answers every request until shutdown.
// Requests reach the fixture's built output through the shared static and
// request-time adapter the fixture's own e2e/server.ts wraps, so the measured
// artifact is still dist/ + dist/server.
const distRoot = fromFileUrl(distDir);
const serverMod = await importRequestTimeServer(fromFileUrl(serverEntry));
const server = serveFetch({
  hostname: '127.0.0.1',
  port: 0,
  handler: (request) =>
    dispatchRequest(request, {
      distDir: distRoot,
      serverMod,
      env: { ...envRecord(), OPEN_ELEMENT_DISABLE_CSRF: '1' },
      onHandlerError: (error) => console.error('[streaming measure] fixture handler error:', error),
    }),
});
await new Promise<void>((resolve, reject) => {
  server.once('listening', () => resolve());
  server.once('error', reject);
});
const address = server.address();
if (address === null || typeof address === 'string') {
  throw new Error('fixture server: loopback listener has no port');
}
const base = `http://127.0.0.1:${address.port}`;

try {
  await ready(base);
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    try {
      const run = async (mode: 'stream' | 'off') => {
        const page = await context.newPage();
        try {
          const tag = mode === 'stream' ? 'stream-proof-page' : 'stream-proof-off-page';
          const route = mode === 'stream' ? '/stream-proof' : '/stream-proof-off';
          const response = await page.goto(`${base}${route}?delay=${delay}`, {
            waitUntil: 'commit',
          });
          if (response?.status() !== 200) {
            throw new Error(`${route} returned ${response?.status()}`);
          }
          await page.waitForFunction(
            ({ tag, message }) =>
              document.querySelector(tag)?.shadowRoot?.querySelector('#delayed')?.textContent ===
              message,
            { tag, message },
          );
          const partReadyProxyMs = await page.evaluate(() => performance.now());
          await page.waitForFunction(
            () => performance.getEntriesByName('first-contentful-paint').length > 0,
          );
          const fcpMs = await page.evaluate(
            () => performance.getEntriesByName('first-contentful-paint')[0].startTime,
          );
          return { fcpMs, partReadyProxyMs };
        } finally {
          await page.close();
        }
      };

      await run('off');
      await run('stream');
      type Timing = Awaited<ReturnType<typeof run>>;
      const observations: Array<{
        index: number;
        order: Array<'stream' | 'off'>;
        stream: Timing;
        off: Timing;
      }> = [];
      for (let index = 0; index < samples; index++) {
        const order: Array<'stream' | 'off'> = index % 2 ? ['off', 'stream'] : ['stream', 'off'];
        const first = await run(order[0]);
        const second = await run(order[1]);
        observations.push({
          index,
          order,
          stream: order[0] === 'stream' ? first : second,
          off: order[0] === 'off' ? first : second,
        });
      }
      const summary = (mode: 'stream' | 'off') => ({
        fcpMedianMs: median(observations.map((pair) => pair[mode]!.fcpMs)),
        partReadyProxyMedianMs: median(observations.map((pair) => pair[mode]!.partReadyProxyMs)),
      });
      const report = {
        schemaVersion: 1,
        issue: 1453,
        kind: 'local-advisory-stream-comparison',
        environment: {
          revision: await git(['rev-parse', 'HEAD']),
          workspaceDirty: (await git(['status', '--porcelain'])).length > 0,
          node: process.version,
          os: process.platform,
          arch: process.arch,
          browser: `chromium ${browser.version()}`,
          viewport: '1280x800',
        },
        method: {
          build:
            'router-native-framework workspace-source dist/ + dist/server served in-process through static-serve.ts; no Nitro deployment',
          routes: ['/stream-proof', '/stream-proof-off'],
          simulatedLoaderDelayMs: delay,
          sampleCountPerMode: samples,
          warmupPerMode: 1,
          navigation: 'fresh page per sample; waitUntil=commit; alternating mode order',
          fcp: 'PerformancePaintTiming first-contentful-paint, navigation-relative',
          partReadyProxy:
            'performance.now after Playwright polls the owning shadow Part text; includes polling overhead, not standardized TTI',
          scope: 'local Chromium observation; no CI timing threshold or production claim',
        },
        observations,
        medians: { stream: summary('stream'), off: summary('off') },
      };
      await mkdir(dirname(out), { recursive: true });
      await writeFile(out, `${JSON.stringify(report, null, 2)}\n`);
      console.log(`stream comparison: ${samples} samples/mode, FCP and Part-ready proxy -> ${out}`);
    } finally {
      await context.close();
    }
  } finally {
    await browser.close();
  }
} finally {
  // close() stops the listener; closeAllConnections() drops the keep-alive
  // sockets Chromium leaves open so the close callback resolves promptly.
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
}
