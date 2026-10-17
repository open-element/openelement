import { expect, test } from 'vitest';
import { assertThrowsIncludes } from '../../../../tests/lib/vitest-asserts.ts';
import {
  createStreamServerExecutor,
  type StreamOwner,
  serializeCompiledProgram,
} from '../../src/internal/compiled/server/index.ts';
import type { PartProgramV2 } from '@openelement/protocol/part-program';
import { PART_PROGRAM_VERSION } from '@openelement/protocol/part-program';
import { testProgram } from '../compiled-runtime/test-program.ts';

const program = testProgram({
  tag: 'oe-stream-page',
  template: [
    {
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
    },
  ],
  parts: [
    { k: 'text', index: 0, signal: 'title' },
    {
      k: 'when',
      index: 1,
      signal: 'enabled',
      test: { signal: 'enabled', op: 'truthy', value: true },
      on: [
        {
          k: 'el',
          tag: 'strong',
          attrs: [['title', 'a&"']],
          children: [{ k: 'text', value: 'Ready <&>' }],
        },
      ],
      off: [{ k: 'text', value: 'Off & waiting' }],
    },
    {
      k: 'each',
      index: 2,
      signal: 'items',
      key: 'id',
      item: [
        {
          k: 'el',
          tag: 'a',
          attrs: [['href', '/next?x=1&y=2']],
          iattrs: [['title', 'label']],
          children: [{ k: 'ival', field: 'label' }],
        },
      ],
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
function owner(p: PartProgramV2 = program, instanceId = 'instance-1'): StreamOwner {
  return { program: p, version: PART_PROGRAM_VERSION, instanceId };
}

test('stream server mode reads only fast signals and preserves regular SSR bytes', () => {
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
  const executor = createStreamServerExecutor(
    program,
    fast,
    { owner: identity, pendingParts: [1, 2] },
    { mode: 'light' },
  );
  expect(executor.shell).toEqual(
    '<oe-stream-page data-oe-light><main>Before <!--oe:p0-->&lt;hello &amp; "world"&gt;<section><!--oe:p1--><!--oe:/p1--></section><!--oe:p2--><!--oe:/p2--> After</main></oe-stream-page>',
  );
  expect(executor.serializeResolved(identity, 1, true)).toEqual(
    '<strong title="a&amp;&quot;">Ready &lt;&amp;&gt;</strong>',
  );
  expect(executor.serializeResolved(identity, 2, values.items)).toEqual(
    '<a href="/next?x=1&amp;y=2" title="A&lt;&amp;&quot;&#39;">A&lt;&amp;"\'</a>',
  );
  expect(serializeCompiledProgram(program, resolvedHost, { mode: 'light' })).toEqual(
    '<oe-stream-page data-oe-light><main>Before <!--oe:p0-->&lt;hello &amp; "world"&gt;<section><!--oe:p1--><strong title="a&amp;&quot;">Ready &lt;&amp;&gt;</strong><!--oe:/p1--></section><!--oe:p2--><a href="/next?x=1&amp;y=2" title="A&lt;&amp;&quot;&#39;">A&lt;&amp;"\'</a><!--oe:/p2--> After</main></oe-stream-page>',
  );
  expect(
    createStreamServerExecutor(
      program,
      resolvedHost,
      {
        owner: identity,
        pendingParts: [],
      },
      { mode: 'light' },
    ).shell,
  ).toEqual(serializeCompiledProgram(program, resolvedHost, { mode: 'light' }));
});

test('pending text has an end anchor only in the opt-in shell and resolves with canonical escaping', () => {
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
  const executor = createStreamServerExecutor(program, pendingHost, {
    owner: identity,
    pendingParts: [0],
  });
  expect(executor.shell).toContain('Before <!--oe:p0--><!--oe:/p0--><section>');
  expect(executor.serializeResolved(identity, 0, values.title)).toEqual(
    '&lt;hello &amp; "world"&gt;',
  );
  expect(serializeCompiledProgram(program, resolvedHost)).toContain(
    'Before <!--oe:p0-->&lt;hello &amp; "world"&gt;<section>',
  );
  assertThrowsIncludes(
    () => executor.serializeResolved(identity, 1, true),
    Error,
    'non-pending Part',
  );
});

test('stream executor rejects unknown, duplicate, ineligible and foreign owners', () => {
  const identity = owner();
  const selection = (indices: number[]) => ({ owner: identity, pendingParts: indices });
  assertThrowsIncludes(
    () => createStreamServerExecutor(program, resolvedHost, selection([4])),
    Error,
    'unknown Part',
  );
  assertThrowsIncludes(
    () => createStreamServerExecutor(program, resolvedHost, selection([0, 0])),
    Error,
    'duplicate Part',
  );
  const executor = createStreamServerExecutor(program, resolvedHost, selection([0]));
  assertThrowsIncludes(
    () => executor.serializeResolved(owner(), 0, 'forged'),
    Error,
    'wrong deferred Part owner',
  );
  assertThrowsIncludes(
    () => executor.serializeResolved(identity, 1, true),
    Error,
    'non-pending Part',
  );
  assertThrowsIncludes(
    () => executor.serializeResolved(identity, 999, 'x'),
    Error,
    'non-pending Part',
  );
  assertThrowsIncludes(
    () =>
      createStreamServerExecutor(program, resolvedHost, {
        owner: owner(structuredClone(program)),
        pendingParts: [0],
      }),
    Error,
    'wrong program',
  );
  assertThrowsIncludes(
    () =>
      createStreamServerExecutor(program, resolvedHost, {
        owner: { ...identity, version: 99 },
        pendingParts: [0],
      }),
    Error,
    'version',
  );
  const wrongVersion = structuredClone(program);
  (wrongVersion as { version: number }).version = 99;
  assertThrowsIncludes(
    () =>
      createStreamServerExecutor(wrongVersion, resolvedHost, {
        owner: { program: wrongVersion, version: 99, instanceId: 'instance-1' },
        pendingParts: [0],
      }),
    Error,
    'version',
  );
  assertThrowsIncludes(
    () => createStreamServerExecutor(program, resolvedHost, selection([0]), { mode: 'closed' }),
    Error,
    'accessible roots',
  );
  const ineligible = testProgram({
    tag: 'oe-attribute',
    template: [{ k: 'el', tag: 'p', attrs: [], children: [] }],
    parts: [{ k: 'attr', index: 0, signal: 'title', name: 'title', path: [0] }],
  });
  assertThrowsIncludes(
    () =>
      createStreamServerExecutor(ineligible, resolvedHost, {
        owner: owner(ineligible),
        pendingParts: [0],
      }),
    Error,
    'anchor-owned',
  );
  const mixed = testProgram({
    tag: 'oe-mixed',
    template: [
      {
        k: 'el',
        tag: 'p',
        attrs: [],
        children: [
          { k: 'part', index: 0 },
          { k: 'part', index: 1 },
        ],
      },
    ],
    parts: [
      { k: 'text', index: 0, signal: 'title' },
      { k: 'text', index: 1, signal: 'title' },
    ],
  });
  assertThrowsIncludes(
    () =>
      createStreamServerExecutor(mixed, resolvedHost, {
        owner: owner(mixed),
        pendingParts: [0],
      }),
    Error,
    'unselected',
  );
  const opaque = testProgram({
    tag: 'oe-opaque',
    template: [{ k: 'part', index: 0 }],
    parts: [
      {
        k: 'when',
        index: 0,
        signal: 'enabled',
        test: { signal: 'enabled', op: 'truthy', value: true },
        on: [{ k: 'el', tag: 'oe-foreign', attrs: [], children: [] }],
        off: [],
      },
    ],
  });
  assertThrowsIncludes(
    () =>
      createStreamServerExecutor(opaque, resolvedHost, {
        owner: owner(opaque),
        pendingParts: [0],
      }),
    Error,
    'opaque',
  );
});

test('nested instances with the same Part index have distinct owners', () => {
  const child = testProgram({
    tag: 'oe-child',
    template: [{ k: 'part', index: 0 }],
    parts: [{ k: 'text', index: 0, signal: 'title' }],
  });
  const outerOwner = owner(program, 'outer');
  const childOwner = owner(child, 'child');
  const outer = createStreamServerExecutor(program, resolvedHost, {
    owner: outerOwner,
    pendingParts: [0],
  });
  const nested = createStreamServerExecutor(
    child,
    resolvedHost,
    {
      owner: childOwner,
      pendingParts: [0],
    },
    { mode: 'light' },
  );
  expect(nested.shell).toContain('<oe-child data-oe-light><!--oe:p0--><!--oe:/p0--></oe-child>');
  assertThrowsIncludes(
    () => outer.serializeResolved(childOwner, 0, 'wrong'),
    Error,
    'wrong deferred Part owner',
  );
  assertThrowsIncludes(
    () => nested.serializeResolved(outerOwner, 0, 'wrong'),
    Error,
    'wrong deferred Part owner',
  );
});
