/**
 * E-10 — JSON prop seed hardening, hostile-payload negative (Node side).
 *
 * ADR-0182 D-18c carries a declared `array`/`object` row on ONE host
 * attribute, `data-oe-prop-seed`, whose value is `JSON.stringify` of the
 * supplied rows. Two properties make that wire safe, and each is pinned here
 * from the outside (the way a browser/consumer meets it), never by reading the
 * implementation:
 *
 *   1. PRODUCER: the serialized value goes through the ONE attribute escaper
 *      (`escapeAttrValue`), so a hostile string can never terminate the
 *      attribute, inject elements or open a tag. The byte pin compares the
 *      emitted attribute text with the canonical escaper's own output and
 *      re-parses the markup to prove nothing new appeared.
 *   2. CONSUMER: the shell's claim parses the payload fail-closed — malformed
 *      JSON, a non-object document, a row the descriptor cannot explain, a
 *      type mismatch and a non-JSON-encodable producer value each raise their
 *      recorded identity instead of silently keeping the declared default.
 *
 * The inner-key case is a DECISION, not a filter: `__proto__` / `constructor`
 * INSIDE a declared row's value are data (the same trust level as passing the
 * value directly), JSON.parse makes them own data properties and no prototype
 * is reachable through them, so they are preserved as data and the global
 * prototype is asserted untouched. A `__proto__` used as a ROW NAME is a name
 * the descriptor does not declare and fails closed through the row check.
 *
 * Browser-side coverage lives in
 * `packages/compiler/__tests__/semantic-ir/generated-element.nonprimitive-properties.browser.test.ts`
 * (unknown row → `OEIR_SHELL_PROP_SEED_MISMATCH`, wrong supplied shape →
 * `OEIR_SHELL_PROPERTY_TYPE_MISMATCH`). This file fills the Node gap: the
 * hostile BYTES, the parse fail-closed directions and the prototype question.
 */

import { describe, expect, test } from 'vitest';
import { installFacadeDom, parseHtml } from '../compiled-runtime/facade-dom.ts';
import { escapeAttrValue } from '../../src/internal/core/html-escape.ts';

// The harness must own the platform globals BEFORE the shell module evaluates:
// the generated class captures `HTMLElement` at module scope, so a static import
// would bind the SSR stub. Dynamic imports below follow the repo's pattern.
const dom = installFacadeDom();

const {
  createGeneratedElementClass,
  seedGeneratedElementHostProperties,
  serializeGeneratedElementHtml,
} = await import('../../src/internal/compiled/generated-element/shell.ts');
const { createRecipe } = await import('../../src/internal/compiled/runtime/recipe.ts');
const { renderToString } = await import('../../src/public-runtime.ts');
const { __ssr } = await import('../../src/server.ts');

/** The wire attribute the shell owns. */
const SEED = 'data-oe-prop-seed';

/** The declared rows: the two JSON-seedable rows plus the excluded-row controls. */
const rows = () => [
  { name: 'items', attribute: null, type: 'array' as const, reflect: false, default: () => [] },
  { name: 'model', attribute: null, type: 'object' as const, reflect: false, default: () => ({}) },
  // trustedHtml is a brand, not JSON data: D-18c excludes it from the seed.
  {
    name: 'articleHtml',
    attribute: null,
    type: 'trustedHtml' as const,
    reflect: false,
    default: '<i>default</i>',
  },
  { name: 'label', attribute: 'label', type: 'string' as const, reflect: false, default: 'none' },
];

/**
 * Hostile row values a same-origin JS caller can legitimately supply (the
 * seed is the same trust level as passing the value directly, so this proves
 * the WIRE cannot be escaped out of — not that the value is untrusted).
 */
const HOSTILE_ITEMS = [
  '"><script>alert(1)</script>',
  '<img src=x onerror=alert(1)>',
  '</oe-seed-hard-leaf><svg onload=alert(1)>',
  '&"<> end',
];
const HOSTILE_MODEL = {
  '"><svg onload=alert(1)>': '<b>&"</b>',
  nested: ['</nav>', '&amp;'],
};

/** Decode the five entities the markup parser restores (facade parseHtml's set). */
function decodeAttribute(value: string): string {
  return value
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&amp;', '&');
}

/** The opening tag of the first `tag` host in `markup` (attributes only). */
function openingTag(markup: string, tag: string): string {
  const found = new RegExp(`<${tag}\\b[^>]*>`).exec(markup);
  expect(found, `no <${tag}> opening tag in:\n${markup}`).not.toBeNull();
  return found![0];
}

/**
 * The raw (still-escaped) seed attribute text. A value that escaped the
 * attribute would terminate the match early — which is exactly what the
 * assertions then catch.
 */
function rawSeed(openTag: string): string {
  const found = new RegExp(`\\s${SEED}="([^"]*)"`).exec(openTag);
  expect(found, `no ${SEED} on:\n${openTag}`).not.toBeNull();
  return found![1]!;
}

/** The expected wire value: the canonical escaper over the canonical JSON. */
function expectedWire(payload: Record<string, unknown>): string {
  return escapeAttrValue(JSON.stringify(payload));
}

let counter = 0;
const uniqueTag = (label: string): string => `oe-seed-hard-${label}-${++counter}`;

interface HardenedElement extends HTMLElement {
  items?: unknown;
  model?: unknown;
}

/**
 * Build + register one generated LIGHT host whose claim is the runtime's own
 * recipe projection (same shape the emitted `create<Name>Recipe` produces):
 * after a successful connect its declared rows are the claimed values.
 */
function registerLeaf(tag: string): void {
  const ctor = createGeneratedElementClass({
    tag,
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
  }) as unknown as CustomElementConstructor;
  dom.registry.define(tag, ctor);
}

/** Create a host, put a seed payload on it, and connect it. */
function connectWithSeed(tag: string, seed: string): HardenedElement {
  const element = dom.document.createElement(tag) as HardenedElement;
  element.setAttribute(SEED, seed);
  dom.document.body.appendChild(element);
  return element;
}

/** The identity a failed connect raises (its code first, its message as context). */
function connectFailure(tag: string, seed: string): { code: string; message: string } {
  const element = dom.document.createElement(tag) as HardenedElement;
  element.setAttribute(SEED, seed);
  try {
    dom.document.body.appendChild(element);
    throw new Error('the malformed prop seed connected without failing closed');
  } catch (error) {
    const coded = error as { code?: unknown };
    return {
      code: typeof coded.code === 'string' ? coded.code : '',
      message: error instanceof Error ? error.message : String(error),
    };
  } finally {
    if (element.parentNode !== null) dom.document.body.removeChild(element);
  }
}

describe('producer: a hostile row value cannot escape the seed attribute', () => {
  test('the light host wire is the canonical escaper over the canonical JSON', () => {
    const tag = uniqueTag('wire');
    registerLeaf(tag);
    const html = __ssr(tag, { items: HOSTILE_ITEMS, model: HOSTILE_MODEL });
    const open = openingTag(html, tag);
    const raw = rawSeed(open);

    // Byte pin: one value, one escaper — never a second escape table.
    expect(raw).toEqual(expectedWire({ items: HOSTILE_ITEMS, model: HOSTILE_MODEL }));
    // No quote/angle survives inside the attribute text, so it cannot close
    // the attribute or open a tag.
    expect(raw).not.toMatch(/["'<>]/);
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/<img/i);
    expect(html).not.toMatch(/<svg/i);
    // The payload is lossless: an HTML parser decodes it back to the JSON.
    expect(JSON.parse(decodeAttribute(raw))).toEqual({
      items: HOSTILE_ITEMS,
      model: HOSTILE_MODEL,
    });

    // Re-parse the emitted markup: the hostile strings are an ATTRIBUTE, so
    // the document still holds exactly the one host element (no injected
    // nodes, no extra siblings).
    const parsed = parseHtml(dom.document, html);
    expect(parsed.childNodes.length).toEqual(1);
    const host = parsed.childNodes[0] as unknown as HTMLElement;
    expect(host.localName).toEqual(tag);
    expect(JSON.parse(host.getAttribute(SEED) ?? 'null')).toEqual({
      items: HOSTILE_ITEMS,
      model: HOSTILE_MODEL,
    });
  });

  test('the shadow host wire (serializeGeneratedElementHtml) escapes identically', () => {
    const tag = uniqueTag('shadow-wire');
    const seeded = seedGeneratedElementHostProperties(rows(), {
      items: HOSTILE_ITEMS,
      model: HOSTILE_MODEL,
    }) as Record<string, unknown>;
    const pairs = seeded.__oeHostAttributes as ReadonlyArray<readonly [string, string]>;
    const html = serializeGeneratedElementHtml({
      tag,
      root: 'open',
      attributes: pairs,
      content: '<nav><a href="#a">First</a></nav>',
    });
    const open = openingTag(html, tag);
    const raw = rawSeed(open);
    expect(raw).toEqual(expectedWire({ items: HOSTILE_ITEMS, model: HOSTILE_MODEL }));
    expect(raw).not.toMatch(/["'<>]/);
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/<svg/i);
    const parsed = parseHtml(dom.document, html);
    expect(parsed.childNodes.length).toEqual(1);
    expect(
      JSON.parse((parsed.childNodes[0] as unknown as HTMLElement).getAttribute(SEED) ?? 'null'),
    ).toEqual({ items: HOSTILE_ITEMS, model: HOSTILE_MODEL });
  });
});

describe('consumer: malformed seed payloads fail closed', () => {
  test('unparseable JSON is OEIR_SHELL_PROP_SEED_MISMATCH', () => {
    const tag = uniqueTag('bad-json');
    registerLeaf(tag);
    expect(connectFailure(tag, '{"items": [}').code).toEqual('OEIR_SHELL_PROP_SEED_MISMATCH');
  });

  test('a non-object JSON document is OEIR_SHELL_PROP_SEED_MISMATCH', () => {
    const tag = uniqueTag('non-object');
    registerLeaf(tag);
    for (const seed of ['[]', 'null', '"items"', '41']) {
      expect(connectFailure(tag, seed).code, `seed ${seed}`).toEqual(
        'OEIR_SHELL_PROP_SEED_MISMATCH',
      );
    }
  });

  test('a row name the descriptor cannot explain is OEIR_SHELL_PROP_SEED_MISMATCH', () => {
    const tag = uniqueTag('unknown-row');
    registerLeaf(tag);
    // `articleHtml` is declared but a trustedHtml BRAND is not JSON data, so
    // the seed may not carry it either; `label` is primitive (attribute wire).
    for (const seed of [
      '{"undeclaredRow":1}',
      '{"articleHtml":"<b>forged</b>"}',
      '{"label":"not-json-seedable"}',
      '{"__proto__":{"polluted":true}}',
    ]) {
      expect(connectFailure(tag, seed).code, `seed ${seed}`).toEqual(
        'OEIR_SHELL_PROP_SEED_MISMATCH',
      );
    }
    // A row NAME of `__proto__` is rejected as an undeclared row; it must not
    // reach any prototype either.
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  test('array/object type mismatches are OEIR_SHELL_PROPERTY_TYPE_MISMATCH', () => {
    const tag = uniqueTag('type-mismatch');
    registerLeaf(tag);
    expect(connectFailure(tag, '{"items":{"id":"not-an-array"}}').code).toEqual(
      'OEIR_SHELL_PROPERTY_TYPE_MISMATCH',
    );
    expect(connectFailure(tag, '{"model":["not-an-object"]}').code).toEqual(
      'OEIR_SHELL_PROPERTY_TYPE_MISMATCH',
    );
  });
});

describe('consumer: inner prototype-shaped keys are data, not a prototype channel', () => {
  test('own __proto__/constructor keys inside a row value are preserved as data', () => {
    const tag = uniqueTag('proto-key');
    registerLeaf(tag);
    const item = JSON.parse(
      '{"__proto__":{"polluted":true},"constructor":{"prototype":{"polluted":true}},"id":"kept"}',
    ) as Record<string, unknown>;
    const element = connectWithSeed(tag, JSON.stringify({ items: [item] }));

    const claimed = (element.items as Array<Record<string, unknown>>)[0]!;
    expect(claimed.id).toEqual('kept');
    // JSON.parse creates OWN data properties; no prototype is replaced.
    expect(Object.hasOwn(claimed, '__proto__')).toBe(true);
    expect(Object.hasOwn(claimed, 'constructor')).toBe(true);
    expect(Object.getPrototypeOf(claimed)).toEqual(Object.prototype);
    // Nothing reached Object.prototype.
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    // The seed is consumed once: a later re-claim cannot replay it.
    expect(element.getAttribute(SEED)).toBeNull();
  });
});

describe('producer: values the JSON seed cannot carry fail closed', () => {
  test('a cyclic array row is OEIR_LEAF_UNSEEDABLE_PROPERTY', () => {
    const cyclic: unknown[] = [];
    cyclic.push(cyclic);
    expect(() => seedGeneratedElementHostProperties(rows(), { items: cyclic })).toThrow(
      /OEIR_LEAF_UNSEEDABLE_PROPERTY: items .*not JSON-encodable/,
    );
  });

  test('a value JSON.stringify drops is OEIR_LEAF_UNSEEDABLE_PROPERTY', () => {
    // A function has no JSON representation (`JSON.stringify` returns
    // undefined), so the wire would silently lose the row.
    expect(() =>
      seedGeneratedElementHostProperties(rows(), { items: (() => 'x') as never }),
    ).toThrow(/OEIR_LEAF_UNSEEDABLE_PROPERTY: items .*under JSON/);
  });

  test('the same producer failure surfaces through the SSR producer', () => {
    const tag = uniqueTag('leaf-unseedable');
    registerLeaf(tag);
    const cyclic: unknown[] = [];
    cyclic.push(cyclic);
    expect(() => __ssr(tag, { items: cyclic })).toThrow(/OEIR_LEAF_UNSEEDABLE_PROPERTY/);
    expect(() => renderToString(tag, { props: { items: cyclic } })).toThrow(
      /OEIR_LEAF_UNSEEDABLE_PROPERTY/,
    );
  });
});
