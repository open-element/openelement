/**
 * M09-shadow — generated-element root / DSD / slot evidence (LOCAL, Chromium).
 *
 * This slice extends the M09-0 shell with the compiler-private `root`
 * (`light | shadow-open | shadow-closed`) and `delegatesFocus` descriptor
 * facts. It deliberately carries NO styles: the style consumer is the next
 * slice and is not claimed here.
 *
 * The browser evidence uses the HTML parser's declarative-shadow-root path
 * (`Element.setHTMLUnsafe` on a container, then upgrade on insertion). A
 * `template[shadowrootmode]` written with `innerHTML` is the explicit negative
 * control: Chromium does not adopt it, so the shell must fail closed instead
 * of creating a second tree.
 *
 * Asserted facts:
 * - open DSD takeover with native named slot, node identity, and zero
 *   claim-period mutations;
 * - closed DSD takeover through `ElementInternals.shadowRoot`, with zero
 *   mount, retained light children and identity (the closed root is held by
 *   the probe recipe wrapper, never exposed by a shell getter);
 * - `delegatesFocus` is passed to `attachShadow` and matches an existing DSD
 *   root fact;
 * - open/closed CSR creation, disconnect/reconnect with the same root and
 *   node identity, and updates after reconnect;
 * - root-mode, root-option, attach-shadow, DSD-not-adopted and
 *   closed-internals-unreachable failures are coded and leave the existing
 *   content untouched (mismatch does not clear);
 * - `dispose(true)` removes only owned nodes; host light children and foreign
 *   shadow children stay; the root is retained;
 * - a multi-root static directory claim works with a real ShadowRoot parent,
 *   while a bare `DocumentFragment` is still refused; the claim parent rule
 *   validates the host and its HTML ancestors;
 * - the generated bundle's RENDERED module graph never reaches the old
 *   server/executor or the server-side DSD serializer. Since M09-2a the
 *   generated element's one internal entry also re-exports the browser-safe DSD
 *   host producer, so `internal/compiled/dsd.ts` is in the PARSE graph while
 *   staying out of the shipped chunk when nothing calls the producer.
 *
 * This is one Chromium engine (147) and LOCAL evidence. It is not M09 exit,
 * not the M13 matrix, not the style consumer, not forms, and not author API.
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';
import { build } from 'vite';
import { compileFunctionModule } from '../../src/internal/compiler/semantic-core/function-frontend.ts';
import {
  GENERATED_LEAF_RUNTIME_SPECIFIER,
  generateLeafModule,
} from '../../src/internal/compiler/semantic-ir/generated-leaf/generate.ts';
import {
  serializeDsdAttributes,
  serializeShadowTemplate,
  type CompiledDsdOptions,
} from '../../../element/src/internal/compiled/dsd.ts';
import { testProgram } from '../../../element/__tests__/compiled-runtime/test-program.ts';
import { ELEMENT_CLASSIFIER as CLASSIFIER, REPO_ROOT } from './testlib/element-classifier.ts';

const FILE = '/proj/src/generated-shadow.tsx';
const HTML_NAMESPACE = 'http://www.w3.org/1999/xhtml';

/**
 * The old Part Program execution backend plus the server-only serializer
 * leaves. The shell may share neutral recipe/value/invariant primitives; the
 * generated browser bundle must not acquire any of these modules.
 *
 * `internal/compiled/dsd.ts` is deliberately NOT listed: since M09-2a the
 * generated element's one internal entry re-exports the browser-safe DSD host
 * producer (`generated-element/dsd-ssr.ts`), so `dsd.ts` is in the bundle's
 * PARSE graph. The shipped artifact is the RENDERED graph, asserted separately
 * below, and there the DSD leaf must still be absent.
 */
const FORBIDDEN_MODULE_SUFFIXES = [
  '/internal/compiled/facade-host.ts',
  '/internal/compiled/runtime-program.ts',
  '/internal/compiled/runtime.ts',
  '/internal/compiled/runtime/kernel.ts',
  '/internal/compiled/runtime/program-kernel.ts',
  '/internal/compiled/runtime/parts.ts',
  '/internal/compiled/runtime/hydrate.ts',
  '/internal/compiled/runtime/fresh-dom.ts',
  '/internal/compiled/runtime/props.ts',
  '/internal/compiled/runtime/blocks.ts',
  '/internal/compiled/runtime/revive.ts',
  '/internal/compiled/runtime/error-boundary.ts',
  '/internal/compiled/runtime/pre-upgrade-events.ts',
  '/internal/compiled/runtime/hydrate-recovery.ts',
  '/internal/compiled/runtime/blocks-seam.ts',
  '/internal/compiled/runtime/hydrate-seam.ts',
  '/internal/compiled/server/index.ts',
  '/internal/compiled/server/shared.ts',
  '/internal/compiled/serializer/serialize-program.ts',
] as const;


/**
 * `ShadowPanel` is a single dynamic root: native named slot + static input +
 * one dynamic text/attribute pair. It therefore uses the ordinary claim path
 * whose parent assertion must accept a ShadowRoot.
 *
 * `ShadowStatic` is a fragment of two pure static roots: its claim uses the
 * M07b static-sibling directory, whose parent must also accept a ShadowRoot.
 */
const SOURCE = `
function ShadowPanel(props) {
  return <section><slot name="title"></slot><input id="field" /><p id="panel" title={props.label}>{props.label}</p></section>;
}
function ShadowStatic() {
  return <><slot name="title"></slot><p id="static">static</p></>;
}
`;

interface PageRuntime {
  defineGeneratedElement: (descriptor: unknown) => CustomElementConstructor;
  createGeneratedElementClass: (descriptor: unknown) => CustomElementConstructor;
  createShadowPanelRecipe: (owner: unknown, host: unknown) => unknown;
  createShadowStaticRecipe: (owner: unknown, host: unknown) => unknown;
  createRecipe: (options: unknown) => unknown;
  ShadowPanel__ssr: (props: unknown, host: unknown) => string;
  ShadowStatic__ssr: () => string;
  assertElementInHtmlNamespace: (node: Node, where: string) => void;
  isClaimParentShadowRoot: (node: Node | null) => boolean;
  openStaticSiblingDirectory: (
    parent: Node,
    declaration: readonly unknown[],
    source?: string,
  ) => { readonly parent: Node };
  LEAF_CLAIM_MISMATCH: string;
  runtimeProbe: { snapshot(): Record<string, number> };
}

interface ClaimProbe {
  claims: number;
  mounts: number;
  mutations: number;
  parents: Node[];
  nodes: Node[][];
  before: Node[][];
  mountNodes: Node[][];
  error: string | null;
  errorCode: string | null;
}

interface SetupHelpers {
  fill(template: string, content: string): string;
  parse(html: string): HTMLElement;
  tick(): Promise<void>;
  errors(): {
    list: Array<{ code: string | null; message: string }>;
    stop(): void;
  };
  probe(key: string): ClaimProbe;
}

declare global {
  interface Window {
    __oeM09: PageRuntime;
    __oeProbe: Record<string, ClaimProbe>;
    __oeSetup: SetupHelpers;
  }
}

let browser: Browser;
let bundleDir = '';
let bundleFile = '';
let bundleModuleIds: string[] = [];
let bundleParsedModuleIds: string[] = [];

function generatedModule(): string {
  const front = compileFunctionModule(SOURCE, FILE, { importClassifier: CLASSIFIER });
  expect(front.diagnostics, front.diagnostics.map((item) => item.code).join(', ')).toEqual([]);
  const generated = generateLeafModule(front.module!);
  expect(
    generated.diagnostics,
    generated.diagnostics.map((item) => item.message).join('\n'),
  ).toEqual([]);
  const module = generated.module!;
  expect(module).toContain('function ShadowPanel__claim');
  expect(module).toContain('function ShadowPanel__ssr');
  expect(module).toContain('function ShadowStatic__claim');
  expect(module).toContain('function ShadowStatic__ssr');
  return module;
}

interface BundleResult {
  readonly file: string;
  readonly moduleIds: readonly string[];
  readonly parsedModuleIds: readonly string[];
}

async function buildBundle(module: string, dir: string): Promise<BundleResult> {
  const element = join(REPO_ROOT, 'packages/element/src/internal');
  const runtime = join(element, 'compiled/runtime');
  const leaf = join(dir, 'leaf.js');
  const shim = join(dir, 'runtime-shim.ts');
  const entry = join(dir, 'entry.ts');
  writeFileSync(leaf, module);
  writeFileSync(
    shim,
    [
      `export { claimRecipe, createRecipe, insertRecipe } from ${JSON.stringify(join(runtime, 'recipe.ts'))};`,
      `export { bindSignalWrites, runUntracked } from ${JSON.stringify(join(runtime, 'bindings.ts'))};`,
      `export { runtimeProbe } from ${JSON.stringify(join(runtime, 'observability.ts'))};`,
      `export { attributeValueOf, assertSafeUrlAttribute, displayValue, removeNodes } from ${JSON.stringify(join(runtime, 'values.ts'))};`,
      `import * as claimInvariants from ${JSON.stringify(join(runtime, 'claim-invariants.ts'))};`,
      `export const { assertElementInHtmlNamespace, assertStaticAttributeSeed, assertTextSlotMarker, leafClaimMismatch } = claimInvariants;`,
      `import * as markers from ${JSON.stringify(join(runtime, 'markers.ts'))};`,
      `export const { emitComment, MARKERS, markerText, rangeMarker, textSlotMarker } = markers;`,
      `export { claimStaticSiblingRange, openStaticSiblingDirectory } from ${JSON.stringify(join(runtime, 'static-sibling-ranges.ts'))};`,
      `export { escapeText } from ${JSON.stringify(join(element, 'compiled/escape-text.ts'))};`,
      `export { escapeAttrValue } from ${JSON.stringify(join(element, 'core/html-escape.ts'))};`,
      '',
    ].join('\n'),
  );
  writeFileSync(
    entry,
    [
      `export { createShadowPanelRecipe, createShadowStaticRecipe, ShadowPanel__ssr, ShadowStatic__ssr } from './leaf.js';`,
      `export { createGeneratedElementClass, defineGeneratedElement } from ${JSON.stringify(join(element, 'compiled/generated-element/shell.ts'))};`,
      `export { createRecipe } from ${JSON.stringify(join(runtime, 'recipe.ts'))};`,
      `export { runtimeProbe } from ${JSON.stringify(join(runtime, 'observability.ts'))};`,
      `export { assertElementInHtmlNamespace, isClaimParentShadowRoot, LEAF_CLAIM_MISMATCH } from ${JSON.stringify(join(runtime, 'claim-invariants.ts'))};`,
      `export { claimStaticSiblingRange, openStaticSiblingDirectory } from ${JSON.stringify(join(runtime, 'static-sibling-ranges.ts'))};`,
      '',
    ].join('\n'),
  );
  const parsedModuleIds = new Set<string>();
  const result = await build({
    configFile: false,
    root: dir,
    logLevel: 'silent',
    resolve: { alias: { [GENERATED_LEAF_RUNTIME_SPECIFIER]: shim } },
    plugins: [
      {
        name: 'oe-m09-shadow-module-graph',
        moduleParsed(info) {
          parsedModuleIds.add(info.id);
        },
      },
    ],
    build: {
      write: false,
      minify: false,
      lib: {
        entry,
        formats: ['iife'],
        name: '__oeM09',
        fileName: () => 'generated-shadow.js',
      },
    },
  });
  const output = Array.isArray(result)
    ? result[0]!.output
    : (result as { output: unknown[] }).output;
  const chunk = (
    output as Array<{
      type: string;
      code?: string;
      moduleIds?: readonly string[];
    }>
  ).find((item) => item.type === 'chunk');
  if (chunk?.code === undefined) throw new Error('generated shadow bundle produced no chunk');
  if (chunk.moduleIds === undefined || chunk.moduleIds.length === 0) {
    throw new Error('generated shadow bundle carried no Vite output module IDs');
  }
  const out = join(dir, 'generated-shadow.js');
  writeFileSync(out, chunk.code);
  return {
    file: out,
    moduleIds: chunk.moduleIds.map((id) => id.replaceAll('\\', '/')),
    parsedModuleIds: [...parsedModuleIds].map((id) => id.replaceAll('\\', '/')),
  };
}

/**
 * Page-side setup. M09 has no author syntax and no emitter: the descriptor is
 * the internal compiler contract. `wrapRecipe` only observes the generated
 * recipe's `mount`/`claim`; it never replaces the generated DOM logic.
 */
const PAGE_SETUP = `
  const mod = window.__oeM09;
  function makeProbe() {
    return { claims: 0, mounts: 0, mutations: 0, parents: [], nodes: [], before: [], mountNodes: [], error: null, errorCode: null };
  }
  window.__oeProbe = {
    panel: makeProbe(),
    static: makeProbe(),
    light: makeProbe(),
    focus: makeProbe(),
    closed: makeProbe(),
    preinternals: makeProbe(),
  };
  function wrapRecipe(base, key) {
    return (owner, host) => {
      const recipe = base(owner, host);
      const probe = window.__oeProbe[key];
      return {
        ...recipe,
        mount(scope, props) {
          probe.mounts += 1;
          const nodes = recipe.mount(scope, props);
          probe.mountNodes.push(nodes);
          return nodes;
        },
        claim(scope, props, parent) {
          probe.claims += 1;
          probe.parents.push(parent);
          const before = [...parent.childNodes];
          const records = [];
          const observer = new MutationObserver((list) => records.push(...list));
          observer.observe(parent, {
            subtree: true,
            childList: true,
            characterData: true,
            attributes: true,
          });
          let nodes;
          try {
            nodes = recipe.claim(scope, props, parent);
          } catch (error) {
            probe.error = String(error);
            probe.errorCode = error?.code ?? null;
            throw error;
          } finally {
            records.push(...observer.takeRecords());
            observer.disconnect();
          }
          probe.mutations += records.length;
          probe.before.push(before);
          probe.nodes.push(nodes);
          return nodes;
        },
      };
    };
  }
  const panelProperties = [{ name: 'label', attribute: 'label', type: 'string' }];
  const panel = (tag, root, delegatesFocus, key) =>
    mod.defineGeneratedElement({
      tag,
      root,
      delegatesFocus,
      properties: panelProperties,
      createRecipe: wrapRecipe(mod.createShadowPanelRecipe, key),
    });
  panel('oe-m09-shadow-open', 'shadow-open', false, 'panel');
  panel('oe-m09-shadow-open-focus', 'shadow-open', true, 'focus');
  panel('oe-m09-shadow-closed', 'shadow-closed', false, 'closed');
  panel('oe-m09-shadow-closed-focus', 'shadow-closed', true, 'closed');
  panel('oe-m09-shadow-light', 'light', false, 'light');
  mod.defineGeneratedElement({
    tag: 'oe-m09-shadow-static',
    root: 'shadow-open',
    properties: [],
    createRecipe: wrapRecipe(mod.createShadowStaticRecipe, 'static'),
  });
  window.__oeSetup = {
    fill(template, content) {
      return template.split('__OE_SSR_CONTENT__').join(content);
    },
    parse(html) {
      const frame = document.createElement('div');
      frame.setHTMLUnsafe(html);
      return frame.firstElementChild;
    },
    tick() {
      return new Promise((resolve) => setTimeout(resolve, 0));
    },
    errors() {
      const list = [];
      const handler = (event) => list.push({
        code: event.error?.code ?? null,
        message: event.error?.message ?? event.message ?? '',
      });
      window.addEventListener('error', handler);
      return { list, stop: () => window.removeEventListener('error', handler) };
    },
    probe(key) {
      return window.__oeProbe[key];
    },
  };
`;

async function openPage(): Promise<Page> {
  const page = await browser.newPage();
  await page.addScriptTag({ path: bundleFile });
  await page.addScriptTag({ content: PAGE_SETUP });
  return page;
}

beforeAll(async () => {
  const dir = mkdtempSync(join(tmpdir(), 'oe-m09-shadow-'));
  bundleDir = dir;
  const built = await buildBundle(generatedModule(), dir);
  bundleFile = built.file;
  bundleModuleIds = [...built.moduleIds];
  bundleParsedModuleIds = [...built.parsedModuleIds];
  browser = await chromium.launch();
}, 120_000);

afterAll(async () => {
  await browser?.close();
  if (bundleDir !== '') rmSync(bundleDir, { recursive: true, force: true });
});

/**
 * The host template carries a placeholder for the generated content; the page
 * substitutes real `ShadowPanel__ssr` / `ShadowStatic__ssr` bytes. The wrapper
 * itself comes from the canonical Node-side DSD leaf, so the fixture does not
 * restate the template spelling.
 */
const CONTENT_SLOT = '__OE_SSR_CONTENT__';

function openPanelHost(
  tag = 'oe-m09-shadow-open',
  options: { delegatesFocus?: boolean } = {},
  light = '<span slot="title">light-title</span><b>foreign-light</b>',
): string {
  return `<${tag} label="server">${serializeShadowTemplate('open', CONTENT_SLOT, options)}${light}</${tag}>`;
}

function closedPanelHost(
  tag = 'oe-m09-shadow-closed',
  light = '<span slot="title">light-title</span><b>foreign-light</b>',
): string {
  return `<${tag} label="server">${serializeShadowTemplate('closed', CONTENT_SLOT)}${light}</${tag}>`;
}

function staticHost(): string {
  return `<oe-m09-shadow-static>${serializeShadowTemplate('open', CONTENT_SLOT)}<span slot="title">static-title</span></oe-m09-shadow-static>`;
}

const DSD_BOOLEAN_KEYS = [
  'delegatesFocus',
  'clonable',
  'serializable',
  'customElementRegistry',
] as const;
const DSD_SLOT_ASSIGNMENTS = [undefined, 'named', 'manual'] as const;

/** Every legal combination of the five typed DSD options (48). */
function legalDsdOptions(): CompiledDsdOptions[] {
  const options: CompiledDsdOptions[] = [];
  for (let mask = 0; mask < 1 << DSD_BOOLEAN_KEYS.length; mask += 1) {
    for (const slotAssignment of DSD_SLOT_ASSIGNMENTS) {
      const candidate: Record<string, unknown> = {};
      DSD_BOOLEAN_KEYS.forEach((key, index) => {
        if ((mask & (1 << index)) !== 0) candidate[key] = true;
      });
      if (slotAssignment !== undefined) candidate.slotAssignment = slotAssignment;
      options.push(candidate as CompiledDsdOptions);
    }
  }
  return options;
}

interface CapturedError {
  readonly name: string;
  readonly code: string | null;
  readonly path: string | null;
  readonly message: string;
}

function captureError(run: () => unknown): CapturedError | null {
  try {
    run();
    return null;
  } catch (error) {
    const captured = error as {
      name?: string;
      code?: string;
      path?: string;
      message?: string;
    };
    return {
      name: captured.name ?? '',
      code: captured.code ?? null,
      path: captured.path ?? null,
      message: captured.message ?? String(error),
    };
  }
}

describe('canonical DSD spelling leaf', () => {
  test('emits the exact canonical template bytes and no style element', () => {
    expect(serializeShadowTemplate('open', '<p>x</p>')).toBe(
      '<template shadowrootmode="open"><p>x</p></template>',
    );
    expect(serializeShadowTemplate('open', '<p>x</p>', { delegatesFocus: true })).toBe(
      '<template shadowrootmode="open" shadowrootdelegatesfocus><p>x</p></template>',
    );
    expect(serializeShadowTemplate('closed', '<p>x</p>')).toBe(
      '<template shadowrootmode="closed"><p>x</p></template>',
    );
    expect(serializeShadowTemplate('open', '')).not.toContain('<style');
    expect(serializeShadowTemplate('open', '')).not.toContain('<link');
  });

  test('keeps the canonical DSD option spellings and validation', () => {
    expect(serializeDsdAttributes(undefined)).toBe('');
    expect(
      serializeDsdAttributes({
        delegatesFocus: true,
        clonable: true,
        serializable: true,
        slotAssignment: 'manual',
        customElementRegistry: true,
      }),
    ).toBe(
      ' shadowrootdelegatesfocus shadowrootclonable shadowrootserializable shadowrootslotassignment="manual" shadowrootcustomelementregistry',
    );
    expect(() => serializeDsdAttributes({ delegatesFocus: 'yes' as unknown as boolean })).toThrow();
    expect(() =>
      serializeDsdAttributes({ slotAssignment: 'auto' as unknown as 'manual' }),
    ).toThrow();
    expect(() => serializeShadowTemplate('manual' as unknown as 'open', '')).toThrow();
  });

  test('the old server shares this leaf instead of carrying a private copy', async () => {
    const server = await import('../../../element/src/internal/compiled/server/index.ts');
    expect('serializeDsdAttributes' in server).toBe(false);
    const dsd = await import('../../../element/src/internal/compiled/dsd.ts');
    expect(dsd.serializeDsdAttributes).toBe(serializeDsdAttributes);
    const serverSource = readFileSync(
      new URL('../../../element/src/internal/compiled/server/index.ts', import.meta.url),
      'utf8',
    );
    expect(serverSource).toContain("from '../dsd.ts'");
    expect(serverSource).not.toContain('function serializeDsdAttributes');
  });

  /**
   * B5: compare the old server PUBLIC serializer against the current canonical
   * leaf. The old implementation is not copied into the test as an eternal
   * oracle; the 252-case HEAD-vs-new diff in the independent review remains the
   * historical evidence for the extraction diff itself. This test pins the
   * continuing wire agreement while the shared leaf is the only DSD speller.
   */
  test('the old server wire and the canonical DSD leaf agree for every legal option', async () => {
    const { serializeCompiledProgram, serializeProgramContent, serializeStyleLinks } =
      await import('../../../element/src/internal/compiled/server/index.ts');
    const program = testProgram({
      tag: 'oe-dsd-wire',
      template: [
        {
          k: 'el',
          tag: 'p',
          attrs: [['class', 'card']],
          children: [{ k: 'text', value: 'body & text' }],
        },
      ],
      parts: [],
    });
    const host = {};
    const content = serializeProgramContent(program, host);
    const links = ['/assets/a.css', 'https://cdn.example/b.css'];
    const styleNodes = serializeStyleLinks(links);
    const light = '<b slot="title">light</b>';

    for (const mode of ['open', 'closed'] as const) {
      for (const options of legalDsdOptions()) {
        const expected = `<${program.tag}>${serializeShadowTemplate(
          mode,
          `${styleNodes}${content}`,
          options,
        )}${light}</${program.tag}>`;
        const actual = serializeCompiledProgram(program, host, {
          mode,
          dsd: options,
          styleLinks: links,
          hostChildren: light,
        });
        expect(actual, `${mode} ${JSON.stringify(options)}`).toBe(expected);
      }
    }

    // One representative with host attrs and the inline style path: the light
    // serializer is the public source of the style+content inner bytes, so the
    // test does not restate the style spelling either.
    const styleCss = '.card { color: rebeccapurple; }';
    const lightWire = serializeCompiledProgram(program, host, {
      mode: 'light',
      styleCss,
      styleLinks: links,
    });
    const lightOpen = `<${program.tag} data-oe-light>`;
    const lightClose = `</${program.tag}>`;
    expect(lightWire.startsWith(lightOpen)).toBe(true);
    expect(lightWire.endsWith(lightClose)).toBe(true);
    const styleAndContent = lightWire.slice(lightOpen.length, -lightClose.length);
    const serverOpen = serializeCompiledProgram(program, host, {
      mode: 'open',
      dsd: { delegatesFocus: true },
      styleCss,
      styleLinks: links,
      hostAttrs: [
        ['data-owner', 'a&"'],
        ['aria-label', 'card'],
      ],
      hostChildren: light,
    });
    expect(serverOpen).toBe(
      `<${program.tag} data-owner="a&amp;&quot;" aria-label="card">` +
        `${serializeShadowTemplate('open', styleAndContent, { delegatesFocus: true })}` +
        `${light}</${program.tag}>`,
    );
  });

  test('invalid DSD options fail with the same error identity in server and leaf', async () => {
    const { serializeCompiledProgram } =
      await import('../../../element/src/internal/compiled/server/index.ts');
    const program = testProgram({
      tag: 'oe-dsd-invalid',
      template: [{ k: 'el', tag: 'p', attrs: [], children: [] }],
      parts: [],
    });
    const invalidOptions: CompiledDsdOptions[] = [
      { delegatesFocus: 'yes' as unknown as boolean },
      { clonable: 1 as unknown as boolean },
      { serializable: null as unknown as boolean },
      { customElementRegistry: 'true' as unknown as boolean },
      { slotAssignment: 'auto' as unknown as 'manual' },
    ];
    for (const options of invalidOptions) {
      const direct = captureError(() => serializeDsdAttributes(options));
      expect(direct, JSON.stringify(options)).not.toBeNull();
      expect(captureError(() => serializeShadowTemplate('open', '', options))).toEqual(direct);
      expect(
        captureError(() => serializeCompiledProgram(program, {}, { mode: 'open', dsd: options })),
      ).toEqual(direct);
    }
    expect(captureError(() => serializeShadowTemplate('manual' as unknown as 'open', ''))).toEqual({
      name: 'CompiledProgramValidationError',
      code: 'OPEN_ELEMENT_COMPILED_PROGRAM_INVALID',
      path: 'shadowRootMode',
      message:
        '[compiled-program] shadowRootMode: DSD root mode must be "open" or "closed", got "manual"',
    });
  });
});

describe('M09-shadow generated element — Chromium (LOCAL)', () => {
  test('the rendered bundle reaches the shell and never the old backend or server DSD leaf', () => {
    expect(bundleModuleIds.length).toBeGreaterThan(0);
    expect(bundleParsedModuleIds.length).toBeGreaterThan(0);
    const has = (suffix: string) => bundleModuleIds.some((id) => id.endsWith(suffix));
    const parsedHas = (suffix: string) => bundleParsedModuleIds.some((id) => id.endsWith(suffix));
    expect(has('/internal/compiled/generated-element/shell.ts')).toBe(true);
    expect(has('/internal/compiled/runtime/claim-invariants.ts')).toBe(true);
    expect(has('/internal/compiled/runtime/static-sibling-ranges.ts')).toBe(true);
    expect(has('/internal/compiled/dsd.ts')).toBe(false);
    // M09-2a, converted not weakened: this bundle is hand-built and its tail is
    // a light-root generated module, so nothing calls the host producer. The
    // producer leaf and `dsd.ts` are therefore PARSED (the one internal entry
    // re-exports the producer) but must be tree-shaken out of the shipped
    // chunk. The rendered-graph refusal above is unchanged; the parse-graph
    // fact is asserted explicitly instead of being left implicit.
    expect(parsedHas('/internal/compiled/dsd.ts')).toBe(true);
    expect(parsedHas('/generated-element/dsd-ssr.ts')).toBe(true);
    const leaked = bundleModuleIds.filter((id) =>
      FORBIDDEN_MODULE_SUFFIXES.some((suffix) => id.endsWith(suffix)),
    );
    expect(leaked, `forbidden modules reached the bundle:\n${leaked.join('\n')}`).toEqual([]);
    const parsedLeaked = bundleParsedModuleIds.filter((id) =>
      FORBIDDEN_MODULE_SUFFIXES.some((suffix) => id.endsWith(suffix)),
    );
    expect(
      parsedLeaked,
      `forbidden modules parsed for the bundle (before tree-shaking):\n${parsedLeaked.join('\n')}`,
    ).toEqual([]);
  });

  test('platform fact: same-mode declarative roots are cleared, other roots throw', async () => {
    const page = await openPage();
    try {
      const result = await page.evaluate(() => {
        const parse = (html: string): HTMLElement => {
          const frame = document.createElement('div');
          frame.setHTMLUnsafe(html);
          return frame.firstElementChild as HTMLElement;
        };
        const tryAttach = (host: HTMLElement, mode: 'open' | 'closed') => {
          try {
            const root = host.attachShadow({ mode, delegatesFocus: true });
            return {
              ok: true as const,
              mode: root.mode,
              delegatesFocus: root.delegatesFocus,
              childCount: root.childNodes.length,
              text: root.textContent,
            };
          } catch (error) {
            return {
              ok: false as const,
              name: (error as Error).name,
              message: (error as Error).message,
            };
          }
        };

        // Same-mode declarative open root: attachShadow succeeds by clearing it.
        const openHost = parse(
          '<div><template shadowrootmode="open" shadowrootdelegatesfocus><p>open-dsd</p></template></div>',
        );
        document.body.append(openHost);
        const openRoot = openHost.shadowRoot!;
        const openBefore = { text: openRoot.textContent, childCount: openRoot.childNodes.length };
        const openAttach = tryAttach(openHost, 'open');

        // Same-mode declarative closed root: the internals-visible channel lets
        // the probe observe the same clearing behavior.
        const closedTag = 'oe-m09-attach-fact-closed';
        class ClosedProbe extends HTMLElement {
          readonly internals: ElementInternals;
          constructor() {
            super();
            this.internals = this.attachInternals();
          }
        }
        customElements.define(closedTag, ClosedProbe);
        const closedHost = parse(
          `<${closedTag}><template shadowrootmode="closed" shadowrootdelegatesfocus><p>closed-dsd</p></template></${closedTag}>`,
        ) as HTMLElement & { internals: ElementInternals };
        document.body.append(closedHost);
        const closedRoot = closedHost.internals.shadowRoot!;
        const closedBefore = {
          text: closedRoot.textContent,
          childCount: closedRoot.childNodes.length,
        };
        const closedAttach = tryAttach(closedHost, 'closed');

        // Different mode: throws and the declarative content is untouched.
        const crossHost = parse(
          '<div><template shadowrootmode="open"><p>cross-dsd</p></template></div>',
        );
        document.body.append(crossHost);
        const crossRoot = crossHost.shadowRoot!;
        const crossAttach = tryAttach(crossHost, 'closed');

        // Existing imperative root: throws even for the same mode.
        const imperativeHost = document.createElement('div');
        document.body.append(imperativeHost);
        const imperativeRoot = imperativeHost.attachShadow({ mode: 'open' });
        imperativeRoot.innerHTML = '<p>imperative</p>';
        const imperativeAttach = tryAttach(imperativeHost, 'open');

        return {
          openBefore,
          openAttach,
          openAfter: {
            sameRoot: openHost.shadowRoot === openRoot,
            childCount: openRoot.childNodes.length,
            text: openRoot.textContent,
          },
          closedBefore,
          closedAttach,
          closedAfter: {
            sameRoot: closedHost.internals.shadowRoot === closedRoot,
            childCount: closedRoot.childNodes.length,
            text: closedRoot.textContent,
          },
          crossAttach,
          crossAfter: { text: crossRoot.textContent, childCount: crossRoot.childNodes.length },
          imperativeAttach,
          imperativeAfter: {
            sameRoot: imperativeHost.shadowRoot === imperativeRoot,
            text: imperativeRoot.textContent,
          },
        };
      });
      expect(result.openBefore).toEqual({ text: 'open-dsd', childCount: 1 });
      expect(result.openAttach).toMatchObject({
        ok: true,
        mode: 'open',
        delegatesFocus: true,
        childCount: 0,
        text: '',
      });
      expect(result.openAfter).toEqual({ sameRoot: true, childCount: 0, text: '' });

      expect(result.closedBefore).toEqual({ text: 'closed-dsd', childCount: 1 });
      expect(result.closedAttach).toMatchObject({
        ok: true,
        mode: 'closed',
        delegatesFocus: true,
        childCount: 0,
        text: '',
      });
      expect(result.closedAfter).toEqual({ sameRoot: true, childCount: 0, text: '' });

      expect(result.crossAttach).toMatchObject({ ok: false, name: 'NotSupportedError' });
      expect(result.crossAttach.ok === false && result.crossAttach.message).toContain(
        'does not match the existing declarative shadow root',
      );
      expect(result.crossAfter).toEqual({ text: 'cross-dsd', childCount: 1 });

      expect(result.imperativeAttach).toMatchObject({ ok: false, name: 'NotSupportedError' });
      expect(result.imperativeAttach.ok === false && result.imperativeAttach.message).toContain(
        'already hosts a shadow tree',
      );
      expect(result.imperativeAfter).toEqual({ sameRoot: true, text: 'imperative' });
    } finally {
      await page.close();
    }
  });

  test('open DSD takeover: native slot, identity, zero claim mutations, reconnect', async () => {
    const page = await openPage();
    try {
      const html = openPanelHost('oe-m09-shadow-open-focus', { delegatesFocus: true });
      const result = await page.evaluate(async (hostHtml: string) => {
        const setup = window.__oeSetup;
        const mod = window.__oeM09;
        const el = setup.parse(
          setup.fill(
            hostHtml,
            mod.ShadowPanel__ssr(
              { label: 'server' },
              { bindings: {}, props: {}, propsChanged: { value: 0 } },
            ),
          ),
        ) as HTMLElement;
        const root = el.shadowRoot!;
        const probe = setup.probe('focus');
        const light = [...el.childNodes];
        const mutations: MutationRecord[] = [];
        const observer = new MutationObserver((records) => mutations.push(...records));
        observer.observe(root, {
          subtree: true,
          childList: true,
          characterData: true,
          attributes: true,
        });
        const errors = setup.errors();
        document.body.append(el);
        await setup.tick();
        errors.stop();
        mutations.push(...observer.takeRecords());
        observer.disconnect();

        const section = root.querySelector('section');
        const slot = root.querySelector('slot[name="title"]');
        const panel = root.querySelector('#panel');
        const span = el.querySelector('span')!;
        const claimed = {
          sameRoot: el.shadowRoot === root,
          mode: root.mode,
          delegatesFocus: root.delegatesFocus,
          lightChildren: el.childNodes.length,
          lightIdentity: el.childNodes[0] === light[0] && el.childNodes[1] === light[1],
          shadowSection: section !== null,
          slotName: slot?.getAttribute('name') ?? null,
          assignedSlot: span.assignedSlot === slot,
          text: panel?.textContent ?? null,
          title: panel?.getAttribute('title') ?? null,
          inputId: root.querySelector('input')?.id ?? null,
          claimParent: probe.parents[0] === root,
          claimNodes: probe.nodes[0]?.[0] === section,
          claimBefore: probe.before[0]?.[0] === section,
          claims: probe.claims,
          mounts: probe.mounts,
          probeMutations: probe.mutations,
        };
        el.focus();
        const focus = {
          activeHost: document.activeElement === el,
          activeShadow: root.activeElement?.id ?? null,
        };
        el.setAttribute('label', 'next');
        const afterUpdate = {
          text: panel?.textContent ?? null,
          title: panel?.getAttribute('title') ?? null,
          samePanel: root.querySelector('#panel') === panel,
        };
        el.remove();
        const retained = {
          sameRoot: el.shadowRoot === root,
          samePanel: root.querySelector('#panel') === panel,
          text: panel?.textContent ?? null,
          attached: el.isConnected,
        };
        document.body.append(el);
        await setup.tick();
        const reconnected = {
          sameRoot: el.shadowRoot === root,
          samePanel: root.querySelector('#panel') === panel,
          text: panel?.textContent ?? null,
          claims: probe.claims,
          mounts: probe.mounts,
        };
        el.setAttribute('label', 'again');
        const afterReconnect = {
          text: panel?.textContent ?? null,
          title: panel?.getAttribute('title') ?? null,
        };
        return {
          errors: errors.list,
          mutations: mutations.length,
          claims: claimed,
          focus,
          afterUpdate,
          retained,
          reconnected,
          afterReconnect,
        };
      }, html);
      expect(result.errors, html).toEqual([]);
      expect(result.mutations).toBe(0);
      expect(result.claims).toMatchObject({
        sameRoot: true,
        mode: 'open',
        delegatesFocus: true,
        lightChildren: 2,
        lightIdentity: true,
        shadowSection: true,
        slotName: 'title',
        assignedSlot: true,
        text: 'server',
        title: 'server',
        inputId: 'field',
        claimParent: true,
        claimNodes: true,
        claimBefore: true,
        claims: 1,
        mounts: 0,
        probeMutations: 0,
      });
      expect(result.focus).toEqual({ activeHost: true, activeShadow: 'field' });
      expect(result.afterUpdate).toMatchObject({
        text: 'next',
        title: 'next',
        samePanel: true,
      });
      expect(result.retained).toMatchObject({
        sameRoot: true,
        samePanel: true,
        text: 'next',
        attached: false,
      });
      expect(result.reconnected).toMatchObject({
        sameRoot: true,
        samePanel: true,
        text: 'next',
        claims: 2,
        mounts: 0,
      });
      expect(result.afterReconnect).toMatchObject({ text: 'again', title: 'again' });
    } finally {
      await page.close();
    }
  });

  test('closed DSD takeover: internals root, zero mount, identity, reconnect', async () => {
    const page = await openPage();
    try {
      const html = closedPanelHost();
      const result = await page.evaluate(async (hostHtml: string) => {
        const setup = window.__oeSetup;
        const mod = window.__oeM09;
        const el = setup.parse(
          setup.fill(
            hostHtml,
            mod.ShadowPanel__ssr(
              { label: 'server' },
              { bindings: {}, props: {}, propsChanged: { value: 0 } },
            ),
          ),
        ) as HTMLElement;
        const probe = setup.probe('closed');
        const light = [...el.childNodes];
        const errors = setup.errors();
        document.body.append(el);
        await setup.tick();
        errors.stop();
        const parent = probe.parents[0] as ShadowRoot;
        const adopted = probe.nodes[0]?.[0] as Element;
        const panel = adopted?.querySelector('#panel');
        const claimed = {
          hostShadowRoot: el.shadowRoot,
          parentMode: parent?.mode ?? null,
          parentHost: parent?.host === el,
          lightChildren: el.childNodes.length,
          lightIdentity: el.childNodes[0] === light[0] && el.childNodes[1] === light[1],
          sameAdopted: probe.before[0]?.[0] === adopted,
          text: panel?.textContent ?? null,
          title: panel?.getAttribute('title') ?? null,
          claims: probe.claims,
          mounts: probe.mounts,
          mutations: probe.mutations,
          html: el.innerHTML,
        };
        el.setAttribute('label', 'next');
        const afterUpdate = {
          text: panel?.textContent ?? null,
          title: panel?.getAttribute('title') ?? null,
        };
        el.remove();
        const retained = {
          sameParent: (probe.parents[0] as ShadowRoot) === parent,
          samePanel: panel?.isConnected ?? false,
          attached: el.isConnected,
        };
        document.body.append(el);
        await setup.tick();
        const reconnected = {
          sameParent: (probe.parents[1] as ShadowRoot) === parent,
          samePanel: panel?.isConnected ?? false,
          text: panel?.textContent ?? null,
          claims: probe.claims,
          mounts: probe.mounts,
        };
        el.setAttribute('label', 'again');
        const afterReconnect = {
          text: panel?.textContent ?? null,
          title: panel?.getAttribute('title') ?? null,
        };
        return {
          errors: errors.list,
          claims: claimed,
          afterUpdate,
          retained,
          reconnected,
          afterReconnect,
        };
      }, html);
      expect(result.errors, html).toEqual([]);
      expect(result.claims).toMatchObject({
        hostShadowRoot: null,
        parentMode: 'closed',
        parentHost: true,
        lightChildren: 2,
        lightIdentity: true,
        sameAdopted: true,
        text: 'server',
        title: 'server',
        claims: 1,
        mounts: 0,
        mutations: 0,
      });
      expect(result.claims.html).not.toContain('<template');
      expect(result.claims.html).toContain('light-title');
      expect(result.afterUpdate).toMatchObject({ text: 'next', title: 'next' });
      expect(result.retained).toMatchObject({ sameParent: true, attached: false });
      expect(result.reconnected).toMatchObject({
        sameParent: true,
        text: 'next',
        claims: 2,
        mounts: 0,
      });
      expect(result.afterReconnect).toMatchObject({ text: 'again', title: 'again' });
    } finally {
      await page.close();
    }
  });

  test('open CSR attachShadow passes delegatesFocus and focus delegates into the root', async () => {
    const page = await openPage();
    try {
      const result = await page.evaluate(async () => {
        const setup = window.__oeSetup;
        const probe = setup.probe('focus');
        const el = document.createElement('oe-m09-shadow-open-focus') as HTMLElement;
        el.setAttribute('label', 'csr');
        document.body.append(el);
        await setup.tick();
        const root = el.shadowRoot!;
        const panel = root.querySelector('#panel');
        el.focus();
        return {
          hasRoot: root !== null,
          mode: root.mode,
          delegatesFocus: root.delegatesFocus,
          hostLightChildren: el.childNodes.length,
          activeHost: document.activeElement === el,
          activeShadow: root.activeElement?.id ?? null,
          claims: probe.claims,
          mounts: probe.mounts,
          text: panel?.textContent ?? null,
        };
      });
      expect(result).toMatchObject({
        hasRoot: true,
        mode: 'open',
        delegatesFocus: true,
        hostLightChildren: 0,
        activeHost: true,
        activeShadow: 'field',
        claims: 0,
        mounts: 1,
        text: 'csr',
      });
    } finally {
      await page.close();
    }
  });

  test('closed CSR creates a closed root without exposing host.shadowRoot', async () => {
    const page = await openPage();
    try {
      const result = await page.evaluate(async () => {
        const setup = window.__oeSetup;
        const probe = setup.probe('closed');
        const el = document.createElement('oe-m09-shadow-closed') as HTMLElement;
        el.setAttribute('label', 'csr-closed');
        document.body.append(el);
        await setup.tick();
        const mounted = probe.mountNodes[0]?.[0] as Element;
        const root = mounted?.getRootNode() as ShadowRoot;
        const panel = mounted?.querySelector?.('#panel') ?? null;
        const first = {
          hostShadowRoot: el.shadowRoot,
          rootMode: root?.mode ?? null,
          rootHost: root?.host === el,
          claims: probe.claims,
          mounts: probe.mounts,
          text: panel?.textContent ?? null,
        };
        el.setAttribute('label', 'next');
        const afterUpdate = { text: panel?.textContent ?? null };
        el.dispose(true);
        const disposed = {
          rootChildCount: root?.childNodes.length ?? -1,
          hostShadowRoot: el.shadowRoot,
        };
        el.remove();
        document.body.append(el);
        await setup.tick();
        const remounted = {
          mounts: probe.mounts,
          text: (probe.mountNodes[1]?.[0] as Element)?.textContent ?? null,
        };
        return { first, afterUpdate, disposed, remounted };
      });
      expect(result.first).toMatchObject({
        hostShadowRoot: null,
        rootMode: 'closed',
        rootHost: true,
        claims: 0,
        mounts: 1,
        text: 'csr-closed',
      });
      expect(result.afterUpdate).toEqual({ text: 'next' });
      expect(result.disposed).toMatchObject({ rootChildCount: 0, hostShadowRoot: null });
      expect(result.remounted).toMatchObject({ mounts: 2 });
      expect(result.remounted.text).toContain('next');
    } finally {
      await page.close();
    }
  });

  test('root/DSD mismatches are coded, preserve existing content and roll back the attempt', async () => {
    const page = await openPage();
    try {
      const result = await page.evaluate(
        async (payload: { optionMismatchHtml: string; closedPreinternalsHtml: string }) => {
          const setup = window.__oeSetup;
          const mod = window.__oeM09;
          const results: Record<string, unknown> = {};

          // 1. A light descriptor on a host that already has an open shadow root.
          {
            const el = document.createElement('oe-m09-shadow-light') as HTMLElement;
            const foreign = el.attachShadow({ mode: 'open' });
            foreign.innerHTML = '<p>foreign</p>';
            const errors = setup.errors();
            document.body.append(el);
            await setup.tick();
            errors.stop();
            results.lightOnShadow = {
              errors: errors.list,
              content: foreign.innerHTML,
              childCount: el.childNodes.length,
              claims: setup.probe('light').claims,
              mounts: setup.probe('light').mounts,
            };
          }

          // 2. A shadow-open descriptor on a host that already has a closed root:
          // attachShadow cannot replace it, and the closed content must survive.
          {
            const el = document.createElement('oe-m09-shadow-open') as HTMLElement;
            const closed = el.attachShadow({ mode: 'closed' });
            closed.innerHTML = '<p>closed</p>';
            el.append(document.createElement('i'));
            const errors = setup.errors();
            document.body.append(el);
            await setup.tick();
            errors.stop();
            results.openOnClosed = {
              errors: errors.list,
              shadowRoot: el.shadowRoot,
              content: closed.textContent,
              lightChildren: el.childNodes.length,
              claims: setup.probe('panel').claims,
              mounts: setup.probe('panel').mounts,
            };
          }

          // 3. A shadow-closed descriptor on a host that already has an open root.
          {
            const el = document.createElement('oe-m09-shadow-closed') as HTMLElement;
            const open = el.attachShadow({ mode: 'open' });
            open.innerHTML = '<p>open</p>';
            const errors = setup.errors();
            document.body.append(el);
            await setup.tick();
            errors.stop();
            results.closedOnOpen = {
              errors: errors.list,
              content: open.innerHTML,
              claims: setup.probe('closed').claims,
              mounts: setup.probe('closed').mounts,
            };
          }

          // 4. delegatesFocus drift between the DSD root and the descriptor.
          {
            const el = setup.parse(
              setup.fill(
                payload.optionMismatchHtml,
                mod.ShadowPanel__ssr(
                  { label: 'server' },
                  { bindings: {}, props: {}, propsChanged: { value: 0 } },
                ),
              ),
            ) as HTMLElement;
            const root = el.shadowRoot!;
            const before = root.innerHTML;
            const errors = setup.errors();
            document.body.append(el);
            await setup.tick();
            errors.stop();
            results.optionMismatch = {
              errors: errors.list,
              content: root.innerHTML,
              unchanged: root.innerHTML === before,
              lightChildren: el.childNodes.length,
              claims: setup.probe('focus').claims,
              mounts: setup.probe('focus').mounts,
            };
          }

          // 5. A parser-inert template from innerHTML: never CSR-fallback.
          {
            const el = document.createElement('oe-m09-shadow-open') as HTMLElement;
            el.innerHTML = '<template shadowrootmode="open"><p>fake</p></template>';
            const errors = setup.errors();
            document.body.append(el);
            await setup.tick();
            errors.stop();
            results.dsdNotAdopted = {
              errors: errors.list,
              shadowRoot: el.shadowRoot,
              template: el.firstElementChild?.tagName ?? null,
              templateMode: el.firstElementChild?.getAttribute('shadowrootmode') ?? null,
              claims: setup.probe('panel').claims,
              mounts: setup.probe('panel').mounts,
            };
          }

          // 6. Closed + already-attached internals is explicitly unsupported:
          // discovery is impossible and a second attachInternals throws. Never
          // fall back to attachShadow: with a same-mode declarative root it
          // clears that root's children; with a different mode or an existing
          // imperative root it throws. Neither is a discovery path.
          {
            const base = mod.createGeneratedElementClass({
              tag: 'oe-m09-shadow-closed-preinternals',
              root: 'shadow-closed',
              properties: [{ name: 'label', attribute: 'label', type: 'string' }],
              createRecipe: mod.createShadowPanelRecipe,
            }) as new () => HTMLElement;
            class PreAttachedInternals extends base {
              constructor() {
                super();
                (this as unknown as { __internals: ElementInternals }).__internals =
                  this.attachInternals();
              }
            }
            customElements.define('oe-m09-shadow-closed-preinternals', PreAttachedInternals);
            const el = setup.parse(
              setup.fill(
                payload.closedPreinternalsHtml,
                mod.ShadowPanel__ssr(
                  { label: 'server' },
                  { bindings: {}, props: {}, propsChanged: { value: 0 } },
                ),
              ),
            ) as HTMLElement & {
              __internals: ElementInternals;
            };
            const internalsRoot = el.__internals.shadowRoot as ShadowRoot | null;
            const before = internalsRoot?.textContent ?? null;
            const errors = setup.errors();
            document.body.append(el);
            await setup.tick();
            errors.stop();
            results.closedPreinternals = {
              errors: errors.list,
              hostShadowRoot: el.shadowRoot,
              internalsRootMode: internalsRoot?.mode ?? null,
              content: internalsRoot?.textContent ?? null,
              unchanged: (internalsRoot?.textContent ?? null) === before,
              mounts: setup.probe('preinternals').mounts,
              claims: setup.probe('preinternals').claims,
            };
          }

          return results;
        },
        {
          optionMismatchHtml: openPanelHost('oe-m09-shadow-open-focus'),
          closedPreinternalsHtml: closedPanelHost('oe-m09-shadow-closed-preinternals'),
        },
      );

      expect(result.lightOnShadow).toMatchObject({
        content: '<p>foreign</p>',
        childCount: 0,
        claims: 0,
        mounts: 0,
      });
      expect(
        (result.lightOnShadow as { errors: { code: string }[] }).errors.map((e) => e.code),
      ).toEqual(['OEIR_SHELL_ROOT_MODE_MISMATCH']);

      expect(result.openOnClosed).toMatchObject({
        shadowRoot: null,
        content: 'closed',
        lightChildren: 1,
        claims: 0,
        mounts: 0,
      });
      expect(
        (result.openOnClosed as { errors: { code: string }[] }).errors.map((e) => e.code),
      ).toEqual(['OEIR_SHELL_ATTACH_SHADOW_FAILED']);

      expect(result.closedOnOpen).toMatchObject({
        content: '<p>open</p>',
        claims: 0,
        mounts: 0,
      });
      expect(
        (result.closedOnOpen as { errors: { code: string }[] }).errors.map((e) => e.code),
      ).toEqual(['OEIR_SHELL_ROOT_MODE_MISMATCH']);

      expect(result.optionMismatch).toMatchObject({
        unchanged: true,
        lightChildren: 2,
        claims: 0,
        mounts: 0,
      });
      expect(
        (result.optionMismatch as { errors: { code: string }[] }).errors.map((e) => e.code),
      ).toEqual(['OEIR_SHELL_ROOT_OPTION_MISMATCH']);

      expect(result.dsdNotAdopted).toMatchObject({
        shadowRoot: null,
        template: 'TEMPLATE',
        templateMode: 'open',
        claims: 0,
        mounts: 0,
      });
      expect(
        (result.dsdNotAdopted as { errors: { code: string }[] }).errors.map((e) => e.code),
      ).toEqual(['OEIR_SHELL_DSD_NOT_ADOPTED']);

      expect(result.closedPreinternals).toMatchObject({
        hostShadowRoot: null,
        internalsRootMode: 'closed',
        unchanged: true,
        mounts: 0,
        claims: 0,
      });
      expect(
        (result.closedPreinternals as { errors: { code: string }[] }).errors.map((e) => e.code),
      ).toEqual(['OEIR_SHELL_CLOSED_ROOT_UNREACHABLE']);
    } finally {
      await page.close();
    }
  });

  test('a coded root failure preserves content and rolls back, but pre-upgrade reflection may land first', async () => {
    const page = await openPage();
    try {
      const result = await page.evaluate(async () => {
        const setup = window.__oeSetup;
        const mod = window.__oeM09;
        const tag = 'oe-m09-shadow-preupgrade-failure';
        const counters = { mounts: 0, claims: 0 };
        const base = mod.createGeneratedElementClass({
          tag,
          root: 'shadow-closed',
          properties: [{ name: 'label', attribute: 'label', type: 'string', reflect: true }],
          createRecipe: (owner: unknown) =>
            mod.createRecipe({
              definitionOwner: owner,
              mount: () => {
                counters.mounts += 1;
                return [];
              },
              claim: () => {
                counters.claims += 1;
                return [];
              },
            }),
        }) as new () => HTMLElement;
        const el = document.createElement(tag) as HTMLElement;
        const foreign = el.attachShadow({ mode: 'open' });
        foreign.innerHTML = '<p>foreign</p>';
        (el as unknown as { label: string }).label = 'pre-upgrade-value';
        const before = {
          ownProperty: Object.prototype.hasOwnProperty.call(el, 'label'),
          attribute: el.getAttribute('label'),
          content: foreign.innerHTML,
        };
        customElements.define(tag, base as unknown as CustomElementConstructor);
        customElements.upgrade(el);
        const errors = setup.errors();
        document.body.append(el);
        await setup.tick();
        errors.stop();
        const after = {
          attribute: el.getAttribute('label'),
          ownProperty: Object.prototype.hasOwnProperty.call(el, 'label'),
          content: foreign.innerHTML,
          sameRoot: el.shadowRoot === foreign,
          mounts: counters.mounts,
          claims: counters.claims,
        };
        const capture = () => {
          try {
            el.connectedCallback();
            return null;
          } catch (error) {
            return {
              code: (error as { code?: string }).code ?? null,
              message: (error as { message?: string }).message ?? '',
            };
          }
        };
        return { before, after, errors: errors.list, retry: capture() };
      });
      expect(result.before).toEqual({
        ownProperty: true,
        attribute: null,
        content: '<p>foreign</p>',
      });
      expect(result.errors.map((error) => error.code)).toEqual(['OEIR_SHELL_ROOT_MODE_MISMATCH']);
      // The failed connect is not a zero-write path: reconciliation ran before
      // root resolution and reflected the own property. It still preserved the
      // foreign root content, created no projection and mounted/claimed nothing.
      expect(result.after).toEqual({
        attribute: 'pre-upgrade-value',
        ownProperty: false,
        content: '<p>foreign</p>',
        sameRoot: true,
        mounts: 0,
        claims: 0,
      });
      expect(result.retry?.code).toBe('OEIR_SHELL_ROOT_MODE_MISMATCH');
    } finally {
      await page.close();
    }
  });

  test('dispose removes only owned nodes; light and foreign shadow children stay', async () => {
    const page = await openPage();
    try {
      const html = openPanelHost();
      const result = await page.evaluate(async (hostHtml: string) => {
        const setup = window.__oeSetup;
        const mod = window.__oeM09;
        const probe = setup.probe('panel');
        const el = setup.parse(
          setup.fill(
            hostHtml,
            mod.ShadowPanel__ssr(
              { label: 'server' },
              { bindings: {}, props: {}, propsChanged: { value: 0 } },
            ),
          ),
        ) as HTMLElement;
        const root = el.shadowRoot!;
        document.body.append(el);
        await setup.tick();
        const panel = root.querySelector('#panel') as Element;
        const lightCount = el.childNodes.length;
        const foreignShadow = document.createElement('u');
        foreignShadow.textContent = 'foreign-shadow';
        root.append(foreignShadow);
        const foreignLight = document.createElement('i');
        foreignLight.textContent = 'foreign';
        el.append(foreignLight);
        el.dispose(true);
        const disposed = {
          sameRoot: el.shadowRoot === root,
          ownedRemoved: root.querySelector('#panel') === null,
          foreignShadow: root.querySelector('u')?.textContent ?? null,
          lightCount: el.childNodes.length,
          foreignLight: el.querySelector('i')?.textContent ?? null,
          panelConnected: panel.isConnected,
        };
        el.remove();
        document.body.append(el);
        await setup.tick();
        const panel2 = root.querySelector('#panel') as Element;
        const remounted = {
          sameRoot: el.shadowRoot === root,
          newPanel: panel2 !== panel,
          text: panel2?.textContent ?? null,
          mounts: probe.mounts,
          claims: probe.claims,
          lightCount: el.childNodes.length,
          foreignLight: el.contains(foreignLight),
          foreignShadow: root.querySelector('u')?.textContent ?? null,
          oldPanelDetached: !panel.isConnected,
        };
        // Remove the foreign node only for the retained-DOM claim half: the
        // generated claim starts at the root's first child, and this test is
        // about dispose(true) preserving foreign nodes across the remount.
        root.querySelector('u')?.remove();
        el.dispose(false);
        const plainDisposed = {
          retained: root.querySelector('#panel') === panel2,
          rootRetained: el.shadowRoot === root,
          lightCount: el.childNodes.length,
        };
        el.remove();
        document.body.append(el);
        await setup.tick();
        const reclaimed = {
          samePanel: root.querySelector('#panel') === panel2,
          claims: probe.claims,
          mounts: probe.mounts,
          text: panel2?.textContent ?? null,
        };
        return { lightCount, disposed, remounted, plainDisposed, reclaimed };
      }, html);
      expect(result.lightCount).toBe(2);
      expect(result.disposed).toMatchObject({
        sameRoot: true,
        ownedRemoved: true,
        foreignShadow: 'foreign-shadow',
        lightCount: 3,
        foreignLight: 'foreign',
        panelConnected: false,
      });
      expect(result.remounted).toMatchObject({
        sameRoot: true,
        newPanel: true,
        text: 'server',
        mounts: 1,
        claims: 1,
        lightCount: 3,
        foreignLight: true,
        foreignShadow: 'foreign-shadow',
        oldPanelDetached: true,
      });
      expect(result.plainDisposed).toMatchObject({
        retained: true,
        rootRetained: true,
        lightCount: 3,
      });
      expect(result.reclaimed).toMatchObject({
        samePanel: true,
        claims: 2,
        mounts: 1,
        text: 'server',
      });
    } finally {
      await page.close();
    }
  });

  test('closed option mismatch keeps shell-owned internals and the same coded error on retry', async () => {
    const page = await openPage();
    try {
      const html = closedPanelHost('oe-m09-shadow-closed-focus');
      const result = await page.evaluate((hostHtml: string) => {
        const setup = window.__oeSetup;
        const mod = window.__oeM09;
        const probe = setup.probe('closed');
        const el = setup.parse(
          setup.fill(
            hostHtml,
            mod.ShadowPanel__ssr(
              { label: 'server' },
              { bindings: {}, props: {}, propsChanged: { value: 0 } },
            ),
          ),
        ) as HTMLElement;
        const capture = () => {
          try {
            el.connectedCallback();
            return null;
          } catch (error) {
            return {
              code: (error as { code?: string }).code ?? null,
              message: (error as { message?: string }).message ?? '',
            };
          }
        };
        const first = capture();
        const second = capture();
        let attachInternalsAfter: string | null = null;
        try {
          el.attachInternals();
        } catch (error) {
          attachInternalsAfter = (error as Error).name;
        }
        return {
          first,
          second,
          attachInternalsAfter,
          hostShadowRoot: el.shadowRoot,
          claims: probe.claims,
          mounts: probe.mounts,
        };
      }, html);
      expect(result.first).toMatchObject({ code: 'OEIR_SHELL_ROOT_OPTION_MISMATCH' });
      expect(result.second).toEqual(result.first);
      expect(result.second?.message).toContain('delegatesFocus mismatch');
      expect(result.second?.message).not.toContain('another subsystem');
      expect(result.attachInternalsAfter).toBe('NotSupportedError');
      expect(result.hostShadowRoot).toBe(null);
      expect(result.claims).toBe(0);
      expect(result.mounts).toBe(0);
    } finally {
      await page.close();
    }
  });

  test('dispose(true) preserves foreign root children and the next connect mounts beside them', async () => {
    const page = await openPage();
    try {
      const result = await page.evaluate(async () => {
        const setup = window.__oeSetup;
        const probe = setup.probe('panel');
        const el = document.createElement('oe-m09-shadow-open') as HTMLElement;
        el.setAttribute('label', 'csr');
        document.body.append(el);
        await setup.tick();
        const root = el.shadowRoot!;
        const firstSection = root.querySelector('section');
        const firstPanel = root.querySelector('#panel');
        const foreign = document.createElement('u');
        foreign.textContent = 'foreign-root-child';
        root.append(foreign);

        el.dispose(true);
        const afterDispose = {
          sameRoot: el.shadowRoot === root,
          generatedGone: root.querySelector('#panel') === null,
          foreignIdentity: root.querySelector('u') === foreign,
          childNodes: [...root.childNodes].map((node) => node.nodeName),
          mounts: probe.mounts,
          claims: probe.claims,
        };

        el.remove();
        document.body.append(el);
        await setup.tick();
        const secondSection = root.querySelector('section');
        const remounted = {
          sameRoot: el.shadowRoot === root,
          mounts: probe.mounts,
          claims: probe.claims,
          freshSection: secondSection !== null && secondSection !== firstSection,
          freshPanel: root.querySelector('#panel') !== firstPanel,
          foreignIdentity: root.querySelector('u') === foreign,
          foreignText: root.querySelector('u')?.textContent ?? null,
          text: root.querySelector('#panel')?.textContent ?? null,
          firstPanelDetached: !firstPanel?.isConnected,
        };
        el.dispose(true);
        return {
          afterDispose,
          remounted,
          secondDispose: {
            foreignIdentity: root.querySelector('u') === foreign,
            generatedGone: root.querySelector('#panel') === null,
          },
        };
      });
      expect(result.afterDispose).toMatchObject({
        sameRoot: true,
        generatedGone: true,
        foreignIdentity: true,
        childNodes: ['U'],
        mounts: 1,
        claims: 0,
      });
      expect(result.remounted).toMatchObject({
        sameRoot: true,
        mounts: 2,
        claims: 0,
        freshSection: true,
        freshPanel: true,
        foreignIdentity: true,
        foreignText: 'foreign-root-child',
        text: 'csr',
        firstPanelDetached: true,
      });
      expect(result.secondDispose).toEqual({ foreignIdentity: true, generatedGone: true });
    } finally {
      await page.close();
    }
  });

  test('an adopted imperative root with SSR content is claimed once, not re-attached', async () => {
    const page = await openPage();
    try {
      const result = await page.evaluate(async () => {
        const setup = window.__oeSetup;
        const mod = window.__oeM09;
        const probe = setup.probe('panel');
        const el = document.createElement('oe-m09-shadow-open') as HTMLElement;
        el.setAttribute('label', 'foreign-root');
        const root = el.attachShadow({ mode: 'open' });
        root.innerHTML = mod.ShadowPanel__ssr(
          { label: 'foreign-root' },
          { bindings: {}, props: {}, propsChanged: { value: 0 } },
        );
        const section = root.querySelector('section');
        document.body.append(el);
        await setup.tick();
        const claimed = {
          sameRoot: el.shadowRoot === root,
          claims: probe.claims,
          mounts: probe.mounts,
          sameSection: root.querySelector('section') === section,
          claimParent: probe.parents[0] === root,
          text: root.querySelector('#panel')?.textContent ?? null,
          rootChildCount: root.childNodes.length,
        };
        el.setAttribute('label', 'updated');
        return {
          claimed,
          updated: root.querySelector('#panel')?.textContent ?? null,
        };
      });
      expect(result.claimed).toMatchObject({
        sameRoot: true,
        claims: 1,
        mounts: 0,
        sameSection: true,
        claimParent: true,
        text: 'foreign-root',
        rootChildCount: 1,
      });
      expect(result.updated).toBe('updated');
    } finally {
      await page.close();
    }
  });

  test('static directory claim accepts a real ShadowRoot and a bare fragment is refused', async () => {
    const page = await openPage();
    try {
      const html = staticHost();
      const result = await page.evaluate(async (hostHtml: string) => {
        const setup = window.__oeSetup;
        const mod = window.__oeM09;
        const probe = setup.probe('static');
        const el = setup.parse(setup.fill(hostHtml, mod.ShadowStatic__ssr())) as HTMLElement;
        const root = el.shadowRoot!;
        const before = [...root.childNodes];
        document.body.append(el);
        await setup.tick();
        const slot = root.querySelector('slot[name="title"]');
        const span = el.querySelector('span')!;
        const p = root.querySelector('#static');
        const claimed = {
          sameRoot: el.shadowRoot === root,
          claims: probe.claims,
          mounts: probe.mounts,
          mutations: probe.mutations,
          parent: probe.parents[0] === root,
          sameP: p !== null && root.querySelector('#static') === p,
          assigned: span.assignedSlot === slot,
          beforeNodes: before.length,
          slotName: slot?.getAttribute('name') ?? null,
        };

        const holder = document.createElement('div');
        document.body.append(holder);
        const fresh = holder.attachShadow({ mode: 'open' });
        const opened = mod.openStaticSiblingDirectory(fresh, [], 'probe');
        const acceptedParent = opened.parent === fresh;

        const fragment = document.createDocumentFragment();
        let fragmentError: { code?: string; message: string } | null = null;
        try {
          mod.openStaticSiblingDirectory(fragment, [], 'probe');
        } catch (error) {
          fragmentError = {
            code: (error as { code?: string }).code,
            message: (error as { message: string }).message,
          };
        }
        // A fragment with spoofed ShadowRoot fields is still not a ShadowRoot.
        const spoofed = document.createDocumentFragment();
        Object.defineProperty(spoofed, 'host', { value: el, configurable: true });
        Object.defineProperty(spoofed, 'mode', { value: 'open', configurable: true });
        let spoofedDirectoryError: { code?: string; message: string } | null = null;
        try {
          mod.openStaticSiblingDirectory(spoofed, [], 'probe');
        } catch (error) {
          spoofedDirectoryError = {
            code: (error as { code?: string }).code,
            message: (error as { message: string }).message,
          };
        }
        let spoofedAssertError: { code?: string; message: string } | null = null;
        try {
          mod.assertElementInHtmlNamespace(spoofed, 'probe');
        } catch (error) {
          spoofedAssertError = {
            code: (error as { code?: string }).code,
            message: (error as { message: string }).message,
          };
        }
        let assertFragmentError: { code?: string; message: string } | null = null;
        try {
          mod.assertElementInHtmlNamespace(fragment, 'probe');
        } catch (error) {
          assertFragmentError = {
            code: (error as { code?: string }).code,
            message: (error as { message: string }).message,
          };
        }
        let assertRootError: unknown = null;
        try {
          mod.assertElementInHtmlNamespace(root, 'probe');
        } catch (error) {
          assertRootError = error;
        }

        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        const foreignObject = document.createElementNS(
          'http://www.w3.org/2000/svg',
          'foreignObject',
        );
        svg.append(foreignObject);
        document.body.append(svg);
        const htmlChild = document.createElement('div');
        foreignObject.append(htmlChild);
        const foreignShadow = htmlChild.attachShadow({ mode: 'open' });
        let ancestorDirectoryError: { code?: string; message: string } | null = null;
        try {
          mod.openStaticSiblingDirectory(foreignShadow, [], 'probe');
        } catch (error) {
          ancestorDirectoryError = {
            code: (error as { code?: string }).code,
            message: (error as { message: string }).message,
          };
        }
        let ancestorNamespaceError: { code?: string; message: string } | null = null;
        try {
          mod.assertElementInHtmlNamespace(foreignShadow, 'probe');
        } catch (error) {
          ancestorNamespaceError = {
            code: (error as { code?: string }).code,
            message: (error as { message: string }).message,
          };
        }

        return {
          claimed,
          acceptedParent,
          fragmentError,
          spoofedDirectoryError,
          spoofedAssertError,
          assertFragmentError,
          assertRootError,
          ancestorDirectoryError,
          ancestorNamespaceError,
          leafCode: mod.LEAF_CLAIM_MISMATCH,
          namespace: root.host.namespaceURI,
        };
      }, html);
      expect(result.claimed).toMatchObject({
        sameRoot: true,
        claims: 1,
        mounts: 0,
        mutations: 0,
        parent: true,
        sameP: true,
        assigned: true,
        slotName: 'title',
      });
      expect(result.acceptedParent).toBe(true);
      expect(result.assertRootError).toBeNull();
      expect(result.fragmentError).not.toBeNull();
      expect(result.fragmentError?.code).toBe('OE_RUNTIME_STATIC_RANGE_MISMATCH');
      expect(result.fragmentError?.message).toContain('unsupported directory parent');
      expect(result.assertFragmentError?.code).toBe(result.leafCode);
      expect(result.assertFragmentError?.message).toContain('not an element');
      expect(result.spoofedDirectoryError?.code).toBe('OE_RUNTIME_STATIC_RANGE_MISMATCH');
      expect(result.spoofedAssertError?.code).toBe(result.leafCode);
      expect(result.spoofedAssertError?.message).toContain('not an element');
      expect(result.ancestorDirectoryError?.code).toBe('OE_RUNTIME_STATIC_RANGE_MISMATCH');
      expect(result.ancestorDirectoryError?.message).toContain('directory is inside');
      expect(result.ancestorNamespaceError?.code).toBe(result.leafCode);
      expect(result.ancestorNamespaceError?.message).toContain('non-HTML namespace');
      expect(result.namespace).toBe(HTML_NAMESPACE);
    } finally {
      await page.close();
    }
  });

  test('cross-realm real ShadowRoot passes the native brand check; spoofed fragments do not', async () => {
    const page = await openPage();
    try {
      const result = await page.evaluate(async () => {
        const mod = window.__oeM09;
        const tryCall = (run: () => unknown) => {
          try {
            const value = run() as { parent?: Node } | undefined;
            return {
              ok: true as const,
              parentMode:
                value && typeof value === 'object' && 'parent' in value
                  ? ((value.parent as ShadowRoot | undefined)?.mode ?? null)
                  : null,
            };
          } catch (error) {
            return {
              ok: false as const,
              code: (error as { code?: string }).code ?? null,
              message: (error as { message?: string }).message ?? '',
            };
          }
        };

        const iframe = document.createElement('iframe');
        iframe.srcdoc = '<!doctype html><body></body>';
        document.body.append(iframe);
        await new Promise<void>((resolve) => {
          iframe.addEventListener('load', () => resolve(), { once: true });
        });
        const frameDocument = iframe.contentWindow!.document;
        const host = frameDocument.createElement('div');
        frameDocument.body.append(host);
        const foreignRoot = host.attachShadow({ mode: 'open' });
        foreignRoot.innerHTML = '<p>cross-realm</p>';
        const emptyHost = frameDocument.createElement('div');
        frameDocument.body.append(emptyHost);
        const emptyRoot = emptyHost.attachShadow({ mode: 'open' });
        const foreignFragment = frameDocument.createDocumentFragment();

        // A parent-realm fragment that spoofs every surface the old duck-typed
        // check read: toStringTag, host and mode. The native brand accessor
        // still rejects it.
        const forged = document.createDocumentFragment();
        Object.defineProperties(forged, {
          [Symbol.toStringTag]: { value: 'ShadowRoot', configurable: true },
          host: { value: host, configurable: true },
          mode: { value: 'open', configurable: true },
          delegatesFocus: { value: false, configurable: true },
        });

        const report = {
          brandRoot: mod.isClaimParentShadowRoot(foreignRoot),
          brandEmptyRoot: mod.isClaimParentShadowRoot(emptyRoot),
          brandFragment: mod.isClaimParentShadowRoot(foreignFragment),
          forgedToString: Object.prototype.toString.call(forged),
          brandForged: mod.isClaimParentShadowRoot(forged),
          rootHost: foreignRoot.host === host,
          assertRoot: tryCall(() => mod.assertElementInHtmlNamespace(foreignRoot, 'probe')),
          directoryRoot: tryCall(() => mod.openStaticSiblingDirectory(emptyRoot, [], 'probe')),
          assertFragment: tryCall(() => mod.assertElementInHtmlNamespace(foreignFragment, 'probe')),
          directoryFragment: tryCall(() =>
            mod.openStaticSiblingDirectory(foreignFragment, [], 'probe'),
          ),
          assertForged: tryCall(() => mod.assertElementInHtmlNamespace(forged, 'probe')),
          directoryForged: tryCall(() => mod.openStaticSiblingDirectory(forged, [], 'probe')),
        };
        iframe.remove();
        return report;
      });
      expect(result.brandRoot).toBe(true);
      expect(result.brandEmptyRoot).toBe(true);
      expect(result.brandFragment).toBe(false);
      expect(result.forgedToString).toBe('[object ShadowRoot]');
      expect(result.brandForged).toBe(false);
      expect(result.rootHost).toBe(true);
      expect(result.assertRoot).toEqual({ ok: true, parentMode: null });
      expect(result.directoryRoot).toEqual({ ok: true, parentMode: 'open' });
      expect(result.assertFragment).toMatchObject({
        ok: false,
        code: 'OEIR_LEAF_CLAIM_MISMATCH',
      });
      expect(result.assertFragment.ok === false && result.assertFragment.message).toContain(
        'not an element',
      );
      expect(result.directoryFragment).toMatchObject({
        ok: false,
        code: 'OE_RUNTIME_STATIC_RANGE_MISMATCH',
      });
      expect(result.directoryFragment.ok === false && result.directoryFragment.message).toContain(
        'unsupported directory parent',
      );
      expect(result.assertForged).toMatchObject({ ok: false, code: 'OEIR_LEAF_CLAIM_MISMATCH' });
      expect(result.assertForged.ok === false && result.assertForged.message).toContain(
        'not an element',
      );
      expect(result.directoryForged).toMatchObject({
        ok: false,
        code: 'OE_RUNTIME_STATIC_RANGE_MISMATCH',
      });
    } finally {
      await page.close();
    }
  });

  test('claim mismatch in a shadow root is coded, does not clear content and does not mount', async () => {
    const page = await openPage();
    try {
      const html = openPanelHost().replace(
        '<template shadowrootmode="open">',
        '<template shadowrootmode="open"><p id="wrong">wrong</p>',
      );
      const result = await page.evaluate(async (hostHtml: string) => {
        const setup = window.__oeSetup;
        const mod = window.__oeM09;
        const el = setup.parse(
          setup.fill(
            hostHtml,
            mod.ShadowPanel__ssr(
              { label: 'server' },
              { bindings: {}, props: {}, propsChanged: { value: 0 } },
            ),
          ),
        ) as HTMLElement;
        const root = el.shadowRoot!;
        const before = root.innerHTML;
        const probe = setup.probe('panel');
        document.body.append(el);
        await setup.tick();
        // Custom-element reaction errors are reported as page errors, not
        // thrown from `append`. Drive the same lifecycle method directly to
        // capture the coded failure; the automatic attempt already happened.
        const capture = () => {
          try {
            el.connectedCallback();
            return null;
          } catch (error) {
            return {
              code: (error as { code?: string }).code ?? null,
              message: (error as { message: string }).message,
            };
          }
        };
        const firstError = capture();
        const first = {
          error: firstError,
          sameRoot: el.shadowRoot === root,
          contentUnchanged: root.innerHTML === before,
          childCount: root.childNodes.length,
          claims: probe.claims,
          mounts: probe.mounts,
          lightChildren: el.childNodes.length,
          probeNodes: probe.nodes.length,
          probeErrorCode: probe.errorCode,
        };
        const retryError = capture();
        const retry = {
          error: retryError,
          contentUnchanged: root.innerHTML === before,
          claims: probe.claims,
          mounts: probe.mounts,
        };
        return { first, retry };
      }, html);
      expect(result.first).toMatchObject({
        sameRoot: true,
        contentUnchanged: true,
        mounts: 0,
        lightChildren: 2,
        probeErrorCode: 'OEIR_LEAF_CLAIM_MISMATCH',
      });
      expect(result.first.error?.code).toBe('OEIR_LEAF_CLAIM_MISMATCH');
      expect(result.first.error?.message).toContain("expected element 'section'");
      expect(result.first.claims).toBeGreaterThanOrEqual(2);
      expect(result.retry).toMatchObject({
        contentUnchanged: true,
        mounts: 0,
      });
      expect(result.retry.error?.code).toBe('OEIR_LEAF_CLAIM_MISMATCH');
      expect(result.retry.claims).toBeGreaterThan(result.first.claims);
    } finally {
      await page.close();
    }
  });
});
