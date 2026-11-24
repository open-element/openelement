/**
 * Generated LIGHT hosts render through the public server consumer, including
 * their caller's authored slot groups, descendant CSS destination and the
 * composition-depth budget.
 */
import { afterEach, expect, test } from 'vitest';
import { installFacadeDom } from '../compiled-runtime/facade-dom.ts';

const dom = installFacadeDom();
const [
  { createGeneratedElementClass },
  { createRecipe },
  { renderToString, createDocumentStyleResources },
  { __setRequestTimeStyleSheetUrls },
  { nestedHost },
  { markerText, slotAnchorMarker },
] = await Promise.all([
  import('../../src/internal/compiled/generated-element/shell.ts'),
  import('../../src/internal/compiled/runtime/recipe.ts'),
  import('../../src/public-runtime.ts'),
  import('../../src/internal/compiled/server/style-links.ts'),
  import('../../src/internal/compiled/runtime/nested-host.ts'),
  import('../../src/internal/compiled/runtime/markers.ts'),
]);

type SsrProducer = (props: Readonly<Record<string, unknown>>, host?: unknown) => string;

function generatedLight(tag: string, producer: SsrProducer): CustomElementConstructor {
  return createGeneratedElementClass({
    tag,
    root: 'light',
    ssrProducer: producer as () => string,
    createRecipe: (owner) =>
      createRecipe({
        definitionOwner: owner as never,
        mount: () => [],
        claim: () => [],
        createProps: () => ({}),
      }) as never,
  }) as unknown as CustomElementConstructor;
}

function define(tag: string, producer: SsrProducer): CustomElementConstructor {
  const ctor = generatedLight(tag, producer);
  dom.registry.define(tag, ctor);
  return ctor;
}

function slotRegion(ordinal: number, name: string): string {
  return `<!--${markerText(slotAnchorMarker(ordinal, name))}--><!--${markerText(
    slotAnchorMarker(ordinal, name, true),
  )}-->`;
}

afterEach(() => {
  __setRequestTimeStyleSheetUrls(null);
});

test('a generated parent projects nested light children into named and default slots', () => {
  const childTag = 'oe-generated-light-projection-child';
  const parentTag = 'oe-generated-light-projection-parent';
  define(childTag, () => {
    return `<section><slot name="title">${slotRegion(0, 'title')}</slot><slot>${slotRegion(1, '')}</slot></section>`;
  });
  define(parentTag, (_props, host) => {
    const title = '<h2 slot="title">Caller title</h2>';
    const body = '<p>Caller body</p>';
    return nestedHost(host, {
      tag: childTag,
      attributes: [['aria-label', 'nested child']],
      open: `<${childTag} aria-label="nested child">`,
      children: `${title}${body}`,
      fallback: `<${childTag} aria-label="nested child">${title}${body}</${childTag}>`,
      groups: [
        ['title', title],
        ['', body],
      ],
    });
  });

  const html = renderToString(parentTag, { ssrRenderableTags: [parentTag, childTag] });
  expect(html).toBe(
    `<${parentTag} data-oe-light><${childTag} aria-label="nested child" data-oe-light data-oe-light-projected>` +
      '<section><slot name="title"><h2 slot="title">Caller title</h2></slot>' +
      '<slot><p>Caller body</p></slot></section></' +
      `${childTag}></${parentTag}>`,
  );
});

test('nested light styles reach the document collector in discovery order', () => {
  const parentTag = 'oe-generated-light-style-parent';
  const childTag = 'oe-generated-light-style-child';
  const grandchildTag = 'oe-generated-light-style-grandchild';
  const parentCss = '/assets/generated-light-parent.css';
  const childCss = '/assets/generated-light-child.css';
  const grandchildCss = '/assets/generated-light-grandchild.css';

  define(grandchildTag, () => '<i>grandchild</i>');
  define(childTag, (_props, host) =>
    nestedHost(host, {
      tag: grandchildTag,
      attributes: [],
      open: `<${grandchildTag}>`,
      children: '',
      fallback: `<${grandchildTag}></${grandchildTag}>`,
      groups: [],
    }),
  );
  define(parentTag, (_props, host) =>
    nestedHost(host, {
      tag: childTag,
      attributes: [],
      open: `<${childTag}>`,
      children: '',
      fallback: `<${childTag}></${childTag}>`,
      groups: [],
    }),
  );
  __setRequestTimeStyleSheetUrls(
    [],
    [
      [parentTag, [parentCss]],
      [childTag, [childCss]],
      [grandchildTag, [grandchildCss]],
    ],
  );

  const documentStyles = createDocumentStyleResources();
  renderToString(parentTag, {
    ssrRenderableTags: [parentTag, childTag, grandchildTag],
    documentStyles,
  });
  expect(documentStyles.links).toEqual([parentCss, childCss, grandchildCss]);
});

test('generated nested light recursion enforces the shared composition depth limit', () => {
  const tags = Array.from({ length: 10 }, (_, index) => `oe-generated-light-depth-${index}`);
  for (let index = 0; index < tags.length; index += 1) {
    const tag = tags[index]!;
    const next = tags[index + 1];
    define(tag, (_props, host) => {
      if (next === undefined) return '<b>end</b>';
      return nestedHost(host, {
        tag: next,
        attributes: [],
        open: `<${next}>`,
        children: '',
        fallback: `<${next}></${next}>`,
        groups: [],
      });
    });
  }

  let caught: unknown;
  try {
    renderToString(tags[0]!, { ssrRenderableTags: tags });
  } catch (error) {
    caught = error;
  }
  expect(caught).toMatchObject({ code: 'OE_SSR_COMPOSITION_DEPTH' });
});

test('renderToString derives the tag from a generated light constructor', () => {
  const tag = 'oe-generated-light-constructor';
  const ctor = generatedLight(tag, () => '<strong>from constructor</strong>');

  expect((ctor as unknown as { __oeTag?: string }).__oeTag).toBe(tag);
  expect(renderToString(ctor)).toBe(
    `<${tag} data-oe-light><strong>from constructor</strong></${tag}>`,
  );
});
