/**
 * Local alpha5 streamed-GET comparison. Run after building the Native fixture:
 * deno run -A benchmarks/streaming/measure.ts --samples 10 --delay 100 \
 *   --out benchmarks/streaming/alpha5-local.json
 */
import { chromium } from '@playwright/test';
import { dirname } from '@std/path';

const fixture = new URL('../../tests/fixtures/router-native-framework/', import.meta.url);
const serverRoot = new URL('e2e/', fixture);
const serverEntry = new URL('dist/server/index.js', fixture);
const message = 'Rendered as data resolves';

function option(name: string, fallback?: string): string | undefined {
  const index = Deno.args.indexOf(name);
  return index < 0 ? fallback : Deno.args[index + 1];
}

function median(values: number[]): number {
  const ordered = [...values].sort((a, b) => a - b);
  const middle = ordered.length / 2;
  return ordered.length % 2
    ? ordered[Math.floor(middle)]
    : (ordered[middle - 1] + ordered[middle]) / 2;
}

async function git(args: string[]): Promise<string> {
  const result = await new Deno.Command('git', {
    args,
    cwd: fixture.pathname,
    stdout: 'piped',
    stderr: 'piped',
  }).output();
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
      // The generated server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('fixture server did not start');
}

const samples = Number(option('--samples', '10'));
const delay = Number(option('--delay', '100'));
const out = option('--out');
if (
  !out || !Number.isInteger(samples) || samples < 2 || samples > 100 ||
  !Number.isInteger(delay) || delay < 5 || delay > 100
) {
  throw new Error('pass --out <path>, --samples 2..100 and --delay 5..100');
}
await Deno.stat(serverEntry);

const listener = Deno.listen({ hostname: '127.0.0.1', port: 0 });
const port = (listener.addr as Deno.NetAddr).port;
listener.close();
const base = `http://127.0.0.1:${port}`;
const server = new Deno.Command(Deno.execPath(), {
  cwd: serverRoot.pathname,
  args: [
    'run',
    '--config',
    '../../../../deno.json',
    '--allow-read',
    '--allow-env',
    '--allow-net',
    'server.ts',
    '--port',
    String(port),
    '--dir',
    '../dist',
  ],
  env: { OPEN_ELEMENT_DISABLE_CSRF: '1' },
  stdout: 'null',
  stderr: 'null',
}).spawn();

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
          await page.waitForFunction(() =>
            performance.getEntriesByName('first-contentful-paint').length > 0
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
        partReadyProxyMedianMs: median(
          observations.map((pair) => pair[mode]!.partReadyProxyMs),
        ),
      });
      const report = {
        schemaVersion: 1,
        issue: 1453,
        kind: 'local-advisory-stream-comparison',
        environment: {
          revision: await git(['rev-parse', 'HEAD']),
          workspaceDirty: (await git(['status', '--porcelain'])).length > 0,
          deno: Deno.version.deno,
          os: Deno.build.os,
          arch: Deno.build.arch,
          browser: `chromium ${browser.version()}`,
          viewport: '1280x800',
        },
        method: {
          build: 'router-native-framework workspace-source dist/server; no Nitro deployment',
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
      await Deno.mkdir(dirname(out), { recursive: true });
      await Deno.writeTextFile(out, `${JSON.stringify(report, null, 2)}\n`);
      console.log(
        `stream comparison: ${samples} samples/mode, FCP and Part-ready proxy -> ${out}`,
      );
    } finally {
      await context.close();
    }
  } finally {
    await browser.close();
  }
} finally {
  try {
    server.kill('SIGTERM');
  } catch {
    // The child may have exited on its own.
  }
  await server.status;
}
