/**
 * Repeated-swap probe for the keyed-Region update path (#1416).
 *
 * `run.ts` and the instrument probe measure ONE swap per page load, which is
 * the right shape for a benchmark score but too few samples to resolve the
 * synchronous segment between the click and the handler returning: that
 * segment is a couple of milliseconds, so a single-sample median carries more
 * scheduler noise than the effect being measured. This probe keeps the page
 * alive after the stock 05_swap1k warmup (01 run + 6 unmeasured swaps, the
 * same sequence run.ts executes) and measures many swaps back to back,
 * reporting the distribution of both the sync segment and the afterframe
 * total.
 *
 * It is a measurement driver, not a benchmark runner: no score, no evidence
 * record, no threshold. Compare two builds with the same `--iterations` and
 * `--swaps` on the same machine.
 *
 * Usage:
 *   deno run -A benchmarks/jfb/harness/swap-repeat-probe.ts \
 *     --build-dir <dir> --iterations 6 --swaps 40 --out /tmp/probe.json
 */
import { join } from '@std/path';
import { AFTERFRAME_SOURCE } from './spec.ts';

interface BrowserPage {
  evaluate<T>(fn: string): Promise<T>;
  goto(url: string, options?: { waitUntil?: string }): Promise<unknown>;
  close(): Promise<void>;
}

const DRIVER = `
  window.__repeat = {
    click: (id) => document.getElementById(id).click(),
    rowIdText: (rowIndex) => {
      const row = document.querySelector('tbody tr:nth-child(' + rowIndex + ')');
      const cell = row && row.querySelector('td:nth-child(1)');
      return cell ? cell.textContent.trim() : null;
    },
    // One measured swap: the sync gap around the click, then the afterframe
    // total (the gap is where the keyed diff runs; the remainder is frame
    // scheduling and layout the event loop performs after the task).
    measureSwap: () => {
      const el = document.getElementById('swaprows');
      const t0 = performance.now();
      el.click();
      const syncMs = performance.now() - t0;
      return new Promise((resolve) =>
        window.afterFrame(() => resolve({ totalMs: performance.now() - t0, syncMs }))
      );
    },
    measureSwaps: async (count) => {
      const out = [];
      for (let i = 0; i < count; i++) out.push(await window.__repeat.measureSwap());
      return out;
    },
    frameFloor: () => {
      const t0 = performance.now();
      return new Promise((resolve) => window.afterFrame(() => resolve(performance.now() - t0)));
    },
  };
`;

async function runOnce(page: BrowserPage, baseUrl: string, swaps: number) {
  await page.goto(`${baseUrl}/oe/index.html`, { waitUntil: 'load' });
  await page.evaluate(AFTERFRAME_SOURCE + '\n' + DRIVER);
  await page.evaluate(
    `(async () => { const d = performance.now(); while (performance.now() - d < 10000) { if (window.__repeat && document.getElementById('run')) return; await new Promise(r => setTimeout(r, 25)); } throw new Error('oe app did not boot'); })()`,
  );
  await page.evaluate('window.__repeat.click("run")');
  await page.evaluate(
    `(async () => { const d = performance.now(); while (performance.now() - d < 10000) { if (window.__repeat.rowIdText(1000) === '1000') return; await new Promise(r => setTimeout(r, 25)); } throw new Error('run did not reach 1000 rows'); })()`,
  );
  // Stock 05_swap1k warmup: six unmeasured swaps.
  for (let warmup = 0; warmup < 6; warmup++) {
    await page.evaluate('window.__repeat.click("swaprows")');
    await page.evaluate('new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)))');
  }
  const frameFloorMs = await page.evaluate<number>('window.__repeat.frameFloor()');
  // Even count so the table ends where it started and the post-state check below
  // is the stock one (row 2 holds id 999, row 999 holds id 2 -- 1-based rows).
  const pairs = await page.evaluate<Array<{ totalMs: number; syncMs: number }>>(
    `window.__repeat.measureSwaps(${swaps})`,
  );
  const row2 = await page.evaluate<string | null>('window.__repeat.rowIdText(2)');
  return { frameFloorMs, pairs, row2 };
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function mean(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
}

if (import.meta.main) {
  const arg = (name: string, fallback?: string): string | undefined => {
    const index = Deno.args.indexOf(name);
    return index >= 0 ? Deno.args[index + 1] : fallback;
  };
  const buildDir = arg('--build-dir');
  if (!buildDir) throw new Error('--build-dir is required');
  const iterations = Number(arg('--iterations', '6'));
  const swaps = Number(arg('--swaps', '40'));
  const out = arg('--out', '/tmp/jfb-swap-repeat.json')!;

  const bundleBytes = (await Deno.stat(join(buildDir, 'oe', 'main.js'))).size;
  const server = Deno.serve({ port: 0 }, async (req) => {
    const url = new URL(req.url);
    const path = url.pathname === '/' ? '/index.html' : url.pathname;
    try {
      const file = await Deno.readFile(join(buildDir, path));
      const type = path.endsWith('.html')
        ? 'text/html'
        : path.endsWith('.js')
        ? 'text/javascript'
        : path.endsWith('.css')
        ? 'text/css'
        : 'application/octet-stream';
      return new Response(file, { headers: { 'content-type': type, 'cache-control': 'no-store' } });
    } catch {
      return new Response('not found', { status: 404 });
    }
  });
  const baseUrl = `http://localhost:${server.addr.port}`;

  const playwright = await import('@playwright/test');
  const browserType = (playwright as unknown as Record<
    string,
    { launch(o?: object): Promise<{ newPage(): Promise<BrowserPage>; close(): Promise<void> }> }
  >)['chromium'];
  const browser = await browserType.launch({
    args: [
      '--js-flags=--expose-gc',
      '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding',
      '--window-size=1280,800',
    ],
  });
  const runs: Awaited<ReturnType<typeof runOnce>>[] = [];
  try {
    for (let iteration = 0; iteration < iterations; iteration++) {
      const page = await browser.newPage();
      try {
        runs.push(await runOnce(page, baseUrl, swaps));
      } finally {
        await page.close();
      }
    }
  } finally {
    await browser.close();
    await server.shutdown();
  }

  const sync = runs.flatMap((run) => run.pairs.map((pair) => pair.syncMs));
  const total = runs.flatMap((run) => run.pairs.map((pair) => pair.totalMs));
  const report = {
    buildDir,
    bundleBytes,
    iterations,
    swapsPerPage: swaps,
    swapCount: sync.length,
    // Post-state of the stock 05_swap1k check: after an even number of swaps
    // the first two rows hold the swapped ids.
    row2AfterAllSwaps: runs.map((run) => run.row2),
    syncMs: {
      median: median(sync),
      mean: mean(sync),
      p10: percentile(sync, 0.1),
      p90: percentile(sync, 0.9),
      min: Math.min(...sync),
      max: Math.max(...sync),
    },
    totalMs: { median: median(total), mean: mean(total) },
    frameFloorMsMedian: median(runs.map((run) => run.frameFloorMs)),
    runs: runs.map((run) => ({
      frameFloorMs: run.frameFloorMs,
      syncMs: run.pairs.map((pair) => pair.syncMs),
    })),
  };
  await Deno.writeTextFile(out, `${JSON.stringify(report, null, 2)}\n`);
  console.log(
    JSON.stringify(
      {
        buildDir,
        bundleBytes,
        swapCount: report.swapCount,
        syncMs: report.syncMs,
        totalMsMedian: report.totalMs.median,
        frameFloorMsMedian: report.frameFloorMsMedian,
      },
      null,
      2,
    ),
  );
  console.log(`wrote ${out}`);
}
