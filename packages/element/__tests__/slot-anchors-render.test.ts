/**
 * Light-root slot anchors — the end-to-end vertical (LOCAL, Node).
 *
 * This is the consumer that makes the whole slice real: the REAL compiler emits
 * a light-root generated element whose producer writes a slot anchor inside
 * every `<slot>`, the REAL shell builds the class and attaches `__ssr`, and the
 * REAL serializer routes the caller's children into those slots.
 *
 * Three facts are pinned:
 *
 *   1. a caller's projection lands inside the right `<slot>` element, and the
 *      anchors never survive into the rendered document (they are the lane's
 *      private locator);
 *   2. a slot with no projection keeps its authored fallback;
 *   3. a projection naming a slot the component does not declare FAILS CLOSED
 *      with the serializer's existing validation identity (the same one the
 *      class lane raises), through both entry points a caller can use:
 *      `renderToString(..., { projectedChildren })` and the server function
 *      lane's `__ssr(tag, props, source, { groups })`.
 *
 * The producer bytes are pinned in
 * `packages/compiler/__tests__/semantic-ir/generated-leaf.slot-anchors.test.ts`;
 * the substitution unit contract lives in `slot-anchors.test.ts`.
 */

import { afterEach, describe, expect, test } from 'vitest';
import { renderToString } from '../src/public-runtime.ts';
import { __ssr } from '../src/server.ts';
import { trustedHtml } from '../src/internal/core/security.ts';
import { SSR_REGISTRY_GENERATED_HOSTS } from '@openelement/protocol/registry-markers';
import { testProgram } from './compiled-runtime/test-program.ts';

const TAG = 'oe-slot-probe';

/** One slot-anchor comment pair, spelled through the marker module. */
interface Producer {
  /** The producer's content bytes, as the emitter would write them. */
  readonly content: string;
}

const SLOTTED: Producer = {
  content:
    '<article class="card">' +
    '<slot name="header"><!--oe:s:0:686561646572--><!--oe:/s:0:686561646572--></slot>' +
    '<p class="body">fixed</p>' +
    '<slot name="footer"><!--oe:s:1:666f6f746572--><em>fallback</em><!--oe:/s:1:666f6f746572--></slot>' +
    '<slot><!--oe:s:2:--><!--oe:/s:2:--></slot>' +
    '</article>',
};

const SLOTLESS: Producer = { content: '<article class="plain"><p>only</p></article>' };

/**
 * Register one generated light host the way the shell does: the class carries
 * `__ssr` (the compiler-attached producer) and NO `__partProgram`, which is what
 * routes `renderToString` down the light branch.
 */
function withLightHost(producer: Producer, body: () => void): void {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'customElements');
  const HostClass = class {};
  Object.defineProperty(HostClass, '__ssr', {
    configurable: true,
    value: () => producer.content,
  });
  const registry: Record<string, unknown> = {
    get: (tag: string) => (tag === TAG ? HostClass : undefined),
  };
  // The registry pair table stays empty: this is the CLASS branch, not the
  // M11 pair channel. A light host with a producer needs no pairing.
  registry[SSR_REGISTRY_GENERATED_HOSTS] = new Map();
  Object.defineProperty(globalThis, 'customElements', { configurable: true, value: registry });
  try {
    body();
  } finally {
    if (original) Object.defineProperty(globalThis, 'customElements', original);
    else delete (globalThis as Record<string, unknown>).customElements;
  }
}

afterEach(() => {
  delete (globalThis as Record<string, unknown>).customElements;
});

describe('light-root slot anchors — projections reach their slots', () => {
  test('a named projection is written inside the slot whose anchor names it', () => {
    withLightHost(SLOTTED, () => {
      const html = renderToString(TAG, {
        projectedChildren: new Map([['header', trustedHtml('<h1>Title</h1>')]]),
      });
      expect(html).toContain('<slot name="header"><h1>Title</h1></slot>');
      // The unprojected slot keeps its authored fallback, and the empty default
      // slot stays empty rather than being dropped.
      expect(html).toContain('<slot name="footer"><em>fallback</em></slot>');
      expect(html).toContain('<slot></slot>');
      // The light-root ownership marker is still written by the host wrapper.
      expect(html).toContain('data-oe-light');
      // The anchors are private: not one reaches the document.
      expect(html).not.toContain('oe:s:');
    });
  });

  test('every declared slot can project in one render', () => {
    withLightHost(SLOTTED, () => {
      const html = renderToString(TAG, {
        projectedChildren: new Map([
          ['header', trustedHtml('<h1>T</h1>')],
          ['footer', trustedHtml('<small>f</small>')],
          ['', trustedHtml('<p>b</p>')],
        ]),
      });
      expect(html).toBe(
        `<${TAG} data-oe-light>` +
          '<article class="card">' +
          '<slot name="header"><h1>T</h1></slot>' +
          '<p class="body">fixed</p>' +
          '<slot name="footer"><small>f</small></slot>' +
          '<slot><p>b</p></slot>' +
          '</article>' +
          `</${TAG}>`,
      );
    });
  });

  test('a render with no projections strips the anchors and keeps every fallback', () => {
    withLightHost(SLOTTED, () => {
      const html = renderToString(TAG, {});
      expect(html).not.toContain('oe:s:');
      expect(html).toContain('<slot name="footer"><em>fallback</em></slot>');
    });
  });
});

describe('light-root slot anchors — fail closed on a missing slot', () => {
  test('renderToString refuses a projection the component cannot place', () => {
    withLightHost(SLOTTED, () => {
      let thrown: unknown;
      try {
        renderToString(TAG, {
          projectedChildren: new Map([['absent', trustedHtml('<i>x</i>')]]),
        });
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(Error);
      // The class lane's own identity: a caller cannot tell which lane refused.
      expect((thrown as { code?: string }).code).toBe('OPEN_ELEMENT_COMPILED_PROGRAM_INVALID');
      expect((thrown as { path?: string }).path).toBe('projectedChildren');
      expect((thrown as Error).message).toContain('targets missing slot "absent"');
    });
  });

  test('a projection into a SLOTLESS light component is refused, not dropped', () => {
    withLightHost(SLOTLESS, () => {
      expect(() =>
        renderToString(TAG, { projectedChildren: new Map([['', trustedHtml('<b>x</b>')]]) }),
      ).toThrow(/targets missing slot "default"/);
    });
  });

  test('the server function lane refuses it through __ssr composition groups', () => {
    withLightHost(SLOTTED, () => {
      // `__ssr` folds `[slotName, html]` groups into projectedChildren on the
      // light branch (that routing is what makes this call reach the slots).
      expect(() => __ssr(TAG, {}, undefined, { groups: [['absent', '<i>x</i>']] })).toThrow(
        /targets missing slot "absent"/,
      );
    });
  });
});

describe('light-root slot anchors — the nested composition route', () => {
  /**
   * One compiled-class parent nesting the generated light host with a slotted
   * child. The parent's own serializer derives `projectedChildren` from the
   * child nodes' static `slot` attributes (`slotNameOf`), which is the map the
   * generated light host must substitute into its anchors.
   */
  function parentProgram(): ReturnType<typeof testProgram> {
    return testProgram({
      tag: 'oe-slot-parent',
      rootMode: 'shadow-open',
      template: [
        {
          k: 'el',
          tag: 'oe-generated-child',
          attrs: [],
          children: [
            {
              k: 'el',
              tag: 'h1',
              attrs: [['slot', 'header']],
              children: [{ k: 'text', value: 'T' }],
            },
            { k: 'el', tag: 'p', attrs: [], children: [{ k: 'text', value: 'body' }] },
          ],
        },
      ],
      parts: [],
    });
  }

  test('a nested generated light host substitutes the parent-derived projections', () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, 'customElements');
    const ChildClass = class {};
    Object.defineProperty(ChildClass, '__ssr', {
      configurable: true,
      value: () => SLOTTED.content,
    });
    const entries = new Map<string, CustomElementConstructor>([
      ['oe-generated-child', ChildClass as unknown as CustomElementConstructor],
    ]);
    const registry: Record<string, unknown> = { get: (tag: string) => entries.get(tag) };
    registry[SSR_REGISTRY_GENERATED_HOSTS] = new Map();
    Object.defineProperty(globalThis, 'customElements', { configurable: true, value: registry });
    try {
      const Parent = Object.assign(class {}, {
        __partProgram: parentProgram(),
        __compiledProperties: [],
      }) as unknown as CustomElementConstructor;
      const html = renderToString('oe-slot-parent', {
        componentClass: Parent,
        ssrRenderableTags: ['oe-generated-child'],
      });
      // The `slot="header"` child landed in the header slot; the unnamed child
      // landed in the default slot; the footer slot kept its fallback.
      expect(html).toContain('<slot name="header"><h1 slot="header">T</h1></slot>');
      expect(html).toContain('<slot><p>body</p></slot>');
      expect(html).toContain('<slot name="footer"><em>fallback</em></slot>');
      expect(html).not.toContain('oe:s:');
    } finally {
      if (original) Object.defineProperty(globalThis, 'customElements', original);
      else delete (globalThis as Record<string, unknown>).customElements;
    }
  });
});

describe('light-root slot anchors — the __ssr composition route', () => {
  test('__ssr group children land in their slots', () => {
    withLightHost(SLOTTED, () => {
      const html = __ssr(TAG, {}, undefined, {
        groups: [
          ['header', '<h1>A</h1>'],
          ['header', '<h2>B</h2>'],
          ['', '<p>body</p>'],
        ],
      });
      // Same-name groups concatenate in authored order, exactly like the class
      // lane's per-slot fold.
      expect(html).toContain('<slot name="header"><h1>A</h1><h2>B</h2></slot>');
      expect(html).toContain('<slot><p>body</p></slot>');
      expect(html).not.toContain('oe:s:');
    });
  });

  test('a numeric slot name arrives as its attribute text, not the default slot', () => {
    // The authored value crosses with the serializer's own attribute rule, so
    // `0` names `<slot name="0">` — the class lane's `slotNameOf` rule.
    withLightHost(
      {
        content:
          '<div><slot name="0"><!--oe:s:0:30--><!--oe:/s:0:30--></slot><slot><!--oe:s:1:--><!--oe:/s:1:--></slot></div>',
      },
      () => {
        const html = __ssr(TAG, {}, undefined, { groups: [[0, '<b>zero</b>']] });
        expect(html).toContain('<slot name="0"><b>zero</b></slot>');
        expect(html).toContain('<slot></slot>');
      },
    );
  });
});
