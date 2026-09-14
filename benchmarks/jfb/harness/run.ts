/**
 * Runs the local JFB harness against every built implementation and writes a
 * result file (issue #1219). Results are local output / CI artifacts — never a
 * committed baseline. The default destination is .artifacts/jfb-evidence.json
 * (gitignored); hostname, account names, and absolute paths are redacted and
 * the record is re-validated before it is written. Driver semantics are a
 * faithful local re-implementation of the stock webdriver-ts "afterframe"
 * driver:
 *
 * - fresh browser page per measured iteration (stock: new page per run)
 * - stock warmup/init sequences with stock DOM verifications between steps
 * - measured duration = performance.now() -> element.click() -> afterFrame
 *   (rAF + MessageChannel task), verbatim afterframe semantics
 * - memory probes via window.gc({type:'major',execution:'sync'}) +
 *   performance.memory.usedJSHeapSize (chromium; stock JFB method)
 *
 * Deviations from stock are explicit in the evidence: iteration count
 * (10 vs stock 15), swap-rows measured with afterframe timing (stock
 * afterframe driver leaves swap unmeasured; the CDP variant measures it),
 * no CPU throttling (stock default), and OE-diagnostic memory probe 26.
 */
import { dirname, join } from '@std/path';
// Host metadata the benchmark schema requires: Deno has no CPU-model API, and
// OS release strings come from the same host boundary. Identity values are
// read from the environment instead (redacted before writing).
import { cpus, release, totalmem } from 'node:os';
import { buildHarness, type BuildReport } from './build.ts';
import {
  assertEvidenceSafe,
  DEFAULT_EVIDENCE_PATH,
  type EvidenceIdentity,
  redactEvidence,
} from './evidence.ts';
import {
  AFTERFRAME_SOURCE,
  CPU_BENCHMARKS,
  CPU_ITERATIONS,
  CPU_ITERATIONS_STOCK,
  type CpuBenchmarkSpec,
  geometricMean,
  mean,
  median,
  MEM_BENCHMARKS,
  MEM_ITERATIONS,
  type MemBenchmarkSpec,
  round3,
} from './spec.ts';
import { JFB_COMMIT, JFB_COMMIT_DATE, JFB_COMMIT_SUBJECT } from './fetch-stock.ts';

interface BrowserPage {
  evaluate<T>(fn: string): Promise<T>;
  goto(url: string, options?: { waitUntil?: string }): Promise<unknown>;
  close(): Promise<void>;
  on(event: string, listener: (value: unknown) => void): void;
}

interface BrowserInstance {
  version(): string;
  newPage(): Promise<BrowserPage>;
  close(): Promise<void>;
}

export interface ImplementationRunSpec {
  id: string;
  /** 'document' or a shadow host selector (stock lit renders into shadow DOM). */
  root: 'document' | 'main-element.shadow';
  stock: boolean;
}

export function implementationRunSpecs(built: string[]): ImplementationRunSpec[] {
  const specs: ImplementationRunSpec[] = [];
  if (built.includes('oe')) specs.push({ id: 'oe', root: 'document', stock: false });
  if (built.includes('vanillajs')) specs.push({ id: 'vanillajs', root: 'document', stock: true });
  for (const id of ['preact-signals', 'lit', 'solid', 'vue', 'svelte']) {
    if (built.includes(id)) {
      specs.push({ id, root: id === 'lit' ? 'main-element.shadow' : 'document', stock: true });
    }
  }
  return specs;
}

/** In-page driver injected via page.evaluate; self-contained. */
function pageDriverSource(): string {
  return `
    const __root = (kind) => kind === 'main-element.shadow'
      ? document.querySelector('main-element').shadowRoot
      : document;
    const __resolve = (rootKind, target) => {
      const root = __root(rootKind);
      if (target.kind === 'button') return root.getElementById(target.id);
      const cellIndex = target.cell === 'label' ? 2 : 3;
      const base = 'tbody tr:nth-child(' + target.rowIndex + ') > td:nth-child(' + cellIndex + ')';
      return target.cell === 'label'
        ? root.querySelector(base + ' a')
        : root.querySelector(base + ' a span');
    };
    const __check = (rootKind, check) => {
      const root = __root(rootKind);
      if (check.kind === 'rowCount') return root.querySelectorAll('tbody tr').length === check.expected;
      const row = root.querySelector('tbody tr:nth-child(' + check.rowIndex + ')');
      if (check.kind === 'rowExists') return !!row;
      if (!row) return false;
      if (check.kind === 'rowIdText') {
        const cell = row.querySelector('td:nth-child(1)');
        return !!cell && cell.textContent.trim() === check.expected;
      }
      if (check.kind === 'rowLabelContains') {
        const cell = row.querySelector('td:nth-child(2) a');
        return !!cell && cell.textContent.includes(check.expected);
      }
      if (check.kind === 'rowClassContains') {
        return row.className.split(/\\s+/).includes(check.expected);
      }
      return false;
    };
    const __waitFor = async (rootKind, check, timeoutMs) => {
      const deadline = performance.now() + timeoutMs;
      while (performance.now() < deadline) {
        if (__check(rootKind, check)) return;
        await new Promise((r) => setTimeout(r, 5));
      }
      if (!__check(rootKind, check)) {
        throw new Error('verification failed: ' + JSON.stringify(check));
      }
    };
    const __measureClick = (rootKind, target) => {
      const el = __resolve(rootKind, target);
      if (!el) throw new Error('click target not found: ' + JSON.stringify(target));
      const t0 = performance.now();
      el.click();
      return new Promise((resolve) => window.afterFrame(() => resolve(performance.now() - t0)));
    };
    window.__jfb = {
      click: async (rootKind, target) => {
        const el = __resolve(rootKind, target);
        if (!el) throw new Error('click target not found: ' + JSON.stringify(target));
        el.click();
      },
      measureClick: __measureClick,
      waitFor: __waitFor,
      check: __check,
      rowCount: (rootKind) => __root(rootKind).querySelectorAll('tbody tr').length,
    };
  `;
}

export interface CpuBenchmarkResult {
  id: string;
  label: string;
  stockId: string;
  samplesMs: number[];
  medianMs: number;
  meanMs: number;
  minMs: number;
  maxMs: number;
}

export interface MemBenchmarkResult {
  id: string;
  label: string;
  stock: boolean;
  usedJSHeapBytes: number;
}

export interface ImplementationResult {
  id: string;
  stock: boolean;
  pageErrors: string[];
  cpu: CpuBenchmarkResult[];
  cpuGeomeanMs: number | null;
  memory: MemBenchmarkResult[];
}

async function runCpuBenchmark(
  page: BrowserPage,
  root: string,
  spec: CpuBenchmarkSpec,
): Promise<number[]> {
  const samples: number[] = [];
  for (let i = 0; i < spec.init.length; i++) {
    await page.evaluate(
      `window.__jfb.click(${JSON.stringify(root)}, ${JSON.stringify(spec.init[i])})`,
    );
    for (const verify of spec.initVerify) {
      if (verify.afterStep === i) {
        await page.evaluate(
          `window.__jfb.waitFor(${JSON.stringify(root)}, ${JSON.stringify(verify.check)}, 10000)`,
        );
      }
    }
  }
  for (let sub = 0; sub < spec.subRuns; sub++) {
    const sample = await page.evaluate(
      `window.__jfb.measureClick(${JSON.stringify(root)}, ${JSON.stringify(spec.measured)})`,
    );
    if (typeof sample !== 'number' || !Number.isFinite(sample)) {
      throw new Error(`invalid measured sample for ${spec.id}`);
    }
    samples.push(sample);
  }
  for (const check of spec.verify) {
    await page.evaluate(
      `window.__jfb.waitFor(${JSON.stringify(root)}, ${JSON.stringify(check)}, 10000)`,
    );
  }
  return samples;
}

async function measureMemory(page: BrowserPage): Promise<number> {
  return await page.evaluate(`
    (async () => {
      const gc = window.gc;
      if (gc) gc({ type: 'major', execution: 'sync', flavor: 'last-resort' });
      await new Promise((r) => setTimeout(r, 50));
      if (gc) gc({ type: 'major', execution: 'sync', flavor: 'last-resort' });
      return performance.memory ? performance.memory.usedJSHeapSize : -1;
    })()
  `) as number;
}

async function runMemBenchmark(
  page: BrowserPage,
  root: string,
  spec: MemBenchmarkSpec,
): Promise<number> {
  for (const op of spec.ops) {
    await page.evaluate(`window.__jfb.click(${JSON.stringify(root)}, ${JSON.stringify(op)})`);
    // Let async flushers settle before the next op / the probe.
    await page.evaluate('new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)))');
  }
  return await measureMemory(page);
}

interface RunOptions {
  buildDir?: string;
  jfbPath?: string;
  localOnly?: boolean;
  iterations?: number;
  implementations?: string[];
  browser?: 'chromium' | 'firefox' | 'webkit';
  /** Run memory probes (chromium only). */
  memory?: boolean;
  /** Extra OE-only engine sanity pass (firefox + webkit, benchmarks 01/03). */
  crossEngineSanity?: boolean;
}

async function commandVersion(command: string, args: string[]): Promise<string> {
  const result = await new Deno.Command(command, { args, stdout: 'piped', stderr: 'piped' })
    .output();
  return result.success ? new TextDecoder().decode(result.stdout).trim() : 'unavailable';
}

async function machineProvenance(): Promise<Record<string, unknown>> {
  const cpuInfo = cpus();
  return {
    platform: Deno.build.os,
    release: release(),
    arch: Deno.build.arch,
    cpuModel: cpuInfo[0]?.model ?? 'unknown',
    cpuCount: cpuInfo.length,
    totalMemoryBytes: totalmem(),
    deno: Deno.version,
    node: await commandVersion('node', ['--version']),
    npm: await commandVersion('npm', ['--version']),
  };
}

/** Identity values the evidence writer must scrub before writing. */
function recordingIdentity(buildDir: string): EvidenceIdentity {
  const hostname = (() => {
    try {
      return Deno.hostname();
    } catch {
      return undefined;
    }
  })();
  return {
    hostname,
    username: Deno.env.get('USER') ?? Deno.env.get('USERNAME'),
    homeDir: Deno.env.get('HOME') ?? Deno.env.get('USERPROFILE'),
    repoRoot: new URL('../../..', import.meta.url).pathname,
    buildDir,
    tmpDir: Deno.env.get('TMPDIR') ?? Deno.env.get('TEMP'),
  };
}

async function gitRevision(): Promise<string> {
  return await commandVersion('git', ['rev-parse', 'HEAD']);
}

export async function runHarness(options: RunOptions = {}): Promise<Record<string, unknown>> {
  const buildReport: BuildReport = await buildHarness({
    buildDir: options.buildDir,
    jfbPath: options.jfbPath,
    localOnly: options.localOnly,
  });
  const built = [
    'oe',
    'vanillajs',
    ...buildReport.comparators.filter((c) => c.built).map((c) => c.id),
  ];
  const runSpecs = implementationRunSpecs(built).filter((spec) =>
    !options.implementations || options.implementations.includes(spec.id)
  );
  const iterations = options.iterations ?? CPU_ITERATIONS;
  const browserName = options.browser ?? 'chromium';

  const playwright = await import('@playwright/test');
  const browserType =
    (playwright as unknown as Record<string, { launch(o?: object): Promise<BrowserInstance> }>)[
      browserName
    ];
  const launchArgs = browserName === 'chromium'
    ? [
      '--js-flags=--expose-gc',
      '--enable-precise-memory-info',
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
      '--window-size=1280,800',
    ]
    : [];
  const browser = await browserType.launch({ args: launchArgs });
  const browserVersion = browser.version();

  const server = Deno.serve({ port: 0 }, async (req) => {
    const url = new URL(req.url);
    const path = url.pathname === '/' ? '/index.html' : url.pathname;
    try {
      const file = await Deno.readFile(join(buildReport.buildDir, path));
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

  const results: ImplementationResult[] = [];
  try {
    for (const runSpec of runSpecs) {
      const pageErrors: string[] = [];
      const cpu: CpuBenchmarkResult[] = [];
      for (const bench of CPU_BENCHMARKS) {
        const samples: number[] = [];
        for (let iteration = 0; iteration < iterations; iteration++) {
          const page = await browser.newPage();
          page.on('pageerror', (value) => {
            pageErrors.push(value instanceof Error ? value.message : String(value));
          });
          await page.goto(`${baseUrl}/${runSpec.id}/index.html`, { waitUntil: 'load' });
          await page.evaluate(AFTERFRAME_SOURCE + '\n' + pageDriverSource());
          // Ensure the app booted: the run button must exist before init.
          await page.evaluate(
            `(async () => { const d = performance.now(); while (performance.now() - d < 10000) { if (window.__jfb && document.querySelector('#run, main-element')) return; await new Promise(r => setTimeout(r, 25)); } throw new Error('app did not boot'); })()`,
          );
          if (runSpec.root !== 'document') {
            await page.evaluate(
              `(async () => { const d = performance.now(); while (performance.now() - d < 10000) { const h = document.querySelector('main-element'); if (h && h.shadowRoot && h.shadowRoot.getElementById('run')) return; await new Promise(r => setTimeout(r, 25)); } throw new Error('shadow app did not boot'); })()`,
            );
          }
          samples.push(...await runCpuBenchmark(page, runSpec.root, bench));
          await page.close();
        }
        cpu.push({
          id: bench.id,
          label: bench.label,
          stockId: bench.stockId,
          samplesMs: samples.map(round3),
          medianMs: round3(median(samples)),
          meanMs: round3(mean(samples)),
          minMs: round3(Math.min(...samples)),
          maxMs: round3(Math.max(...samples)),
        });
      }
      const memory: MemBenchmarkResult[] = [];
      if (options.memory && browserName === 'chromium') {
        for (const memBench of MEM_BENCHMARKS) {
          for (let i = 0; i < MEM_ITERATIONS; i++) {
            const page = await browser.newPage();
            await page.goto(`${baseUrl}/${runSpec.id}/index.html`, { waitUntil: 'load' });
            await page.evaluate(AFTERFRAME_SOURCE + '\n' + pageDriverSource());
            await page.evaluate(
              `(async () => { const d = performance.now(); while (performance.now() - d < 10000) { if (document.querySelector('#run, main-element')) return; await new Promise(r => setTimeout(r, 25)); } throw new Error('app did not boot'); })()`,
            );
            if (runSpec.root !== 'document') {
              await page.evaluate(
                `(async () => { const d = performance.now(); while (performance.now() - d < 10000) { const h = document.querySelector('main-element'); if (h && h.shadowRoot && h.shadowRoot.getElementById('run')) return; await new Promise(r => setTimeout(r, 25)); } throw new Error('shadow app did not boot'); })()`,
              );
            }
            const usedJSHeapBytes = await runMemBenchmark(page, runSpec.root, memBench);
            memory.push({
              id: memBench.id,
              label: memBench.label,
              stock: memBench.stock,
              usedJSHeapBytes,
            });
            await page.close();
          }
        }
      }
      const medians = cpu.map((result) => result.medianMs);
      results.push({
        id: runSpec.id,
        stock: runSpec.stock,
        pageErrors,
        cpu,
        cpuGeomeanMs: round3(geometricMean(medians)),
        memory,
      });
    }
  } finally {
    await browser.close();
    await server.shutdown();
  }

  const evidence = {
    schemaVersion: 1,
    kind: 'jfb-local-baseline',
    issue: 1219,
    recordedAt: new Date().toISOString(),
    provenance: {
      openElement: { sha: await gitRevision(), package: '@openelement/element workspace source' },
      jfb: {
        repo: 'krausest/js-framework-benchmark',
        commit: JFB_COMMIT,
        commitDate: JFB_COMMIT_DATE,
        commitSubject: JFB_COMMIT_SUBJECT,
      },
      stockFiles: buildReport.stockFetch,
      browser: { engine: browserName, version: browserVersion, launchArgs },
      toolchain: await machineProvenance(),
      iterations: { cpu: iterations, cpuStock: CPU_ITERATIONS_STOCK, mem: MEM_ITERATIONS },
      warmupPolicy:
        'stock webdriver-ts warmup counts (5/5/3/1/5/5/5/5/5), fresh page per measured iteration, no CPU throttling',
      timingSemantics:
        't0=performance.now(); el.click(); resolve after rAF + MessageChannel task (verbatim afterframe)',
      build: {
        oe: buildReport.oe,
        comparators: buildReport.comparators,
      },
      deviationsFromStock: [
        `iterations: ${iterations} per CPU benchmark (stock 15)`,
        'swap-rows measured with afterframe timing (stock afterframe driver leaves swap unmeasured; stock CDP driver measures it)',
        'select-row: 10 measured sub-runs per iteration (stock additionalNumberOfRuns 10)',
        '26_run10k-memory is an OE diagnostic extension, not a stock JFB benchmark',
        'results are only comparable within this run, not to official JFB published numbers (different machine/browser/configuration)',
      ],
    },
    results,
  };
  // Never write raw machine identity: redact, then fail closed if a leak or a
  // schema violation survives the scrub.
  const identity = recordingIdentity(buildReport.buildDir);
  const safeEvidence = redactEvidence(evidence, identity);
  assertEvidenceSafe(safeEvidence, identity, { jfbCommit: JFB_COMMIT });
  return safeEvidence;
}

if (import.meta.main) {
  const args = Deno.args;
  const flagValue = (name: string): string | undefined => {
    const index = args.indexOf(`--${name}`);
    return index >= 0 ? args[index + 1] : undefined;
  };
  const evidence = await runHarness({
    buildDir: flagValue('build-dir'),
    jfbPath: flagValue('jfb-path'),
    localOnly: args.includes('--local-only'),
    iterations: flagValue('iterations') ? Number(flagValue('iterations')) : undefined,
    implementations: flagValue('impl') ? flagValue('impl')!.split(',') : undefined,
    memory: args.includes('--memory'),
  });
  // Results are local output, not a tracked file (identity-free by default).
  const repoRoot = new URL('../../..', import.meta.url).pathname;
  const out = flagValue('out') ?? join(repoRoot, DEFAULT_EVIDENCE_PATH);
  await Deno.mkdir(dirname(out), { recursive: true });
  await Deno.writeTextFile(out, `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(`wrote ${out}`);
}
