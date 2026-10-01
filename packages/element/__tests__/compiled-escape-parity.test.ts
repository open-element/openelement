/**
 * Kernel contract for the compiled serializers' escape contracts (issue
 * #1220, L1; #1272 B1.1/F3; issue #1469, ADR-0160 rule b).
 *
 * There is ONE tree-walking serializer
 * (`internal/compiled/serializer/serialize-program.ts`); the server serializer
 * (server/index.ts) and the runtime seed serializer (runtime.ts) delegate
 * their walk to it. Before #1469 this file guarded the convergence of two
 * parallel walkers: the runtime escaped only `&` and `"` while the server
 * also escaped `<`, `>`, and `'`, so the same program produced different
 * bytes on the two paths and claim parity could drift. The byte pins stay:
 * every corpus replays through both entry points, requires byte-identical
 * output (both walk the same kernel), and pins the canonical escape contracts
 * directly. A structural guard keeps the single-walker boundary from
 * regrowing a private walker in either execution module.
 */

import { assert, assertEquals, assertStringIncludes } from '@std/assert';
import { serializeToHtml as serializeRuntime } from '../src/internal/compiled/runtime.ts';
import { serializeToHtml as serializeServer } from '../src/internal/compiled/server/index.ts';
import { escapeAttr } from '../src/internal/core/html-escape.ts';
import { escapeText } from '../src/internal/compiled/escape-text.ts';
import { testProgram } from './compiled-runtime/test-program.ts';

const REPO_ROOT = new URL('../../../', import.meta.url);

const EXECUTION_SITES = [
  'packages/element/src/internal/compiled/runtime.ts',
  'packages/element/src/internal/compiled/server/index.ts',
];

const CORPUS: readonly string[] = [
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

function hostWith(value: unknown) {
  return { signals: { v: { value, subscribe: () => () => {} } }, handlers: {} };
}

type RuntimeHost = Parameters<typeof serializeRuntime>[1];

Deno.test('escape parity: attr Part corpus is byte-identical across both serializers', () => {
  for (const value of CORPUS) {
    const program = testProgram({
      tag: 'x-parity',
      template: [{ k: 'el', tag: 'div', attrs: [], children: [] }],
      parts: [{ k: 'attr', index: 0, signal: 'v', name: 'title', path: [0] }],
    });
    const runtime = serializeRuntime(program, hostWith(value) as unknown as RuntimeHost);
    const server = serializeServer(program, hostWith(value));
    assertEquals(runtime, server, `serializers diverged for ${JSON.stringify(value)}`);
    assertEquals(
      runtime,
      `<div title="${escapeAttr(value)}"></div>`,
      `shared escapeAttr contract broken for ${JSON.stringify(value)}`,
    );
  }
});

Deno.test('escape parity: fixed attribute corpus is byte-identical across both serializers', () => {
  for (const value of CORPUS) {
    const program = testProgram({
      tag: 'x-parity',
      template: [{ k: 'el', tag: 'div', attrs: [['title', value]], children: [] }],
      parts: [],
    });
    const runtime = serializeRuntime(program, hostWith(undefined) as unknown as RuntimeHost);
    const server = serializeServer(program, hostWith(undefined));
    assertEquals(runtime, server, `serializers diverged for ${JSON.stringify(value)}`);
    assertEquals(runtime, `<div title="${escapeAttr(value)}"></div>`);
  }
});

Deno.test('escape parity: canonical contract escapes & < > " and \'', () => {
  assertEquals(escapeAttr(`a&b"c<d>e'f`), 'a&amp;b&quot;c&lt;d&gt;e&#39;f');
});

/**
 * Text-node corpus (B1.1 audit remediation, #1272 / finding F3).
 *
 * Text nodes use a REDUCED escape contract (`&`, `<`, `>` only — quotes are
 * pass-through in text content) owned by one shared helper,
 * `internal/compiled/escape-text.ts`, consumed by the shared kernel. Before
 * the convergence each serializer carried a private copy and no test bound
 * the two at byte level for text output; a drift confined to `>` escaping in
 * text nodes would have been silent. This corpus requires byte-identical text
 * output across both serializers and pins the shared contract.
 */
const TEXT_CORPUS: readonly string[] = [
  `a&b"c<d>e'f`,
  `<`,
  `>`,
  `&`,
  `"`,
  `'`,
  `&quot;entity-looking&quot;`,
  `plain`,
  `line\nbreak\ttab`,
  `unicode é ‹› „ “`,
  `</script><script>alert(1)</script>`,
];

Deno.test('escape parity: static text corpus is byte-identical across both serializers', () => {
  for (const value of TEXT_CORPUS) {
    const program = testProgram({
      tag: 'x-parity',
      template: [{ k: 'el', tag: 'div', attrs: [], children: [{ k: 'text', value }] }],
      parts: [],
    });
    const runtime = serializeRuntime(program, hostWith(undefined) as unknown as RuntimeHost);
    const server = serializeServer(program, hostWith(undefined));
    assertEquals(runtime, server, `serializers diverged for ${JSON.stringify(value)}`);
    assertEquals(
      runtime,
      `<div>${escapeText(value)}</div>`,
      `shared escapeText contract broken for ${JSON.stringify(value)}`,
    );
  }
});

Deno.test('escape parity: text Part corpus is byte-identical across both serializers', () => {
  for (const value of TEXT_CORPUS) {
    const program = testProgram({
      tag: 'x-parity',
      template: [{ k: 'el', tag: 'div', attrs: [], children: [{ k: 'part', index: 0 }] }],
      parts: [{ k: 'text', index: 0, signal: 'v' }],
    });
    const runtime = serializeRuntime(program, hostWith(value) as unknown as RuntimeHost);
    const server = serializeServer(program, hostWith(value));
    assertEquals(runtime, server, `serializers diverged for ${JSON.stringify(value)}`);
    assertStringIncludes(
      runtime,
      escapeText(value),
      `escaped text missing from output for ${JSON.stringify(value)}`,
    );
  }
});

Deno.test('escape parity: text contract escapes & < > and passes quotes and non-ASCII through', () => {
  assertEquals(escapeText(`a&b"c<d>e'f`), 'a&amp;b"c&lt;d&gt;e\'f');
  assertEquals(escapeText(`unicode é ‹› „ “`), `unicode é ‹› „ “`);
});

/**
 * Single-walker boundary (issue #1469, ADR-0160 rule b): both execution
 * modules route serialization through the shared kernel and carry no private
 * template walk. The kernel is the only module that walks the template and
 * assembles serialized output; a second serialize walker in an execution
 * module is a lane failure. (The claim/fresh paths legitimately construct
 * comment markers for DOM creation — that is not a serializer.)
 */
Deno.test('escape parity: both execution modules delegate the walk to the shared kernel', async () => {
  for (const path of EXECUTION_SITES) {
    const source = await Deno.readTextFile(new URL(path, REPO_ROOT));
    assert(
      source.includes('serializer/serialize-program.ts'),
      `${path}: serialization must import the shared kernel`,
    );
    for (const privateWalker of [
      'function serializeNode(',
      'function serializeElement(',
      'function serializeChildren(',
    ]) {
      assertEquals(
        source.includes(privateWalker),
        false,
        `${path}: private template walk regrew (${JSON.stringify(privateWalker)})`,
      );
    }
  }
});
