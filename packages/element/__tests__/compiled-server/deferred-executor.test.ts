import { assertEquals, assertStringIncludes, assertThrows } from '@std/assert';
import {
  createDeferredServerExecutor,
  type DeferredServerOwner,
  serializeCompiledProgram,
} from '../../src/internal/compiled/server/index.ts';
import type { PartProgramV1 } from '../../src/internal/protocol/part-program.ts';
import { testProgram } from '../compiled-runtime/test-program.ts';

const program = testProgram({
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
        children: [
          { k: 'text', value: 'Ready <&>' },
        ],
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
        iattrs: [
          ['title', 'label'],
        ],
        children: [{ k: 'ival', field: 'label' }],
      }],
    },
  ],
});

const values = {
  title: '<hello & "world">',
  enabled: true,
  items: [{ id: 'one', label: `A<&"'` }],
};
const signal = (value: unknown) => ({ value, subscribe: () => () => {} });
const resolvedHost = {
  signals: {
    title: signal(values.title),
    enabled: signal(values.enabled),
    items: signal(values.items),
  },
};
function owner(p: PartProgramV1 = program, instanceId = 'instance-1'): DeferredServerOwner {
  return { program: p, version: 1, instanceId };
}

Deno.test('deferred server mode reads only fast signals and preserves regular SSR bytes', () => {
  const fast = {
    signals: {
      title: signal(values.title),
      enabled: {
        get value(): never {
          throw new Error('pending when read');
        },
        subscribe: () => () => {},
      },
      items: {
        get value(): never {
          throw new Error('pending each read');
        },
        subscribe: () => () => {},
      },
    },
  };
  const identity = owner();
  const executor = createDeferredServerExecutor(
    program,
    fast,
    { owner: identity, pendingParts: [1, 2] },
    { mode: 'light' },
  );
  assertEquals(
    executor.shell,
    '<oe-stream-page data-oe-light><main>Before <!--oe:p0-->&lt;hello &amp; "world"&gt;<section><!--oe:p1--><!--oe:/p1--></section><!--oe:p2--><!--oe:/p2--> After</main></oe-stream-page>',
  );
  assertEquals(
    executor.serializeResolved(identity, 1, true),
    '<strong title="a&amp;&quot;">Ready &lt;&amp;&gt;</strong>',
  );
  assertEquals(
    executor.serializeResolved(identity, 2, values.items),
    '<a href="/next?x=1&amp;y=2" title="A&lt;&amp;&quot;&#39;">A&lt;&amp;"\'</a>',
  );
  assertEquals(
    serializeCompiledProgram(program, resolvedHost, { mode: 'light' }),
    '<oe-stream-page data-oe-light><main>Before <!--oe:p0-->&lt;hello &amp; "world"&gt;<section><!--oe:p1--><strong title="a&amp;&quot;">Ready &lt;&amp;&gt;</strong><!--oe:/p1--></section><!--oe:p2--><a href="/next?x=1&amp;y=2" title="A&lt;&amp;&quot;&#39;">A&lt;&amp;"\'</a><!--oe:/p2--> After</main></oe-stream-page>',
  );
  assertEquals(
    createDeferredServerExecutor(program, resolvedHost, {
      owner: identity,
      pendingParts: [],
    }, { mode: 'light' }).shell,
    serializeCompiledProgram(program, resolvedHost, { mode: 'light' }),
  );
});

Deno.test('pending text has an end anchor only in the opt-in shell and resolves with canonical escaping', () => {
  const pendingHost = {
    signals: {
      ...resolvedHost.signals,
      title: {
        get value(): never {
          throw new Error('pending title read');
        },
        subscribe: () => () => {},
      },
    },
  };
  const identity = owner();
  const executor = createDeferredServerExecutor(program, pendingHost, {
    owner: identity,
    pendingParts: [0],
  });
  assertStringIncludes(executor.shell, 'Before <!--oe:p0--><!--oe:/p0--><section>');
  assertEquals(
    executor.serializeResolved(identity, 0, values.title),
    '&lt;hello &amp; "world"&gt;',
  );
  assertStringIncludes(
    serializeCompiledProgram(program, resolvedHost),
    'Before <!--oe:p0-->&lt;hello &amp; "world"&gt;<section>',
  );
  assertThrows(() => executor.serializeResolved(identity, 1, true), Error, 'non-pending Part');
});

Deno.test('deferred executor rejects unknown, duplicate, ineligible and foreign owners', () => {
  const identity = owner();
  const selection = (indices: number[]) => ({ owner: identity, pendingParts: indices });
  assertThrows(
    () => createDeferredServerExecutor(program, resolvedHost, selection([4])),
    Error,
    'unknown Part',
  );
  assertThrows(
    () => createDeferredServerExecutor(program, resolvedHost, selection([0, 0])),
    Error,
    'duplicate Part',
  );
  const executor = createDeferredServerExecutor(program, resolvedHost, selection([0]));
  assertThrows(
    () => executor.serializeResolved(owner(), 0, 'forged'),
    Error,
    'wrong deferred Part owner',
  );
  assertThrows(() => executor.serializeResolved(identity, 1, true), Error, 'non-pending Part');
  assertThrows(() => executor.serializeResolved(identity, 999, 'x'), Error, 'non-pending Part');
  assertThrows(
    () =>
      createDeferredServerExecutor(program, resolvedHost, {
        owner: owner(structuredClone(program)),
        pendingParts: [0],
      }),
    Error,
    'wrong program',
  );
  assertThrows(
    () =>
      createDeferredServerExecutor(program, resolvedHost, {
        owner: { ...identity, version: 2 },
        pendingParts: [0],
      }),
    Error,
    'version',
  );
  const wrongVersion = structuredClone(program);
  (wrongVersion as { version: number }).version = 2;
  assertThrows(
    () =>
      createDeferredServerExecutor(wrongVersion, resolvedHost, {
        owner: { program: wrongVersion, version: 2, instanceId: 'instance-1' },
        pendingParts: [0],
      }),
    Error,
    'version',
  );
  assertThrows(
    () => createDeferredServerExecutor(program, resolvedHost, selection([0]), { mode: 'closed' }),
    Error,
    'accessible roots',
  );
  const ineligible = testProgram({
    tag: 'oe-attribute',
    template: [{ k: 'el', tag: 'p', attrs: [], children: [] }],
    parts: [{ k: 'attr', index: 0, signal: 'title', name: 'title', path: [0] }],
  });
  assertThrows(
    () =>
      createDeferredServerExecutor(ineligible, resolvedHost, {
        owner: owner(ineligible),
        pendingParts: [0],
      }),
    Error,
    'anchor-owned',
  );
  const mixed = testProgram({
    tag: 'oe-mixed',
    template: [{
      k: 'el',
      tag: 'p',
      attrs: [],
      children: [{ k: 'part', index: 0 }, { k: 'part', index: 1 }],
    }],
    parts: [
      { k: 'text', index: 0, signal: 'title' },
      { k: 'text', index: 1, signal: 'title' },
    ],
  });
  assertThrows(
    () =>
      createDeferredServerExecutor(mixed, resolvedHost, {
        owner: owner(mixed),
        pendingParts: [0],
      }),
    Error,
    'unselected',
  );
  const opaque = testProgram({
    tag: 'oe-opaque',
    template: [{ k: 'part', index: 0 }],
    parts: [{
      k: 'when',
      index: 0,
      signal: 'enabled',
      test: { signal: 'enabled', op: 'truthy', value: true },
      on: [{ k: 'el', tag: 'oe-foreign', attrs: [], children: [] }],
      off: [],
    }],
  });
  assertThrows(
    () =>
      createDeferredServerExecutor(opaque, resolvedHost, {
        owner: owner(opaque),
        pendingParts: [0],
      }),
    Error,
    'opaque',
  );
});

Deno.test('nested instances with the same Part index have distinct owners', () => {
  const child = testProgram({
    tag: 'oe-child',
    template: [{ k: 'part', index: 0 }],
    parts: [{ k: 'text', index: 0, signal: 'title' }],
  });
  const outerOwner = owner(program, 'outer');
  const childOwner = owner(child, 'child');
  const outer = createDeferredServerExecutor(program, resolvedHost, {
    owner: outerOwner,
    pendingParts: [0],
  });
  const nested = createDeferredServerExecutor(child, resolvedHost, {
    owner: childOwner,
    pendingParts: [0],
  }, { mode: 'light' });
  assertStringIncludes(
    nested.shell,
    '<oe-child data-oe-light><!--oe:p0--><!--oe:/p0--></oe-child>',
  );
  assertThrows(
    () => outer.serializeResolved(childOwner, 0, 'wrong'),
    Error,
    'wrong deferred Part owner',
  );
  assertThrows(
    () => nested.serializeResolved(outerOwner, 0, 'wrong'),
    Error,
    'wrong deferred Part owner',
  );
});
