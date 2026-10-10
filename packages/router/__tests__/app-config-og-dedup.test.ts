/**
 * @openelement/router — site-level og meta dedup by route declaration.
 *
 * The site-level head block (openelement.config.ts `head`) emits og:title,
 * og:site_name, og:description, og:type and og:image. A route whose resolved
 * head.meta declares one of those properties owns it: the site-level default
 * for the SAME property is not emitted at all — the page's own tag serializes
 * through the Document seam's meta channel. Properties the route does not
 * declare keep the site-level defaults, and the serialization itself stays the
 * ONE emitter table in app-config.ts (P6): the dedup is a suppression set
 * threaded through the same emitters, never a second serializer.
 */

import { expect, test } from 'vitest';
import {
  filterHeadExtrasForRoute,
  headFragmentsForRoute,
  routeDeclaredOgProperties,
} from '../src/vite/app-config.ts';

const HEAD = {
  title: 'Site title',
  description: 'Site description',
  favicon: '/favicon.svg',
  ogImage: 'https://example.com/og.png',
};

/** The full site-level block with nothing suppressed (canonical emitter order). */
const FULL_SITE_BLOCK = [
  '<link rel="icon" href="/favicon.svg">',
  '<meta property="og:title" content="Site title">',
  '<meta property="og:site_name" content="Site title">',
  '<meta property="og:description" content="Site description">',
  '<meta property="og:type" content="website">',
  '<meta property="og:image" content="https://example.com/og.png">',
  '<meta name="twitter:card" content="summary_large_image">',
];

function fragmentsWithRouteMeta(meta: Array<Record<string, string>> | undefined): string[] {
  return headFragmentsForRoute(HEAD, 'Site title', meta);
}

test('og dedup: a route-declared og: property suppresses the same site-level default', () => {
  // The dispatch-page case: the route owns og:type (article) — the static
  // og:type=website boilerplate must not follow it into the document.
  const fragments = fragmentsWithRouteMeta([{ property: 'og:type', content: 'article' }]);
  expect(fragments).toEqual([
    '<link rel="icon" href="/favicon.svg">',
    '<meta property="og:title" content="Site title">',
    '<meta property="og:site_name" content="Site title">',
    '<meta property="og:description" content="Site description">',
    '<meta property="og:image" content="https://example.com/og.png">',
    '<meta name="twitter:card" content="summary_large_image">',
  ]);
});

test('og dedup: every site-level og property can be overridden by route declaration', () => {
  const fragments = fragmentsWithRouteMeta([
    { property: 'og:title', content: 'Page title' },
    { property: 'og:site_name', content: 'Page site name' },
    { property: 'og:description', content: 'Page description' },
    { property: 'og:type', content: 'article' },
    { property: 'og:image', content: 'https://example.com/page.png' },
  ]);
  // Only the non-og site fragments survive: the favicon link and the
  // twitter:card name= meta (not an og: property, so never suppressed).
  expect(fragments).toEqual([
    '<link rel="icon" href="/favicon.svg">',
    '<meta name="twitter:card" content="summary_large_image">',
  ]);
});

test('og dedup: properties the route does not declare keep the site-level defaults', () => {
  // og:url and name= entries are route-side data the site block never emits;
  // the site block must serialize byte-identically to the unfiltered one.
  expect(fragmentsWithRouteMeta([{ property: 'og:url', content: 'https://example.com/' }])).toEqual(
    FULL_SITE_BLOCK,
  );
  expect(fragmentsWithRouteMeta([{ name: 'robots', content: 'noindex' }])).toEqual(FULL_SITE_BLOCK);
});

test('og dedup: mixed — one declared property suppresses exactly its own site default', () => {
  const fragments = fragmentsWithRouteMeta([{ property: 'og:title', content: 'Page title' }]);
  expect(fragments).toEqual([
    '<link rel="icon" href="/favicon.svg">',
    // og:site_name is a distinct property: the og:title declaration does not own it.
    '<meta property="og:site_name" content="Site title">',
    '<meta property="og:description" content="Site description">',
    '<meta property="og:type" content="website">',
    '<meta property="og:image" content="https://example.com/og.png">',
    '<meta name="twitter:card" content="summary_large_image">',
  ]);
});

test('og dedup: no route meta (or an empty one) serializes the full site block', () => {
  expect(fragmentsWithRouteMeta(undefined)).toEqual(FULL_SITE_BLOCK);
  expect(fragmentsWithRouteMeta([])).toEqual(FULL_SITE_BLOCK);
});

test('routeDeclaredOgProperties: reads resolved-document meta records only', () => {
  expect(
    routeDeclaredOgProperties([
      { property: 'og:title', content: 'Page title' },
      { property: 'og:url', content: 'https://example.com/' },
      { name: 'twitter:card', content: 'summary_large_image' },
      // Non-string property values and malformed entries never contribute a
      // declaration (resolvePageDocument validates the array, not its
      // entries — the cast mirrors what can reach this at runtime).
      { property: 42 },
      null,
      7,
    ] as unknown as Array<Record<string, string>>),
  ).toEqual(new Set(['og:title', 'og:url']));
  expect(routeDeclaredOgProperties(undefined)).toEqual(new Set());
});

// ─── filterHeadExtrasForRoute: the baked-string face ────────────────────────
//
// The site-level fragments are serialized ONCE per build (headFragmentsFor →
// buildHeadExtras joins with '\n  ') and baked into __HEAD_EXTRAS__ / the
// per-handler literal. The filter removes, from that baked string, the og
// tags the route's resolved meta owns — the same per-property suppression
// headFragmentsForRoute threads through the emitters, applied where the
// route context finally exists (the generated entries' inline mirror).

/** The realistic baked string: the full site block joined exactly like buildHeadExtras. */
const BAKED_HEAD_EXTRAS = FULL_SITE_BLOCK.join('\n  ');

test('filterHeadExtrasForRoute: a route-declared og: property drops its site tag from the baked string', () => {
  const filtered = filterHeadExtrasForRoute(BAKED_HEAD_EXTRAS, [
    { property: 'og:title', content: 'Page title' },
  ]);
  expect(filtered).toEqual(
    [
      '<link rel="icon" href="/favicon.svg">',
      '<meta property="og:site_name" content="Site title">',
      '<meta property="og:description" content="Site description">',
      '<meta property="og:type" content="website">',
      '<meta property="og:image" content="https://example.com/og.png">',
      '<meta name="twitter:card" content="summary_large_image">',
    ].join('\n  '),
  );
});

test('filterHeadExtrasForRoute: every declared og: property drops exactly its own tag; name= never matches', () => {
  const filtered = filterHeadExtrasForRoute(BAKED_HEAD_EXTRAS, [
    { property: 'og:title', content: 'Page title' },
    { property: 'og:type', content: 'article' },
    { name: 'twitter:card', content: 'summary' },
  ]);
  expect(filtered).toEqual(
    [
      '<link rel="icon" href="/favicon.svg">',
      '<meta property="og:site_name" content="Site title">',
      '<meta property="og:description" content="Site description">',
      '<meta property="og:image" content="https://example.com/og.png">',
      '<meta name="twitter:card" content="summary_large_image">',
    ].join('\n  '),
  );
});

test('filterHeadExtrasForRoute: no og declarations leave the baked string byte-identical', () => {
  expect(filterHeadExtrasForRoute(BAKED_HEAD_EXTRAS, undefined)).toEqual(BAKED_HEAD_EXTRAS);
  expect(filterHeadExtrasForRoute(BAKED_HEAD_EXTRAS, [])).toEqual(BAKED_HEAD_EXTRAS);
  expect(
    filterHeadExtrasForRoute(BAKED_HEAD_EXTRAS, [{ name: 'robots', content: 'noindex' }]),
  ).toEqual(BAKED_HEAD_EXTRAS);
  // Malformed meta arrays (resolvePageDocument validates the array, not its
  // entries) never suppress anything.
  expect(
    filterHeadExtrasForRoute(BAKED_HEAD_EXTRAS, [null, 7, { property: 42 }] as unknown),
  ).toEqual(BAKED_HEAD_EXTRAS);
});
