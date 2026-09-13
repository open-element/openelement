import { assertEquals, assertStringIncludes, assertThrows } from '@std/assert';
import type { PartProgramV1 } from '../../src/internal/compiled/program.ts';
import { trustedHtml } from '../../src/internal/core/security.ts';
import { testProgram } from '../compiled-runtime/test-program.ts';

const PROGRAM = testProgram({
  tag: 'oe-demo-card',
  template: [{
    k: 'el',
    tag: 'input',
    attrs: [['class', 'card'] as [string, string]],
    children: [],
  }],
  parts: [{
    k: 'prop',
    index: 0,
    signal: 'value',
    name: 'value',
    path: [0],
  }],
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

Deno.test('compiled server requires the TrustedHtml capability for html Parts', async () => {
  const { serializeProgramContent } = await import(
    '../../src/internal/compiled/server/index.ts'
  );
  const program = testProgram({
    tag: 'oe-server-html',
    template: [{ k: 'el', tag: 'div', attrs: [], children: [] }],
    parts: [{ k: 'html', index: 0, signal: 'body', path: [0] }],
  });
  const host = (value: unknown) => ({
    signals: { body: { value, subscribe: () => () => {} } },
    handlers: {},
  });
  assertEquals(
    serializeProgramContent(program, host(trustedHtml('<strong>safe</strong>'))),
    '<div><strong>safe</strong></div>',
  );
  assertThrows(
    () => serializeProgramContent(program, host('<strong>unsafe</strong>')),
    Error,
    'requires a value created by trustedHtml()',
  );
  assertThrows(
    () => serializeProgramContent(program, host(structuredClone(trustedHtml('<b>x</b>')))),
    Error,
    'requires a value created by trustedHtml()',
  );
});

const FIXTURE_PROGRAM_URL = new URL(
  '../../__fixtures__/compiled-server/program.json',
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
  return JSON.parse(await Deno.readTextFile(FIXTURE_PROGRAM_URL)) as PartProgramV1;
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
      items: signal([{ id: 'a', text: 'alpha' }, { id: 'b', text: 'beta' }]),
    },
    handlers: {},
  };
}

Deno.test('alpha.3 server serialization is one deterministic program across root modes', async () => {
  const { serializeCompiledProgram } = await import(
    '../../src/internal/compiled/server/index.ts'
  );

  assertEquals(
    serializeCompiledProgram(PROGRAM, HOST, { mode: 'light' }),
    '<oe-demo-card data-oe-light><input class="card" value="server &amp; safe"></oe-demo-card>',
  );
  assertEquals(
    serializeCompiledProgram(PROGRAM, HOST, {
      mode: 'light',
      styleCss: '.card { color: rebeccapurple; }',
    }),
    '<oe-demo-card data-oe-light><style data-oe-static-styles>.card { color: rebeccapurple; }</style><input class="card" value="server &amp; safe"></oe-demo-card>',
  );
  assertEquals(
    serializeCompiledProgram(PROGRAM, HOST, { mode: 'open' }),
    '<oe-demo-card><template shadowrootmode="open"><input class="card" value="server &amp; safe"></template></oe-demo-card>',
  );
  assertEquals(
    serializeCompiledProgram(PROGRAM, HOST, { mode: 'closed' }),
    '<oe-demo-card><template shadowrootmode="closed"><input class="card" value="server &amp; safe"></template></oe-demo-card>',
  );
});

Deno.test('alpha.3 server fixture is deterministic and agrees with the seed serializer', async () => {
  const { serializeCompiledProgram, serializeProgramContent } = await import(
    '../../src/internal/compiled/server/index.ts'
  );
  const { serializeToHtml: serializeSeed } = await import(
    '../../src/internal/compiled/runtime.ts'
  );
  const program = await readFixtureProgram();
  const host = fixtureHost();
  const [light, open, closed] = await Promise.all([
    Deno.readTextFile(FIXTURE_EXPECTED_URLS.light),
    Deno.readTextFile(FIXTURE_EXPECTED_URLS.open),
    Deno.readTextFile(FIXTURE_EXPECTED_URLS.closed),
  ]);

  assertEquals(serializeCompiledProgram(program, host, { mode: 'light' }), light.trimEnd());
  assertEquals(serializeCompiledProgram(program, host, { mode: 'open' }), open.trimEnd());
  assertEquals(serializeCompiledProgram(program, host, { mode: 'closed' }), closed.trimEnd());
  assertEquals(
    serializeCompiledProgram(program, host, { mode: 'open' }),
    serializeCompiledProgram(program, host, { mode: 'open' }),
  );
  assertEquals(
    serializeProgramContent(program, host),
    serializeSeed(program, host as unknown as Parameters<typeof serializeSeed>[1]),
  );
});

Deno.test('alpha.3 server output escapes values, supports native DSD flags, and fails closed', async () => {
  const { serializeCompiledProgram, serializeProgramContent } = await import(
    '../../src/internal/compiled/server/index.ts'
  );
  const staticProgram = testProgram({
    tag: 'oe-static',
    template: [{
      k: 'el',
      tag: 'p',
      attrs: [['title', 'a&"<>\'']],
      children: [{ k: 'text', value: '<safe & text>' }],
    }],
    parts: [],
  });
  assertEquals(
    serializeProgramContent(staticProgram, {}),
    '<p title="a&amp;&quot;&lt;&gt;&#39;">&lt;safe &amp; text&gt;</p>',
  );
  assertEquals(
    serializeCompiledProgram(staticProgram, {}, {
      mode: 'open',
      hostAttrs: [['data-id', 'a&"'], ['aria-label', 'card']],
      dsd: {
        delegatesFocus: true,
        clonable: true,
        serializable: true,
        slotAssignment: 'manual',
        customElementRegistry: true,
      },
    }),
    '<oe-static data-id="a&amp;&quot;" aria-label="card"><template shadowrootmode="open" shadowrootdelegatesfocus shadowrootclonable shadowrootserializable shadowrootslotassignment="manual" shadowrootcustomelementregistry><p title="a&amp;&quot;&lt;&gt;&#39;">&lt;safe &amp; text&gt;</p></template></oe-static>',
  );

  const unsafe = structuredClone(staticProgram);
  const unsafeRoot = unsafe.template[0];
  if (unsafeRoot.k !== 'el') throw new Error('test setup: expected an element root');
  unsafeRoot.attrs = [['onclick', 'alert(1)']];
  const error = assertThrows(() => serializeProgramContent(unsafe, {}), Error);
  assertStringIncludes(error.message, 'unsafe name');
  const rawText = structuredClone(staticProgram);
  const rawTextRoot = rawText.template[0];
  if (rawTextRoot.k !== 'el') throw new Error('test setup: expected an element root');
  rawTextRoot.tag = 'script';
  assertThrows(() => serializeProgramContent(rawText, {}), Error);

  const inheritedItem = Object.create({ id: 'a', text: 'alpha' });
  const eachProgram = testProgram({
    tag: 'oe-each',
    template: [{ k: 'part', index: 0 }],
    parts: [{
      k: 'each',
      index: 0,
      signal: 'items',
      key: 'id',
      field: 'text',
      item: [{ k: 'ival', field: 'text' }],
    }],
  });
  const inheritedError = assertThrows(
    () =>
      serializeProgramContent(eachProgram, {
        signals: {
          items: { value: [inheritedItem], subscribe: () => () => {} },
        },
      }),
    Error,
  );
  assertStringIncludes(inheritedError.message, 'each Region item needs');

  const unsafeProperty = structuredClone(PROGRAM);
  const propertyPart = unsafeProperty.parts[0];
  if (propertyPart.k !== 'prop') throw new Error('test setup: expected a prop Part');
  propertyPart.name = '__proto__';
  const propertyError = assertThrows(
    () => serializeProgramContent(unsafeProperty, HOST),
    Error,
  );
  assertStringIncludes(propertyError.message, 'unsafe property sink name');

  const inheritedSignals = Object.create({ value: HOST.signals.value });
  const signalError = assertThrows(
    () => serializeProgramContent(PROGRAM, { signals: inheritedSignals }),
    Error,
  );
  assertStringIncludes(signalError.message, 'missing signal');

  const nestedProgram = testProgram({
    tag: 'oe-nested',
    template: [{
      k: 'el',
      tag: 'oe-child',
      attrs: [['data-owner', 'demo']],
      children: [{
        k: 'el',
        tag: 'x-third-party',
        attrs: [],
        children: [{ k: 'text', value: 'foreign' }],
      }],
    }],
    parts: [],
  });
  assertEquals(
    serializeCompiledProgram(nestedProgram, {}, { mode: 'open' }),
    '<oe-nested><template shadowrootmode="open"><oe-child data-owner="demo"><x-third-party>foreign</x-third-party></oe-child></template></oe-nested>',
  );
});

Deno.test('alpha.3 static-only server fixture needs no client signal artifact', async () => {
  const { serializeProgramContent } = await import(
    '../../src/internal/compiled/server/index.ts'
  );
  const program = JSON.parse(await Deno.readTextFile(STATIC_ONLY_PROGRAM_URL));
  const expected = (await Deno.readTextFile(STATIC_ONLY_EXPECTED_URL)).trimEnd();
  assertEquals(serializeProgramContent(program, {}), expected);
});

Deno.test('compiled server preserves structured custom-element property values for nested SSR', async () => {
  const { serializeProgramContent } = await import(
    '../../src/internal/compiled/server/index.ts'
  );
  const program = testProgram({
    tag: 'oe-parent',
    template: [{
      k: 'el',
      tag: 'oe-child',
      attrs: [],
      children: [],
    }],
    parts: [
      { k: 'prop', index: 0, signal: 'model', name: 'model', path: [0] },
      { k: 'prop', index: 1, signal: 'enabled', name: 'enabled', path: [0] },
    ],
  });
  const signal = <T>(value: T) => ({ value, subscribe: () => () => {} });

  assertEquals(
    serializeProgramContent(program, {
      signals: {
        model: signal({ title: 'safe & exact', items: [1, 2] }),
        enabled: signal(false),
      },
    }),
    '<oe-child model="{&quot;title&quot;:&quot;safe &amp; exact&quot;,&quot;items&quot;:[1,2]}" enabled="false"></oe-child>',
  );
});
