/**
 * `16b-EB` SSR fallback, condition 2 of execution plan §19.2 — the render path
 * emits the boundary's fallback BYTES for a failing descendant producer, and the
 * failure is not swallowed.
 *
 * Condition 1 (the contract) is pinned at the helper in
 * `nested-host-expansion.test.ts`. This suite is the CONSUMER form: a real
 * `renderToString` pass over a light-root generated host whose nested generated
 * producer throws. That distinction matters here more than usual, because the
 * first implementation of condition 1 type-checked and its helper rows passed
 * while the real render had stopped expanding nested hosts altogether — the bug
 * was only visible when a full render ran.
 *
 * Four properties:
 *
 *   1. the failing descendant contributes the CALLER's literal bytes for that
 *      host (the boundary's fallback), so the render still returns markup;
 *   2. the failure reaches the report channel instead of failing the whole
 *      render;
 *   3. with NO report channel the original error propagates — the unchanged
 *      pre-`16b-EB` behaviour, i.e. this is not a silent swallow;
 *   4. a healthy sibling producer in the SAME render still expands normally.
 */

import { describe, expect, test } from 'vitest';
import { installFacadeDom } from '../compiled-runtime/facade-dom.ts';

// The harness owns the platform globals before the runtime module evaluates.
installFacadeDom();

const { renderToString } = await import('../../src/public-runtime.ts');
const { nestedHost } = await import('../../src/internal/compiled/runtime/nested-host.ts');
const { SSR_REGISTRY_GENERATED_HOSTS } = await import('@openelement/protocol/registry-markers');
const { __setRequestTimeStyleSheetUrls } =
  await import('../../src/internal/compiled/server/style-links.ts');

const PAGE = 'oe-eb-page';
/** The caller's own literal markup for each admitted tag — the boundary fallback. */
const FAILING_LITERAL = 'FAILING-LITERAL';
const HEALTHY_LITERAL = 'HEALTHY-LITERAL';
const FAILING = 'oe-eb-failing';
const HEALTHY = 'oe-eb-healthy';

type HostRenderer = (
  props: Readonly<Record<string, unknown>>,
  lightChildren: string,
  attributes: readonly (readonly [string, string])[] | undefined,
  styleLinks?: readonly string[],
) => string;

/**
 * A light-root generated page: its `__ssr` producer is the string builder the
 * compiler emits, and it emits `nestedHost(...)` for each dash tag — so the
 * failing child is reached through the SAME call the real emitter makes.
 */
function installRenderers(): { restore: () => void; calls: string[] } {
  const calls: string[] = [];
  const failing: HostRenderer = () => {
    calls.push(FAILING);
    throw new Error('descendant producer exploded');
  };
  const healthy: HostRenderer = () => {
    calls.push(HEALTHY);
    return `<${HEALTHY}><template shadowrootmode="open"><b>ok</b></template></${HEALTHY}>`;
  };
  // The PAGE is a LIGHT-ROOT class carrying the compiler-emitted `__ssr` producer
  // — the one root shape whose render installs the nested expander and hands it to
  // the producer as its third argument (`renderToString`'s light path). That is
  // the frame §19.2 condition 1 re-seated the fallback on.
  const original = Object.getOwnPropertyDescriptor(globalThis, 'customElements');
  const registry: Record<string, unknown> = {
    get: (tag: string) =>
      tag === PAGE
        ? Object.assign(class {}, {
            __ssr: (_props?: unknown, _attributes?: unknown, nestedExpander?: unknown) =>
              `<${PAGE} data-oe-light>` +
              nestedMarkup(nestedExpander, FAILING, FAILING_LITERAL) +
              nestedMarkup(nestedExpander, HEALTHY, HEALTHY_LITERAL) +
              `</${PAGE}>`,
          })
        : undefined,
  };
  registry[SSR_REGISTRY_GENERATED_HOSTS] = new Map<string, HostRenderer>([
    [FAILING, failing],
    [HEALTHY, healthy],
  ]);
  Object.defineProperty(globalThis, 'customElements', { configurable: true, value: registry });
  __setRequestTimeStyleSheetUrls([], null);
  return {
    calls,
    restore: () => {
      if (original) Object.defineProperty(globalThis, 'customElements', original);
      else delete (globalThis as Record<string, unknown>).customElements;
    },
  };
}

/**
 * The markup an emitted producer contributes for one admitted dash tag. The
 * emitted code calls `nestedHost(host, {…})`; this reproduces that call's
 * OBSERVABLE input (the tag plus the caller's literal fallback) without depending
 * on the compiler, so this suite tests the runtime contract rather than emission.
 */
function nestedMarkup(expander: unknown, tag: string, literal: string): string {
  // The light path hands the producer the RAW expander; the generated-element
  // shell wraps it into the `__oe_nestedHost` host record before calling the
  // producer. This suite drives `renderToString` directly, so it wraps the same
  // way the shell does — the wrapping is not the fact under test, the fallback is.
  const host = typeof expander === 'function' ? { __oe_nestedHost: expander } : expander;
  // The caller's own bytes: what the producer writes when nobody expands it.
  const open = `<${tag} data-literal="${literal}">`;
  return nestedHost(host, {
    tag,
    attributes: [],
    open,
    children: '',
    fallback: `${open}</${tag}>`,
  });
}

describe('16b-EB — a failing descendant producer renders the boundary fallback', () => {
  test('the render succeeds, keeps the healthy sibling, and reports the failure', () => {
    const { restore, calls } = installRenderers();
    const reported: unknown[] = [];
    let html = '';
    try {
      html = renderToString(PAGE, {
        ssrRenderableTags: [FAILING, HEALTHY],
        onNestedFailure: (error) => reported.push(error),
      });
    } finally {
      restore();
    }
    // (1) The render produced markup at all, and the failing host kept the
    // caller's literal bytes rather than vanishing or half-expanding.
    expect(html).toContain(`<${PAGE}`);
    expect(html).toContain(`data-literal="FAILING-LITERAL"`);
    // (2) The failure reached the boundary's report channel exactly once, with a
    // real error — observable, not swallowed.
    expect(reported).toHaveLength(1);
    expect((reported[0] as Error).message).toBe('descendant producer exploded');
    // (4) The healthy sibling in the SAME render still expanded to its DSD.
    expect(html).toContain(`<${HEALTHY}><template shadowrootmode="open"><b>ok</b></template>`);
    expect(calls).toEqual([FAILING, HEALTHY]);
  });

  test('with no report channel the original error propagates (no silent swallow)', () => {
    const { restore } = installRenderers();
    let caught: unknown;
    try {
      renderToString(PAGE, { ssrRenderableTags: [FAILING, HEALTHY] });
    } catch (error) {
      caught = error;
    } finally {
      restore();
    }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toBe('descendant producer exploded');
  });
});

describe('16b-EB — claim parity is structural: the fallback bytes are the no-expansion bytes', () => {
  test('the same producer emits byte-identical markup with and without a failing expander', () => {
    // §19.2 condition 3 asks for CLAIM PARITY over the fallback bytes. The claim
    // path is byte-driven — it parses the serialized host and adopts what it
    // finds — so parity holds exactly when the fallback bytes are
    // INDISTINGUISHABLE from the bytes of a render that never expanded the host.
    // This row measures that equality rather than asserting it in prose: the same
    // producer, once with an expander that throws for the tag and once with no
    // expander at all, must agree byte for byte.
    const withFailingExpander = renderPage({ [FAILING]: 'boom' });
    const withNoExpander = renderPage({});
    // The healthy sibling always expands; the FAILING tag's bytes are what must
    // agree, so compare with the reported failure already stripped out of the
    // render's own accounting (the only observable difference is the report).
    expect(withFailingExpander.html).toEqual(withNoExpander.html);
    // And the failure still did not vanish into that equality: it was reported.
    expect(withFailingExpander.reported).toHaveLength(1);
    // The healthy sibling expanded in BOTH renders (it is admitted either way).
    expect(withFailingExpander.html).toContain(`<${HEALTHY}><template shadowrootmode="open">`);
  });
});

/** Render the page with a per-tag expander map: `{ [tag]: 'boom' }` throws. */
function renderPage(throwing: Readonly<Record<string, string>>): {
  html: string;
  reported: unknown[];
} {
  const reported: unknown[] = [];
  const original = Object.getOwnPropertyDescriptor(globalThis, 'customElements');
  const registry: Record<string, unknown> = {
    get: (tag: string) =>
      tag === PAGE
        ? Object.assign(class {}, {
            __ssr: (_props?: unknown, _attributes?: unknown, nestedExpander?: unknown) =>
              `<${PAGE} data-oe-light>` +
              nestedMarkup(nestedExpander, FAILING, FAILING_LITERAL) +
              nestedMarkup(nestedExpander, HEALTHY, HEALTHY_LITERAL) +
              `</${PAGE}>`,
          })
        : undefined,
  };
  // The failing tag's renderer: it throws when the row asks it to, and is NOT
  // REGISTERED AT ALL otherwise — the "no expander" render must reach the tag
  // through the no-renderer path, not through a renderer that succeeds (a
  // succeeding renderer would expand it and the comparison would be meaningless,
  // which is what the first draft of this row measured).
  const failing: HostRenderer = () => {
    throw new Error('boom');
  };
  const healthy: HostRenderer = () =>
    `<${HEALTHY}><template shadowrootmode="open"><b>ok</b></template></${HEALTHY}>`;
  registry[SSR_REGISTRY_GENERATED_HOSTS] = new Map<string, HostRenderer>(
    throwing[FAILING] === undefined
      ? [[HEALTHY, healthy]]
      : [
          [FAILING, failing],
          [HEALTHY, healthy],
        ],
  );
  Object.defineProperty(globalThis, 'customElements', { configurable: true, value: registry });
  __setRequestTimeStyleSheetUrls([], null);
  let html = '';
  try {
    html = renderToString(PAGE, {
      ssrRenderableTags: [FAILING, HEALTHY],
      onNestedFailure: (error) => reported.push(error),
    });
  } finally {
    if (original) Object.defineProperty(globalThis, 'customElements', original);
    else delete (globalThis as Record<string, unknown>).customElements;
  }
  return { html, reported };
}
