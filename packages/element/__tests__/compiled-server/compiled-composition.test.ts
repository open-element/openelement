import { assertEquals, assertStringIncludes, assertThrows } from '@std/assert';
import { renderDsd } from '../../src/public-runtime.ts';
import { trustedHtml } from '../../src/internal/core/security.ts';
import type { PartProgram } from '../../src/internal/protocol/part-program.ts';
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

Deno.test('Element server owns nested composition, slots, DSD, and foreign passthrough', () => {
  const rail = testProgram({
    tag: 'oe-page-rail',
    rootMode: 'shadow-open',
    template: [{
      k: 'el',
      tag: 'nav',
      attrs: [],
      children: [{ k: 'text', value: 'Start' }],
    }],
    parts: [],
  });
  const shell = testProgram({
    tag: 'oe-reading-shell',
    rootMode: 'light',
    template: [{
      k: 'el',
      tag: 'article',
      attrs: [],
      children: [{
        k: 'el',
        tag: 'header',
        attrs: [],
        children: [{
          k: 'el',
          tag: 'slot',
          attrs: [['name', 'meta']],
          children: [{ k: 'text', value: 'Fallback meta' }],
        }],
      }, {
        k: 'el',
        tag: 'main',
        attrs: [],
        children: [{
          k: 'el',
          tag: 'slot',
          attrs: [],
          children: [{ k: 'text', value: 'Fallback body' }],
        }],
      }],
    }],
    parts: [],
  });
  const page = testProgram({
    tag: 'oe-guide-page',
    rootMode: 'shadow-open',
    template: [{
      k: 'el',
      tag: 'oe-reading-shell',
      attrs: [],
      children: [{
        k: 'el',
        tag: 'span',
        attrs: [['slot', 'meta']],
        children: [{ k: 'text', value: 'Projected meta' }],
      }, {
        k: 'el',
        tag: 'oe-page-rail',
        attrs: [],
        children: [],
      }, {
        k: 'el',
        tag: 'x-third-party',
        attrs: [],
        children: [{ k: 'text', value: 'foreign' }],
      }],
    }],
    parts: [],
  });

  const registry = new Map<string, CustomElementConstructor>([
    ['oe-reading-shell', compiledClass(shell)],
    ['oe-page-rail', compiledClass(rail)],
  ]);
  withRegistry(registry, () => {
    const html = renderDsd('oe-guide-page', {
      componentClass: compiledClass(page),
      ssrRenderableTags: ['oe-reading-shell', 'oe-page-rail'],
    }).html;
    assertEquals((html.match(/<oe-reading-shell/g) ?? []).length, 1);
    assertEquals((html.match(/<oe-page-rail/g) ?? []).length, 1);
    assertStringIncludes(
      html,
      '<slot name="meta"><span slot="meta">Projected meta</span></slot>',
    );
    assertEquals(html.includes('Fallback meta'), false);
    assertStringIncludes(
      html,
      '<slot><oe-page-rail><template shadowrootmode="open"><nav>Start</nav></template></oe-page-rail><x-third-party>foreign</x-third-party></slot>',
    );
  });
});

Deno.test('Trusted HTML remains opaque to nested component composition', () => {
  const child = testProgram({
    tag: 'oe-safe-child',
    rootMode: 'shadow-open',
    template: [{ k: 'el', tag: 'p', attrs: [], children: [{ k: 'text', value: 'executed' }] }],
    parts: [],
  });
  const parent = testProgram({
    tag: 'oe-html-parent',
    rootMode: 'shadow-open',
    properties: [{
      name: 'body',
      attribute: null,
      type: 'object',
      converter: 'object',
      reflect: false,
      default: null,
    }],
    template: [{ k: 'el', tag: 'div', attrs: [], children: [] }],
    parts: [{ k: 'html', index: 0, signal: 'body', path: [0] }],
  });

  withRegistry(new Map([['oe-safe-child', compiledClass(child)]]), () => {
    const html = renderDsd('oe-html-parent', {
      componentClass: compiledClass(parent),
      props: { body: trustedHtml('<oe-safe-child>opaque</oe-safe-child>') },
      ssrRenderableTags: ['oe-safe-child'],
    }).html;
    assertStringIncludes(html, '<oe-safe-child>opaque</oe-safe-child>');
    assertEquals(html.includes('executed'), false);
  });
});

Deno.test('nested compiled boolean host attributes preserve presence semantics', () => {
  const child = testProgram({
    tag: 'oe-boolean-child',
    rootMode: 'light',
    properties: [{
      name: 'active',
      attribute: 'active',
      type: 'boolean',
      converter: 'boolean',
      reflect: true,
      default: false,
    }],
    template: [{ k: 'el', tag: 'slot', attrs: [], children: [] }],
    parts: [],
  });
  const parent = testProgram({
    tag: 'oe-boolean-parent',
    rootMode: 'shadow-open',
    template: [{
      k: 'el',
      tag: 'oe-boolean-child',
      attrs: [['active', '']],
      children: [],
    }],
    parts: [],
  });

  withRegistry(new Map([['oe-boolean-child', compiledClass(child)]]), () => {
    const html = renderDsd('oe-boolean-parent', {
      componentClass: compiledClass(parent),
      ssrRenderableTags: ['oe-boolean-child'],
    }).html;
    assertStringIncludes(html, '<oe-boolean-child active="" data-oe-light>');
  });
});

Deno.test('public light-child projection rejects forged TrustedHtml values', () => {
  const shell = testProgram({
    tag: 'oe-safe-shell',
    rootMode: 'light',
    template: [{ k: 'el', tag: 'slot', attrs: [], children: [] }],
    parts: [],
  });

  assertThrows(
    () => {
      renderDsd('oe-safe-shell', {
        componentClass: compiledClass(shell),
        projectedChildren: new Map([
          ['', { html: '<script>forged</script>' }],
        ]),
      });
    },
    Error,
    'ordinary strings are rejected',
  );
});

Deno.test('renderDsd threads the compiled delegatesFocus static into the DSD template (#1226)', () => {
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
  assertStringIncludes(
    renderDsd('oe-focusable', { componentClass: focusable }).html,
    '<template shadowrootmode="open" shadowrootdelegatesfocus>',
  );
  assertStringIncludes(
    renderDsd('oe-focusable', { componentClass: plain }).html,
    '<template shadowrootmode="open">',
  );
});
