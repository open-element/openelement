/**
 * A generated LIGHT-root host never spells a non-primitive declared row as an
 * attribute (consumer-form pin; the real page vertical is the router/fixture
 * suites).
 *
 * The defect this pins: a declared `array`/`object` row is property-only — the
 * shell refuses an attribute for it and `observedAttributes` never observes one
 * — but both light host entry points (`renderToString` and the server function
 * lane's `__ssr`) hand the CALLER's pairs to the host writer, which normalizes
 * through the class lane's value algebra. That algebra is `String()` for
 * anything that is not `class`/`style`, so a caller-supplied array reached the
 * tag as `items="[object Object],[object Object],…"` while the same value also
 * travelled on `data-oe-prop-seed`. Measured on the www rail migration: 14
 * server-function pages carried that string.
 *
 * The contract under test is the WIRE, not an implementation handle:
 *
 *   1. the emitted host markup carries no `[object Object]`;
 *   2. the shell's ONE seed attribute (`data-oe-prop-seed`) is present and its
 *      JSON parses to the supplied array/object;
 *   3. primitive rows and static attributes keep their bytes;
 *   4. the claim consumes that same seed — the ROUND TRIP is the proof, since a
 *      seed nobody reads would satisfy (2) while the upgraded element silently
 *      fell back to its declared default.
 *
 * Both placements are exercised because they are different code paths: a PAGE
 * ROOT (`renderToString` / `__ssr`) and a NESTED host inside a class parent's
 * DSD template, which is where the rail was measured.
 */

import { describe, expect, test } from 'vitest';
import { installFacadeDom, parseHtml } from '../compiled-runtime/facade-dom.ts';
import { testProgram } from '../compiled-runtime/test-program.ts';

// The harness must own the platform globals BEFORE the shell module evaluates:
// the generated class captures `HTMLElement` at module scope, so a static import
// would bind the SSR stub and the claim path would run against a class with no
// `childNodes`. The repo's facade suites all use this dynamic-import pattern.
const dom = installFacadeDom();

const { createGeneratedElementClass } =
  await import('../../src/internal/compiled/generated-element/shell.ts');
const { createRecipe } = await import('../../src/internal/compiled/runtime/recipe.ts');
const { renderToString } = await import('../../src/public-runtime.ts');
const { __ssr } = await import('../../src/server.ts');

/** The wire attribute the shell owns; spelled once, as a consumer would. */
const SEED = 'data-oe-prop-seed';

const ITEMS = [
  { id: 'a', label: 'First' },
  { id: 'b', label: 'Second' },
];
const MODEL = { k: 1, nested: { ok: true } };

/** The declared rows: the array/object under test plus the primitive controls. */
const rows = () => [
  // No attribute channel: the JSON seed is this row's only host wire.
  { name: 'items', attribute: null, type: 'array' as const, reflect: false, default: () => [] },
  { name: 'model', attribute: null, type: 'object' as const, reflect: false, default: () => ({}) },
  // Controls: these must keep their exact bytes.
  { name: 'label', attribute: 'label', type: 'string' as const, reflect: false, default: 'none' },
  { name: 'locale', attribute: 'locale', type: 'string' as const, reflect: false, default: 'en' },
];

let counter = 0;
const uniqueTag = (label: string): string => `oe-prop-wire-${label}-${++counter}`;

/** Build + register one generated light host; returns the tag it is registered under. */
function registerLeaf(tag: string): CustomElementConstructor {
  const ctor = createGeneratedElementClass({
    tag,
    root: 'light',
    properties: rows() as never,
    ssrProducer: () => '<nav><a href="#a">First</a><a href="#b">Second</a></nav><slot></slot>',
    createRecipe: () => ({ mount: () => [], createProps: () => ({}) }) as never,
  }) as unknown as CustomElementConstructor;
  dom.registry.define(tag, ctor);
  return ctor;
}

/** The opening tag of the first `tag` host in `markup` (attributes only). */
function openingTag(markup: string, tag: string): string {
  const found = new RegExp(`<${tag}\\b[^>]*>`).exec(markup);
  expect(found, `no <${tag}> opening tag in:\n${markup}`).not.toBeNull();
  return found![0];
}

/** The seed payload on an opening tag, decoded and parsed. */
function seedOf(openTag: string): unknown {
  const raw = new RegExp(`\\s${SEED}="([^"]*)"`).exec(openTag)?.[1];
  expect(raw, `no ${SEED} on:\n${openTag}`).toBeDefined();
  return JSON.parse(raw!.replaceAll('&quot;', '"').replaceAll('&amp;', '&'));
}

/** One attribute's text on an opening tag, or '' when absent. */
function attributeText(openTag: string, name: string): string {
  return new RegExp(`\\s${name}(?:="([^"]*)")?`).exec(openTag)?.[0] ?? '';
}

describe('page-root light host', () => {
  test('an array/object row travels on the seed, never as a host attribute', () => {
    const tag = uniqueTag('root');
    registerLeaf(tag);
    const html = __ssr(tag, { items: ITEMS, model: MODEL, label: 'Rail', locale: 'de' });
    const open = openingTag(html, tag);

    // (a) No stringified non-primitive on the tag.
    expect(open).not.toContain('[object Object]');
    expect(open).not.toContain('items=');
    expect(open).not.toContain('model=');
    // (b) The one seed channel carries exactly the supplied values.
    expect(seedOf(open)).toEqual({ items: ITEMS, model: MODEL });
    // (c) Primitive rows and the ownership marker keep their bytes.
    expect(attributeText(open, 'label')).toBe(' label="Rail"');
    expect(attributeText(open, 'locale')).toBe(' locale="de"');
    expect(attributeText(open, 'data-oe-light')).toBe(' data-oe-light');
  });

  test('renderToString takes the same path with the same wire', () => {
    const tag = uniqueTag('root-props');
    registerLeaf(tag);
    const html = renderToString(tag, { props: { items: ITEMS, locale: 'de' } });
    const open = openingTag(html, tag);
    expect(open).not.toContain('[object Object]');
    expect(open).not.toContain('items=');
    expect(seedOf(open)).toEqual({ items: ITEMS });
    expect(attributeText(open, 'locale')).toBe(' locale="de"');
  });

  test('an omitted row leaves the host tag bytes untouched', () => {
    const tag = uniqueTag('root-empty');
    registerLeaf(tag);
    const html = __ssr(tag, { locale: 'de' });
    const open = openingTag(html, tag);
    // Nothing was supplied, so nothing is seeded and no row attribute appears.
    expect(attributeText(open, SEED)).toBe('');
    expect(open).not.toContain('[object Object]');
    expect(attributeText(open, 'locale')).toBe(' locale="de"');
  });
});

describe('nested light host inside a DSD template', () => {
  test('the nested host gets the same seed wire and keeps static attributes', () => {
    const leaf = uniqueTag('leaf');
    const parent = uniqueTag('parent');
    registerLeaf(leaf);
    const program = testProgram({
      tag: parent,
      rootMode: 'shadow-open',
      properties: [
        {
          name: 'rows',
          attribute: null,
          type: 'array',
          converter: 'array',
          reflect: false,
          default: [],
        },
        {
          name: 'loc',
          attribute: null,
          type: 'string',
          converter: 'string',
          reflect: false,
          default: 'en',
        },
      ],
      template: [{ k: 'el', tag: leaf, attrs: [['data-static', 'kept']], children: [] }],
      parts: [
        { k: 'prop', index: 0, signal: 'rows', name: 'items', path: [0] },
        { k: 'prop', index: 1, signal: 'loc', name: 'locale', path: [0] },
      ],
    });
    dom.registry.define(
      parent,
      Object.assign(class {}, {
        __partProgram: program,
        __compiledProperties: program.metadata.properties,
      }) as unknown as CustomElementConstructor,
    );

    const html = renderToString(parent, {
      props: { rows: ITEMS, loc: 'de' },
      ssrRenderableTags: [leaf],
    });
    const open = openingTag(html, leaf);
    expect(open).not.toContain('[object Object]');
    expect(open).not.toContain('items=');
    expect(seedOf(open)).toEqual({ items: ITEMS });
    // The primitive row and the parent's STATIC attribute are unchanged.
    expect(attributeText(open, 'locale')).toBe(' locale="de"');
    expect(attributeText(open, 'data-static')).toBe(' data-static="kept"');
    expect(attributeText(open, 'data-oe-light')).toBe(' data-oe-light');
  });
});

describe('the seed round-trips into an upgraded instance', () => {
  test('the shell claim restores the supplied array and object from that seed', () => {
    const tag = uniqueTag('claim');
    registerLeaf(tag);
    const html = renderToString(tag, { props: { items: ITEMS, model: MODEL, locale: 'de' } });
    const open = openingTag(html, tag);
    expect(open).not.toContain('[object Object]');

    // The payload on the wire, decoded exactly as an HTML parser would.
    const payload = seedOf(open);
    expect(payload).toEqual({ items: ITEMS, model: MODEL });

    // A bound descriptor with a real claim is what makes the shell's reader run.
    // The recipe is built by the runtime's own `createRecipe` with the scope the
    // shell hands the generated factory, exactly as an emitted `create<Name>Recipe`
    // does — a hand-shaped object has no `definitionOwner` and cannot be projected.
    const boundTag = uniqueTag('claim-bound');
    const ctor = createGeneratedElementClass({
      tag: boundTag,
      root: 'light',
      properties: rows() as never,
      ssrProducer: () => '<nav><a href="#a">First</a></nav>',
      createRecipe: (owner: unknown) =>
        createRecipe({
          definitionOwner: owner as never,
          mount: () => [],
          claim: (_scope: unknown, _props: unknown, parent: Node) => [...parent.childNodes],
          createProps: () => ({}),
        }) as never,
    }) as unknown as CustomElementConstructor & Record<string, unknown>;
    dom.registry.define(boundTag, ctor);

    // Re-emit through the bound class so the seed and the claim come from the
    // SAME descriptor, then upgrade a host carrying exactly those attributes.
    const boundHtml = renderToString(boundTag, {
      props: { items: ITEMS, model: MODEL, locale: 'de' },
    });
    const boundOpen = openingTag(boundHtml, boundTag);
    expect(boundOpen).not.toContain('[object Object]');

    const element = dom.document.createElement(boundTag) as HTMLElement & {
      items?: unknown;
      model?: unknown;
    };
    for (const match of boundOpen.matchAll(/([\w:.-]+)(?:="([^"]*)")?/g)) {
      const [, name, value] = match;
      if (name === undefined || name === boundTag) continue;
      element.setAttribute(name, (value ?? '').replaceAll('&quot;', '"').replaceAll('&amp;', '&'));
    }
    // The generated content the producer emitted is the region the claim adopts.
    // The parser hands these nodes over directly (the harness owns them), which
    // is the same shape `mountSerialized` uses for a light host.
    for (const child of parseHtml(dom.document, boundHtml).childNodes) {
      element.appendChild(child);
    }
    dom.document.body.appendChild(element);

    // The SUPPLIED values — not the declared defaults — are the upgraded state.
    expect(element.items).toEqual(ITEMS);
    expect(element.model).toEqual(MODEL);
    // Consumed once, never left for a later re-claim to replay.
    expect(element.getAttribute(SEED)).toBeNull();
  });
});
