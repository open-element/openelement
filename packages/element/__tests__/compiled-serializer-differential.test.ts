/**
 * Differential parity harness for the shared serialization kernel (issue
 * #1469, ADR-0160 rule b).
 *
 * The kernel (`internal/compiled/serializer/serialize-program.ts`) is the one
 * tree-walking serializer; the server and runtime-seed entry points delegate
 * to it. Until the pre-kernel walkers are retired, this harness replays the
 * full program corpus through BOTH implementations of each entry point and
 * requires byte-identical output (or byte-identical failures). The corpus
 * covers static and dynamic attributes, boolean/class/style sinks, property
 * JSON serialization, void tags, when/each Regions, nested Regions, item
 * slots (ival/iattrs), slot projection, trusted HTML, unsafe-program
 * rejections, DSD root modes, nested custom elements, and streamed pending
 * seeds. It retires together with the legacy walkers it diffs against.
 */

import { assertEquals } from '@std/assert';
import { serializeToHtml, serializeToHtmlLegacy } from '../src/internal/compiled/runtime.ts';
import type { CompiledRuntimeHost } from '../src/internal/compiled/runtime.ts';
import {
  type CompiledServerOptions,
  createDeferredServerExecutor,
  createDeferredServerExecutorLegacy,
  serializeCompiledProgram,
  serializeCompiledProgramLegacy,
  serializeProgramContent,
  serializeProgramContentLegacy,
} from '../src/internal/compiled/server/index.ts';
import type { PartProgramV1, ProgramElementNode } from '../src/internal/protocol/part-program.ts';
import { escapeAttr } from '../src/internal/core/html-escape.ts';
import { escapeText } from '../src/internal/compiled/escape-text.ts';
import { trustedHtml } from '../src/internal/core/security.ts';
import { testProgram } from './compiled-runtime/test-program.ts';

type RuntimeHost = Parameters<typeof serializeToHtmlLegacy>[1];

function hostWith(signals: Record<string, unknown>): RuntimeHost {
  const wrapped: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(signals)) {
    wrapped[name] = { value, subscribe: () => () => {} };
  }
  return { signals: wrapped, handlers: {} } as unknown as RuntimeHost;
}

function serverHost(signals: Record<string, unknown>) {
  return hostWith(signals) as unknown as Parameters<typeof serializeProgramContent>[1];
}

/** Old vs new seed serializer must agree byte for byte (or fail identically). */
function expectSeedParity(program: PartProgramV1, host: RuntimeHost): string {
  let legacy: string | undefined;
  let legacyError: unknown;
  try {
    legacy = serializeToHtmlLegacy(program, host);
  } catch (error) {
    legacyError = error;
  }
  if (legacyError !== undefined || legacy === undefined) {
    let kernelError: unknown;
    try {
      serializeToHtml(program, host);
    } catch (error) {
      kernelError = error;
    }
    assertEquals(
      (kernelError as Error | undefined)?.message,
      (legacyError as Error).message,
      'seed serializers diverged on a rejection',
    );
    return '<threw>';
  }
  const kernel = serializeToHtml(program, host);
  assertEquals(kernel, legacy, 'seed serializers diverged on output bytes');
  return kernel;
}

/** Old vs new server serializer must agree byte for byte (or fail identically). */
function expectServerParity(
  program: PartProgramV1,
  host: unknown,
  options?: CompiledServerOptions,
): string {
  let legacy: string | undefined;
  let legacyError: unknown;
  try {
    legacy = serializeCompiledProgramLegacy(program, host, options);
  } catch (error) {
    legacyError = error;
  }
  if (legacyError !== undefined || legacy === undefined) {
    let kernelError: unknown;
    try {
      serializeCompiledProgram(program, host, options);
    } catch (error) {
      kernelError = error;
    }
    assertEquals(
      (kernelError as Error | undefined)?.message,
      (legacyError as Error).message,
      'server serializers diverged on a rejection',
    );
    return '<threw>';
  }
  const kernel = serializeCompiledProgram(program, host, options);
  assertEquals(
    kernel,
    legacy,
    `server serializers diverged for options ${JSON.stringify(options ?? {})}`,
  );
  assertEquals(
    serializeProgramContent(program, host),
    serializeProgramContentLegacy(program, host),
    'server content serializers diverged on output bytes',
  );
  return kernel;
}

function expectThrowsMessage(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    return (error as Error).message;
  }
  throw new Error('expected the call to throw');
}

function forgedProgram(
  base: PartProgramV1,
  mutate: (root: ProgramElementNode) => void,
): PartProgramV1 {
  const clone = structuredClone(base);
  const root = clone.template[0];
  if (root.k !== 'el') throw new Error('test setup: expected an element root');
  mutate(root);
  return clone;
}

// ─── Corpus programs ────────────────────────────────────────────────

const ESCAPE_CORPUS: readonly string[] = [
  `a&b"c<d>e'f`,
  `'`,
  `<`,
  `>`,
  `"`,
  `&`,
  `&quot;entity-looking&quot;`,
  `plain`,
  `line\nbreak\ttab`,
  `unicode é ‹› „ “`,
  `</script><script>alert(1)</script>`,
];

const MIXED_SINKS_PROGRAM = testProgram({
  tag: 'oe-mixed-sinks',
  template: [{
    k: 'el',
    tag: 'div',
    attrs: [['data-static', 'yes']],
    children: [
      { k: 'el', tag: 'input', attrs: [], children: [] },
      { k: 'el', tag: 'button', attrs: [], children: [{ k: 'text', value: 'go' }] },
    ],
  }],
  parts: [
    { k: 'attr', index: 0, signal: 'title', name: 'title', path: [0] },
    { k: 'prop', index: 1, signal: 'value', name: 'value', path: [0, 0] },
    { k: 'bool', index: 2, signal: 'disabled', name: 'disabled', path: [0, 0] },
    { k: 'class', index: 3, signal: 'classes', path: [0] },
    { k: 'style', index: 4, signal: 'styles', path: [0] },
  ],
});

const MIXED_HOST_STATES: Array<Record<string, unknown>> = [
  {
    title: 'initial',
    value: 'ready',
    disabled: false,
    classes: { selected: true, active: true },
    styles: { display: 'block', color: 'red' },
  },
  { title: null, value: '', disabled: true, classes: ['a', 'b'], styles: '--accent:red' },
  {
    title: undefined,
    value: 0,
    disabled: 'yes',
    classes: 'single',
    styles: ['color:blue', 'margin:0'],
  },
  {
    title: 'x&"',
    value: { deep: true },
    disabled: 0,
    classes: { dropped: false, kept: true },
    styles: null,
  },
];

const VOID_PROGRAM = testProgram({
  tag: 'oe-void-tags',
  template: [
    { k: 'el', tag: 'br', attrs: [], children: [] },
    { k: 'el', tag: 'img', attrs: [['alt', 'static']], children: [] },
    { k: 'el', tag: 'input', attrs: [], children: [] },
    { k: 'el', tag: 'hr', attrs: [['data-x', 'a&"']], children: [] },
  ],
  parts: [
    { k: 'attr', index: 0, signal: 'src', name: 'src', path: [1] },
    { k: 'bool', index: 1, signal: 'required', name: 'required', path: [2] },
    { k: 'attr', index: 2, signal: 'label', name: 'aria-label', path: [3] },
  ],
});

const SINK_ORDER_PROGRAM = testProgram({
  tag: 'oe-sink-order',
  template: [{ k: 'el', tag: 'input', attrs: [], children: [] }],
  parts: [
    { k: 'prop', index: 0, signal: 'value', name: 'value', path: [0] },
    { k: 'bool', index: 1, signal: 'disabled', name: 'disabled', path: [0] },
  ],
});

const PROP_JSON_PROGRAM = testProgram({
  tag: 'oe-prop-json',
  template: [{ k: 'el', tag: 'oe-child', attrs: [], children: [] }],
  parts: [
    { k: 'prop', index: 0, signal: 'model', name: 'model', path: [0] },
    { k: 'prop', index: 1, signal: 'count', name: 'count', path: [0] },
  ],
});

const WHEN_PROGRAM = testProgram({
  tag: 'oe-when-modes',
  template: [
    { k: 'el', tag: 'p', attrs: [], children: [{ k: 'part', index: 0 }] },
    { k: 'el', tag: 'section', attrs: [], children: [{ k: 'part', index: 1 }] },
  ],
  parts: [
    {
      k: 'when',
      index: 0,
      signal: 'count',
      test: { signal: 'count', op: 'greater-than', value: 0 },
      on: [{ k: 'text', value: 'positive <&>' }],
      off: [{
        k: 'el',
        tag: 'em',
        attrs: [['title', 'a&"']],
        children: [{ k: 'text', value: 'zero' }],
      }],
    },
    {
      k: 'when',
      index: 1,
      signal: 'enabled',
      test: { signal: 'enabled', op: 'truthy', value: true },
      on: [{ k: 'el', tag: 'strong', attrs: [], children: [{ k: 'text', value: 'on' }] }],
      off: [],
    },
  ],
});

const NESTED_REGION_PROGRAM = testProgram({
  tag: 'oe-nested-regions',
  template: [{
    k: 'el',
    tag: 'div',
    attrs: [],
    children: [
      { k: 'part', index: 0 },
      { k: 'part', index: 1 },
      { k: 'el', tag: 'ul', attrs: [], children: [{ k: 'part', index: 2 }] },
    ],
  }],
  parts: [
    {
      k: 'when',
      index: 0,
      signal: 'visible',
      test: { signal: 'visible', op: 'greater-than', value: 0 },
      on: [
        { k: 'text', value: 'hello <&>' },
        {
          k: 'el',
          tag: 'p',
          attrs: [['class', 'nested']],
          children: [{ k: 'text', value: 'nested' }],
        },
      ],
      off: [{ k: 'text', value: 'off' }],
    },
    {
      k: 'when',
      index: 1,
      signal: 'deep',
      test: { signal: 'deep', op: 'equals', value: 'yes' },
      on: [{ k: 'el', tag: 'strong', attrs: [], children: [{ k: 'text', value: 'deep-on' }] }],
      off: [],
    },
    {
      k: 'each',
      index: 2,
      signal: 'items',
      key: 'id',
      field: 'text',
      item: [{ k: 'el', tag: 'li', attrs: [], children: [{ k: 'ival', field: 'text' }] }],
    },
  ],
});

const MULTI_FIELD_PROGRAM = testProgram({
  tag: 'oe-multi-field',
  template: [{ k: 'part', index: 0 }],
  parts: [{
    k: 'each',
    index: 0,
    signal: 'rows',
    key: 'id',
    item: [{
      k: 'el',
      tag: 'li',
      attrs: [],
      iattrs: [['data-kind', 'kind']],
      children: [
        { k: 'ival', field: 'name' },
        { k: 'text', value: ' / ' },
        { k: 'ival', field: 'count' },
      ],
    }],
  }],
});

const IATTR_PROGRAM = testProgram({
  tag: 'oe-iattrs',
  template: [{
    k: 'el',
    tag: 'ul',
    attrs: [],
    children: [{ k: 'part', index: 0 }],
  }],
  parts: [{
    k: 'each',
    index: 0,
    signal: 'rows',
    key: 'id',
    field: 'label',
    item: [{
      k: 'el',
      tag: 'a',
      attrs: [['href', '/next?x=1&y=2']],
      iattrs: [['title', 'label'], ['data-on', 'flag']],
      children: [{ k: 'ival', field: 'label' }],
    }],
  }],
});

const TRUSTED_HTML_PROGRAM = testProgram({
  tag: 'oe-trusted-html',
  template: [{ k: 'el', tag: 'div', attrs: [], children: [] }],
  parts: [{ k: 'html', index: 0, signal: 'body', path: [0] }],
});

const UNSAFE_PROGRAMS: Array<[string, PartProgramV1]> = [
  [
    'script tag',
    forgedProgram(
      testProgram({
        tag: 'oe-unsafe-script',
        template: [{ k: 'el', tag: 'p', attrs: [], children: [{ k: 'text', value: 'x' }] }],
        parts: [],
      }),
      (root) => {
        root.tag = 'script';
      },
    ),
  ],
  [
    'srcdoc attribute',
    forgedProgram(
      testProgram({
        tag: 'oe-unsafe-srcdoc',
        template: [{ k: 'el', tag: 'p', attrs: [['title', 'ok']], children: [] }],
        parts: [],
      }),
      (root) => {
        root.attrs = [['srcdoc', '<p>forged</p>']];
      },
    ),
  ],
  [
    'event handler attribute',
    forgedProgram(
      testProgram({
        tag: 'oe-unsafe-onclick',
        template: [{ k: 'el', tag: 'p', attrs: [['title', 'ok']], children: [] }],
        parts: [],
      }),
      (root) => {
        root.attrs = [['onclick', 'alert(1)']];
      },
    ),
  ],
];

const COMPOSED_PROGRAM = testProgram({
  tag: 'oe-composed-parent',
  rootMode: 'shadow-open',
  template: [{
    k: 'el',
    tag: 'oe-rail',
    attrs: [['data-owner', 'demo']],
    children: [
      {
        k: 'el',
        tag: 'span',
        attrs: [['slot', 'meta']],
        children: [{ k: 'text', value: 'Projected' }],
      },
      { k: 'el', tag: 'x-third-party', attrs: [], children: [{ k: 'text', value: 'foreign' }] },
    ],
  }, {
    k: 'el',
    tag: 'slot',
    attrs: [['name', 'meta']],
    children: [{ k: 'text', value: 'Fallback meta' }],
  }, {
    k: 'el',
    tag: 'slot',
    attrs: [],
    children: [{ k: 'text', value: 'Fallback body' }],
  }],
  parts: [],
});

const NESTED_ITEM_PROGRAM = testProgram({
  tag: 'oe-nested-items',
  template: [{ k: 'part', index: 0 }],
  parts: [{
    k: 'each',
    index: 0,
    signal: 'rows',
    key: 'id',
    item: [{
      k: 'el',
      tag: 'oe-rail',
      attrs: [['data-row', 'static']],
      iattrs: [['data-id', 'id']],
      children: [{ k: 'el', tag: 'span', attrs: [], children: [{ k: 'ival', field: 'label' }] }],
    }],
  }],
});

const DEFERRED_PROGRAM = testProgram({
  tag: 'oe-stream-page',
  template: [{
    k: 'el',
    tag: 'main',
    attrs: [],
    children: [
      { k: 'text', value: 'Before ' },
      { k: 'part', index: 0 },
      { k: 'el', tag: 'section', attrs: [], children: [{ k: 'part', index: 1 }] },
      { k: 'part', index: 2 },
      { k: 'text', value: ' After' },
    ],
  }],
  parts: [
    { k: 'text', index: 0, signal: 'title' },
    {
      k: 'when',
      index: 1,
      signal: 'enabled',
      test: { signal: 'enabled', op: 'truthy', value: true },
      on: [{
        k: 'el',
        tag: 'strong',
        attrs: [['title', 'a&"']],
        children: [{ k: 'text', value: 'Ready <&>' }],
      }],
      off: [{ k: 'text', value: 'Off & waiting' }],
    },
    {
      k: 'each',
      index: 2,
      signal: 'items',
      key: 'id',
      item: [{
        k: 'el',
        tag: 'a',
        attrs: [['href', '/next?x=1&y=2']],
        iattrs: [['title', 'label']],
        children: [{ k: 'ival', field: 'label' }],
      }],
    },
  ],
});

async function fixtureProgram(): Promise<PartProgramV1> {
  const url = new URL('../__fixtures__/compiled-claim/program.json', import.meta.url);
  return JSON.parse(await Deno.readTextFile(url)) as PartProgramV1;
}

// ─── Shared walkers: escaping and static/dynamic sinks ──────────────

Deno.test('differential: escaping corpus is byte-identical through both implementations', () => {
  for (const value of ESCAPE_CORPUS) {
    const program = testProgram({
      tag: 'oe-diff-escape',
      template: [{ k: 'el', tag: 'div', attrs: [], children: [{ k: 'text', value }] }],
      parts: [{ k: 'attr', index: 0, signal: 'v', name: 'title', path: [0] }],
    });
    const host = hostWith({ v: value });
    const html = expectSeedParity(program, host);
    expectServerParity(program, serverHost({ v: value }));
    assertEquals(html, `<div title="${escapeAttr(value)}">${escapeText(value)}</div>`);
  }
});

Deno.test('differential: mixed attr/prop/bool/class/style sinks across host states', () => {
  for (const signals of MIXED_HOST_STATES) {
    expectSeedParity(MIXED_SINKS_PROGRAM, hostWith(signals));
    expectServerParity(MIXED_SINKS_PROGRAM, serverHost(signals));
  }
});

Deno.test('differential: boolean presence diverges per mode and stays byte-stable', () => {
  for (const disabled of [true, false, 'truthy-string', 0]) {
    const signals = { value: 'ready', disabled };
    const seed = expectSeedParity(SINK_ORDER_PROGRAM, hostWith(signals));
    const server = expectServerParity(SINK_ORDER_PROGRAM, serverHost(signals));
    const inner = disabled ? '<input value="ready" disabled="">' : '<input value="ready">';
    const serverInner = disabled ? '<input disabled value="ready">' : '<input value="ready">';
    assertEquals(seed, inner);
    assertEquals(
      server,
      `<oe-sink-order><template shadowrootmode="open">${serverInner}</template></oe-sink-order>`,
    );
  }
});

Deno.test('differential: void tags carry attributes and sinks identically', () => {
  for (
    const signals of [
      { src: '/a.png', required: true, label: 'rule' },
      { src: null, required: false, label: null },
    ]
  ) {
    expectSeedParity(VOID_PROGRAM, hostWith(signals));
    expectServerParity(VOID_PROGRAM, serverHost(signals));
  }
});

Deno.test('differential: property serialization spans JSON, String, and rejection paths', () => {
  for (
    const signals of [
      { model: { title: 'safe & exact', items: [1, 2] }, count: 3 },
      { model: [1, 'two', null], count: 0 },
      { model: 'plain & <string>', count: -1.5 },
      { model: true, count: false },
      // undefined carries no JSON representation: the server mode fails
      // closed, the seed mode drops the unserializable attribute.
      { model: undefined, count: 1 },
      { model: BigInt(2), count: 1 },
    ]
  ) {
    expectSeedParity(PROP_JSON_PROGRAM, hostWith(signals));
    expectServerParity(PROP_JSON_PROGRAM, serverHost(signals));
  }
});

// ─── Shared walkers: Regions and item slots ─────────────────────────

Deno.test('differential: when Regions select branches byte-identically', () => {
  for (
    const signals of [
      { count: 1, enabled: true },
      { count: 0, enabled: false },
      { count: '5', enabled: 'truthy' },
    ]
  ) {
    expectSeedParity(WHEN_PROGRAM, hostWith(signals));
    expectServerParity(WHEN_PROGRAM, serverHost(signals));
  }
});

Deno.test('differential: nested Regions and keyed item lists stay byte-identical', () => {
  for (
    const signals of [
      {
        visible: true,
        deep: 'yes',
        items: [{ id: 'a', text: 'alpha' }, { id: 'b', text: 'beta' }],
      },
      { visible: false, deep: 'no', items: [] },
      { visible: true, deep: null, items: [{ id: 'a', text: '' }] },
    ]
  ) {
    expectSeedParity(NESTED_REGION_PROGRAM, hostWith(signals));
    expectServerParity(NESTED_REGION_PROGRAM, serverHost(signals));
  }
});

Deno.test("differential: multi-field item templates keep each walker's slot semantics", () => {
  const signals = {
    rows: [
      { id: 'a', name: 'A & B', count: 1, kind: 'x' },
      { id: 'b', name: '<C>', count: 0, kind: 'y' },
    ],
  };
  const seed = expectSeedParity(MULTI_FIELD_PROGRAM, hostWith(signals));
  const server = expectServerParity(MULTI_FIELD_PROGRAM, serverHost(signals));
  // The seed path renders the whole item where the Region restates no field;
  // the server path renders each slot's own field. Both contracts stay pinned.
  assertEquals(
    seed,
    '<!--oe:p0--><li data-kind="x">[object Object] / [object Object]</li>' +
      '<li data-kind="y">[object Object] / [object Object]</li><!--oe:/p0-->',
  );
  assertEquals(
    server,
    '<oe-multi-field><template shadowrootmode="open"><!--oe:p0--><li data-kind="x">A &amp; B / 1</li>' +
      '<li data-kind="y">&lt;C&gt; / 0</li><!--oe:/p0--></template></oe-multi-field>',
  );
});

Deno.test('differential: item attribute slots keep presence and omission semantics', () => {
  const signals = {
    rows: [
      { id: 'a', label: `A<&"'`, flag: true },
      { id: 'b', label: 'plain', flag: false },
      { id: 'c', label: '', flag: 'text' },
    ],
  };
  const seed = expectSeedParity(IATTR_PROGRAM, hostWith(signals));
  const server = expectServerParity(IATTR_PROGRAM, serverHost(signals));
  assertEquals(
    seed,
    '<ul><!--oe:p0--><a href="/next?x=1&amp;y=2" title="A&lt;&amp;&quot;&#39;" data-on="">A&lt;&amp;"\'</a>' +
      '<a href="/next?x=1&amp;y=2" title="plain">plain</a>' +
      '<a href="/next?x=1&amp;y=2" title="" data-on="text"></a><!--oe:/p0--></ul>',
  );
  assertEquals(
    server,
    '<oe-iattrs><template shadowrootmode="open"><ul><!--oe:p0--><a href="/next?x=1&amp;y=2" title="A&lt;&amp;&quot;&#39;" data-on>A&lt;&amp;"\'</a>' +
      '<a href="/next?x=1&amp;y=2" title="plain">plain</a>' +
      '<a href="/next?x=1&amp;y=2" title data-on="text"></a><!--oe:/p0--></ul></template></oe-iattrs>',
  );
});

Deno.test('differential: list admission failures match per walker', () => {
  const notArray = { rows: 'nope' };
  assertEquals(
    expectThrowsMessage(() => serializeToHtml(NESTED_REGION_PROGRAM, hostWith(notArray))),
    expectThrowsMessage(() => serializeToHtmlLegacy(NESTED_REGION_PROGRAM, hostWith(notArray))),
  );
  assertEquals(
    expectThrowsMessage(() => serializeProgramContent(NESTED_REGION_PROGRAM, serverHost(notArray))),
    expectThrowsMessage(() =>
      serializeProgramContentLegacy(NESTED_REGION_PROGRAM, serverHost(notArray))
    ),
  );
  const duplicate = { rows: [{ id: 'a', text: 'one' }, { id: 'a', text: 'two' }] };
  assertEquals(
    expectThrowsMessage(() =>
      serializeProgramContent(NESTED_REGION_PROGRAM, serverHost(duplicate))
    ),
    expectThrowsMessage(() =>
      serializeProgramContentLegacy(NESTED_REGION_PROGRAM, serverHost(duplicate))
    ),
  );
  // The seed path renders order-preserving without keying.
  expectSeedParity(NESTED_REGION_PROGRAM, hostWith(duplicate));
});

// ─── Shared walkers: trusted HTML and unsafe programs ───────────────

Deno.test('differential: trusted HTML is required and rendered verbatim', () => {
  const trusted = { body: trustedHtml('<strong>safe & <em>deep</em></strong>') };
  expectSeedParity(TRUSTED_HTML_PROGRAM, hostWith(trusted));
  expectServerParity(TRUSTED_HTML_PROGRAM, serverHost(trusted));
  const untrusted = { body: '<strong>unsafe</strong>' };
  assertEquals(
    expectThrowsMessage(() => serializeToHtml(TRUSTED_HTML_PROGRAM, hostWith(untrusted))),
    expectThrowsMessage(() => serializeToHtmlLegacy(TRUSTED_HTML_PROGRAM, hostWith(untrusted))),
  );
  assertEquals(
    expectThrowsMessage(() => serializeProgramContent(TRUSTED_HTML_PROGRAM, serverHost(untrusted))),
    expectThrowsMessage(() =>
      serializeProgramContentLegacy(TRUSTED_HTML_PROGRAM, serverHost(untrusted))
    ),
  );
});

Deno.test('differential: unsafe programs are rejected with identical diagnostics', () => {
  for (const [name, program] of UNSAFE_PROGRAMS) {
    assertEquals(
      expectThrowsMessage(() => serializeProgramContent(program, serverHost({}))),
      expectThrowsMessage(() => serializeProgramContentLegacy(program, serverHost({}))),
      name,
    );
    assertEquals(
      expectThrowsMessage(() => serializeToHtml(program, hostWith({}))),
      expectThrowsMessage(() => serializeToHtmlLegacy(program, hostWith({}))),
      name,
    );
  }
});

// ─── Server artifact: DSD modes, projection, nested elements ────────

Deno.test('differential: DSD root modes and host artifacts are byte-identical', () => {
  const host = serverHost(MIXED_HOST_STATES[0]);
  for (const mode of ['light', 'open', 'closed'] as const) {
    expectServerParity(MIXED_SINKS_PROGRAM, host, { mode });
    expectServerParity(MIXED_SINKS_PROGRAM, host, {
      mode,
      hostAttrs: [['data-id', 'a&"'], ['aria-label', 'card']],
      dsd: {
        delegatesFocus: true,
        clonable: true,
        serializable: true,
        slotAssignment: 'manual',
        customElementRegistry: true,
      },
      styleCss: mode === 'light' ? '.card { color: rebeccapurple; }' : '',
    });
  }
});

Deno.test('differential: slot projection consumes once and validates leftovers', () => {
  const projected = new Map(Object.entries({
    meta: '<span slot="meta">Projected</span>',
    '': '<p>default body</p>',
  }));
  const html = expectServerParity(COMPOSED_PROGRAM, serverHost({}), {
    mode: 'open',
    projectedChildren: projected,
  });
  assertEquals(html.includes('Fallback meta'), false);
  assertEquals(html.includes('Fallback body'), false);
  const missing = new Map([['orphan', '<p>lost</p>']]);
  assertEquals(
    expectThrowsMessage(() =>
      serializeCompiledProgram(COMPOSED_PROGRAM, serverHost({}), {
        mode: 'open',
        projectedChildren: missing,
      })
    ),
    expectThrowsMessage(() =>
      serializeCompiledProgramLegacy(COMPOSED_PROGRAM, serverHost({}), {
        mode: 'open',
        projectedChildren: missing,
      })
    ),
  );
});

Deno.test('differential: nested custom elements receive identical seam payloads', () => {
  const renderNested = (element: {
    tag: string;
    attributes: ReadonlyArray<readonly [string, unknown]>;
    properties: Readonly<Record<string, unknown>>;
    children: string;
    projectedChildren: ReadonlyMap<string, string>;
  }) =>
    `<rendered tag="${element.tag}" attrs="${
      JSON.stringify(element.attributes).replaceAll('"', '&quot;')
    }" props="${JSON.stringify(element.properties).replaceAll('"', '&quot;')}" projected="${
      JSON.stringify([...element.projectedChildren]).replaceAll('"', '&quot;')
    }">${element.children}</rendered>`;
  const withRenderer: CompiledServerOptions = { mode: 'open', renderNestedElement: renderNested };
  const host = serverHost({
    rows: [{ id: 'a', label: 'A & B' }],
    model: { deep: [1, 2] },
    count: 1,
  });
  expectServerParity(COMPOSED_PROGRAM, host, withRenderer);
  expectServerParity(NESTED_ITEM_PROGRAM, host, withRenderer);
  expectServerParity(PROP_JSON_PROGRAM, host, withRenderer);
  const withoutRenderer: CompiledServerOptions = { mode: 'open' };
  expectServerParity(COMPOSED_PROGRAM, host, withoutRenderer);
  expectServerParity(NESTED_ITEM_PROGRAM, host, withoutRenderer);
});

// ─── Streamed pending seeds ─────────────────────────────────────────

Deno.test('differential: deferred executor shells and resolved frames are byte-identical', () => {
  const values = {
    title: '<hello & "world">',
    enabled: true,
    items: [{ id: 'one', label: `A<&"'` }],
  };
  const pendingSignal = {
    get value(): never {
      throw new Error('pending read');
    },
    subscribe: () => () => {},
  };
  const fast = serverHost({ title: values.title, enabled: pendingSignal, items: pendingSignal });
  const owner = { program: DEFERRED_PROGRAM, version: 1, instanceId: 'instance-1' };
  const makeExecutor = (
    create: typeof createDeferredServerExecutor | typeof createDeferredServerExecutorLegacy,
  ) =>
    create(
      DEFERRED_PROGRAM,
      fast,
      { owner, pendingParts: [0, 1, 2] },
      { mode: 'light' },
    );
  const legacyExecutor = makeExecutor(createDeferredServerExecutorLegacy);
  const kernelExecutor = makeExecutor(createDeferredServerExecutor);
  assertEquals(kernelExecutor.shell, legacyExecutor.shell);
  assertEquals(
    kernelExecutor.serializeResolved(owner, 0, values.title),
    legacyExecutor.serializeResolved(owner, 0, values.title),
  );
  assertEquals(
    kernelExecutor.serializeResolved(owner, 1, true),
    legacyExecutor.serializeResolved(owner, 1, true),
  );
  assertEquals(
    kernelExecutor.serializeResolved(owner, 2, values.items),
    legacyExecutor.serializeResolved(owner, 2, values.items),
  );
  assertEquals(
    expectThrowsMessage(() => kernelExecutor.serializeResolved(owner, 999, 'x')),
    expectThrowsMessage(() => legacyExecutor.serializeResolved(owner, 999, 'x')),
  );
  const resolvedHost = serverHost(values);
  const legacyFull = createDeferredServerExecutorLegacy(
    DEFERRED_PROGRAM,
    resolvedHost,
    { owner, pendingParts: [1] },
    { mode: 'light' },
  );
  const kernelFull = createDeferredServerExecutor(
    DEFERRED_PROGRAM,
    resolvedHost,
    { owner, pendingParts: [1] },
    { mode: 'light' },
  );
  assertEquals(kernelFull.shell, legacyFull.shell);
});

// ─── Shared fixture corpus ──────────────────────────────────────────

Deno.test('differential: the shared compiled-claim fixture is byte-identical', async () => {
  const program = await fixtureProgram();
  const signals = {
    count: 0,
    label: 'ready',
    items: [{ id: 'a', text: 'alpha' }, { id: 'b', text: 'beta' }],
  };
  expectSeedParity(program, hostWith(signals));
  expectServerParity(program, serverHost(signals));
  const shifted = { count: 2, label: '<ready & "set">', items: [{ id: 'z', text: '<&>' }] };
  expectSeedParity(program, hostWith(shifted));
  expectServerParity(program, serverHost(shifted));
});
