/**
 * Element-runtime focus for the authored-origin extension of the generated-leaf
 * claim helpers (`claim-invariants.ts`).
 *
 * The origin is a compile-time constant supplied by the generator; the runtime
 * only appends it to the existing message. These tests pin:
 *
 *   - the exact legacy message when no origin is supplied, so emitted modules
 *     from before the generator patch and the directory consumer keep their
 *     bytes and their existing signatures still type-check;
 *   - the exact additive ` (authored file:line:column)` suffix when an origin
 *     is supplied, after the unchanged DOM path;
 *   - the unchanged error identity and the absence of any structured position
 *     field on the error or its `toJSON()`.
 *
 * This is not a compiler-location test: which authored construct owns a
 * mismatch is the generator's selection rule, exercised by
 * `generated-leaf.authored-diagnostic.browser.test.ts`.
 */

import { describe, expect, test } from 'vitest';
import {
  assertEachAnchor,
  assertEachEndMarker,
  assertElementInHtmlNamespace,
  assertStaticAttributeSeed,
  assertTextSlotMarker,
  assertWhenAnchor,
  assertWhenEndMarker,
  type ClaimOrigin,
  LEAF_CLAIM_MISMATCH,
  leafClaimMismatch,
  readEntryKeyMarker,
} from '../../src/internal/compiled/runtime/claim-invariants.ts';

const HTML_NAMESPACE = 'http://www.w3.org/1999/xhtml';
const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';

const ORIGIN = { file: '/proj/src/App.tsx', line: 7, column: 3 } as const;

interface ErrorLike {
  readonly name: string;
  readonly message: string;
  readonly code?: unknown;
  readonly phase?: unknown;
  readonly severity?: unknown;
  readonly recoverable?: unknown;
}

interface FakeAttribute {
  readonly name: string;
  readonly value: string;
}

function element(
  options: {
    readonly localName?: string;
    readonly namespaceURI?: string | null;
    readonly attributes?: readonly FakeAttribute[];
  } = {},
): Element {
  const attributes = options.attributes ?? [];
  return {
    nodeType: 1,
    localName: options.localName ?? 'p',
    namespaceURI: options.namespaceURI === undefined ? HTML_NAMESPACE : options.namespaceURI,
    parentNode: null,
    attributes: {
      length: attributes.length,
      item(index: number) {
        return attributes[index] ?? null;
      },
    },
  } as unknown as Element;
}

function withParent(child: Element, parent: Node): Element {
  (child as unknown as { parentNode: Node | null }).parentNode = parent;
  return child;
}

function comment(nodeValue: string | null): Node {
  return { nodeType: 8, nodeValue } as unknown as Node;
}

function text(nodeValue: string): Node {
  return { nodeType: 3, nodeValue } as unknown as Node;
}

function capture(run: () => void): ErrorLike {
  try {
    run();
  } catch (error) {
    return error as ErrorLike;
  }
  throw new Error('expected the claim helper to throw');
}

function expectError(error: ErrorLike, detail: string, origin?: ClaimOrigin): void {
  expect(error.name).toBe('OpenElementError');
  expect(error.code).toBe(LEAF_CLAIM_MISMATCH);
  expect(error.phase).toBe('csr');
  expect(error.severity).toBe('error');
  expect(error.recoverable).toBe(false);
  expect('file' in error).toBe(false);
  expect('line' in error).toBe(false);
  expect('column' in error).toBe(false);
  expect('span' in error).toBe(false);
  expect('source' in error).toBe(false);
  const suffix =
    origin === undefined ? '' : ` (authored ${origin.file}:${origin.line}:${origin.column})`;
  expect(error.message).toBe(`${LEAF_CLAIM_MISMATCH}: ${detail}${suffix}`);
}

function expectThrown(run: () => void, detail: string, origin?: ClaimOrigin): void {
  expectError(capture(run), detail, origin);
}

const DECLARED: readonly FakeAttribute[] = [
  { name: 'id', value: 't' },
  { name: 'class', value: 'x' },
];

describe('leafClaimMismatch authored origin', () => {
  test('appends the exact suffix after the unchanged DOM path', () => {
    const error = leafClaimMismatch("expected element 'p' at /0/0/then/0", ORIGIN);
    expectError(error, "expected element 'p' at /0/0/then/0", ORIGIN);
    expect(
      error.message.startsWith(`${LEAF_CLAIM_MISMATCH}: expected element 'p' at /0/0/then/0`),
    ).toBe(true);
  });

  test('keeps the byte-identical legacy message without an origin', () => {
    expectError(
      leafClaimMismatch('child cursor has an extra node at /0'),
      'child cursor has an extra node at /0',
    );
    expect(leafClaimMismatch('child cursor has an extra node at /0').message).not.toContain(
      '(authored',
    );
  });

  test('uses the file string as-is (no separator normalization)', () => {
    const windows = { file: 'C:\\proj\\src\\App.tsx', line: 4, column: 10 } as const;
    expectError(leafClaimMismatch('detail at /0', windows), 'detail at /0', windows);
    expect(leafClaimMismatch('detail at /0', windows).message).toContain(
      '(authored C:\\proj\\src\\App.tsx:4:10)',
    );
  });

  test('does not add a structured position to the error or its JSON', () => {
    const error = leafClaimMismatch('detail at /0', ORIGIN);
    const json = error.toJSON();
    for (const key of ['file', 'line', 'column', 'span', 'source']) {
      expect(json, key).not.toHaveProperty(key);
    }
    // The position is message text only; the fields stay the documented set.
    expect(Object.keys(json).sort()).toEqual([
      'cause',
      'code',
      'message',
      'name',
      'phase',
      'recoverable',
      'severity',
      'statusCode',
    ]);
  });
});

describe('static attribute seed origin', () => {
  test('reports count, order and value failures with the owning element origin', () => {
    expectThrown(
      () =>
        assertStaticAttributeSeed(
          element({ attributes: [...DECLARED, { name: 'data-extra', value: '1' }] }),
          DECLARED,
          '/0',
          [],
          ORIGIN,
        ),
      'static attribute seed count is 3, declared 2 at /0',
      ORIGIN,
    );
    expectThrown(
      () =>
        assertStaticAttributeSeed(
          element({
            attributes: [
              { name: 'class', value: 'x' },
              { name: 'id', value: 't' },
            ],
          }),
          DECLARED,
          '/0',
          [],
          ORIGIN,
        ),
      'static attribute id is out of order (found class) at /0',
      ORIGIN,
    );
    expectThrown(
      () =>
        assertStaticAttributeSeed(
          element({
            attributes: [
              { name: 'id', value: 't' },
              { name: 'class', value: 'y' },
            ],
          }),
          DECLARED,
          '/0',
          [],
          ORIGIN,
        ),
      'static attribute class has value "y", declared "x" at /0',
      ORIGIN,
    );
  });

  test('keeps the legacy four-argument shape and dynamic-name skip', () => {
    expectThrown(
      () => assertStaticAttributeSeed(element(), DECLARED, '/0'),
      'static attribute seed count is 0, declared 2 at /0',
    );
    expect(() =>
      assertStaticAttributeSeed(
        element({
          attributes: [...DECLARED, { name: 'data-live', value: '1' }],
        }),
        DECLARED,
        '/0',
        ['data-live'],
        ORIGIN,
      ),
    ).not.toThrow();
  });
});

describe('dynamic text, condition and list origins', () => {
  test('threads the origin through every text-slot failure', () => {
    expectThrown(
      () => assertTextSlotMarker(null, 0, false, '/0/0/text-start', ORIGIN),
      'text boundary start is missing at /0/0/text-start',
      ORIGIN,
    );
    expectThrown(
      () => assertTextSlotMarker(text('oe:t:0'), 0, false, '/0/0/text-start', ORIGIN),
      'text boundary start at /0/0/text-start is not a comment',
      ORIGIN,
    );
    expectThrown(
      () => assertTextSlotMarker(comment('oe:t:1'), 0, false, '/0/0/text-start', ORIGIN),
      'text boundary start at /0/0/text-start does not match ordinal 0',
      ORIGIN,
    );
    expectThrown(
      () => assertTextSlotMarker(comment('oe:/t:1'), 0, true, '/0/0/text-end', ORIGIN),
      'text boundary end at /0/0/text-end does not match ordinal 0',
      ORIGIN,
    );
    expectThrown(
      () => assertTextSlotMarker(null, 0, false, '/0'),
      'text boundary start is missing at /0',
    );
  });

  test('threads the origin through every condition failure', () => {
    expectThrown(
      () => assertWhenAnchor(null, '/0/0/when', ORIGIN),
      'condition anchor is missing at /0/0/when',
      ORIGIN,
    );
    expectThrown(
      () => assertWhenAnchor(text('oe:when'), '/0/0/when', ORIGIN),
      'condition anchor at /0/0/when is not a comment',
      ORIGIN,
    );
    expectThrown(
      () => assertWhenAnchor(comment('oe:/when'), '/0/0/when', ORIGIN),
      'condition anchor at /0/0/when does not match',
      ORIGIN,
    );
    expectThrown(
      () => assertWhenEndMarker(null, '/0/0/when/end', ORIGIN),
      'condition end is missing at /0/0/when/end',
      ORIGIN,
    );
    expectThrown(
      () => assertWhenEndMarker(text('oe:/when'), '/0/0/when/end', ORIGIN),
      'condition end at /0/0/when/end is not a comment',
      ORIGIN,
    );
    expectThrown(
      () => assertWhenEndMarker(comment('oe:when'), '/0/0/when/end', ORIGIN),
      'condition end at /0/0/when/end does not match',
      ORIGIN,
    );
    expectThrown(() => assertWhenAnchor(null, '/0'), 'condition anchor is missing at /0');
  });

  test('threads the origin through every list anchor, end and entry-key failure', () => {
    expectThrown(
      () => assertEachAnchor(null, '/0/0/each', ORIGIN),
      'list anchor is missing at /0/0/each',
      ORIGIN,
    );
    expectThrown(
      () => assertEachAnchor(text('oe:each'), '/0/0/each', ORIGIN),
      'list anchor at /0/0/each is not a comment',
      ORIGIN,
    );
    expectThrown(
      () => assertEachAnchor(comment('oe:/each'), '/0/0/each', ORIGIN),
      'list anchor at /0/0/each does not match',
      ORIGIN,
    );
    expectThrown(
      () => assertEachEndMarker(null, '/0/0/each/end', ORIGIN),
      'list end is missing at /0/0/each/end',
      ORIGIN,
    );
    expectThrown(
      () => assertEachEndMarker(text('oe:/each'), '/0/0/each/end', ORIGIN),
      'list end at /0/0/each/end is not a comment',
      ORIGIN,
    );
    expectThrown(
      () => assertEachEndMarker(comment('oe:each'), '/0/0/each/end', ORIGIN),
      'list end at /0/0/each/end does not match',
      ORIGIN,
    );
    expectThrown(
      () => readEntryKeyMarker(null, '/0/0/each/entry', ORIGIN),
      'entry key marker is missing at /0/0/each/entry',
      ORIGIN,
    );
    expectThrown(
      () => readEntryKeyMarker(text('oe:k:s:61'), '/0/0/each/entry', ORIGIN),
      'entry key marker at /0/0/each/entry is not a comment',
      ORIGIN,
    );
    expectThrown(
      () => readEntryKeyMarker(comment('comment'), '/0/0/each/entry', ORIGIN),
      'entry key marker at /0/0/each/entry does not match',
      ORIGIN,
    );
    expectThrown(
      () => readEntryKeyMarker(comment('oe:k:u'), '/0/0/each/entry', ORIGIN),
      'unsupported entry key kind at /0/0/each/entry',
      ORIGIN,
    );
    expect(readEntryKeyMarker(comment('oe:k:s:61'), '/0/0/each/entry', ORIGIN)).toBe('s:61');
    expectThrown(() => assertEachEndMarker(null, '/0'), 'list end is missing at /0');
  });
});

describe('HTML namespace origin', () => {
  test('reports the component/recipe origin on null, foreign and ancestor failures', () => {
    expectThrown(
      () => assertElementInHtmlNamespace(null, '/', ORIGIN),
      'non-HTML namespace at / (no node)',
      ORIGIN,
    );
    const foreign = element({ localName: 'svg', namespaceURI: SVG_NAMESPACE });
    expectThrown(
      () => assertElementInHtmlNamespace(foreign, '/0/0', ORIGIN),
      `non-HTML namespace at /0/0 (non-HTML namespace "${SVG_NAMESPACE}" on "svg")`,
      ORIGIN,
    );
    const child = withParent(element(), foreign);
    expectThrown(
      () => assertElementInHtmlNamespace(child, '/0/1', ORIGIN),
      `non-HTML namespace at /0/1 (non-HTML namespace "${SVG_NAMESPACE}" on "svg")`,
      ORIGIN,
    );
    expect(() => assertElementInHtmlNamespace(element(), '/', ORIGIN)).not.toThrow();
    expectThrown(
      () => assertElementInHtmlNamespace(null, '/'),
      'non-HTML namespace at / (no node)',
    );
  });
});
