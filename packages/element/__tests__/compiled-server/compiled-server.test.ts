import { readFile } from 'node:fs/promises';
import { expect, test } from 'vitest';
import { assertThrowsIncludes } from '../../../../tests/lib/vitest-asserts.ts';
import type { PartProgramV1 } from '../../src/internal/protocol/part-program.ts';
import { trustedHtml } from '../../src/internal/core/security.ts';
import { testProgram } from '../compiled-runtime/test-program.ts';

const PROGRAM = testProgram({
  tag: 'oe-demo-card',
  template: [
    {
      k: 'el',
      tag: 'input',
      attrs: [['class', 'card'] as [string, string]],
      children: [],
    },
  ],
  parts: [
    {
      k: 'prop',
      index: 0,
      signal: 'value',
      name: 'value',
      path: [0],
    },
  ],
});

const HOST = {
  signals: {
    value: {
      value: 'server & safe',
      subscribe: () => () => {},
    },
  },
  handlers: {},
};

test('compiled server requires the TrustedHtml capability for html Parts', async () => {
  const { serializeProgramContent } = await import('../../src/internal/compiled/server/index.ts');
  const program = testProgram({
    tag: 'oe-server-html',
    template: [{ k: 'el', tag: 'div', attrs: [], children: [] }],
    parts: [{ k: 'html', index: 0, signal: 'body', path: [0] }],
  });
  const host = (value: unknown) => ({
    signals: { body: { value, subscribe: () => () => {} } },
    handlers: {},
  });
  expect(serializeProgramContent(program, host(trustedHtml('<strong>safe</strong>')))).toEqual(
    '<div><strong>safe</strong></div>',
  );
  assertThrowsIncludes(
    () => serializeProgramContent(program, host('<strong>unsafe</strong>')),
    Error,
    'requires a value created by trustedHtml()',
  );
  assertThrowsIncludes(
    () => serializeProgramContent(program, host(structuredClone(trustedHtml('<b>x</b>')))),
    Error,
    'requires a value created by trustedHtml()',
  );
});

// One canonical compiled-counter program: compiled-claim owns the fixture and
// the server suite renders the same bytes, so the program cannot drift into a
// second copy (audit P3-02).
const FIXTURE_PROGRAM_URL = new URL(
  '../../__fixtures__/compiled-claim/program.json',
  import.meta.url,
);

const FIXTURE_EXPECTED_URLS = {
  light: new URL('../../__fixtures__/compiled-server/expected-light.html.txt', import.meta.url),
  open: new URL('../../__fixtures__/compiled-server/expected-open.html.txt', import.meta.url),
  closed: new URL('../../__fixtures__/compiled-server/expected-closed.html.txt', import.meta.url),
};

const STATIC_ONLY_PROGRAM_URL = new URL(
  '../../__fixtures__/compiled-server/static-only-program.json',
  import.meta.url,
);
const STATIC_ONLY_EXPECTED_URL = new URL(
  '../../__fixtures__/compiled-server/static-only-expected.html.txt',
  import.meta.url,
);

async function readFixtureProgram(): Promise<PartProgramV1> {
  return JSON.parse(await readFile(FIXTURE_PROGRAM_URL, 'utf8')) as PartProgramV1;
}

function fixtureHost() {
  const signal = <T>(value: T) => ({
    value,
    subscribe: () => () => {},
  });
  return {
    signals: {
      count: signal(0),
      label: signal('ready'),
      items: signal([
        { id: 'a', text: 'alpha' },
        { id: 'b', text: 'beta' },
      ]),
    },
    handlers: {},
  };
}

test('alpha.3 server serialization is one deterministic program across root modes', async () => {
  const { serializeCompiledProgram } = await import('../../src/internal/compiled/server/index.ts');

  expect(serializeCompiledProgram(PROGRAM, HOST, { mode: 'light' })).toEqual(
    '<oe-demo-card data-oe-light><input class="card" value="server &amp; safe"></oe-demo-card>',
  );
  expect(
    serializeCompiledProgram(PROGRAM, HOST, {
      mode: 'light',
      styleCss: '.card { color: rebeccapurple; }',
    }),
  ).toEqual(
    '<oe-demo-card data-oe-light><style data-oe-static-styles>.card { color: rebeccapurple; }</style><input class="card" value="server &amp; safe"></oe-demo-card>',
  );
  expect(serializeCompiledProgram(PROGRAM, HOST, { mode: 'open' })).toEqual(
    '<oe-demo-card><template shadowrootmode="open"><input class="card" value="server &amp; safe"></template></oe-demo-card>',
  );
  expect(serializeCompiledProgram(PROGRAM, HOST, { mode: 'closed' })).toEqual(
    '<oe-demo-card><template shadowrootmode="closed"><input class="card" value="server &amp; safe"></template></oe-demo-card>',
  );
});

test('alpha.3 server fixture is deterministic and agrees with the seed serializer', async () => {
  const { serializeCompiledProgram, serializeProgramContent } =
    await import('../../src/internal/compiled/server/index.ts');
  const { serializeToHtml: serializeSeed } = await import('../../src/internal/compiled/runtime.ts');
  const program = await readFixtureProgram();
  const host = fixtureHost();
  const [light, open, closed] = await Promise.all([
    readFile(FIXTURE_EXPECTED_URLS.light, 'utf8'),
    readFile(FIXTURE_EXPECTED_URLS.open, 'utf8'),
    readFile(FIXTURE_EXPECTED_URLS.closed, 'utf8'),
  ]);

  expect(serializeCompiledProgram(program, host, { mode: 'light' })).toEqual(light.trimEnd());
  expect(serializeCompiledProgram(program, host, { mode: 'open' })).toEqual(open.trimEnd());
  expect(serializeCompiledProgram(program, host, { mode: 'closed' })).toEqual(closed.trimEnd());
  expect(serializeCompiledProgram(program, host, { mode: 'open' })).toEqual(
    serializeCompiledProgram(program, host, { mode: 'open' }),
  );
  expect(serializeProgramContent(program, host)).toEqual(
    serializeSeed(program, host as unknown as Parameters<typeof serializeSeed>[1]),
  );
});

test('alpha.3 server output escapes values, supports native DSD flags, and fails closed', async () => {
  const { serializeCompiledProgram, serializeProgramContent } =
    await import('../../src/internal/compiled/server/index.ts');
  const staticProgram = testProgram({
    tag: 'oe-static',
    template: [
      {
        k: 'el',
        tag: 'p',
        attrs: [['title', 'a&"<>\'']],
        children: [{ k: 'text', value: '<safe & text>' }],
      },
    ],
    parts: [],
  });
  expect(serializeProgramContent(staticProgram, {})).toEqual(
    '<p title="a&amp;&quot;&lt;&gt;&#39;">&lt;safe &amp; text&gt;</p>',
  );
  expect(
    serializeCompiledProgram(
      staticProgram,
      {},
      {
        mode: 'open',
        hostAttrs: [
          ['data-id', 'a&"'],
          ['aria-label', 'card'],
        ],
        dsd: {
          delegatesFocus: true,
          clonable: true,
          serializable: true,
          slotAssignment: 'manual',
          customElementRegistry: true,
        },
      },
    ),
  ).toEqual(
    '<oe-static data-id="a&amp;&quot;" aria-label="card"><template shadowrootmode="open" shadowrootdelegatesfocus shadowrootclonable shadowrootserializable shadowrootslotassignment="manual" shadowrootcustomelementregistry><p title="a&amp;&quot;&lt;&gt;&#39;">&lt;safe &amp; text&gt;</p></template></oe-static>',
  );

  const unsafe = structuredClone(staticProgram);
  const unsafeRoot = unsafe.template[0];
  if (unsafeRoot.k !== 'el') throw new Error('test setup: expected an element root');
  unsafeRoot.attrs = [['onclick', 'alert(1)']];
  const error = assertThrowsIncludes(() => serializeProgramContent(unsafe, {}), Error);
  expect(error.message).toContain('unsafe name');
  const rawText = structuredClone(staticProgram);
  const rawTextRoot = rawText.template[0];
  if (rawTextRoot.k !== 'el') throw new Error('test setup: expected an element root');
  rawTextRoot.tag = 'script';
  assertThrowsIncludes(() => serializeProgramContent(rawText, {}), Error);
  const rawTextStyle = structuredClone(staticProgram);
  const rawTextStyleRoot = rawTextStyle.template[0];
  if (rawTextStyleRoot.k !== 'el') throw new Error('test setup: expected an element root');
  rawTextStyleRoot.tag = 'style';
  assertThrowsIncludes(() => serializeProgramContent(rawTextStyle, {}), Error);

  const srcdocAttr = structuredClone(staticProgram);
  const srcdocRoot = srcdocAttr.template[0];
  if (srcdocRoot.k !== 'el') throw new Error('test setup: expected an element root');
  srcdocRoot.attrs = [['srcdoc', '<p>forged</p>']];
  const srcdocError = assertThrowsIncludes(() => serializeProgramContent(srcdocAttr, {}), Error);
  expect(srcdocError.message).toContain('unsafe name');
  const innerHtmlAttr = structuredClone(staticProgram);
  const innerHtmlRoot = innerHtmlAttr.template[0];
  if (innerHtmlRoot.k !== 'el') throw new Error('test setup: expected an element root');
  innerHtmlRoot.attrs = [['innerHTML', '<p>forged</p>']];
  assertThrowsIncludes(() => serializeProgramContent(innerHtmlAttr, {}), Error);

  const inheritedItem = Object.create({ id: 'a', text: 'alpha' });
  const eachProgram = testProgram({
    tag: 'oe-each',
    template: [{ k: 'part', index: 0 }],
    parts: [
      {
        k: 'each',
        index: 0,
        signal: 'items',
        key: 'id',
        field: 'text',
        item: [{ k: 'ival', field: 'text' }],
      },
    ],
  });
  const inheritedError = assertThrowsIncludes(
    () =>
      serializeProgramContent(eachProgram, {
        signals: {
          items: { value: [inheritedItem], subscribe: () => () => {} },
        },
      }),
    Error,
  );
  expect(inheritedError.message).toContain('each Region item needs');

  const unsafeProperty = structuredClone(PROGRAM);
  const propertyPart = unsafeProperty.parts[0];
  if (propertyPart.k !== 'prop') throw new Error('test setup: expected a prop Part');
  propertyPart.name = '__proto__';
  const propertyError = assertThrowsIncludes(
    () => serializeProgramContent(unsafeProperty, HOST),
    Error,
  );
  expect(propertyError.message).toContain('unsafe property sink name');

  for (const forbiddenName of ['constructor', 'prototype']) {
    const forged = structuredClone(PROGRAM);
    const forgedPart = forged.parts[0];
    if (forgedPart.k !== 'prop') throw new Error('test setup: expected a prop Part');
    forgedPart.name = forbiddenName;
    const forgedError = assertThrowsIncludes(() => serializeProgramContent(forged, HOST), Error);
    expect(forgedError.message).toContain('unsafe property sink name');
  }

  const inheritedSignals = Object.create({ value: HOST.signals.value });
  const signalError = assertThrowsIncludes(
    () => serializeProgramContent(PROGRAM, { signals: inheritedSignals }),
    Error,
  );
  expect(signalError.message).toContain('missing signal');

  const nestedProgram = testProgram({
    tag: 'oe-nested',
    template: [
      {
        k: 'el',
        tag: 'oe-child',
        attrs: [['data-owner', 'demo']],
        children: [
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
  expect(serializeCompiledProgram(nestedProgram, {}, { mode: 'open' })).toEqual(
    '<oe-nested><template shadowrootmode="open"><oe-child data-owner="demo"><x-third-party>foreign</x-third-party></oe-child></template></oe-nested>',
  );
});

test('alpha.3 static-only server fixture needs no client signal artifact', async () => {
  const { serializeProgramContent } = await import('../../src/internal/compiled/server/index.ts');
  const program = JSON.parse(await readFile(STATIC_ONLY_PROGRAM_URL, 'utf8'));
  const expected = (await readFile(STATIC_ONLY_EXPECTED_URL, 'utf8')).trimEnd();
  expect(serializeProgramContent(program, {})).toEqual(expected);
});

test('compiled server validation rejects the shared forbidden-sink deny list', async () => {
  const { assertCompiledProgram } = await import('../../src/internal/compiled/server/index.ts');
  const forge = (mutate: (program: PartProgramV1) => void): PartProgramV1 => {
    const program = structuredClone(PROGRAM);
    mutate(program);
    return program;
  };

  for (const tag of ['script', 'style']) {
    const forged = forge((program) => {
      const root = program.template[0];
      if (root.k !== 'el') throw new Error('test setup: expected an element root');
      root.tag = tag;
    });
    assertThrowsIncludes(() => assertCompiledProgram(forged), Error);
  }

  for (const name of ['srcdoc', 'innerHTML']) {
    const forgedAttr = forge((program) => {
      const root = program.template[0];
      if (root.k !== 'el') throw new Error('test setup: expected an element root');
      root.attrs = [[name, 'forged']];
    });
    assertThrowsIncludes(() => assertCompiledProgram(forgedAttr), Error);

    const forgedSink = forge((program) => {
      const part = program.parts[0];
      if (part.k !== 'prop') throw new Error('test setup: expected a prop Part');
      (part as unknown as { k: string; name: string }).k = 'attr';
      part.name = name;
    });
    assertThrowsIncludes(() => assertCompiledProgram(forgedSink), Error);
  }

  for (const name of ['__proto__', 'constructor', 'prototype']) {
    const forged = forge((program) => {
      const part = program.parts[0];
      if (part.k !== 'prop') throw new Error('test setup: expected a prop Part');
      part.name = name;
    });
    const error = assertThrowsIncludes(() => assertCompiledProgram(forged), Error);
    expect(error.message).toContain('unsafe property sink name');
  }
});

test('compiled server preserves structured custom-element property values for nested SSR', async () => {
  const { serializeProgramContent } = await import('../../src/internal/compiled/server/index.ts');
  const program = testProgram({
    tag: 'oe-parent',
    template: [
      {
        k: 'el',
        tag: 'oe-child',
        attrs: [],
        children: [],
      },
    ],
    parts: [
      { k: 'prop', index: 0, signal: 'model', name: 'model', path: [0] },
      { k: 'prop', index: 1, signal: 'enabled', name: 'enabled', path: [0] },
    ],
  });
  const signal = <T>(value: T) => ({ value, subscribe: () => () => {} });

  expect(
    serializeProgramContent(program, {
      signals: {
        model: signal({ title: 'safe & exact', items: [1, 2] }),
        enabled: signal(false),
      },
    }),
  ).toEqual(
    '<oe-child model="{&quot;title&quot;:&quot;safe &amp; exact&quot;,&quot;items&quot;:[1,2]}" enabled="false"></oe-child>',
  );
});
