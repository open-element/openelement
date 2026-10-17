/**
 * The component-stylesheet channel (alpha15 S lane) at the runtime level.
 *
 * The DSD serializer declares framework-generated component CSS as a marked
 * external `<link rel="stylesheet">`; the runtime's one adoption owner
 * (themeManager.applyStyles) must NOT adopt a second constructable copy into a
 * root whose own markup already references that URL. These tests pin the two
 * halves of that contract without a DOM implementation:
 *
 *   - the request-time setter/reader the generated SSR entry feeds;
 *   - link-delivered sheets are skipped, everything else is adopted, and
 *     unmarked/foreign links never satisfy the delivery check.
 */
import { beforeEach, expect, test } from 'vitest';
import { STYLE_SHEET_URL, type StyleSheetLike } from '@openelement/protocol/style-sheet';
import { STATIC_STYLES_MARKER } from '@openelement/protocol/part-program';
import {
  __setRequestTimeStyleSheetUrls,
  requestTimeStyleLinks,
} from '../src/internal/compiled/server/style-links.ts';
import { themeManager } from '../src/open-element-styles.ts';

/** A sheet double carrying the external-identity key. */
function sheetWithUrl(url: string | undefined): StyleSheetLike {
  const sheet = { cssRules: [], replaceSync: () => {} } as StyleSheetLike & Record<string, unknown>;
  if (url !== undefined) (sheet as Record<string, unknown>)[STYLE_SHEET_URL] = url;
  return sheet;
}

/** A shadow-root double: exactly the surface applyStyles touches. */
function rootWithLinks(links: readonly { href: string; marked: boolean }[]): ShadowRoot {
  const nodes = links.map((link) => ({
    getAttribute: (name: string) =>
      name === 'href' ? link.href : name === 'rel' ? 'stylesheet' : link.marked ? '' : null,
  }));
  return {
    adoptedStyleSheets: [],
    querySelectorAll: (selector: string) =>
      selector.includes(STATIC_STYLES_MARKER) && selector.includes('rel="stylesheet"') ? nodes : [],
  } as unknown as ShadowRoot;
}

beforeEach(() => {
  themeManager.resetStyles();
  __setRequestTimeStyleSheetUrls(null);
});

test('the request-time setter/reader carries the emitted URLs', () => {
  expect(requestTimeStyleLinks()).toEqual([]);
  __setRequestTimeStyleSheetUrls(['/client/assets/abc.css']);
  expect(requestTimeStyleLinks()).toEqual(['/client/assets/abc.css']);
  __setRequestTimeStyleSheetUrls(null);
  expect(requestTimeStyleLinks()).toEqual([]);
});

test('a link-delivered sheet is not adopted a second time', () => {
  const sheet = sheetWithUrl('/client/assets/abc.css');
  const root = rootWithLinks([{ href: '/client/assets/abc.css', marked: true }]);
  themeManager.applyStyles(root, [sheet]);
  expect(root.adoptedStyleSheets, 'no duplicate adoption for a delivered URL').toEqual([]);
});

test('a sheet with no delivered link adopts as before', () => {
  const sheet = sheetWithUrl('/client/assets/other.css');
  const root = rootWithLinks([{ href: '/client/assets/abc.css', marked: true }]);
  themeManager.applyStyles(root, [sheet]);
  expect(root.adoptedStyleSheets).toEqual([sheet]);
});

test('a sheet without an external identity is never treated as delivered', () => {
  const sheet = sheetWithUrl(undefined);
  const root = rootWithLinks([{ href: '/client/assets/abc.css', marked: true }]);
  themeManager.applyStyles(root, [sheet]);
  expect(root.adoptedStyleSheets).toEqual([sheet]);
});

test('a link with a different href does not satisfy the delivery', () => {
  const sheet = sheetWithUrl('/client/assets/abc.css');
  const root = rootWithLinks([{ href: '/client/assets/xyz.css', marked: true }]);
  themeManager.applyStyles(root, [sheet]);
  expect(root.adoptedStyleSheets).toEqual([sheet]);
});

test('globally registered sheets follow the same rule', () => {
  const sheet = sheetWithUrl('/client/assets/abc.css');
  themeManager.registerStyles([sheet]);
  const delivered = rootWithLinks([{ href: '/client/assets/abc.css', marked: true }]);
  themeManager.applyStyles(delivered);
  expect(delivered.adoptedStyleSheets).toEqual([]);
  const missing = rootWithLinks([]);
  themeManager.applyStyles(missing);
  expect(missing.adoptedStyleSheets).toEqual([sheet]);
});
