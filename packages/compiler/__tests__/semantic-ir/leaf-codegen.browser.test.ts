/**
 * Compiler-private leaf-codegen prototype — real-browser execution evidence
 * (NOT G1 evidence; G1 is not claimed).
 *
 * This is the step beyond the lifecycle DOM stub in leaf-codegen.test.ts: the
 * emitted text is injected as a script into a Playwright page and driven through
 * mount → update → dispose against real DOM nodes. It demonstrates that the
 * prototype artifact executes in an engine; it is not the M05/G1 acceptance
 * matrix, and M03 expression lowering / M04 ownership / claim / SSR are absent.
 *
 * Engine selection mirrors `matrixInstances()` in vitest.config.ts: the default
 * PR layer is chromium; OE_BROWSER_MATRIX=full widens to the
 * chromium+firefox+webkit release matrix; unknown values fail closed rather
 * than silently running fewer engines. M13 owns the full release browser/server
 * qualification — this file only proves the prototype artifact runs.
 *
 * The security negatives deliberately stop at compilation: a dangerous authored
 * input must never produce a recipe, so there is nothing to mount.
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

interface ElementSnapshot {
  tag: string;
  attributes: Record<string, string>;
  value: string | null;
  checked: boolean;
  readOnly: boolean;
  disabled: boolean;
}

interface Snapshot {
  html: string;
  text: string | null;
  value: string | null;
  tags: string[];
  elements: ElementSnapshot[];
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
        elements: [...host.querySelectorAll('*')].map((element) => ({
          tag: element.tagName.toLowerCase(),
          attributes: Object.fromEntries(
            [...element.attributes].map((attribute) => [attribute.name, attribute.value]),
          ),
          value: (element as HTMLInputElement).value ?? null,
          checked: (element as HTMLInputElement).checked ?? false,
          readOnly: (element as HTMLInputElement).readOnly ?? false,
          disabled: (element as HTMLInputElement).disabled ?? false,
        })),
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

/**
 * Compile-only security negatives. These need no browser: the contract is that
 * a dangerous input never produces a recipe, so it can never be mounted.
 */
describe('leaf recipe — dangerous authored input stops at compilation', () => {
  test('every dangerous sink class is refused with a coded diagnostic', () => {
    const cases: readonly [string, string, string][] = [
      [
        'dynamic innerHTML',
        'function F(props) { return <div innerHTML={props.html} />; }',
        'OEIR_LEAF_UNSAFE_ATTRIBUTE',
      ],
      [
        'static srcdoc',
        'function F() { return <div srcdoc="<script>x</script>" />; }',
        'OEIR_LEAF_UNSAFE_ATTRIBUTE',
      ],
      [
        'static on* handler',
        'function F() { return <button onclick="window.x=1">x</button>; }',
        'OEIR_LEAF_UNSAFE_ATTRIBUTE',
      ],
      [
        'static javascript: URL',
        'function F() { return <a href="javascript:alert(1)">x</a>; }',
        'OEIR_LEAF_UNSAFE_ATTRIBUTE',
      ],
      [
        'dynamic URL attribute',
        'function F(props) { return <a href={props.url}>x</a>; }',
        'OEIR_LEAF_URL_SINK_UNSUPPORTED',
      ],
      [
        'script tag',
        'function F() { return <script src="/x.js"></script>; }',
        'OEIR_LEAF_UNSAFE_TAG',
      ],
      [
        'style tag',
        'function F() { return <style>{"#host{color:red}"}</style>; }',
        'OEIR_LEAF_UNSAFE_TAG',
      ],
      ['iframe tag', 'function F() { return <iframe src="/x"></iframe>; }', 'OEIR_LEAF_UNSAFE_TAG'],
      [
        'dynamic class',
        'function F(props) { return <div class={props.cls} />; }',
        'OEIR_LEAF_UNSUPPORTED_VALUE_SHAPE',
      ],
      [
        'event channel',
        'function F(props) { return <button onClick={props.onClick}>x</button>; }',
        'OEIR_LEAF_UNSUPPORTED_ATTRIBUTE',
      ],
    ];
    for (const [label, source, code] of cases) {
      const ir = buildSemanticIr(source, '/browser.tsx');
      expect(ir.component, label).not.toBeNull();
      const generated = generateLeafRecipe(ir.component!);
      expect(generated.recipe, label).toBeNull();
      expect(
        generated.diagnostics.map((diagnostic) => diagnostic.code),
        label,
      ).toContain(code);
    }
  });

  test('a legal artifact contains no executable sink tokens', () => {
    const legal = [
      'function Counter(props) { return <p class="note">Count: {props.count}</p>; }',
      'function Fields(props) { return <input value={props.name} data-x={10} />; }',
      'function Row(props) { return <div data-id={props.id} aria-label={props.label} title={props.title} />; }',
      'function Maybe(props) { return <div>{props.ok ? <span>{props.n}</span> : <em>off</em>}</div>; }',
      'function Link() { return <a href="/docs">docs</a>; }',
    ];
    for (const source of legal) {
      const body = generatedBody(source);
      expect(body).not.toContain('innerHTML');
      expect(body).not.toContain('srcdoc');
      expect(body).not.toMatch(/\bon[a-z]+\s*=/i);
      expect(body).not.toContain('createElement("script")');
    }
  });
});

for (const engine of engines()) {
  describe(`leaf recipe — generated code in ${engine.name} (prototype, not G1)`, () => {
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
      expect(result.initial.elements[0]?.attributes['class']).toBe('note');
      expect(result.initial.text).toBe('Count: 1');
      expect(result.steps[0]?.text).toBe('Count: 2');
      expect(result.staticNodeSame).toBe(true);
      expect(result.disposedHtml).toBe('');
    });

    test('dynamic plain attributes are real DOM attributes (Fields data-x)', async () => {
      const result = await execute(
        page,
        'function Fields(props) { return <input value={props.name} data-x={10} />; }',
        { props: { name: 'Ada' } },
        [{ props: { name: 'Grace' } }],
      );

      expect(result.initial.tags).toEqual(['input']);
      expect(result.initial.value).toBe('Ada');
      expect(result.initial.elements[0]?.attributes['data-x']).toBe('10');
      expect(result.steps[0]?.value).toBe('Grace');
      // The snapshot attribute is untouched by update.
      expect(result.steps[0]?.elements[0]?.attributes['data-x']).toBe('10');
      expect(result.disposedHtml).toBe('');
    });

    test('the real attribute / boolean / property matrix', async () => {
      const result = await execute(
        page,
        `function Matrix(props) {
           return (
             <div data-id={props.id} aria-label={props.label} class="static-class" title={props.title} tabindex={props.tabindex}>
               <label for={props.target}>field</label>
               <input readonly={props.readonly} disabled={props.disabled} checked={props.checked} value={props.value} />
             </div>
           );
         }`,
        {
          props: {
            id: 7,
            label: 'menu',
            title: 'hello',
            tabindex: 3,
            target: 'field-1',
            readonly: true,
            disabled: true,
            checked: true,
            value: 'Ada',
          },
        },
        [
          {
            props: {
              id: 8,
              label: null,
              title: 'bye',
              tabindex: 4,
              target: 'field-2',
              readonly: false,
              disabled: false,
              checked: false,
              value: 'Grace',
            },
          },
        ],
      );

      const initial = result.initial;
      expect(initial.tags).toEqual(['div', 'label', 'input']);
      const div = initial.elements[0]!;
      const label = initial.elements[1]!;
      const input = initial.elements[2]!;

      // data-* / aria-* / static class / title / tabindex / for are real DOM
      // attributes, not JS expandos.
      expect(div.attributes['data-id']).toBe('7');
      expect(div.attributes['aria-label']).toBe('menu');
      expect(div.attributes['class']).toBe('static-class');
      expect(div.attributes['title']).toBe('hello');
      expect(div.attributes['tabindex']).toBe('3');
      expect(label.attributes['for']).toBe('field-1');

      // boolean channel: presence with an empty value, not `"true"` text.
      expect(input.attributes['readonly']).toBe('');
      expect(input.attributes['disabled']).toBe('');
      expect(input.attributes['checked']).toBe('');
      expect(input.readOnly).toBe(true);
      expect(input.disabled).toBe(true);
      expect(input.checked).toBe(true);

      // property channel: the IDL property, not an attribute.
      expect(input.value).toBe('Ada');
      expect(input.attributes['value']).toBeUndefined();

      const after = result.steps[0]!;
      const divAfter = after.elements[0]!;
      const inputAfter = after.elements[2]!;
      expect(divAfter.attributes['data-id']).toBe('8');
      expect(divAfter.attributes['aria-label']).toBeUndefined();
      expect(divAfter.attributes['title']).toBe('bye');
      expect(divAfter.attributes['tabindex']).toBe('4');
      expect(after.elements[1]!.attributes['for']).toBe('field-2');
      expect(inputAfter.attributes['readonly']).toBeUndefined();
      expect(inputAfter.attributes['disabled']).toBeUndefined();
      expect(inputAfter.attributes['checked']).toBeUndefined();
      expect(inputAfter.readOnly).toBe(false);
      expect(inputAfter.disabled).toBe(false);
      expect(inputAfter.checked).toBe(false);
      expect(inputAfter.value).toBe('Grace');
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
