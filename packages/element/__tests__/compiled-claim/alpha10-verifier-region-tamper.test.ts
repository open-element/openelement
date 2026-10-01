/**
 * Alpha.10 closure verification — NEW parity probe added by the independent
 * release verifier (packet criterion 5). Drift vectors NOT present in
 * nested-region-part-paths.test.ts:
 *   - a static attribute REMOVED from a when-Region branch element in transit
 *   - an unexpected attribute INJECTED into an each-Region item in transit
 * Both must fail closed at claim, while SSR/fresh stay byte-identical.
 */

import { assertEquals, assertStringIncludes, assertThrows } from '@std/assert';
import {
  claimExistingDom,
  createFreshDom,
  PartProgramClaimError,
  serializeToHtml,
} from '../../src/internal/compiled/runtime.ts';
import { serializeProgramContent } from '../../src/internal/compiled/server/index.ts';
import { testProgram } from '../compiled-runtime/test-program.ts';
import { parseHtml, TestDocument, TestElement } from '../compiled-runtime/test-dom.ts';

class Sig<T> {
  #value: T;
  readonly #listeners = new Set<(value: T) => void>();
  constructor(value: T) {
    this.#value = value;
  }
  get value(): T {
    return this.#value;
  }
  set value(next: T) {
    this.#value = next;
    for (const listener of [...this.#listeners]) listener(next);
  }
  subscribe(listener: (value: T) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }
}

interface WhenHost {
  signals: { title: Sig<string>; count: Sig<number> };
}
interface EachHost {
  signals: { title: Sig<string>; items: Sig<Array<{ id: string; label: string }>> };
}

const whenHost = (): WhenHost => ({
  signals: { title: new Sig('DYN'), count: new Sig(5) },
});
const eachHost = (): EachHost => ({
  signals: {
    title: new Sig('DYN'),
    items: new Sig([
      { id: 'a', label: 'alpha' },
      { id: 'b', label: 'beta' },
    ]),
  },
});

const serializeServer = serializeProgramContent as unknown as (
  program: unknown,
  host: unknown,
) => string;
const serializeSeed = serializeToHtml as unknown as (program: unknown, host: unknown) => string;
const createFresh = createFreshDom as unknown as (
  program: unknown,
  host: unknown,
  root: Node,
) => { dispose(): void };
const claimExisting = claimExistingDom as unknown as (
  program: unknown,
  host: unknown,
  root: Node,
) => { dispose(): void };

function whenSiblingProgram(): unknown {
  return testProgram({
    tag: 'oe-a10v-when-sibling',
    template: [
      { k: 'el', tag: 'div', attrs: [], children: [] },
      { k: 'part', index: 1 },
    ],
    parts: [
      { k: 'attr', index: 0, signal: 'title', name: 'title', path: [0] },
      {
        k: 'when',
        index: 1,
        signal: 'count',
        test: { signal: 'count', op: 'greater-than', value: 0 },
        on: [{ k: 'el', tag: 'span', attrs: [['title', 'static-on']], children: [] }],
        off: [{ k: 'el', tag: 'span', attrs: [['title', 'static-off']], children: [] }],
      },
    ],
  });
}

function eachSiblingProgram(): unknown {
  return testProgram({
    tag: 'oe-a10v-each-sibling',
    template: [
      { k: 'el', tag: 'div', attrs: [], children: [] },
      { k: 'part', index: 1 },
    ],
    parts: [
      { k: 'attr', index: 0, signal: 'title', name: 'title', path: [0] },
      {
        k: 'each',
        index: 1,
        signal: 'items',
        key: 'id',
        item: [
          {
            k: 'el',
            tag: 'li',
            attrs: [['title', 'item-static']],
            iattrs: [['data-label', 'label']],
            children: [],
          },
        ],
      },
    ],
  });
}

Deno.test('alpha10-verifier parity: claim fails closed when a static attr is REMOVED inside a when Region branch', () => {
  const program = whenSiblingProgram();
  const host = whenHost();
  const html = serializeServer(program, host);
  // SSR/fresh parity holds on the untampered payload.
  assertEquals(serializeSeed(program, host), html);
  const freshDoc = new TestDocument();
  const freshRoot = freshDoc.createElement('host');
  createFresh(program, host, freshRoot as unknown as Node).dispose();
  assertEquals(freshRoot.innerHTML, html);

  const doc = new TestDocument();
  const root = parseHtml(doc, html);
  const span = root.childNodes[2] as TestElement;
  assertEquals(span.getAttribute('title'), 'static-on');
  span.removeAttribute('title'); // tamper: deletion, not value rewrite
  const error = assertThrows(
    () => claimExisting(program, whenHost(), root as unknown as Node),
    PartProgramClaimError,
  );
  assertStringIncludes(error.message, 'template[1].branch[0]');
});

Deno.test('alpha10-verifier parity: claim fails closed when an unexpected attr is INJECTED into an each Region item', () => {
  const program = eachSiblingProgram();
  const host = eachHost();
  const html = serializeServer(program, host);
  assertEquals(serializeSeed(program, host), html);
  const freshDoc = new TestDocument();
  const freshRoot = freshDoc.createElement('host');
  createFresh(program, host, freshRoot as unknown as Node).dispose();
  assertEquals(freshRoot.innerHTML, html);

  const doc = new TestDocument();
  const root = parseHtml(doc, html);
  const li = root.childNodes[3] as TestElement; // second keyed item
  li.setAttribute('data-injected', 'evil'); // tamper: injection, not rewrite
  const error = assertThrows(
    () => claimExisting(program, eachHost(), root as unknown as Node),
    PartProgramClaimError,
  );
  assertStringIncludes(error.message, 'template[1].item');
});

Deno.test('alpha10-verifier parity: untampered SSR payload still claims with zero allocations (control)', () => {
  const program = eachSiblingProgram();
  const doc = new TestDocument();
  const root = parseHtml(doc, serializeServer(program, eachHost()));
  const before = { ...doc.counts };
  claimExisting(program, eachHost(), root as unknown as Node).dispose();
  assertEquals({ ...doc.counts }, before, 'a clean claim must allocate nothing');
});
