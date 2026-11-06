/**
 * G1 slice — the generated code executes in a REAL browser (chromium).
 *
 * This is the step beyond the minimal DOM stub in leaf-codegen.test.ts: the
 * emitted text is injected as a script into a Playwright page and driven through
 * mount → update → dispose against real DOM nodes. Single-engine by design;
 * the three-engine matrix belongs to M13, not to this first G1 slice.
 *
 * Compiler-private and off by default: the generator still lives under
 * `semantic-ir/`, excluded from the published compiler surface.
 */

import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';
import { buildSemanticIr } from '../../src/internal/compiler/semantic-ir/index.ts';
import { generateLeafRecipe } from '../../src/internal/compiler/semantic-ir/leaf-codegen/generate.ts';

let browser: Browser;
let page: Page;

beforeAll(async () => {
  browser = await chromium.launch();
  page = await browser.newPage();
  await page.setContent('<!doctype html><html><body><div id="host"></div></body></html>');
});

afterAll(async () => {
  await browser?.close();
});

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
  updated: Snapshot | null;
  staticNodeSame: boolean | null;
  disposedHtml: string;
}

/** Inject the emitted text as a script, then drive it against the real DOM. */
function execute(source: string, values: unknown, next?: unknown): Promise<Result> {
  return page.evaluate(
    ({ code, values, next }) => {
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

      const instance = mountFn(host, values);
      const staticBefore = host.firstElementChild?.firstChild ?? null;
      const initial = snapshot();
      let updated: Snapshot | null = null;
      let staticNodeSame: boolean | null = null;
      if (next !== undefined) {
        instance.update(next);
        updated = snapshot();
        staticNodeSame = staticBefore === (host.firstElementChild?.firstChild ?? null);
      }
      instance.dispose();
      const disposedHtml = host.innerHTML;
      script.remove();
      return { initial, updated, staticNodeSame, disposedHtml };
    },
    { code: generatedBody(source), values, next },
  );
}

describe('G1 slice — generated code in chromium', () => {
  test('mount builds real DOM, update refreshes only the dynamic text', async () => {
    const result = await execute(
      'function Counter(props) { return <p class="note">Count: {props.count}</p>; }',
      { props: { count: 1 } },
      { props: { count: 2 } },
    );

    expect(result.initial.tags).toEqual(['p']);
    expect(result.initial.html).toContain('class="note"');
    expect(result.initial.text).toBe('Count: 1');
    expect(result.updated?.text).toBe('Count: 2');
    expect(result.staticNodeSame).toBe(true);
    expect(result.disposedHtml).toBe('');
  });

  test('dynamic property values are real DOM properties', async () => {
    const result = await execute(
      'function Fields(props) { return <input value={props.name} data-x={10} />; }',
      { props: { name: 'Ada' } },
      { props: { name: 'Grace' } },
    );

    expect(result.initial.tags).toEqual(['input']);
    expect(result.initial.value).toBe('Ada');
    expect(result.updated?.value).toBe('Grace');
    expect(result.disposedHtml).toBe('');
  });

  test('a condition swaps real DOM subtrees without rebuilding the host', async () => {
    const result = await execute(
      'function Maybe(props) { return <div>{props.ok ? <span>on</span> : <em>off</em>}</div>; }',
      { props: { ok: true } },
      { props: { ok: false } },
    );

    expect(result.initial.tags).toEqual(['div', 'span']);
    expect(result.initial.text).toBe('on');
    expect(result.updated?.tags).toEqual(['div', 'em']);
    expect(result.updated?.text).toBe('off');
    expect(result.disposedHtml).toBe('');
  });
});
