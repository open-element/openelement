/**
 * M11 complete vertical — the serializer's nested-composition branch invokes a
 * registered generated host producer. (Node; the real compiler+emitted module
 * vertical is the router suite.)
 *
 * The generated element's class has NO `__partProgram`: its server artifact is
 * the compiler-emitted `<Name>__ssrHost` producer. The one nested callback used
 * to fail closed on such an admitted tag (`PROGRAM_MISSING`). This suite pins
 * the branch that replaces that dead end:
 *
 * - the ADMISSION gate wins first (an unadmitted tag never reaches the table,
 *   the renderer is never called);
 * - for an admitted tag, the one protocol marker table on the SSR registry is
 *   read; a hit calls the paired renderer with the nested properties, the
 *   already-serialized light children, and the canonical normalized attribute
 *   pairs — no class read, no static, no `__partProgram`;
 * - the canonical host-attribute normalization is the SAME one the class
 *   serializer's host writer uses (one value algebra; presence is carried as a
 *   flag and handed to the typed producer channel as the canonical empty-string
 *   pair, which the DSD producer spells `name=""`);
 * - a renderer result that is not a string fails closed with the existing
 *   coded SSR error instead of concatenating `undefined`;
 * - a tag with no table entry keeps today's class path (no behavior change).
 */

import { describe, expect, test } from 'vitest';
import {
  createStreamShellExecutor,
  renderToString,
  type StreamShellManifest,
} from '../../src/public-runtime.ts';
import { serializeGeneratedElementHtml } from '../../src/internal/compiled/generated-element/dsd-ssr.ts';
import { seedGeneratedElementHostProperties } from '../../src/internal/compiled/generated-element/shell.ts';
import { createStreamServerExecutor } from '../../src/internal/compiled/server/index.ts';
import { PART_PROGRAM_VERSION } from '@openelement/protocol/part-program';
import { SSR_REGISTRY_GENERATED_HOSTS } from '@openelement/protocol/registry-markers';
import { normalizeHostAttributePairs } from '../../src/internal/compiled/server/index.ts';
import { __setRequestTimeStyleSheetUrls } from '../../src/internal/compiled/server/style-links.ts';
import { testProgram } from '../compiled-runtime/test-program.ts';

const HOST_TAG = 'oe-generated-card';

/** The registry entry the guard (router) writes: tag -> compiler host renderer. */
type HostRenderer = (
  props: Readonly<Record<string, unknown>>,
  lightChildren: string,
  attributes: readonly (readonly [string, string])[] | undefined,
  styleLinks?: readonly string[],
) => string;

function compiledClass(program: ReturnType<typeof testProgram>): CustomElementConstructor {
  return Object.assign(class {}, {
    __partProgram: program,
    __compiledProperties: program.metadata.properties,
  }) as unknown as CustomElementConstructor;
}

/**
 * One real class program (shadow root) nesting the generated host with a light
 * child: the static `id` attribute, the dynamic property channel (`title`,
 * `note` lower to prop Parts for a custom-element host) and a slotted child.
 */
function parentProgram(): ReturnType<typeof testProgram> {
  const hostPath = [0, 0];
  return testProgram({
    tag: 'oe-generated-parent',
    rootMode: 'shadow-open',
    properties: [
      {
        name: 'title',
        attribute: null,
        type: 'string',
        converter: 'string',
        reflect: false,
        default: '',
      },
      {
        name: 'note',
        attribute: null,
        type: 'string',
        converter: 'string',
        reflect: false,
        default: '',
      },
    ],
    template: [
      {
        k: 'el',
        tag: 'div',
        attrs: [['id', 'wrap']],
        children: [
          {
            k: 'el',
            tag: HOST_TAG,
            attrs: [['id', 'gen"<&']],
            children: [
              {
                k: 'el',
                tag: 'span',
                attrs: [['slot', 'x']],
                children: [{ k: 'text', value: 'light & child' }],
              },
            ],
          },
        ],
      },
    ],
    parts: [
      { k: 'prop', index: 0, signal: 'title', name: 'title', path: hostPath },
      { k: 'prop', index: 1, signal: 'note', name: 'note', path: hostPath },
    ],
  });
}

/**
 * Install a minimal SSR `customElements` registry whose marker table is the one
 * the router guard owns. The element runtime only READS the table here; the
 * guard's atomic pairing is tested in the router suite.
 */
function withGeneratedRegistry(entries: ReadonlyMap<string, unknown>, run: () => void): void {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'customElements');
  const registry: Record<string, unknown> = {
    get: () => undefined,
  };
  registry[SSR_REGISTRY_GENERATED_HOSTS] = new Map(entries);
  Object.defineProperty(globalThis, 'customElements', {
    configurable: true,
    value: registry,
  });
  try {
    run();
  } finally {
    if (original) Object.defineProperty(globalThis, 'customElements', original);
    else delete (globalThis as Record<string, unknown>).customElements;
  }
}

function withNoRegistry(run: () => void): void {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'customElements');
  Object.defineProperty(globalThis, 'customElements', {
    configurable: true,
    value: undefined,
  });
  try {
    run();
  } finally {
    if (original) Object.defineProperty(globalThis, 'customElements', original);
    else delete (globalThis as Record<string, unknown>).customElements;
  }
}

describe('M11 nested generated host branch', () => {
  test('an admitted generated host calls the paired canonical producer once', () => {
    const calls: Array<Parameters<HostRenderer>> = [];
    const renderer: HostRenderer = (props, lightChildren, attributes) => {
      calls.push([props, lightChildren, attributes]);
      return serializeGeneratedElementHtml({
        tag: HOST_TAG,
        root: 'open',
        content: '<article part="card"></article>',
        ...(lightChildren === '' ? {} : { lightChildren }),
        ...(attributes === undefined ? {} : { attributes }),
      });
    };

    const parent = compiledClass(parentProgram());
    let html = '';
    withGeneratedRegistry(new Map([[HOST_TAG, renderer]]), () => {
      html = renderToString(parent, {
        ssrRenderableTags: [HOST_TAG],
        props: { title: 'dynamic "t"<&', note: 'N' },
      });
    });

    // The producer ran exactly once with the three canonical channels.
    expect(calls.length).toBe(1);
    const [props, lightChildren, attributes] = calls[0]!;
    // The dynamic property channel is the SSR content input (JS values, never
    // the serialized attribute text).
    expect(props).toEqual({ title: 'dynamic "t"<&', note: 'N' });
    // The light children are the parent's ALREADY-SERIALIZED child markup.
    expect(lightChildren).toBe('<span slot="x">light &amp; child</span>');
    // The canonical attribute pairs: statics first, then prop sinks in part
    // order, values normalized by the ONE value algebra (raw strings here).
    expect(attributes).toEqual([
      ['id', 'gen"<&'],
      ['title', 'dynamic "t"<&'],
      ['note', 'N'],
    ]);

    // The returned producer artifact is the parent element's content: the host
    // tag (attributes escaped by the canonical producer), its DSD template, and
    // the light children AFTER the template for native slot distribution.
    expect(html).toContain(
      '<oe-generated-card id="gen&quot;&lt;&amp;" title="dynamic &quot;t&quot;&lt;&amp;" note="N">' +
        '<template shadowrootmode="open"><article part="card"></article></template>' +
        '<span slot="x">light &amp; child</span></oe-generated-card>',
    );
    expect(html.indexOf('</template>')).toBeLessThan(
      html.indexOf('<span slot="x">light &amp; child</span>'),
    );
  });

  test('static / literal host attributes reach the producer as canonical pairs', () => {
    // The standard SSR shape: no dynamic channel at all, only literal attributes
    // on the nested host. The branch must hand them to the producer (which seeds
    // its content props from them through the canonical conversion) instead of
    // silently dropping them with the missing class program.
    const received: Array<Parameters<HostRenderer>> = [];
    const renderer: HostRenderer = (props, lightChildren, attributes) => {
      received.push([props, lightChildren, attributes]);
      return serializeGeneratedElementHtml({
        tag: HOST_TAG,
        root: 'open',
        content: '<article part="card"></article>',
        ...(lightChildren === '' ? {} : { lightChildren }),
        ...(attributes === undefined ? {} : { attributes }),
      });
    };
    const staticParent = testProgram({
      tag: 'oe-static-parent',
      rootMode: 'shadow-open',
      template: [
        {
          k: 'el',
          tag: HOST_TAG,
          attrs: [
            ['id', 'literal-host'],
            ['title', 'a "b" <c>'],
            ['note', '<script>alert(1)</script>'],
          ],
          children: [],
        },
      ],
      parts: [],
    });
    let html = '';
    withGeneratedRegistry(new Map([[HOST_TAG, renderer]]), () => {
      html = renderToString(compiledClass(staticParent), {
        ssrRenderableTags: [HOST_TAG],
      });
    });

    expect(received.length).toBe(1);
    const [props, , attributes] = received[0]!;
    // No dynamic property sinks were authored: the content channel is empty and
    // the literal attributes are the producer's conversion input.
    expect(props).toEqual({});
    expect(attributes).toEqual([
      ['id', 'literal-host'],
      ['title', 'a "b" <c>'],
      ['note', '<script>alert(1)</script>'],
    ]);
    // Both host-attribute escaping and the producer template placement hold.
    expect(html).toContain('title="a &quot;b&quot; &lt;c&gt;"');
    expect(html).toContain('note="&lt;script&gt;alert(1)&lt;/script&gt;"');
    expect(html).not.toContain('<script>alert(1)</script>');
  });

  test('the admission gate is evaluated inside a live nested branch (non-empty admitted set)', () => {
    // The earlier shape admitted NOTHING, so the serializer never installed the
    // nested callback and the test proved nothing. Here a sibling class-backed
    // tag IS admitted, so the callback exists and actually runs for both
    // children; the generated tag must return undefined from the admission gate
    // without reading the registry table or calling its renderer.
    const SIBLING_TAG = 'oe-admitted-sibling';
    const siblingProgram = testProgram({
      tag: SIBLING_TAG,
      rootMode: 'shadow-open',
      template: [{ k: 'el', tag: 'em', attrs: [], children: [{ k: 'text', value: 'sibling' }] }],
      parts: [],
    });
    const siblingClass = compiledClass(siblingProgram);
    const parent = testProgram({
      tag: 'oe-admission-parent',
      rootMode: 'shadow-open',
      template: [
        {
          k: 'el',
          tag: 'section',
          attrs: [],
          children: [
            { k: 'el', tag: SIBLING_TAG, attrs: [], children: [] },
            { k: 'el', tag: HOST_TAG, attrs: [['id', 'admission-host']], children: [] },
          ],
        },
      ],
      parts: [],
    });
    let rendererCalls = 0;
    const renderer: HostRenderer = () => {
      rendererCalls += 1;
      return '<unexpected></unexpected>';
    };
    const original = Object.getOwnPropertyDescriptor(globalThis, 'customElements');
    const registry: Record<string, unknown> = {
      get: (tag: string) => (tag === SIBLING_TAG ? siblingClass : undefined),
    };
    registry[SSR_REGISTRY_GENERATED_HOSTS] = new Map([[HOST_TAG, renderer]]);
    Object.defineProperty(globalThis, 'customElements', { configurable: true, value: registry });
    let html = '';
    try {
      html = renderToString(compiledClass(parent), { ssrRenderableTags: [SIBLING_TAG] });
    } finally {
      if (original) Object.defineProperty(globalThis, 'customElements', original);
      else delete (globalThis as Record<string, unknown>).customElements;
    }
    // The admitted sibling really went through the live nested branch...
    expect(html).toContain(
      '<oe-admitted-sibling><template shadowrootmode="open"><em>sibling</em></template></oe-admitted-sibling>',
    );
    // ...while the unadmitted generated tag took the fallback and its paired
    // renderer was never invoked.
    expect(rendererCalls).toBe(0);
    expect(html).toContain('<oe-generated-card id="admission-host"></oe-generated-card>');
    expect(html).not.toContain('<unexpected>');
  });

  test('a renderer result that is not a string fails closed with the coded SSR error', () => {
    const renderer = (() => undefined) as unknown as HostRenderer;
    withGeneratedRegistry(new Map([[HOST_TAG, renderer]]), () => {
      let thrown: unknown;
      try {
        renderToString(compiledClass(parentProgram()), {
          ssrRenderableTags: [HOST_TAG],
          props: { title: 't', note: 'n' },
        });
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeDefined();
      expect((thrown as { code?: string }).code).toBe('SSR_RENDER_ERROR');
      expect(String((thrown as Error).message)).toContain(HOST_TAG);
    });
  });

  test('a classless admitted tag with no host pair keeps the existing PROGRAM_MISSING refusal', () => {
    withGeneratedRegistry(new Map(), () => {
      let thrown: unknown;
      try {
        renderToString(compiledClass(parentProgram()), {
          ssrRenderableTags: [HOST_TAG],
          props: { title: 't', note: 'n' },
        });
      } catch (error) {
        thrown = error;
      }
      expect((thrown as { code?: string }).code).toBe('OE_PROGRAM_MISSING');
    });
  });

  test('no SSR registry at all keeps the pre-existing PROGRAM_MISSING refusal', () => {
    withNoRegistry(() => {
      let thrown: unknown;
      try {
        renderToString(compiledClass(parentProgram()), {
          ssrRenderableTags: [HOST_TAG],
          props: { title: 't', note: 'n' },
        });
      } catch (error) {
        thrown = error;
      }
      expect((thrown as { code?: string }).code).toBe('OE_PROGRAM_MISSING');
    });
  });
});

describe('one host-attribute value algebra, two canonical wire spellings', () => {
  test('normalizeHostAttributePairs is the single algebra the class writer wraps', () => {
    // The class serializer's host writer is a thin wrapper over the same
    // normalization: one value algebra, canonical bytes unchanged.
    const host = compiledClass(
      testProgram({
        tag: 'oe-algebra-host',
        rootMode: 'shadow-open',
        template: [{ k: 'el', tag: 'slot', attrs: [], children: [] }],
        parts: [],
      }),
    );
    const html = renderToString('oe-algebra-host', {
      componentClass: host,
      hostAttrs: [
        ['hidden', true],
        ['class', ['a', 'b']],
        ['style', { color: 'red' }],
        ['data-x', false],
        ['tabindex', 3],
      ],
    });
    expect(html).toContain('<oe-algebra-host hidden class="a b" style="color:red" tabindex="3">');
  });

  test('presence is a flag in the one algebra; the typed pair channel spells it empty', () => {
    // The generated host producer channel only accepts string pairs, so the ONE
    // normalized presence flag is handed over as the canonical empty-string
    // pair (the DSD producer's `name=""`), never as a second value algebra.
    const normalized = normalizeHostAttributePairs([
      ['hidden', true],
      ['class', ['a', 'b']],
      ['data-x', false],
    ]);
    expect(normalized.attributes).toEqual([
      { name: 'hidden', value: '', bare: true },
      { name: 'class', value: 'a b', bare: false },
    ]);
    // The lowercased presence ledger keeps the class writer's light-marker guard.
    expect(normalized.names.has('data-x')).toBe(true);
    const pairs = normalized.attributes.map(
      (attribute) => [attribute.name, attribute.bare ? '' : attribute.value] as const,
    );
    expect(pairs).toEqual([
      ['hidden', ''],
      ['class', 'a b'],
    ]);
    // The canonical DSD producer spells the same canonical pair as `name=""`:
    // parsed attribute presence is identical to the class writer's bare `name`.
    const rendered = serializeGeneratedElementHtml({
      tag: HOST_TAG,
      root: 'open',
      content: '',
      attributes: pairs,
    });
    expect(rendered).toContain(' hidden=""');
    expect(rendered).toContain(' class="a b"');
  });
});

describe('host producer property seeding (B2/B3)', () => {
  test('a supplied undefined primitive falls back to the canonical declared default (one projection read)', () => {
    const properties = [
      {
        name: 'label',
        attribute: 'label',
        type: 'string' as const,
        reflect: false,
        default: 'untitled',
      },
    ];
    let reads = 0;
    const props = {
      get label() {
        reads += 1;
        return undefined;
      },
    };
    const seeded = seedGeneratedElementHostProperties(properties, props, undefined);
    // M11-2: the canonical host-attribute projection reads each attribute-backed
    // supplied row exactly ONCE during the seed (it cannot project an attribute
    // without the value); the content record itself stays per-read delegated.
    expect(reads).toBe(1);
    // Reading the seeded row applies the client's canonical undefined->default.
    expect(seeded.label).toBe('untitled');
    expect(reads).toBe(2);
    expect(seeded.label).toBe('untitled');
    // Per-read delegation: a later read reads the supplied getter again.
    expect(reads).toBe(3);
  });

  test('a supplied real primitive wins (one projection read, then per-read delegation)', () => {
    const properties = [
      { name: 'count', attribute: 'count', type: 'number' as const, reflect: false, default: 0 },
    ];
    let reads = 0;
    const props = {
      get count() {
        reads += 1;
        return 7;
      },
    };
    const seeded = seedGeneratedElementHostProperties(properties, props, [['count', '1']]);
    // One canonical projection read during the seed; the supplied prop wins over
    // the attribute wire for both content and the host tag.
    expect(reads).toBe(1);
    expect(seeded.count).toBe(7);
    expect(reads).toBe(2);
  });

  test('only the DECLARED attribute feeds the seed (no lowercased property-name dialect)', () => {
    const properties = [
      {
        name: 'itemCount',
        attribute: 'item-count',
        type: 'number' as const,
        reflect: false,
        default: 0,
      },
    ];
    // The declared attribute is the ONLY match.
    expect(
      seedGeneratedElementHostProperties(properties, undefined, [['item-count', '5']]),
    ).toEqual({
      itemCount: 5,
    });
    // A lowercased property name is NOT the declared attribute: no second dialect.
    expect(seedGeneratedElementHostProperties(properties, undefined, [['itemcount', '5']])).toEqual(
      {
        itemCount: 0,
      },
    );
    // The property key itself is not an attribute channel either.
    expect(seedGeneratedElementHostProperties(properties, undefined, [['itemCount', '5']])).toEqual(
      {
        itemCount: 0,
      },
    );
  });
});

describe('generated-host registry fail-closed (L1)', () => {
  function withClassAndMarker(
    markerValue: unknown,
    run: (calls: { rendererCalls: number }) => void,
  ): void {
    const classProgram = testProgram({
      tag: HOST_TAG,
      rootMode: 'shadow-open',
      template: [{ k: 'el', tag: 'div', attrs: [], children: [] }],
      parts: [],
    });
    const classBackedHost = compiledClass(classProgram);
    const original = Object.getOwnPropertyDescriptor(globalThis, 'customElements');
    const registry: Record<string, unknown> = {
      get: (tag: string) => (tag === HOST_TAG ? classBackedHost : undefined),
    };
    registry[SSR_REGISTRY_GENERATED_HOSTS] = markerValue;
    Object.defineProperty(globalThis, 'customElements', { configurable: true, value: registry });
    try {
      run({ rendererCalls: 0 });
    } finally {
      if (original) Object.defineProperty(globalThis, 'customElements', original);
      else delete (globalThis as Record<string, unknown>).customElements;
    }
  }

  function renderParent(): string {
    return renderToString(compiledClass(parentProgram()), {
      ssrRenderableTags: [HOST_TAG],
      props: { title: 't', note: 'n' },
    });
  }

  test('a marker container that is not a Map fails closed with the existing coded error', () => {
    // Critically: a class-backed path EXISTS for the same tag. The malformed
    // table must fail closed instead of silently falling back to that class.
    withClassAndMarker({}, () => {
      let thrown: unknown;
      try {
        renderParent();
      } catch (error) {
        thrown = error;
      }
      expect((thrown as { code?: string }).code).toBe('OE_PROGRAM_MISSING');
      expect(String((thrown as Error).message)).toContain('generated-host table');
    });
  });

  test('a table entry present with an undefined renderer fails closed', () => {
    withClassAndMarker(new Map([[HOST_TAG, undefined]]), () => {
      let thrown: unknown;
      try {
        renderParent();
      } catch (error) {
        thrown = error;
      }
      expect((thrown as { code?: string }).code).toBe('OE_PROGRAM_MISSING');
      expect(String((thrown as Error).message)).toContain(HOST_TAG);
    });
  });

  test('an absent marker table keeps the pre-existing class path (no false fail-closed)', () => {
    const classProgram = testProgram({
      tag: HOST_TAG,
      rootMode: 'shadow-open',
      template: [{ k: 'el', tag: 'div', attrs: [], children: [] }],
      parts: [],
    });
    const original = Object.getOwnPropertyDescriptor(globalThis, 'customElements');
    const registry: Record<string, unknown> = {
      get: (tag: string) => (tag === HOST_TAG ? compiledClass(classProgram) : undefined),
    };
    Object.defineProperty(globalThis, 'customElements', { configurable: true, value: registry });
    try {
      const html = renderToString(compiledClass(parentProgram()), {
        ssrRenderableTags: [HOST_TAG],
        props: { title: 't', note: 'n' },
      });
      expect(html).toContain('<oe-generated-card');
    } finally {
      if (original) Object.defineProperty(globalThis, 'customElements', original);
      else delete (globalThis as Record<string, unknown>).customElements;
    }
  });
});

// OWED (review L3): streaming/deferred SSR of a generated host is NOT part of
// this slice. The two tests below CHARACTERIZE the current plain-host boundary
// (no nested seam, no producer call, no DSD) so the gap is recorded as owed
// work rather than silently added support. A later, separately approved slice
// owns widening it.
describe('stream boundary (L3 — OWED, characterized not supported)', () => {
  test('the stream executor structurally refuses nested-renderer options', () => {
    // This slice adds NO stream support for generated hosts (OWED, L3). The
    // deferred executor already refuses the nested-renderer seam (and closed
    // roots / projections) at admission; this test records that boundary so a
    // later slice cannot silently route a generated host through streaming.
    const program = testProgram({
      tag: 'oe-stream-probe',
      rootMode: 'shadow-open',
      template: [{ k: 'el', tag: 'div', attrs: [], children: [] }],
      parts: [],
    });
    const owner = { program, version: PART_PROGRAM_VERSION, instanceId: 'stream-instance' };
    expect(() =>
      createStreamServerExecutor(
        program,
        {},
        { owner, pendingParts: [] },
        { renderNestedElement: () => undefined },
      ),
    ).toThrow(/no opaque nested renderer/);
  });

  test('a streamed component serves a generated host as plain markup (no producer, no DSD) — OWED boundary', async () => {
    // Deferred/streamed components never install the nested seam, so an
    // admitted generated host inside one degrades to its plain tag markup: no
    // DSD, no producer call. This test pins the KNOWN, OWED boundary (review L3)
    // so a later slice cannot mistake the current state for stream support.
    const streamProgram = testProgram({
      tag: 'oe-stream-parent',
      rootMode: 'shadow-open',
      template: [
        {
          k: 'el',
          tag: 'section',
          attrs: [],
          children: [
            { k: 'el', tag: HOST_TAG, attrs: [['id', 'stream-host']], children: [] },
            { k: 'el', tag: 'p', attrs: [], children: [{ k: 'part', index: 0 }] },
          ],
        },
      ],
      parts: [{ k: 'text', index: 0, signal: 'title' }],
      properties: [
        {
          name: 'title',
          attribute: null,
          type: 'string',
          converter: 'string',
          reflect: false,
          default: 'default',
        },
      ],
    });
    let producerCalls = 0;
    const original = Object.getOwnPropertyDescriptor(globalThis, 'customElements');
    const registry: Record<string, unknown> = { get: () => undefined };
    registry[SSR_REGISTRY_GENERATED_HOSTS] = new Map([
      [
        HOST_TAG,
        () => {
          producerCalls += 1;
          return '<unexpected-host></unexpected-host>';
        },
      ],
    ]);
    Object.defineProperty(globalThis, 'customElements', { configurable: true, value: registry });
    try {
      const { sourceMap: _sourceMap, ...wireProgram } = streamProgram;
      const digest = await crypto.subtle.digest(
        'SHA-256',
        new TextEncoder().encode(JSON.stringify(wireProgram)),
      );
      const manifest: StreamShellManifest = {
        program: {
          version: streamProgram.version,
          tag: streamProgram.tag,
          sha256: [...new Uint8Array(digest)]
            .map((byte) => byte.toString(16).padStart(2, '0'))
            .join(''),
        },
        fields: [{ field: 'title', signal: 'title', owners: [{ kind: 'part', index: 0 }] }],
      };
      class StreamPage {}
      Object.assign(StreamPage, {
        __partProgram: streamProgram,
        __compiledProperties: streamProgram.metadata.properties,
      });
      const bridge = await createStreamShellExecutor({
        componentClass: StreamPage as unknown as CustomElementConstructor,
        manifest,
        instanceId: 'stream-boundary',
      });
      // Plain tag markup inside the shell; the generated host producer is never
      // reached and no nested DSD artifact is produced.
      expect(bridge.shell).toContain('<oe-generated-card id="stream-host"></oe-generated-card>');
      expect(bridge.shell.includes('<oe-generated-card id="stream-host"><template')).toBe(false);
      expect(producerCalls).toBe(0);
    } finally {
      if (original) Object.defineProperty(globalThis, 'customElements', original);
      else delete (globalThis as Record<string, unknown>).customElements;
    }
  });
});

/**
 * M09-2e / #1803: the nested renderer hands a generated SHADOW host the
 * per-island stylesheet URLs recorded for its tag, and the emitted host
 * producer declares them INSIDE the canonical DSD template. A resolved carrier
 * is passed through the SAME typed channel; the `null` state (declared but
 * unavailable, e.g. the dev server) fails closed instead of rendering the
 * island silently unstyled.
 */
describe('M09-2e generated-host stylesheet carrier', () => {
  // The same nested parent as the suite above: it already hosts HOST_TAG with
  // a static attribute, a dynamic property channel and a slotted light child.
  const STYLED_TAG = HOST_TAG;
  const styledProgram = parentProgram;

  test('a resolved island carrier reaches the host producer as the typed styleLinks channel', () => {
    const emitted: Array<readonly string[] | undefined> = [];
    const renderer: HostRenderer = (props, lightChildren, attributes, styleLinks) => {
      emitted.push(styleLinks);
      return serializeGeneratedElementHtml({
        tag: STYLED_TAG,
        root: 'open',
        content: '<article part="card"></article>',
        ...(styleLinks === undefined ? {} : { styleLinks }),
      });
    };

    let html = '';
    __setRequestTimeStyleSheetUrls(null, [[STYLED_TAG, ['/client/assets/styled.css']]]);
    try {
      withGeneratedRegistry(new Map([[STYLED_TAG, renderer]]), () => {
        html = renderToString(compiledClass(styledProgram()), {
          ssrRenderableTags: [STYLED_TAG],
        });
      });
    } finally {
      __setRequestTimeStyleSheetUrls(null);
    }

    expect(emitted).toEqual([['/client/assets/styled.css']]);
    // Exactly one canonical marked link, inside the template, before the
    // authored content — the claim's prefix walk has exactly this shape.
    expect(
      html.match(
        /<link rel="stylesheet" href="\/client\/assets\/styled\.css" data-oe-static-styles \/>/g,
      )?.length,
    ).toBe(1);
    const templateOpen = html.indexOf('<template shadowrootmode="open">');
    const link = html.indexOf('<link rel="stylesheet"');
    const content = html.indexOf('<article part="card">');
    expect(templateOpen).toBeGreaterThan(-1);
    expect(link).toBeGreaterThan(templateOpen);
    expect(content).toBeGreaterThan(link);
  });

  test('the explicit unavailable carrier fails closed instead of rendering unstyled', () => {
    const renderer: HostRenderer = (props, lightChildren, attributes, styleLinks) =>
      serializeGeneratedElementHtml({
        tag: STYLED_TAG,
        root: 'open',
        content: '<article part="card"></article>',
        ...(styleLinks === undefined ? {} : { styleLinks }),
      });

    __setRequestTimeStyleSheetUrls(null, [[STYLED_TAG, null]]);
    try {
      withGeneratedRegistry(new Map([[STYLED_TAG, renderer]]), () => {
        expect(() =>
          renderToString(compiledClass(styledProgram()), { ssrRenderableTags: [STYLED_TAG] }),
        ).toThrow(/declares IslandConfig\.styles on a shadow root/);
      });
    } finally {
      __setRequestTimeStyleSheetUrls(null);
    }
  });
});
