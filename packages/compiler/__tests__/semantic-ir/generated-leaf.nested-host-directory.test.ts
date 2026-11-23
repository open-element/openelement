/**
 * GAP-2 (F16 closeout) — a generated PAGE ROOT could not claim a nested
 * hydrated LIGHT generated island.
 *
 * MEASURED DEFECT (fixture `tests/fixtures/router-request-time`, /combobox, on
 * every load):
 *
 *   [compiled-runtime] app/components/page-combobox.tsx#ComboboxPage:
 *   OE_RUNTIME_STATIC_RANGE_MISMATCH
 *   (dev detail: boundary: nested or mismatched marker "oe:r:0")
 *
 * MECHANISM, MEASURED — not assumed:
 *
 * 1. The page's claimed region formed a static-sibling directory over `<form>`,
 *    whose static element children are the nested `<zag-combobox-light>` host
 *    and the submit `<button>` (`generate.ts` `staticElementDirectory` ->
 *    `emitClaimedDirectory`, SSR/mount/claim all share it). The directory wire
 *    therefore bracketed the nested host:
 *      <!--oe:r:0--><zag-combobox-light …>…</zag-combobox-light><!--oe:/r:0-->
 * 2. The nested light island is expanded INTO that bracket server-side, and its
 *    own generated claim producer emits its own static-sibling ranges inside
 *    its content (`Light__ssr` carries its own `<!--oe:r:N-->` markers). Those
 *    markers now live in the page's tree.
 * 3. The runtime directory consumer rejects them
 *    (`static-sibling-ranges.ts` `parseDirectory` -> `rejectNestedMarker`):
 *    a range interior may not contain another range marker. The page claim
 *    throws STATIC_RANGE_MISMATCH; the page still renders and its islands
 *    hydrate, but the page-level diagnostic is permanent.
 *
 * CHOSEN RULE (b), at the COMPILER emit layer — a nested custom-element host is
 * a claim BOUNDARY, not static directory content:
 *
 *   - `isStaticDirectoryElement` refuses a dash tag at any depth, so a parent
 *     whose static children include a nested host never becomes a directory on
 *     ANY of the three emitters (SSR markers, mount markers, claim consumer).
 *     The host is claimed as an element shell on the ordinary cursor walk.
 *   - The host's interior (its expanded light DOM) belongs to the host's own
 *     claim; the nested-host claim exemption is the runtime/claim half owned by
 *     the F16 round-4 sibling (data-oe-light seed exemption + opaque expanded
 *     light interior), not restated here.
 *
 * WHY NOT (a) and (c):
 *
 *   (a) scoping the runtime directory claim around dash tags would weaken the
 *   ONE directory rule for every caller, make the emitted declaration (which
 *   lists the host's children) disagree with what the runtime checks, and does
 *   not cover the ordinary cursor walk's "extra node" bound for a non-directory
 *   parent. The runtime predicate stays strict: row A below keeps proving that a
 *   directory that DOES bracket a nested marker still refuses it.
 *
 *   (c) suppressing the nested light island's own ranges is not expressible at
 *   compile time: a light island module is compiled once and may be a page root
 *   on one route and nested on another (this fixture is exactly that reuse), and
 *   its own claim needs those markers to adopt its own content. It also would
 *   not fix the parent's declaration/interior mismatch.
 *
 * Node DOM shim. Not a browser, not SSR, not a packed consumer. The DOM is
 * built by the generated mount producer (the project's contract: the mount tree
 * and the SSR string are the same structure), while the SSR STRING itself is
 * asserted for the real marker bytes the emitted generator produces.
 *
 * The two behavioural rows that claim a nested hydrated light host depend on the
 * F16 round-4 sibling change (`assertNestedHostStaticAttributeSeed` +
 * `isExpandedLightRootHost` in `claim-invariants.ts`, routed by
 * `generate.ts`'s nested-host claim path): without it the parent claim would
 * refuse the framework's `data-oe-light` marker / the expanded interior. That
 * split is recorded in the handoff to the lead; this file is the regression
 * proof for the directory half.
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { build } from 'vite';
import { RuntimeErrorCode } from '@openelement/protocol/errors';
import { compileFunctionModule } from '../../src/internal/compiler/semantic-core/function-frontend.ts';
import {
  GENERATED_LEAF_RUNTIME_SPECIFIER,
  generateLeafModule,
} from '../../src/internal/compiler/semantic-ir/generated-leaf/generate.ts';
import {
  openStaticSiblingDirectory,
  type DeclaredStaticNode,
} from '../../../element/src/internal/compiled/runtime/static-sibling-ranges.ts';
import { ELEMENT_CLASSIFIER as CLASSIFIER, REPO_ROOT } from './testlib/element-classifier.ts';

const FILE = '/proj/src/page.tsx';
const HTML_NAMESPACE = 'http://www.w3.org/1999/xhtml';

function generate(source: string): string {
  const front = compileFunctionModule(source, FILE, { importClassifier: CLASSIFIER });
  expect(front.diagnostics, front.diagnostics.map((item) => item.message).join('\n')).toEqual([]);
  const generated = generateLeafModule(front.module!);
  expect(
    generated.diagnostics,
    generated.diagnostics.map((item) => item.message).join('\n'),
  ).toEqual([]);
  return generated.module!;
}

/* ------------------------------------------------------------------------- *
 * A: the runtime directory rule stays strict.
 *
 * This is the measured refusal itself, reproduced with the real runtime module
 * and the real generated marker spelling. It is what the page claim hit; the
 * defect was the EMITTER asking the consumer to bracket a nested host, not the
 * consumer refusing a nested marker.
 * ------------------------------------------------------------------------- */

interface ClaimAttribute {
  name: string;
  value: string;
}

interface ClaimNode {
  nodeType: number;
  parentNode: ClaimNode | null;
  nodeValue?: string;
  localName?: string;
  tagName?: string;
  namespaceURI?: string | null;
  childNodes?: ClaimNode[];
  readonly firstChild?: ClaimNode | null;
  readonly nextSibling?: ClaimNode | null;
  attributes?: { readonly length: number; item(index: number): ClaimAttribute | null };
  getAttribute?(name: string): string | null;
  hasAttribute?(name: string): boolean;
  setAttribute?(name: string, value: string): void;
  removeAttribute?(name: string): void;
  toggleAttribute?(name: string, force?: boolean): boolean;
  appendChild?(node: ClaimNode): ClaimNode;
  insertBefore?(node: ClaimNode, reference: ClaimNode | null): ClaimNode;
  removeChild?(node: ClaimNode): ClaimNode;
  remove?(): void;
}

function element(tag: string, namespaceURI: string | null = HTML_NAMESPACE): ClaimNode {
  const attrs: ClaimAttribute[] = [];
  const attributes = {
    get length() {
      return attrs.length;
    },
    item(index: number) {
      return attrs[index] ?? null;
    },
  };
  const node: ClaimNode = {
    nodeType: 1,
    parentNode: null,
    localName: tag,
    tagName: tag.toUpperCase(),
    namespaceURI,
    childNodes: [],
    attributes,
    get firstChild() {
      return node.childNodes![0] ?? null;
    },
    get nextSibling() {
      const parent = node.parentNode;
      if (parent === null) return null;
      const siblings = parent.childNodes ?? [];
      const index = siblings.indexOf(node);
      return index < 0 ? null : (siblings[index + 1] ?? null);
    },
    getAttribute: (name) => attrs.find((entry) => entry.name === name)?.value ?? null,
    hasAttribute: (name) => attrs.some((entry) => entry.name === name),
    setAttribute: (name, value) => {
      const found = attrs.find((entry) => entry.name === name);
      if (found) found.value = value;
      else attrs.push({ name, value });
    },
    removeAttribute: (name) => {
      const index = attrs.findIndex((entry) => entry.name === name);
      if (index >= 0) attrs.splice(index, 1);
    },
    toggleAttribute: (name, force) => {
      const has = attrs.some((entry) => entry.name === name);
      const on = force === undefined ? !has : force;
      if (on) node.setAttribute!(name, '');
      else node.removeAttribute!(name);
      return on;
    },
    appendChild: (child) => {
      child.parentNode?.removeChild?.(child);
      child.parentNode = node;
      node.childNodes!.push(child);
      return child;
    },
    insertBefore: (child, reference) => {
      child.parentNode?.removeChild?.(child);
      if (reference === null) return node.appendChild!(child);
      const index = node.childNodes!.indexOf(reference);
      if (index < 0) throw new Error('insertBefore reference is not a child');
      child.parentNode = node;
      node.childNodes!.splice(index, 0, child);
      return child;
    },
    removeChild: (child) => {
      const index = node.childNodes!.indexOf(child);
      if (index < 0) throw new Error('removeChild node is not a child');
      node.childNodes!.splice(index, 1);
      child.parentNode = null;
      return child;
    },
    remove: () => {
      node.parentNode?.removeChild?.(node);
    },
  };
  return node;
}

function text(value: string): ClaimNode {
  const node: ClaimNode = { nodeType: 3, parentNode: null, nodeValue: value };
  Object.defineProperty(node, 'nextSibling', {
    get() {
      const parent = node.parentNode;
      if (parent === null) return null;
      const siblings = parent.childNodes ?? [];
      const index = siblings.indexOf(node);
      return index < 0 ? null : (siblings[index + 1] ?? null);
    },
  });
  Object.defineProperty(node, 'firstChild', { value: null });
  node.remove = () => node.parentNode?.removeChild?.(node);
  return node;
}

function comment(value: string): ClaimNode {
  const node: ClaimNode = { nodeType: 8, parentNode: null, nodeValue: value };
  Object.defineProperty(node, 'nextSibling', {
    get() {
      const parent = node.parentNode;
      if (parent === null) return null;
      const siblings = parent.childNodes ?? [];
      const index = siblings.indexOf(node);
      return index < 0 ? null : (siblings[index + 1] ?? null);
    },
  });
  Object.defineProperty(node, 'firstChild', { value: null });
  node.remove = () => node.parentNode?.removeChild?.(node);
  return node;
}

function declaredHost(tag: string): DeclaredStaticNode {
  return { kind: 'element', localName: tag, attributes: [], children: [] };
}

test('A: a directory that brackets a nested host interior still refuses the nested oe:r: marker', () => {
  // The exact wire the page's claim produced: form -> range 0 -> nested host
  // whose expansion carries its own range markers -> range end.
  const parent = element('form');
  parent.appendChild!(comment('oe:r:0'));
  const host = element('x-light');
  const inner = element('div');
  inner.appendChild!(comment('oe:r:0'));
  inner.appendChild!(element('label'));
  inner.appendChild!(comment('oe:/r:0'));
  host.appendChild!(inner);
  parent.appendChild!(host);
  parent.appendChild!(comment('oe:/r:0'));

  let caught: { code?: string; message?: string } | undefined;
  try {
    openStaticSiblingDirectory(
      parent,
      [[declaredHost('x-light')]],
      'fixtures/nested-host-directory',
    );
  } catch (error) {
    caught = error as { code?: string; message?: string };
  }
  expect(caught, 'the directory consumer must refuse a bracketed nested marker').toBeDefined();
  expect(caught!.code).toBe(RuntimeErrorCode.STATIC_RANGE_MISMATCH);
  expect(caught!.message).toContain('nested or mismatched marker "oe:r:0"');
});

/* ------------------------------------------------------------------------- *
 * B: the emitter no longer asks for that directory.
 * ------------------------------------------------------------------------- */

const PAGE_SOURCE = `function Page() {
  return (
    <main>
      <h1>zag combobox spike</h1>
      <form id='fruit-form' method='post'>
        <x-light machine-id='light-fruit'></x-light>
        <button id='submit-fruit' type='submit'>Submit fruit</button>
      </form>
    </main>
  );
}
`;

const INTRINSIC_CONTROL_SOURCE = `function Page() {
  return (
    <main>
      <h1>zag combobox spike</h1>
      <form id='fruit-form' method='post'>
        <em>light</em>
        <button id='submit-fruit' type='submit'>Submit fruit</button>
      </form>
    </main>
  );
}
`;

const LIGHT_SOURCE = `function Light() {
  return (
    <div class='zag-combobox-light'>
      <div class='zag-combobox' data-part='root'>
        <label class='zag-combobox-label' data-part='label'>Fruit</label>
        <div class='zag-combobox-control' data-part='control'>
          <input class='zag-combobox-input' data-part='input' name='fruit' />
          <button class='zag-combobox-trigger' data-part='trigger' type='button'>v</button>
        </div>
        <div class='zag-combobox-positioner' data-part='positioner'>
          <ul class='zag-combobox-content' data-part='content'>
            <li class='zag-combobox-item' data-part='item'>Apple</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
`;

describe('B: a nested custom-element host is never a static-sibling directory member', () => {
  test('SSR, mount, and claim never bracket a parent whose static children include a host', () => {
    const page = generate(PAGE_SOURCE);
    // No directory consumer at all: <form>'s two static children are claimed on
    // the ordinary cursor walk.
    expect(page).not.toContain('openStaticSiblingDirectory(');
    expect(page).not.toContain('claimStaticSiblingRange(');
    // No range markers in the mount or the SSR bytes.
    expect(page).not.toContain('rangeMarker(');
    expect(page).not.toContain('markerText(rangeMarker(');
    // The host is still claim content: its shell (tag + static seed) is checked.
    expect(page).toMatch(
      /localName \|\| __oe_\w+\.tagName \|\| ""\)\.toLowerCase\(\) !== "x-light"/,
    );
    // ...and the SSR still expands it through the ONE nested-host helper.
    expect(page).toContain('nestedHost(__oe_host, {');
  });

  test('a host at ANY depth refuses the directory for its enclosing static parent', () => {
    const deep = generate(`function Page() {
  return (
    <div>
      <p>a</p>
      <section><span><x-light></x-light></span></section>
    </div>
  );
}
`);
    expect(deep).not.toContain('openStaticSiblingDirectory(');
    expect(deep).not.toContain('rangeMarker(');
  });

  test('an intrinsic directory elsewhere is untouched: only the host-containing parent is refused', () => {
    const mixed = generate(`function Page() {
  return (
    <main>
      <ul><li>a</li><li>b</li></ul>
      <form><x-light></x-light><button>Submit</button></form>
    </main>
  );
}
`);
    // Exactly ONE directory remains — the intrinsic <ul>; the <form> whose
    // static children include the host is not one. The refusal is scoped to the
    // host-containing parent, not to the component.
    expect([...mixed.matchAll(/openStaticSiblingDirectory\(/g)]).toHaveLength(1);
    expect(mixed).toContain('emitComment(rangeMarker(0))');
  });

  test('a pure intrinsic static directory still takes the directory path (strictness preserved)', () => {
    const control = generate(INTRINSIC_CONTROL_SOURCE);
    expect(control).toContain('openStaticSiblingDirectory(');
    expect(control).toContain('emitComment(rangeMarker(0))');
    expect(control).toContain('claimStaticSiblingRange(');
    // The nested light island DOES keep its own ranges (its content is its own
    // claimed region; only the PAGE parent must not bracket it).
    const light = generate(LIGHT_SOURCE);
    expect(light).toContain('openStaticSiblingDirectory(');
    expect(light).toContain('emitComment(rangeMarker(0))');
  });
});

/* ------------------------------------------------------------------------- *
 * C: execute the generated page claim against a nested hydrated light host.
 *
 * The DOM is the generated MOUNT tree (the project's mount/SSR structural
 * contract), and the SSR STRING is asserted separately for the real marker
 * bytes: the nested light producer really does emit `oe:r:` into the page's
 * tree, which is what makes a bracketing page directory impossible.
 * ------------------------------------------------------------------------- */

interface ClaimProjection {
  nodes: ClaimNode[];
  dispose: (detach?: boolean) => void;
}

interface Loaded {
  createPageRecipe: (owner: unknown, host: unknown) => unknown;
  Page__ssr: (props: unknown, host: unknown) => string;
  createLightRecipe: (owner: unknown, host: unknown) => unknown;
  Light__ssr: () => string;
  claimRecipe: (owner: unknown, recipe: unknown, parent: ClaimNode) => ClaimProjection;
  insertRecipe: (owner: unknown, recipe: unknown, parent: ClaimNode) => ClaimProjection;
  LifetimeScope: new () => unknown;
}

function childByTag(parent: ClaimNode, tag: string): ClaimNode | undefined {
  return (parent.childNodes ?? []).find((child) => child.localName === tag);
}

function nodesSnapshot(node: ClaimNode): ClaimNode[] {
  return [...(node.childNodes ?? [])];
}

let loaded: Loaded;
let bundleDir = '';

beforeAll(async () => {
  const pageModule = generate(PAGE_SOURCE);
  const lightModule = generate(LIGHT_SOURCE);
  // The page no longer brackets the host, so only the light module carries the
  // directory consumer; both modules are bundled against the SAME real runtime.
  const dir = mkdtempSync(join(tmpdir(), 'oe-gap2-'));
  bundleDir = dir;
  const elementRoot = join(REPO_ROOT, 'packages/element/src/internal');
  const runtime = join(elementRoot, 'compiled/runtime');
  const shim = join(dir, 'runtime-shim.ts');
  writeFileSync(
    shim,
    [
      // Star exports keep the shim a pure pass-through: the sibling round-4
      // change adds the nested-host claim helpers to these same modules and
      // this file must not restate their names.
      `export * from ${JSON.stringify(join(runtime, 'claim-invariants.ts'))};`,
      `export * from ${JSON.stringify(join(runtime, 'markers.ts'))};`,
      `export * from ${JSON.stringify(join(runtime, 'values.ts'))};`,
      `export * from ${JSON.stringify(join(runtime, 'bindings.ts'))};`,
      `export * from ${JSON.stringify(join(runtime, 'observability.ts'))};`,
      `export * from ${JSON.stringify(join(runtime, 'nested-host.ts'))};`,
      `export { claimRecipe, createRecipe, insertRecipe } from ${JSON.stringify(join(runtime, 'recipe.ts'))};`,
      `export { reconcileEachEntries } from ${JSON.stringify(join(runtime, 'each-reconcile.ts'))};`,
      `export { claimStaticSiblingRange, openStaticSiblingDirectory } from ${JSON.stringify(join(runtime, 'static-sibling-ranges.ts'))};`,
      `export { escapeText } from ${JSON.stringify(join(elementRoot, 'compiled/escape-text.ts'))};`,
      `export { escapeAttrValue } from ${JSON.stringify(join(elementRoot, 'core/html-escape.ts'))};`,
      `export { OpenElementError } from ${JSON.stringify(join(REPO_ROOT, 'packages/protocol/src/errors.ts'))};`,
      `export { LifetimeScope } from ${JSON.stringify(join(elementRoot, 'compiled/lifetime-scope.ts'))};`,
      '',
    ].join('\n'),
  );
  writeFileSync(join(dir, 'page.js'), pageModule);
  writeFileSync(join(dir, 'light.js'), lightModule);
  writeFileSync(
    join(dir, 'entry.ts'),
    [
      `export { createPageRecipe, Page__ssr } from './page.js';`,
      `export { createLightRecipe, Light__ssr } from './light.js';`,
      `export { claimRecipe, insertRecipe, LifetimeScope } from ${JSON.stringify(
        GENERATED_LEAF_RUNTIME_SPECIFIER,
      )};`,
      '',
    ].join('\n'),
  );
  const result = await build({
    configFile: false,
    root: dir,
    logLevel: 'silent',
    resolve: { alias: { [GENERATED_LEAF_RUNTIME_SPECIFIER]: shim } },
    build: {
      write: false,
      minify: false,
      lib: { entry: join(dir, 'entry.ts'), formats: ['es'], fileName: () => 'mod.js' },
    },
  });
  const output = Array.isArray(result)
    ? result[0]!.output
    : (result as { output: unknown[] }).output;
  const chunk = (output as Array<{ type: string; code?: string }>).find(
    (item) => item.type === 'chunk',
  );
  if (chunk?.code === undefined) throw new Error('GAP-2 bundle produced no chunk');
  const out = join(dir, 'mod.js');
  writeFileSync(out, chunk.code);
  loaded = (await import(pathToFileURL(out).href)) as Loaded;
}, 60_000);

afterAll(() => {
  if (bundleDir !== '') rmSync(bundleDir, { recursive: true, force: true });
});

beforeEach(() => {
  (globalThis as { document?: unknown }).document = undefined;
});

/** Place the nested light host exactly where the expansion puts it. */
function buildPage(): { pageRoot: ClaimNode; host: ClaimNode; light: ClaimNode } {
  const doc = {
    createElement: (tag: string) => element(tag),
    createTextNode: (value: string) => text(value),
    createComment: (value: string) => comment(value),
  };
  (globalThis as { document?: unknown }).document = doc;

  const pageRoot = element('combobox-page');
  const pageOwner = new loaded.LifetimeScope();
  const pageRecipe = loaded.createPageRecipe(pageOwner, { bindings: {}, props: {} });
  const pageMounted = loaded.insertRecipe(pageOwner, pageRecipe, pageRoot);
  pageMounted.dispose(false);

  const main = childByTag(pageRoot, 'main')!;
  const form = childByTag(main, 'form')!;
  const host = childByTag(form, 'x-light')!;
  // The light root serializer's ownership marker: written by
  // serializeLightGeneratedHost in the real SSR string, reproduced here because
  // the mount producer never expands a nested host.
  host.setAttribute!('data-oe-light', '');

  const lightOwner = new loaded.LifetimeScope();
  const lightRecipe = loaded.createLightRecipe(lightOwner, { bindings: {}, props: {} });
  const lightMounted = loaded.insertRecipe(lightOwner, lightRecipe, host);
  const light = nodesSnapshot(host)[0]!;
  lightMounted.dispose(false);
  return { pageRoot, host, light };
}

describe('C: the generated page claim and the nested light claim own disjoint regions', () => {
  test('the generated SSR bytes really carry the nested light island ranges the page must not bracket', () => {
    const lightHtml = loaded.Light__ssr();
    expect(lightHtml).toContain('<!--oe:r:0-->');
    expect(lightHtml).toContain('<!--oe:/r:0-->');
    expect(lightHtml).toContain('<!--oe:r:2-->');

    const expander = (request: {
      tag: string;
      open: string;
      fallback: string;
    }): string | undefined => {
      if (request.tag !== 'x-light') return undefined;
      const open = request.open.replace(/>$/, ' data-oe-light>');
      return `${open}${lightHtml}</x-light>`;
    };
    const pageHtml = loaded.Page__ssr(undefined, { __oe_nestedHost: expander });
    // The page bytes no longer bracket the host: no range marker before it.
    expect(pageHtml).not.toContain('<!--oe:r:0--><x-light');
    expect(pageHtml).toContain('<x-light machine-id="light-fruit" data-oe-light>');
    // The nested island's OWN ranges are inside the host, in the page's tree —
    // which is exactly why the page must not open a directory across it.
    const hostAt = pageHtml.indexOf('<x-light');
    const hostEnd = pageHtml.indexOf('</x-light>');
    expect(hostAt).toBeGreaterThan(-1);
    expect(pageHtml.slice(hostAt, hostEnd)).toContain('<!--oe:r:0-->');
  });

  test('the page claim adopts the host shell and leaves the nested light region to its own claim', () => {
    const { pageRoot, host } = buildPage();
    const hostChildrenBefore = nodesSnapshot(host);
    const hostAttributesBefore = host.attributes!.length;

    const pageClaimOwner = new loaded.LifetimeScope();
    const pageRecipe = loaded.createPageRecipe(pageClaimOwner, { bindings: {}, props: {} });
    const pageClaimed = loaded.claimRecipe(pageClaimOwner, pageRecipe, pageRoot);

    expect(pageClaimed.nodes.map((node) => node.localName)).toEqual(['main']);
    expect(host.parentNode).not.toBeNull();
    expect(nodesSnapshot(host)).toEqual(hostChildrenBefore);
    expect(host.attributes!.length).toBe(hostAttributesBefore);

    // The nested light island's own claim now owns its content: its directory
    // ranges are consumed by IT, not by the page.
    const lightClaimOwner = new loaded.LifetimeScope();
    const lightRecipe = loaded.createLightRecipe(lightClaimOwner, { bindings: {}, props: {} });
    const lightClaimed = loaded.claimRecipe(lightClaimOwner, lightRecipe, host);
    expect(lightClaimed.nodes.map((node) => node.localName)).toEqual(['div']);
    expect(nodesSnapshot(host)).toEqual(hostChildrenBefore);
  });

  test('the page claim still fails closed on genuine intrinsic content mismatch', () => {
    const { pageRoot } = buildPage();
    const main = childByTag(pageRoot, 'main')!;
    const heading = childByTag(main, 'h1')!;
    (heading.childNodes![0] as ClaimNode).nodeValue = 'tampered';

    const owner = new loaded.LifetimeScope();
    const recipe = loaded.createPageRecipe(owner, { bindings: {}, props: {} });
    let caught: { code?: string; message?: string } | undefined;
    try {
      loaded.claimRecipe(owner, recipe, pageRoot);
    } catch (error) {
      caught = error as { code?: string; message?: string };
    }
    expect(caught, 'a tampered static text must still fail the page claim').toBeDefined();
    expect(String(caught!.code ?? caught!.message)).toContain('OEIR_LEAF_CLAIM_MISMATCH');
    expect(String(caught!.message)).toContain('static text at /0/0/0');
  });
});
