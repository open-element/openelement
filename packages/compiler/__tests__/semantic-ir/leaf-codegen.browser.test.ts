/**
 * G1 slice — the generated code executes in REAL browsers.
 *
 * This is the step beyond the minimal DOM stub in leaf-codegen.test.ts: the
 * emitted text is injected as a script into a Playwright page and driven through
 * mount → update → dispose against real DOM nodes.
 *
 * Engine selection mirrors `matrixInstances()` in vitest.config.ts: the default
 * PR layer is chromium; OE_BROWSER_MATRIX=full widens to the
 * chromium+firefox+webkit release matrix; unknown values fail closed rather
 * than silently running fewer engines. M13 owns the full release browser/server
 * qualification — this file only proves the slice artifact runs.
 *
 * Compiler-private and off by default: the generator still lives under
 * `semantic-ir/`, excluded from the published compiler surface.
 */

import { beforeAll, afterAll, describe, expect, test } from 'vitest';
import { chromium, firefox, webkit, type Browser, type Page } from 'playwright';
import { buildSemanticIr } from '../../src/internal/compiler/semantic-ir/index.ts';
import { generateLeafRecipe } from '../../src/internal/compiler/semantic-ir/leaf-codegen/generate.ts';

interface Engine {
  name: string;
  launch: () => Promise<Browser>;
}

/** Same contract as vitest.config.ts:63-78, for a node-project Playwright test. */
function engines(): Engine[] {
  const all: Engine[] = [
    { name: 'chromium', launch: () => chromium.launch() },
    { name: 'firefox', launch: () => firefox.launch() },
    { name: 'webkit', launch: () => webkit.launch() },
  ];
  const matrix = process.env.OE_BROWSER_MATRIX ?? 'chromium';
  switch (matrix) {
    case 'chromium':
    case '':
      return [all[0]!];
    case 'firefox':
      return [all[1]!];
    case 'webkit':
      return [all[2]!];
    case 'full':
      return all;
    default:
      throw new Error(`unknown OE_BROWSER_MATRIX: ${matrix}`);
  }
}

function generatedBody(source: string): string {
  const ir = buildSemanticIr(source, '/browser.tsx');
  if (ir.component === null) {
    throw new Error(`IR build failed: ${ir.diagnostics.map((d) => d.code).join(', ')}`);
  }
  const generated = generateLeafRecipe(ir.component);
  if (generated.recipe === null) {
    throw new Error(`codegen failed: ${generated.diagnostics.map((d) => d.code).join(', ')}`);
  }
  return generated.recipe.body;
}

interface Snapshot {
  html: string;
  text: string | null;
  value: string | null;
  tags: string[];
}

interface Result {
  initial: Snapshot;
  steps: Snapshot[];
  staticNodeSame: boolean | null;
  disposedHtml: string;
}

/** Inject the emitted text as a script, then drive it against the real DOM. */
function execute(
  page: Page,
  source: string,
  initial: unknown,
  updates: readonly unknown[] = [],
): Promise<Result> {
  return page.evaluate(
    ({ code, initial, updates }) => {
      interface Instance {
        update(nextValues: unknown): void;
        dispose(): void;
      }
      const host = document.getElementById('host') as HTMLElement;
      host.replaceChildren();
      const script = document.createElement('script');
      script.textContent = `${code}\nwindow.__oeMount = mount;`;
      document.head.appendChild(script);

      const mountFn = (
        window as unknown as { __oeMount: (element: HTMLElement, initial: unknown) => Instance }
      ).__oeMount;
      const snapshot = (): Snapshot => ({
        html: host.innerHTML,
        text: host.textContent,
        value: (host.querySelector('input') as HTMLInputElement | null)?.value ?? null,
        tags: [...host.querySelectorAll('*')].map((element) => element.tagName.toLowerCase()),
      });

      const instance = mountFn(host, initial);
      const staticBefore = host.firstElementChild?.firstChild ?? null;
      const first = snapshot();
      const steps: Snapshot[] = [];
      for (const values of updates) {
        instance.update(values);
        steps.push(snapshot());
      }
      const staticNodeSame = staticBefore === (host.firstElementChild?.firstChild ?? null);
      instance.dispose();
      const disposedHtml = host.innerHTML;
      script.remove();
      return { initial: first, steps, staticNodeSame, disposedHtml };
    },
    { code: generatedBody(source), initial, updates },
  );
}

for (const engine of engines()) {
  describe(`G1 slice — generated code in ${engine.name}`, () => {
    let browser: Browser;
    let page: Page;

    beforeAll(async () => {
      browser = await engine.launch();
      page = await browser.newPage();
      await page.setContent('<!doctype html><html><body><div id="host"></div></body></html>');
    }, 120_000);

    afterAll(async () => {
      await browser?.close();
    });

    test('mount builds real DOM, update refreshes only the dynamic text', async () => {
      const result = await execute(
        page,
        'function Counter(props) { return <p class="note">Count: {props.count}</p>; }',
        { props: { count: 1 } },
        [{ props: { count: 2 } }],
      );

      expect(result.initial.tags).toEqual(['p']);
      expect(result.initial.html).toContain('class="note"');
      expect(result.initial.text).toBe('Count: 1');
      expect(result.steps[0]?.text).toBe('Count: 2');
      expect(result.staticNodeSame).toBe(true);
      expect(result.disposedHtml).toBe('');
    });

    test('dynamic property values are real DOM properties', async () => {
      const result = await execute(
        page,
        'function Fields(props) { return <input value={props.name} data-x={10} />; }',
        { props: { name: 'Ada' } },
        [{ props: { name: 'Grace' } }],
      );

      expect(result.initial.tags).toEqual(['input']);
      expect(result.initial.value).toBe('Ada');
      expect(result.steps[0]?.value).toBe('Grace');
      expect(result.disposedHtml).toBe('');
    });

    test('a condition swaps real DOM subtrees without rebuilding the host', async () => {
      const result = await execute(
        page,
        'function Maybe(props) { return <div>{props.ok ? <span>on</span> : <em>off</em>}</div>; }',
        { props: { ok: true } },
        [{ props: { ok: false } }],
      );

      expect(result.initial.tags).toEqual(['div', 'span']);
      expect(result.initial.text).toBe('on');
      expect(result.steps[0]?.tags).toEqual(['div', 'em']);
      expect(result.steps[0]?.text).toBe('off');
      expect(result.disposedHtml).toBe('');
    });

    test('a branch-local refresh closure updates tracked text and survives branch swaps', async () => {
      const result = await execute(
        page,
        'function Maybe(props) { return <div>{props.ok ? <span>{props.n}</span> : <em>off</em>}</div>; }',
        { props: { ok: true, n: 1 } },
        [
          { props: { ok: true, n: 2 } },
          { props: { ok: false, n: 2 } },
          { props: { ok: true, n: 3 } },
        ],
      );

      expect(result.initial.tags).toEqual(['div', 'span']);
      expect(result.initial.text).toBe('1');
      expect(result.steps[0]?.text).toBe('2');
      expect(result.steps[1]?.tags).toEqual(['div', 'em']);
      expect(result.steps[1]?.text).toBe('off');
      expect(result.steps[2]?.tags).toEqual(['div', 'span']);
      expect(result.steps[2]?.text).toBe('3');
      expect(result.disposedHtml).toBe('');
    });
  });
}
