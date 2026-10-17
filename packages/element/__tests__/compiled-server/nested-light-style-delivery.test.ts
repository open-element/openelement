/**
 * A light root nested inside another component's SHADOW TEMPLATE delivers its
 * sheets from that template (alpha15 consolidation follow-up, audit C).
 *
 * The delivery root is the tree the component's content lands in. For a
 * document-level light root that is the document, and the head link is the
 * delivery. For a light root inside an ancestor's DSD template it is the
 * ENCLOSING SHADOW ROOT — and a document-head stylesheet never matches elements
 * inside a shadow tree, so the head link delivered nothing at all while the
 * client adopted the sheet into a tree that could not reach its subject.
 *
 * The two halves are pinned together here, because either alone is passable:
 *   - server: the nested light component's marked `<link>` lands INSIDE the
 *     parent's `<template shadowrootmode>` and NOT in the document sink, as the
 *     child's LEADING node — the claim skips only leading marked style nodes,
 *     so a trailing link would fail the child's activation closed;
 *   - client: `adoptionTargetOf` resolves the enclosing tree
 *     (`light-style-adoption.test.ts` proves the adoption side).
 * The runtime shape is the SAME marked link every other component sheet uses,
 * so `sheetDeliveredByLink` recognizes it on the client and does not adopt a
 * second copy.
 */
import { afterEach, expect, test } from 'vitest';
import { resetErrorTelemetryHookForTests } from '../../src/internal/core/errors.ts';
import { installFacadeDom } from '../compiled-runtime/facade-dom.ts';
import { testProgram, type TestProgramSpec } from '../compiled-runtime/test-program.ts';

const dom = installFacadeDom();

const { OpenElement, renderToString } = await import('@openelement/element');

/** The serializer's marker, spelled independently of the runtime constant. */
const DSD_STYLE_MARKER = 'data-oe-static-styles';
/** The link the build adapters record on a sheet they own (protocol key). */
const STYLE_SHEET_URL = '__openElementStyleSheetUrl';

let counter = 0;
const uniqueTag = (prefix: string): string => `oe-nested-light-${prefix}-${++counter}`;

const PARENT_SHEET_URL = '/client/assets/parent-sheet.css';
const CHILD_SHEET_URL = '/client/assets/child-light-sheet.css';

function defineCompiled(
  spec: TestProgramSpec,
  statics: Record<string, unknown> = {},
): CustomElementConstructor {
  const program = testProgram(spec);
  const ctor = class extends OpenElement {} as unknown as CustomElementConstructor &
    Record<string, unknown>;
  ctor.__partProgram = program;
  ctor.__compiledProperties = program.metadata.properties;
  ctor.__elementMetadata = program.metadata;
  if (program.metadata.observedAttributes.length > 0) {
    ctor.observedAttributes = program.metadata.observedAttributes;
  }
  for (const [name, value] of Object.entries(statics)) ctor[name] = value;
  dom.registry.define(spec.tag, ctor);
  return ctor;
}

afterEach(() => {
  resetErrorTelemetryHookForTests();
});

/**
 * A sink that records what the render reported for the document head, with the
 * same dedup rule the real `createDocumentStyleResources` applies.
 */
function sink(): { links: string[]; add(urls: readonly string[]): void } {
  const links: string[] = [];
  return {
    links,
    add(urls) {
      for (const url of urls) if (!links.includes(url)) links.push(url);
    },
  };
}

test('a light root inside a DSD template declares its sheets IN that template', () => {
  const childTag = uniqueTag('child');
  const parentTag = uniqueTag('parent');
  const childSheet = { replaceSync() {}, cssRules: [], [STYLE_SHEET_URL]: CHILD_SHEET_URL };
  const parentSheet = { replaceSync() {}, cssRules: [], [STYLE_SHEET_URL]: PARENT_SHEET_URL };
  defineCompiled(
    {
      tag: childTag,
      rootMode: 'light',
      template: [{ k: 'el', tag: 'span', attrs: [], children: [] }],
      parts: [],
    },
    { styles: [childSheet] },
  );
  const parentCtor = defineCompiled(
    {
      tag: parentTag,
      rootMode: 'shadow-open',
      // The nested host carries a passthrough attribute whose value contains
      // every character that could derail a "first `>`" scan (`>`, `"`, `&`):
      // emission must escape them, and the splice must still land immediately
      // after the real opening tag (asserted below).
      template: [{ k: 'el', tag: childTag, attrs: [['data-note', 'a>b"c&d']], children: [] }],
      parts: [],
    },
    { styles: [parentSheet] },
  );

  const documentStyles = sink();
  const html = renderToString(parentTag, {
    componentClass: parentCtor,
    ssrRenderableTags: [childTag],
    documentStyles: documentStyles as never,
  });

  // The parent's template exists and carries the nested light element…
  const templateAt = html.indexOf('<template shadowrootmode="open"');
  expect(templateAt, 'the parent renders a DSD template').toBeGreaterThan(-1);
  const templateBody = html.slice(templateAt);
  expect(templateBody, 'the nested light component is inside the template').toContain(childTag);
  // …and the child's sheet is declared THERE, in the one shape the client's
  // delivery check recognizes.
  expect(templateBody, "the child's sheet link is inside the template").toContain(
    `<link rel="stylesheet" href="${CHILD_SHEET_URL}" ${DSD_STYLE_MARKER} />`,
  );
  // The link is the child's LEADING node, and the program content follows it:
  // the light root's own claim skips only leading marked style nodes and fails
  // closed on a trailing one, so the position is part of the delivery contract,
  // not cosmetics. Escaping keeps the hostile host attribute from producing a
  // raw `>` inside the opening tag (`a>b"c&d` may only appear escaped), which is
  // what makes "insert after the first `>`" correct.
  expect(templateBody, 'the hostile host attribute is escaped, never raw').toContain(
    'data-note="a&gt;b&quot;c&amp;d"',
  );
  expect(templateBody, 'no raw hostile attribute value in the markup').not.toContain('a>b"c&d');
  const open = new RegExp(`<${childTag}[^>]*>`).exec(templateBody);
  expect(open, 'the nested light host has exactly one opening tag').not.toBeNull();
  const childMarkup = templateBody.slice(open!.index + open![0].length);
  const nestedLink = `<link rel="stylesheet" href="${CHILD_SHEET_URL}" ${DSD_STYLE_MARKER} />`;
  expect(
    childMarkup.startsWith(nestedLink),
    "the child's sheet link is its FIRST node (the claim skips leading style nodes)",
  ).toBe(true);
  expect(
    childMarkup.slice(nestedLink.length),
    'the program content follows the leading style link',
  ).toMatch(/^<span>/);
  // The document head cannot reach a shadow tree, so it must not carry it.
  expect(documentStyles.links, 'the document sink must not receive it').not.toContain(
    CHILD_SHEET_URL,
  );
});

test('a document-level light root still reports to the document head', () => {
  // The other side of the same decision: nothing about the fix moves a
  // document-level light root off the head link.
  const tag = uniqueTag('page');
  const sheet = { replaceSync() {}, cssRules: [], [STYLE_SHEET_URL]: CHILD_SHEET_URL };
  const ctor = defineCompiled(
    {
      tag,
      rootMode: 'light',
      template: [{ k: 'el', tag: 'span', attrs: [], children: [] }],
      parts: [],
    },
    { styles: [sheet] },
  );

  const documentStyles = sink();
  renderToString(tag, { componentClass: ctor, documentStyles: documentStyles as never });
  expect(documentStyles.links, 'the head sink receives it').toContain(CHILD_SHEET_URL);
});
