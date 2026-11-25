/**
 * Performance budget harness (T10 R8, G3-approved).
 *
 * CHROMIUM-ONLY. This spec measures through CDP — `context.newCDPSession`,
 * CPU throttling, `Network.emulateNetworkConditions`,
 * `Network.loadingFinished` — none of which exist in Firefox or WebKit. Rather
 * than skip there (the candidate proof forbids skips, and a skip would read as
 * coverage that does not exist), `playwright.config.ts` lists this file in
 * CHROMIUM_ONLY_SPECS and the firefox/webkit projects ignore it. It was
 * collected by all three projects at first, and the release check caught the
 * consequence: two engine failures at `context.newCDPSession`.
 *
 * How to run the baseline:
 *   pnpm --dir www run e2e:chromium -- e2e/performance-budget.spec.ts
 *   PERF_RUNS=3 pnpm --dir www run e2e:chromium -- --workers=1 e2e/performance-budget.spec.ts
 * (`e2e:chromium` is the project-scoped script; under `e2e:browsers` the
 * firefox and webkit legs do not collect this spec by design.)
 *
 * Why it exists: the repository had no LCP/CLS/INP measurement anywhere, and
 * the only performance assertions were "loads within 5 seconds"
 * (accessibility-performance.spec.ts:199,208), which cannot see a regression
 * that is real but smaller than a second. This spec measures the built site
 * under a mobile-4G + 4x-CPU profile — cold cache, fresh context, N runs per
 * route, median reported — and compares against the committed baseline in
 * `perf-baseline.json`.
 *
 * Deliberately NOT a hard gate yet (the owner's "measure, do not fail"):
 * absolute milliseconds on a shared CI runner are noise, and the repository
 * already documents a 0.3% byte spread for identical trees across runner
 * images (www/tools/check-doc-figures.ts). The comparison therefore reports
 * regressions as test annotations and only fails when PERF_STRICT=1 is set, at
 * which point the band below becomes the budget.
 *
 * Two measurement rules worth knowing before reading a number:
 *   - INP needs interactions, so each run drives the chrome the reader would
 *     touch (open search, type, escape, toggle theme, Tab) and reports the
 *     worst event-timing duration. A run with no interaction reports 0, which
 *     means "not measured", not "instant".
 *   - Bytes come from CDP Network.loadingFinished.encodedDataLength, not from
 *     content-length headers: the built tree's responses do not all carry one
 *     (the T10 audit hit exactly that wall with the static test server).
 *
 * Comparability: run this file alone (`--workers=1`) — parallel workers starve
 * the CPU this profile is trying to throttle.
 */
import { expect, test, type Browser, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const BASELINE_PATH = fileURLToPath(new URL('./perf-baseline.json', import.meta.url));
const RUNS = Number(process.env.PERF_RUNS ?? '3');
const STRICT = process.env.PERF_STRICT === '1';
/** Report-only band: beyond this the run is annotated as a regression. */
const REGRESSION_BAND = 0.35;

interface RouteBaseline {
  lcpMs: number;
  cls: number;
  inpMs: number;
  longTasks: number;
  longTaskMs: number;
  loadMs: number;
  requests: number;
  transferBytes: number;
}

interface PerfBaseline {
  note: string;
  measuredAt: string;
  profile: string;
  runs: number;
  routes: Record<string, RouteBaseline>;
}

interface Measurement {
  lcpMs: number;
  cls: number;
  inpMs: number;
  longTasks: number;
  longTaskMs: number;
  loadMs: number;
  requests: number;
  transferBytes: number;
}

const baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf8')) as PerfBaseline;

/** The routes the baseline pins: one per template, both locales. */
const ROUTES = Object.keys(baseline.routes);

interface LayoutShiftEntry extends PerformanceEntry {
  hadRecentInput: boolean;
  value: number;
}

declare global {
  var __vitals: Pick<Measurement, 'cls' | 'longTaskMs' | 'longTasks'> & {
    lcp: number;
    inp: number;
  };
}

const VITALS_SCRIPT = () => {
  globalThis.__vitals = { lcp: 0, cls: 0, inp: 0, longTasks: 0, longTaskMs: 0 };
  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        globalThis.__vitals.lcp = Math.max(globalThis.__vitals.lcp, entry.startTime);
      }
    }).observe({ type: 'largest-contentful-paint', buffered: true });
  } catch {
    // Entry type unsupported in this engine: that metric stays 0.
  }
  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries() as LayoutShiftEntry[]) {
        if (!entry.hadRecentInput) globalThis.__vitals.cls += entry.value;
      }
    }).observe({ type: 'layout-shift', buffered: true });
  } catch {
    // Entry type unsupported in this engine: that metric stays 0.
  }
  try {
    const options: PerformanceObserverInit & { durationThreshold: number } = {
      type: 'event',
      buffered: true,
      durationThreshold: 40,
    };
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        globalThis.__vitals.inp = Math.max(globalThis.__vitals.inp, entry.duration ?? 0);
      }
    }).observe(options);
  } catch {
    // Entry type unsupported in this engine: that metric stays 0.
  }
  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        globalThis.__vitals.longTasks++;
        globalThis.__vitals.longTaskMs += entry.duration;
      }
    }).observe({ type: 'longtask', buffered: true });
  } catch {
    // Entry type unsupported in this engine: that metric stays 0.
  }
};

/** Drive the chrome the reader actually touches, so INP has samples. */
async function interact(page: Page): Promise<void> {
  // Locale-agnostic trigger: the accessible name is "Search" on en pages and
  // "搜索" on zh pages, but the island tag is the same in both trees.
  const trigger = page.locator('open-search').getByRole('button').first();
  if (await trigger.count()) {
    await trigger.click({ timeout: 10_000 }).catch(() => {});
    const input = page.getByRole('combobox').first();
    if (await input.count()) {
      await input.pressSequentially('island', { delay: 30 });
      await page.waitForTimeout(600);
    }
    await page.keyboard.press('Escape');
  }
  const toggle = page.locator('open-theme-toggle button').first();
  if (await toggle.count()) {
    await toggle.click({ timeout: 5_000 }).catch(() => {});
  }
  for (let i = 0; i < 4; i++) await page.keyboard.press('Tab');
}

const median = (values: readonly number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
};

async function measureOnce(browser: Browser, path: string): Promise<Measurement> {
  // Fresh context per run: cold cache is the point of a first-visit profile.
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    userAgent:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 ' +
      '(KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send('Network.enable');
  // Mobile 4G: 4 Mbps down / 3 Mbps up / 150 ms RTT.
  await cdp.send('Network.emulateNetworkConditions', {
    offline: false,
    latency: 150,
    downloadThroughput: (4 * 1024 * 1024) / 8,
    uploadThroughput: (3 * 1024 * 1024) / 8,
  });
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  await cdp.send('Network.clearBrowserCache');

  const transfer = { bytes: 0, requests: 0 };
  cdp.on('Network.loadingFinished', (event) => {
    transfer.bytes += event.encodedDataLength;
    transfer.requests += 1;
  });

  await page.addInitScript(VITALS_SCRIPT);
  const started = Date.now();
  await page.goto(path, { waitUntil: 'load', timeout: 180_000 });
  await page.waitForTimeout(2_000);
  await interact(page);
  await page.waitForTimeout(1_500);
  const vitals = await page.evaluate(() => globalThis.__vitals);
  const loadMs = Date.now() - started;
  await context.close();
  return {
    lcpMs: Math.round(vitals.lcp),
    cls: Number(vitals.cls.toFixed(4)),
    inpMs: Math.round(vitals.inp),
    longTasks: vitals.longTasks,
    longTaskMs: Math.round(vitals.longTaskMs),
    loadMs,
    requests: transfer.requests,
    transferBytes: transfer.bytes,
  };
}

function compare(route: string, measured: Measurement, expected: RouteBaseline): string[] {
  const notes: string[] = [];
  for (const key of Object.keys(expected) as Array<keyof RouteBaseline>) {
    const before = expected[key];
    const now = measured[key];
    if (before === 0) continue;
    const delta = (now - before) / before;
    if (delta > REGRESSION_BAND) {
      notes.push(`${route} ${key}: ${before} → ${now} (+${(delta * 100).toFixed(0)}%)`);
    }
  }
  return notes;
}

test.describe.configure({ mode: 'serial' });

test.describe('Performance profile (mobile 4G, 4x CPU, cold cache)', () => {
  // Three throttled runs per route include search and other interactive checks.
  test.setTimeout(1_200_000);

  for (const route of ROUTES) {
    test(`perf profile: ${route}`, async ({ browser }) => {
      const runs: Measurement[] = [];
      for (let i = 0; i < RUNS; i++) runs.push(await measureOnce(browser, route));
      const measured: Measurement = {
        lcpMs: median(runs.map((run) => run.lcpMs)),
        cls: Number(median(runs.map((run) => run.cls)).toFixed(4)),
        inpMs: median(runs.map((run) => run.inpMs)),
        longTasks: median(runs.map((run) => run.longTasks)),
        longTaskMs: median(runs.map((run) => run.longTaskMs)),
        loadMs: median(runs.map((run) => run.loadMs)),
        requests: median(runs.map((run) => run.requests)),
        transferBytes: median(runs.map((run) => run.transferBytes)),
      };
      const expected = baseline.routes[route]!;
      const regressions = compare(route, measured, expected);
      const summary =
        `measured: LCP=${measured.lcpMs}ms CLS=${measured.cls} INP=${measured.inpMs}ms ` +
        `longTasks=${measured.longTasks}/${measured.longTaskMs}ms load=${measured.loadMs}ms ` +
        `reqs=${measured.requests} bytes=${measured.transferBytes} | ` +
        `baseline(${baseline.runs} runs): LCP=${expected.lcpMs}ms CLS=${expected.cls} ` +
        `INP=${expected.inpMs}ms bytes=${expected.transferBytes}`;
      console.log(summary);

      test.info().annotations.push({ type: 'performance', description: summary });
      if (measured.inpMs === 0) {
        // Honesty marker: no interaction produced an event-timing sample.
        test.info().annotations.push({
          type: 'performance-inp-unmeasured',
          description: `${route}: no interaction sample — INP is unmeasured in this run`,
        });
      }
      if (regressions.length > 0) {
        test.info().annotations.push({
          type: 'performance-regression',
          description: regressions.join('; '),
        });
        console.log(
          `regressions beyond +${REGRESSION_BAND * 100}%:\n  ${regressions.join('\n  ')}`,
        );
      }

      // Report-only by default: the measurement is the deliverable until the
      // baseline has been observed on CI. PERF_STRICT=1 promotes it to a gate.
      if (STRICT) {
        expect(regressions, 'performance regressed beyond the report-only band').toEqual([]);
      }
    });
  }
});
