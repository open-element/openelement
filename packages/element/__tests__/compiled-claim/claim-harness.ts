/**
 * Shared wire-level claim fixtures for the nested-path (A10.4) and tamper
 * (alpha.10 verifier) suites: the structural signal, the two host shapes, the
 * wire-level views of the four executor entry points, and the sibling-sink
 * programs. Program tags take the suite's prefix so the suites register
 * distinguishable tags (`<prefix>-when-sibling` / `<prefix>-each-sibling`).
 */
import {
  claimExistingDom,
  createFreshDom,
  serializeToHtml,
} from '../../src/internal/compiled/runtime.ts';
import { serializeProgramContent } from '../../src/internal/compiled/server/index.ts';
import { testProgram } from '../compiled-runtime/test-program.ts';

/** Structural signal matching the runtime's SignalLike contract. */
export class Sig<T> {
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

export interface WhenHost {
  signals: { title: Sig<string>; count: Sig<number> };
}

export interface EachHost {
  signals: { title: Sig<string>; items: Sig<Array<{ id: string; label: string }>> };
}

export function whenHost(): WhenHost {
  return { signals: { title: new Sig('DYN'), count: new Sig(5) } };
}

export function eachHost(): EachHost {
  return {
    signals: {
      title: new Sig('DYN'),
      items: new Sig([
        { id: 'a', label: 'alpha' },
        { id: 'b', label: 'beta' },
      ]),
    },
  };
}

/** The executor entry points viewed through their wire-level shape. */
export const serializeServer = serializeProgramContent as unknown as (
  program: unknown,
  host: unknown,
) => string;
export const serializeSeed = serializeToHtml as unknown as (
  program: unknown,
  host: unknown,
) => string;
export const createFresh = createFreshDom as unknown as (
  program: unknown,
  host: unknown,
  root: Node,
) => { dispose(): void };
export const claimExisting = claimExistingDom as unknown as (
  program: unknown,
  host: unknown,
  root: Node,
) => { dispose(): void };

/**
 * `element(dynamic attr)` immediately followed by `when └ element` — the
 * valid shape closest to the A10.4 audit suspicion: the branch element's
 * Region-relative position collides with the sibling sink's canonical path
 * [0] if the claim/serialize recursion ever resets the path.
 */
export function whenSiblingProgram(tagPrefix: string): unknown {
  return testProgram({
    tag: `${tagPrefix}-when-sibling`,
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

/**
 * `element(dynamic attr)` followed by `each └ element(item attr)` — the only
 * dynamic-attribute form valid INSIDE a Region: per-item attribute slots.
 */
export function eachSiblingProgram(tagPrefix: string): unknown {
  return testProgram({
    tag: `${tagPrefix}-each-sibling`,
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
