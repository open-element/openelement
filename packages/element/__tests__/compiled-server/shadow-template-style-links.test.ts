/**
 * A generated SHADOW host's DSD template declares exactly the stylesheets its
 * own content needs — its per-island sheet, plus the sheet of a nested LIGHT
 * child that actually lands inside that template. It must NOT declare the
 * app-wide union of every admitted island's sheet (F16 measured defect: the
 * `/generated` fixture page root carried 7 marked links for 1 own sheet).
 *
 * The union came from a pre-fill in `createNestedHostExpander`: it seeded the
 * lift sink from EVERY tag in `ssrRenderableTags` (the app-wide admission set),
 * so each shadow template declared every styled island in the application.
 *
 * Two contracts have to hold together, which is why the fix threads a LIVE list
 * instead of pre-filling a union:
 *
 * 1. a shadow host's template declares only its own sheet plus the sheets of
 *    nested LIGHT children that are actually expanded into it (the template is
 *    a STRING BUILDER: its content is evaluated before the host is serialized,
 *    so a list appended to during expansion is complete when the DSD leaf reads
 *    it);
 * 2. a nested SHADOW child declares its own sheet in ITS OWN template and never
 *    leaks that sheet into the enclosing one.
 *
 * The producers below mirror the compiler-emitted wrapper's evaluation order
 * (`content:` is computed before the `styleLinks` property, see emit.ts), which
 * is what makes contract 1 observable.
 */

import { afterEach, expect, test } from 'vitest';
import { renderToString } from '../../src/public-runtime.ts';
import { serializeGeneratedElementHtml } from '../../src/internal/compiled/generated-element/dsd-ssr.ts';
import { __setRequestTimeStyleSheetUrls } from '../../src/internal/compiled/server/style-links.ts';
import { SSR_REGISTRY_GENERATED_HOSTS } from '@openelement/protocol/registry-markers';

const SHADOW_PAGE = 'oe-shadow-page';
const NESTED_LIGHT = 'oe-nested-light';
const OTHER_LIGHT = 'oe-other-light';
const OTHER_SHADOW = 'oe-other-shadow';

const OWN = '/client/assets/own.css';
const NESTED_LIGHT_URL = '/client/assets/nested-light.css';
const OTHER_LIGHT_URL = '/client/assets/other-light.css';
const OTHER_SHADOW_URL = '/client/assets/other-shadow.css';

/** One marked link in `html`, in document order. */
function markedLinks(html: string): string[] {
  return [...html.matchAll(/<link rel="stylesheet" href="([^"]+)" data-oe-static-styles \/>/g)].map(
    (match) => match[1]!,
  );
}

/**
 * The content of the DSD template belonging to `hostTag`, including a nested
 * template's markup when the child host sits inside it (the parser's template
 * nesting is not a regex `<template>…</template>` pair).
 */
function templateOf(html: string, hostTag: string): string | undefined {
  const hostAt = html.indexOf(`<${hostTag}`);
  if (hostAt < 0) return undefined;
  const openAt = html.indexOf('<template', hostAt);
  if (openAt < 0) return undefined;
  const scan = /<template\b[^>]*>|<\/template>/g;
  scan.lastIndex = openAt;
  let depth = 0;
  let start = -1;
  for (let match = scan.exec(html); match !== null; match = scan.exec(html)) {
    if (match[0] === '</template>') {
      depth -= 1;
      if (depth === 0) return html.slice(start, match.index);
      continue;
    }
    if (depth === 0) start = match.index + match[0].length;
    depth += 1;
  }
  return undefined;
}

/**
 * The link list inside the DSD template belonging to `hostTag`. A nested child
 * host's own template markup sits INSIDE the parent template's content, so it is
 * stripped first: this reads the links the template itself declares.
 */
function templateLinks(html: string, hostTag: string): string[] {
  let content = templateOf(html, hostTag);
  if (content === undefined) return [];
  for (;;) {
    const stripped = content.replace(/<template\b[^>]*>[\s\S]*?<\/template>/g, '');
    if (stripped === content) break;
    content = stripped;
  }
  return markedLinks(content);
}

type NestedExpandRequest = {
  readonly tag: string;
  readonly attributes: ReadonlyArray<readonly [string, string]>;
  readonly open: string;
  readonly children: string;
  readonly fallback: string;
};

type HostRenderer = (
  props: Readonly<Record<string, unknown>>,
  lightChildren: string | undefined,
  attributes: readonly (readonly [string, string])[] | undefined,
  styleLinks?: readonly string[],
  nestedHost?: unknown,
) => unknown;

/** Install a fake SSR registry: the generated-host pair table plus class lookups. */
function withRegistry(
  pairs: ReadonlyMap<string, unknown>,
  classes: ReadonlyMap<string, { __ssr?: () => unknown }>,
  run: () => void,
): void {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'customElements');
  const registry: Record<string, unknown> = {
    get: (tag: string) => classes.get(tag),
  };
  registry[SSR_REGISTRY_GENERATED_HOSTS] = new Map(pairs);
  Object.defineProperty(globalThis, 'customElements', { configurable: true, value: registry });
  try {
    run();
  } finally {
    if (original) Object.defineProperty(globalThis, 'customElements', original);
    else delete (globalThis as Record<string, unknown>).customElements;
  }
}

/**
 * A compiler-emitted shadow host producer. `nested` names the tags the leaf
 * expands inside its content (in authored order); the content is built FIRST so
 * a live `styleLinks` list is complete by serialization time, exactly like the
 * emitted wrapper.
 */
function shadowProducer(tag: string, nested: readonly string[] = []): HostRenderer {
  return (_props, _lightChildren, _attributes, styleLinks, nestedHost) => {
    let content = '';
    for (const nestedTag of nested) {
      const request: NestedExpandRequest = {
        tag: nestedTag,
        attributes: [],
        open: `<${nestedTag}>`,
        children: '',
        fallback: `<${nestedTag}></${nestedTag}>`,
      };
      const expanded = (nestedHost as ((input: NestedExpandRequest) => unknown) | undefined)?.(
        request,
      );
      content += typeof expanded === 'string' ? expanded : '';
    }
    content += '<section part="content">page</section>';
    return serializeGeneratedElementHtml({
      tag,
      root: 'open' as const,
      content,
      ...(styleLinks === undefined ? {} : { styleLinks }),
    });
  };
}

const LIGHT_CLASS = {
  __ssr: () => '<span class="nested-light">nested</span>',
};

afterEach(() => {
  __setRequestTimeStyleSheetUrls(null);
});

test('a shadow host declares ONLY its own sheet, never the app-wide admission union', () => {
  // Every tag below is admitted and styled; only SHADOW_PAGE's template may
  // declare a link, and only its own.
  __setRequestTimeStyleSheetUrls(
    [],
    [
      [SHADOW_PAGE, [OWN]],
      [NESTED_LIGHT, [NESTED_LIGHT_URL]],
      [OTHER_LIGHT, [OTHER_LIGHT_URL]],
      [OTHER_SHADOW, [OTHER_SHADOW_URL]],
    ],
  );
  let html = '';
  withRegistry(
    new Map([[SHADOW_PAGE, shadowProducer(SHADOW_PAGE)]]),
    new Map([[NESTED_LIGHT, LIGHT_CLASS]]),
    () => {
      html = renderToString(SHADOW_PAGE, {
        props: {},
        ssrRenderableTags: [SHADOW_PAGE, NESTED_LIGHT, OTHER_LIGHT, OTHER_SHADOW],
      });
    },
  );
  expect(templateLinks(html, SHADOW_PAGE)).toEqual([OWN]);
});

test('a nested LIGHT child that lands in the template still lifts its sheet there', () => {
  __setRequestTimeStyleSheetUrls(
    [],
    [
      [SHADOW_PAGE, [OWN]],
      [NESTED_LIGHT, [NESTED_LIGHT_URL]],
      [OTHER_LIGHT, [OTHER_LIGHT_URL]],
    ],
  );
  let html = '';
  withRegistry(
    new Map([[SHADOW_PAGE, shadowProducer(SHADOW_PAGE, [NESTED_LIGHT])]]),
    new Map([[NESTED_LIGHT, LIGHT_CLASS]]),
    () => {
      html = renderToString(SHADOW_PAGE, {
        props: {},
        ssrRenderableTags: [SHADOW_PAGE, NESTED_LIGHT, OTHER_LIGHT],
      });
    },
  );
  // Own sheet first, then the lifted nested-light sheet; the unrelated light
  // island is not in this template's content and contributes nothing.
  expect(templateLinks(html, SHADOW_PAGE)).toEqual([OWN, NESTED_LIGHT_URL]);
  expect(html).toContain('data-oe-light');
});

test("a nested SHADOW child keeps its sheet in its OWN template, never the parent's", () => {
  __setRequestTimeStyleSheetUrls(
    [],
    [
      [SHADOW_PAGE, [OWN]],
      [OTHER_SHADOW, [OTHER_SHADOW_URL]],
      [NESTED_LIGHT, [NESTED_LIGHT_URL]],
    ],
  );
  let html = '';
  withRegistry(
    new Map([
      [SHADOW_PAGE, shadowProducer(SHADOW_PAGE, [OTHER_SHADOW])],
      [OTHER_SHADOW, shadowProducer(OTHER_SHADOW, [NESTED_LIGHT])],
    ]),
    new Map([[NESTED_LIGHT, LIGHT_CLASS]]),
    () => {
      html = renderToString(SHADOW_PAGE, {
        props: {},
        ssrRenderableTags: [SHADOW_PAGE, OTHER_SHADOW, NESTED_LIGHT],
      });
    },
  );
  // Parent template: own only. Child template: own + the light child it nests.
  expect(templateLinks(html, SHADOW_PAGE)).toEqual([OWN]);
  expect(templateLinks(html, OTHER_SHADOW)).toEqual([OTHER_SHADOW_URL, NESTED_LIGHT_URL]);
  // One delivery per resource across the whole host tree: 1 + 2, no union dupe.
  expect(markedLinks(html)).toHaveLength(3);
});

test('a nested LIGHT child sharing the host sheet keeps one marked link', () => {
  __setRequestTimeStyleSheetUrls(
    [],
    [
      [SHADOW_PAGE, [OWN]],
      // Two components delivered by the same emitted asset is the documented
      // one-resource/one-link contract; the template must not log who asked.
      [NESTED_LIGHT, [OWN]],
    ],
  );
  let html = '';
  withRegistry(
    new Map([[SHADOW_PAGE, shadowProducer(SHADOW_PAGE, [NESTED_LIGHT])]]),
    new Map([[NESTED_LIGHT, LIGHT_CLASS]]),
    () => {
      html = renderToString(SHADOW_PAGE, {
        props: {},
        ssrRenderableTags: [SHADOW_PAGE, NESTED_LIGHT],
      });
    },
  );
  expect(templateLinks(html, SHADOW_PAGE)).toEqual([OWN]);
});
