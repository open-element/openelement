/**
 * M11-2 — the serializer's ROOT page path invokes a registered generated host
 * producer (Node; the real compiler+entry+browser vertical is the router /
 * fixture suites).
 *
 * A generated page's host class carries no `__partProgram`. The generated
 * entry pairs the compiler-emitted `<Name>__ssrHost` producer with the tag
 * through the ONE registry guard (`SSR_REGISTRY_GENERATED_HOSTS`), exactly the
 * table the nested expansion already reads. This suite pins the root path:
 *
 * - a paired tag renders through the SAME helper the nested branch uses
 *   (props channel, no light children, no host attributes at the root) and
 *   never probes the class or its program;
 * - the per-island stylesheet URLs come from the SAME request-time style-link
 *   channel the generated entry fills; `null` (declared but carrier
 *   unavailable) fails closed instead of rendering the host unstyled;
 * - a malformed table / present-but-invalid entry / non-string producer result
 *   keeps the existing fail-closed identities;
 * - a tag with no pair entry keeps the compiled-class path byte-identical.
 */

import { afterEach, describe, expect, test } from 'vitest';
import { renderToString } from '../../src/public-runtime.ts';
import { serializeGeneratedElementHtml } from '../../src/internal/compiled/generated-element/dsd-ssr.ts';
import { __setRequestTimeStyleSheetUrls } from '../../src/internal/compiled/server/style-links.ts';
import { SSR_REGISTRY_GENERATED_HOSTS } from '@openelement/protocol/registry-markers';
import { trustedHtml } from '../../src/internal/core/security.ts';

const HOST_TAG = 'oe-generated-page';

type HostRenderer = (
  props: Readonly<Record<string, unknown>>,
  lightChildren: string | undefined,
  attributes: readonly (readonly [string, string])[] | undefined,
  styleLinks?: readonly string[],
) => unknown;

function withGeneratedRegistry(entries: ReadonlyMap<string, unknown>, run: () => void): void {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'customElements');
  const registry: Record<string, unknown> = { get: () => undefined };
  registry[SSR_REGISTRY_GENERATED_HOSTS] = new Map(entries);
  Object.defineProperty(globalThis, 'customElements', { configurable: true, value: registry });
  try {
    run();
  } finally {
    if (original) Object.defineProperty(globalThis, 'customElements', original);
    else delete (globalThis as Record<string, unknown>).customElements;
  }
}

/** The emitted host producer shape: the compiler wrapper over the DSD leaf. */
function hostProducer(
  calls: unknown[][],
  options: { readonly root?: 'open' | 'light'; readonly result?: unknown } = {},
): HostRenderer {
  return (props, lightChildren, attributes, styleLinks) => {
    calls.push([props, lightChildren, attributes, styleLinks]);
    if (options.result !== undefined) return options.result;
    const base = {
      tag: HOST_TAG,
      root: options.root ?? ('open' as const),
      content: '<article part="card"><h2>page</h2></article>',
      ...(lightChildren === undefined ? {} : { lightChildren }),
      ...(attributes === undefined ? {} : { attributes }),
      ...(styleLinks === undefined ? {} : { styleLinks }),
    };
    return serializeGeneratedElementHtml(base);
  };
}

afterEach(() => {
  __setRequestTimeStyleSheetUrls(null);
});

describe('generated page root dispatch', () => {
  test('a generated host rendered through __ssr keeps its light children', () => {
    // The server function lane's `__ssr(tag, props, source, composition)` hands
    // a shadow host its authored children as `hostChildren` and undeclared
    // props as host attributes. The root dispatch must carry both to the
    // producer instead of rendering the host empty.
    const calls: unknown[][] = [];
    let html = '';
    withGeneratedRegistry(new Map([[HOST_TAG, hostProducer(calls)]]), () => {
      html = renderToString(HOST_TAG, {
        props: { title: 'Hello' },
        hostAttrs: [['class', 'frame']],
        hostChildren: trustedHtml('<div class="slotted"><pre>code</pre></div>'),
      });
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]![1]).toEqual('<div class="slotted"><pre>code</pre></div>');
    expect(calls[0]![2]).toEqual([['class', 'frame']]);
    expect(html).toContain('<div class="slotted"><pre>code</pre></div>');
  });

  test('a paired tag renders through the host producer before any program probe', () => {
    const calls: unknown[][] = [];
    let html = '';
    withGeneratedRegistry(new Map([[HOST_TAG, hostProducer(calls)]]), () => {
      html = renderToString(HOST_TAG, { props: { title: 'Hello' } });
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]![0]).toEqual({ title: 'Hello' });
    expect(calls[0]![1]).toBeUndefined();
    expect(calls[0]![2]).toBeUndefined();
    expect(calls[0]![3]).toBeUndefined();
    expect(html).toContain('<oe-generated-page>');
    expect(html).toContain('<template shadowrootmode="open">');
    expect(html).toContain('<h2>page</h2>');
  });

  test('the request-time island style channel is passed through (styled page shadow host)', () => {
    const calls: unknown[][] = [];
    let html = '';
    __setRequestTimeStyleSheetUrls(null, [[HOST_TAG, ['/client/assets/generated-page-abc.css']]]);
    withGeneratedRegistry(new Map([[HOST_TAG, hostProducer(calls)]]), () => {
      html = renderToString(HOST_TAG, { props: {} });
    });
    expect(calls[0]![3]).toEqual(['/client/assets/generated-page-abc.css']);
    expect(html).toContain(
      '<link rel="stylesheet" href="/client/assets/generated-page-abc.css" data-oe-static-styles />',
    );
  });

  test('the explicit unavailable carrier fails closed instead of rendering unstyled', () => {
    const calls: unknown[][] = [];
    __setRequestTimeStyleSheetUrls(null, [[HOST_TAG, null]]);
    withGeneratedRegistry(new Map([[HOST_TAG, hostProducer(calls)]]), () => {
      expect(() => renderToString(HOST_TAG, { props: {} })).toThrow(
        /declares IslandConfig\.styles on a shadow root/,
      );
    });
    expect(calls).toHaveLength(0);
  });

  test('malformed, invalid and non-string entries keep the coded fail-closed identities', () => {
    // Non-Map table: the guard is its only writer, so a foreign marker fails.
    const original = Object.getOwnPropertyDescriptor(globalThis, 'customElements');
    Object.defineProperty(globalThis, 'customElements', {
      configurable: true,
      value: { get: () => undefined, [SSR_REGISTRY_GENERATED_HOSTS]: {} },
    });
    try {
      expect(() => renderToString(HOST_TAG, { props: {} })).toThrow(
        /generated-host table is malformed/,
      );
    } finally {
      if (original) Object.defineProperty(globalThis, 'customElements', original);
      else delete (globalThis as Record<string, unknown>).customElements;
    }

    // Present-but-invalid entry: never silently treated as absent.
    withGeneratedRegistry(new Map([[HOST_TAG, 'not-a-function']]), () => {
      expect(() => renderToString(HOST_TAG, { props: {} })).toThrow(
        /is paired with a string renderer/,
      );
    });

    // The emitted producer must always return the host markup string.
    withGeneratedRegistry(
      new Map([[HOST_TAG, hostProducer([], { result: undefined })]]),
      () => undefined,
    );
    withGeneratedRegistry(new Map([[HOST_TAG, () => 42]]), () => {
      expect(() => renderToString(HOST_TAG, { props: {} })).toThrow(
        /produced number instead of an HTML string/,
      );
    });
  });

  test('an unpaired tag keeps the class path: the pair table alone renders nothing', () => {
    withGeneratedRegistry(new Map(), () => {
      // The table exists but has no entry for this tag: the class/program path
      // runs, so an unregistered tag still fails closed exactly as before.
      expect(() => renderToString('oe-not-a-generated-page')).toThrow(/found no compiled class/);
    });
  });
});
