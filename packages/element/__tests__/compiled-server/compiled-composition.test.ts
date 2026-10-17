import { expect, test } from 'vitest';
import { assertThrowsIncludes } from '../../../../tests/lib/vitest-asserts.ts';
import { renderToString } from '../../src/public-runtime.ts';
import { trustedHtml } from '../../src/internal/core/security.ts';
import type { PartProgram } from '@openelement/protocol/part-program';
import { testProgram } from '../compiled-runtime/test-program.ts';

function compiledClass(program: PartProgram): CustomElementConstructor {
  return Object.assign(class {}, {
    __partProgram: program,
    __compiledProperties: program.metadata.properties,
  }) as unknown as CustomElementConstructor;
}

function withRegistry(
  entries: ReadonlyMap<string, CustomElementConstructor>,
  run: () => void,
): void {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'customElements');
  Object.defineProperty(globalThis, 'customElements', {
    configurable: true,
    value: { get: (tag: string) => entries.get(tag) },
  });
  try {
    run();
  } finally {
    if (original) Object.defineProperty(globalThis, 'customElements', original);
    else delete (globalThis as Record<string, unknown>).customElements;
  }
}

test('Element server owns nested composition, slots, DSD, and foreign passthrough', () => {
  const rail = testProgram({
    tag: 'oe-page-rail',
    rootMode: 'shadow-open',
    template: [
      {
        k: 'el',
        tag: 'nav',
        attrs: [],
        children: [{ k: 'text', value: 'Start' }],
      },
    ],
    parts: [],
  });
  const shell = testProgram({
    tag: 'oe-reading-shell',
    rootMode: 'light',
    template: [
      {
        k: 'el',
        tag: 'article',
        attrs: [],
        children: [
          {
            k: 'el',
            tag: 'header',
            attrs: [],
            children: [
              {
                k: 'el',
                tag: 'slot',
                attrs: [['name', 'meta']],
                children: [{ k: 'text', value: 'Fallback meta' }],
              },
            ],
          },
          {
            k: 'el',
            tag: 'main',
            attrs: [],
            children: [
              {
                k: 'el',
                tag: 'slot',
                attrs: [],
                children: [{ k: 'text', value: 'Fallback body' }],
              },
            ],
          },
        ],
      },
    ],
    parts: [],
  });
  const page = testProgram({
    tag: 'oe-guide-page',
    rootMode: 'shadow-open',
    template: [
      {
        k: 'el',
        tag: 'oe-reading-shell',
        attrs: [],
        children: [
          {
            k: 'el',
            tag: 'span',
            attrs: [['slot', 'meta']],
            children: [{ k: 'text', value: 'Projected meta' }],
          },
          {
            k: 'el',
            tag: 'oe-page-rail',
            attrs: [],
            children: [],
          },
          {
            k: 'el',
            tag: 'x-third-party',
            attrs: [],
            children: [{ k: 'text', value: 'foreign' }],
          },
        ],
      },
    ],
    parts: [],
  });

  const registry = new Map<string, CustomElementConstructor>([
    ['oe-reading-shell', compiledClass(shell)],
    ['oe-page-rail', compiledClass(rail)],
  ]);
  withRegistry(registry, () => {
    const html = renderToString('oe-guide-page', {
      componentClass: compiledClass(page),
      ssrRenderableTags: ['oe-reading-shell', 'oe-page-rail'],
    });
    expect((html.match(/<oe-reading-shell/g) ?? []).length).toEqual(1);
    expect((html.match(/<oe-page-rail/g) ?? []).length).toEqual(1);
    expect(html).toContain('<slot name="meta"><span slot="meta">Projected meta</span></slot>');
    expect(html.includes('Fallback meta')).toEqual(false);
    expect(html).toContain(
      '<slot><oe-page-rail><template shadowrootmode="open"><nav>Start</nav></template></oe-page-rail><x-third-party>foreign</x-third-party></slot>',
    );
  });
});

test('Trusted HTML remains opaque to nested component composition', () => {
  const child = testProgram({
    tag: 'oe-safe-child',
    rootMode: 'shadow-open',
    template: [{ k: 'el', tag: 'p', attrs: [], children: [{ k: 'text', value: 'executed' }] }],
    parts: [],
  });
  const parent = testProgram({
    tag: 'oe-html-parent',
    rootMode: 'shadow-open',
    properties: [
      {
        name: 'body',
        attribute: null,
        type: 'object',
        converter: 'object',
        reflect: false,
        default: null,
      },
    ],
    template: [{ k: 'el', tag: 'div', attrs: [], children: [] }],
    parts: [{ k: 'html', index: 0, signal: 'body', path: [0] }],
  });

  withRegistry(new Map([['oe-safe-child', compiledClass(child)]]), () => {
    const html = renderToString('oe-html-parent', {
      componentClass: compiledClass(parent),
      props: { body: trustedHtml('<oe-safe-child>opaque</oe-safe-child>') },
      ssrRenderableTags: ['oe-safe-child'],
    });
    expect(html).toContain('<oe-safe-child>opaque</oe-safe-child>');
    expect(html.includes('executed')).toEqual(false);
  });
});

test('nested compiled boolean host attributes preserve presence semantics', () => {
  const child = testProgram({
    tag: 'oe-boolean-child',
    rootMode: 'light',
    properties: [
      {
        name: 'active',
        attribute: 'active',
        type: 'boolean',
        converter: 'boolean',
        reflect: true,
        default: false,
      },
    ],
    template: [{ k: 'el', tag: 'slot', attrs: [], children: [] }],
    parts: [],
  });
  const parent = testProgram({
    tag: 'oe-boolean-parent',
    rootMode: 'shadow-open',
    template: [
      {
        k: 'el',
        tag: 'oe-boolean-child',
        attrs: [['active', '']],
        children: [],
      },
    ],
    parts: [],
  });

  withRegistry(new Map([['oe-boolean-child', compiledClass(child)]]), () => {
    const html = renderToString('oe-boolean-parent', {
      componentClass: compiledClass(parent),
      ssrRenderableTags: ['oe-boolean-child'],
    });
    expect(html).toContain('<oe-boolean-child active="" data-oe-light>');
  });
});

test('public light-child projection rejects forged TrustedHtml values', () => {
  const shell = testProgram({
    tag: 'oe-safe-shell',
    rootMode: 'light',
    template: [{ k: 'el', tag: 'slot', attrs: [], children: [] }],
    parts: [],
  });

  assertThrowsIncludes(
    () => {
      renderToString('oe-safe-shell', {
        componentClass: compiledClass(shell),
        projectedChildren: new Map([['', { html: '<script>forged</script>' }]]),
      });
    },
    Error,
    'ordinary strings are rejected',
  );
});

test('renderToString threads the compiled delegatesFocus static into the DSD template (#1226)', () => {
  const program = testProgram({
    tag: 'oe-focusable',
    rootMode: 'shadow-open',
    template: [{ k: 'el', tag: 'button', attrs: [], children: [{ k: 'text', value: 'x' }] }],
    parts: [],
  });
  const focusable = Object.assign(compiledClass(program), { delegatesFocus: true });
  const plain = compiledClass(program);
  // The client kernel passes the static to attachShadow; the DSD template
  // must carry the matching marker or the claimed root loses delegation.
  expect(renderToString('oe-focusable', { componentClass: focusable })).toContain(
    '<template shadowrootmode="open" shadowrootdelegatesfocus>',
  );
  expect(renderToString('oe-focusable', { componentClass: plain })).toContain(
    '<template shadowrootmode="open">',
  );
});

test('a bare boolean prop reads TRUE from its empty-string presence encoding', () => {
  // A server function page composes an admitted host with bare JSX attributes
  // (`<open-reading-shell rail>`), which the constructor lowers to the
  // canonical presence encoding `{ "rail": "" }`. Attribute presence means
  // TRUE — exactly how `convertFromAttribute` reads it on the client and how
  // the nested-class expansion guards it — so the seed must not run the empty
  // string through `Boolean('')` and silently drop the flag.
  const shell = testProgram({
    tag: 'oe-flag-shell',
    rootMode: 'light',
    template: [
      {
        k: 'el',
        tag: 'aside',
        attrs: [],
        children: [{ k: 'part', index: 0 }],
      },
    ],
    parts: [
      {
        k: 'when',
        index: 0,
        signal: 'rail',
        test: { signal: 'rail', op: 'truthy', value: true },
        on: [
          {
            k: 'el',
            tag: 'span',
            attrs: [],
            children: [{ k: 'text', value: 'RAIL-ON' }],
          },
        ],
        off: [
          {
            k: 'el',
            tag: 'span',
            attrs: [],
            children: [{ k: 'text', value: 'RAIL-OFF' }],
          },
        ],
      },
    ],
    properties: [
      {
        name: 'rail',
        attribute: 'rail',
        type: 'boolean',
        converter: 'boolean',
        reflect: true,
        default: false,
      },
    ],
  });

  expect(renderToString('oe-flag-shell', { componentClass: compiledClass(shell) })).toContain(
    'RAIL-OFF',
  );
  expect(
    renderToString('oe-flag-shell', {
      componentClass: compiledClass(shell),
      props: { rail: '' },
    }),
  ).toContain('RAIL-ON');
  expect(
    renderToString('oe-flag-shell', {
      componentClass: compiledClass(shell),
      props: { rail: false },
    }),
  ).toContain('RAIL-OFF');
});

test('an undeclared prop rides the __ssr host tag as a host attribute', async () => {
  // A server function page passes `class` to an admitted host
  // (`<open-button class='no-underline'>`); the compiled property seed only
  // reads declared records, so an undeclared key would silently vanish — the
  // exact regression the changelog page's footer buttons showed. The nested
  // class expansion forwards such keys as `hostAttrs`; the `__ssr` call site
  // must agree, or the two composition channels emit different host tags.
  const { __ssr } = await import('../../src/server.ts');
  const btn = testProgram({
    tag: 'oe-btn',
    rootMode: 'shadow-open',
    template: [
      {
        k: 'el',
        tag: 'a',
        attrs: [['part', 'control']],
        children: [{ k: 'el', tag: 'slot', attrs: [], children: [] }],
      },
    ],
    parts: [],
    properties: [
      {
        name: 'variant',
        attribute: 'variant',
        type: 'string',
        converter: 'string',
        reflect: true,
        default: '',
      },
    ],
  });
  const original = Object.getOwnPropertyDescriptor(globalThis, 'customElements');
  Object.defineProperty(globalThis, 'customElements', {
    configurable: true,
    value: { get: (tag: string) => (tag === 'oe-btn' ? compiledClass(btn) : undefined) },
  });
  try {
    const html = __ssr('oe-btn', { class: 'no-underline', variant: 'ghost' }, undefined, {
      groups: [['', 'X']],
    });
    expect(html).toContain('class="no-underline"');
    expect(html).toContain('variant="ghost"');
    // The declared prop is consumed as the compiled property, not repeated as
    // an anonymous passthrough attribute.
    expect(html.match(/variant=/g)?.length).toBe(1);
  } finally {
    if (original) Object.defineProperty(globalThis, 'customElements', original);
    else delete (globalThis as Record<string, unknown>).customElements;
  }
});
