/**
 * The host-attribute writer and the `hostChildren` capability (alpha15 R3
 * A2/A4).
 *
 * A2 — `serializeHostAttributes` is the ONE writer of the attributes a
 * compiled host carries (the `__ssr` passthrough, the class path's nested
 * expansion, the public `renderToString` options). It must normalize
 * `class`/`style` through the SAME `classValueOf`/`styleValueOf` the element
 * serializer's Part emissions and `__h` use — otherwise one authoring value
 * (`class={['a','b']}`, `style={{color:'red'}}`) reaches the wire as "a,b" /
 * "[object Object]" on a host while the same value on a plain tag renders
 * "a b" / "color:red": two class semantics, drifting.
 *
 * A4 — `hostChildren` is the public shadow-side sibling of
 * `projectedChildren`: brand-checked trusted light children appended after a
 * shadow-root host's DSD template (native slot distribution does the rest),
 * and a coded rejection on a light root, whose children are projections.
 */

import { describe, expect, test } from 'vitest';
import { renderToString } from '../../src/public-runtime.ts';
import { __h } from '../../src/server.ts';
import { trustedHtml } from '../../src/internal/core/security.ts';
import type { TrustedHtml } from '../../src/internal/core/security.ts';
import { testProgram } from '../compiled-runtime/test-program.ts';

function compiledClass(program: ReturnType<typeof testProgram>): CustomElementConstructor {
  return Object.assign(class {}, {
    __partProgram: program,
    __compiledProperties: program.metadata.properties,
  }) as unknown as CustomElementConstructor;
}

const LIGHT_SLOT_HOST = testProgram({
  tag: 'oe-probe-light',
  rootMode: 'light',
  template: [{ k: 'el', tag: 'slot', attrs: [], children: [] }],
  parts: [],
});

const SHADOW_SLOT_HOST = testProgram({
  tag: 'oe-probe-shadow',
  rootMode: 'shadow-open',
  template: [
    { k: 'el', tag: 'nav', attrs: [], children: [{ k: 'text', value: 'nav' }] },
    { k: 'el', tag: 'slot', attrs: [], children: [] },
  ],
  parts: [],
});

const lightHostClass = compiledClass(LIGHT_SLOT_HOST);
const shadowHostClass = compiledClass(SHADOW_SLOT_HOST);

/** The serialized form of one attribute (bare or quoted), or '' when absent. */
function attributeText(html: string, name: string): string {
  const match = new RegExp(` ${name}(="[^"]*")?`).exec(html);
  return match?.[0] ?? '';
}

/** The same value through the plain-element sink: `__h` is the reference semantics. */
function hAttributeText(name: string, value: unknown): string {
  return attributeText(__h('x-probe', { [name]: value }, []), name);
}

/** The same value through the host-attribute writer (the public options route). */
function hostAttributeText(name: string, value: unknown): string {
  return attributeText(
    renderToString('oe-probe-light', {
      componentClass: lightHostClass,
      hostAttrs: [[name, value]],
    }),
    name,
  );
}

describe('A2 — host attributes normalize through the shared class/style coercions', () => {
  test('one value, one wire form: the host writer and __h agree on every supported value', () => {
    const cases: Array<[string, unknown]> = [
      ['class', 'card'],
      ['class', ''],
      ['class', 'a b'],
      ['class', ['a', 'b']],
      ['class', ['a', '', 'b']],
      ['class', { wide: true, narrow: false, tall: true }],
      ['class', 7],
      ['class', null],
      ['class', undefined],
      ['class', false],
      ['style', 'color:red'],
      ['style', ''],
      ['style', { color: 'red', fontSize: '1em' }],
      ['style', ['color:red', 'display:block']],
      ['style', null],
      ['style', undefined],
      ['style', false],
      ['data-x', '1'],
      ['data-x', ''],
      ['data-x', null],
      ['hidden', true],
      ['hidden', false],
      ['hidden', ''],
      ['tabindex', 3],
    ];
    for (const [name, value] of cases) {
      const reference = hAttributeText(name, value);
      expect(reference, `__h(${name}) reference`).toBe(
        attributeText(__h('x-probe', { [name]: value }, []), name),
      );
      expect(
        hostAttributeText(name, value),
        `host attribute ${name} for ${JSON.stringify(value)}`,
      ).toBe(reference);
    }
    // The rows are discriminating, not vacuous: a quoted class array is the
    // space-joined form and a record style is the sorted declaration list.
    expect(hAttributeText('class', ['a', 'b'])).toBe(' class="a b"');
    expect(hAttributeText('style', { color: 'red', fontSize: '1em' })).toBe(
      ' style="color:red;font-size:1em"',
    );
    expect(hAttributeText('class', '')).toBe('');
    expect(hAttributeText('class', { wide: true, narrow: false })).toBe(' class="wide"');
  });

  test('a boolean class value fails closed in both sinks (the shared coercion owns the rule)', () => {
    // `classValueOf(true)` has no class form: the same coded rejection must
    // come out of the plain tag and the host attribute writer.
    expect(() => __h('x-probe', { class: true }, [])).toThrow(/class Part expects/);
    expect(() =>
      renderToString('oe-probe-light', {
        componentClass: lightHostClass,
        hostAttrs: [['class', true]],
      }),
    ).toThrow(/class Part expects/);
  });

  test('the class lane nested expansion and the hostAttrs route agree byte-for-byte', () => {
    // Two producers hand values to the ONE writer: the class path's nested
    // composition (a `class`/`style` Part on a nested host) and the public
    // hostAttrs route the server function lane rides. Their wire bytes are the
    // consumer-form guard against a second normalization.
    const parent = testProgram({
      tag: 'oe-attr-parent',
      rootMode: 'shadow-open',
      properties: [
        {
          name: 'cls',
          attribute: null,
          type: 'object',
          converter: 'object',
          reflect: false,
          default: null,
        },
        {
          name: 'st',
          attribute: null,
          type: 'object',
          converter: 'object',
          reflect: false,
          default: null,
        },
      ],
      template: [{ k: 'el', tag: 'oe-probe-light', attrs: [], children: [] }],
      parts: [
        { k: 'class', index: 0, signal: 'cls', path: [0] },
        { k: 'style', index: 1, signal: 'st', path: [0] },
      ],
    });
    const original = Object.getOwnPropertyDescriptor(globalThis, 'customElements');
    Object.defineProperty(globalThis, 'customElements', {
      configurable: true,
      value: { get: (tag: string) => (tag === 'oe-probe-light' ? lightHostClass : undefined) },
    });
    try {
      const nested = renderToString('oe-attr-parent', {
        componentClass: compiledClass(parent),
        ssrRenderableTags: ['oe-probe-light'],
        props: { cls: ['a', 'b'], st: { color: 'red' } },
      });
      const direct = renderToString('oe-probe-light', {
        componentClass: lightHostClass,
        hostAttrs: [
          ['class', ['a', 'b']],
          ['style', { color: 'red' }],
        ],
      });
      expect(attributeText(nested, 'class')).toBe(' class="a b"');
      expect(attributeText(nested, 'style')).toBe(' style="color:red"');
      expect(attributeText(nested, 'class')).toBe(attributeText(direct, 'class'));
      expect(attributeText(nested, 'style')).toBe(attributeText(direct, 'style'));
    } finally {
      if (original) Object.defineProperty(globalThis, 'customElements', original);
      else delete (globalThis as Record<string, unknown>).customElements;
    }
  });

  test('the writer keeps its safety boundary: unsafe names and duplicates still fail closed', () => {
    for (const hostAttrs of [
      [['onclick', 'x']],
      [['not a name', 'x']],
      [
        ['class', 'a'],
        ['CLASS', 'b'],
      ],
    ] as Array<Array<[string, unknown]>>) {
      expect(() =>
        renderToString('oe-probe-light', { componentClass: lightHostClass, hostAttrs }),
      ).toThrow(/unsafe attribute name|duplicate attribute/);
    }
  });
});

describe('A4 — hostChildren is a public, brand-checked composition capability', () => {
  test('a shadow-root host appends the trusted light children after its DSD template', () => {
    const html = renderToString('oe-probe-shadow', {
      componentClass: shadowHostClass,
      hostChildren: trustedHtml('<p slot="body">slotted</p>'),
    });
    expect(html).toBe(
      '<oe-probe-shadow>' +
        '<template shadowrootmode="open"><nav>nav</nav><slot></slot></template>' +
        '<p slot="body">slotted</p>' +
        '</oe-probe-shadow>',
    );
  });

  test('a light root rejects non-empty hostChildren (its children are projections)', () => {
    let thrown: unknown;
    try {
      renderToString('oe-probe-light', {
        componentClass: lightHostClass,
        hostChildren: trustedHtml('<p>x</p>'),
      });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeDefined();
    expect(String((thrown as Error).message)).toContain('hostChildren is for shadow-root hosts');
    // An empty value is inert, so a caller that conditionally composes nothing
    // does not have to special-case the light root.
    expect(
      renderToString('oe-probe-light', {
        componentClass: lightHostClass,
        hostChildren: trustedHtml(''),
      }),
    ).toBe('<oe-probe-light data-oe-light><slot></slot></oe-probe-light>');
  });

  test('an unbranded or forged hostChildren value fails the trustedHtml brand check', () => {
    const forged: unknown[] = ['<p>x</p>', { html: '<p>x</p>' }];
    for (const value of forged) {
      let thrown: unknown;
      try {
        renderToString('oe-probe-shadow', {
          componentClass: shadowHostClass,
          hostChildren: value as TrustedHtml,
        });
      } catch (error) {
        thrown = error;
      }
      expect(thrown, `hostChildren ${JSON.stringify(value)}`).toBeDefined();
      expect(String((thrown as Error).message)).toContain('ordinary strings are rejected');
    }
  });
});
