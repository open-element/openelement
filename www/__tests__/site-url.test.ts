/**
 * Unit contract for the outward URL vocabulary (owner decision D-02).
 *
 * The rules are priority-encoded: a directory route gets a trailing slash, while
 * the localized root, flat routes and static assets must stay exactly as they
 * are. Locale stripping happens BEFORE the exception judgement, so `/zh` and
 * `/zh/404` normalize correctly.
 */
import { describe, expect, test } from 'vitest';
import {
  canonicalRoutePath,
  FLAT_ROUTES,
  normalizeSiteHref,
  SITE_ORIGIN,
  siteHref,
} from '../app/site-ui/site-url.ts';

describe('canonicalRoutePath', () => {
  test('root keeps the bare slash', () => {
    expect(canonicalRoutePath('/')).toBe('/');
  });

  test('directory routes gain the trailing slash', () => {
    expect(canonicalRoutePath('/docs')).toBe('/docs/');
    expect(canonicalRoutePath('/docs/')).toBe('/docs/');
    expect(canonicalRoutePath('/guide/getting-started')).toBe('/guide/getting-started/');
    expect(canonicalRoutePath('/architecture/comparison')).toBe('/architecture/comparison/');
    expect(canonicalRoutePath('/blog/1-0-0-alpha-1-baseline')).toBe(
      '/blog/1-0-0-alpha-1-baseline/',
    );
    // A slug that merely contains a dot is still a directory route: the static
    // rule is an explicit extension whitelist, not "the segment has a dot".
    expect(canonicalRoutePath('/blog/v1.2')).toBe('/blog/v1.2/');
  });

  test('flat routes and static assets are not slashed', () => {
    expect(FLAT_ROUTES.has('/404')).toBe(true);
    expect(canonicalRoutePath('/404')).toBe('/404');
    expect(canonicalRoutePath('/404/')).toBe('/404');
    expect(canonicalRoutePath('/favicon.svg')).toBe('/favicon.svg');
    expect(canonicalRoutePath('/client/assets/app.css')).toBe('/client/assets/app.css');
    expect(canonicalRoutePath('/sitemap.xml')).toBe('/sitemap.xml');
  });

  test('non-site inputs pass through', () => {
    expect(canonicalRoutePath('https://example.com/docs')).toBe('https://example.com/docs');
    expect(canonicalRoutePath('#anchor')).toBe('#anchor');
  });
});

describe('siteHref', () => {
  test('default locale keeps unprefixed canonical paths', () => {
    expect(siteHref('/docs', 'en')).toBe('/docs/');
    expect(siteHref('/', 'en')).toBe('/');
    expect(siteHref('/404', 'en')).toBe('/404');
    expect(siteHref('/favicon.svg', 'en')).toBe('/favicon.svg');
  });

  test('zh locale prefixes and still follows the same path rules', () => {
    expect(siteHref('/docs', 'zh')).toBe('/zh/docs/');
    expect(siteHref('/', 'zh')).toBe('/zh/');
    expect(siteHref('/zh', 'zh')).toBe('/zh/');
    expect(siteHref('/404', 'zh')).toBe('/zh/404');
    expect(siteHref('/zh/404', 'zh')).toBe('/zh/404');
    expect(siteHref('/guide/getting-started', 'zh')).toBe('/zh/guide/getting-started/');
  });

  test('query and hash are preserved after a slashed pathname', () => {
    expect(siteHref('/guide/configuration?x=1#middleware-use', 'en')).toBe(
      '/guide/configuration/?x=1#middleware-use',
    );
    expect(siteHref('/architecture/comparison#实测输出', 'zh')).toBe(
      '/zh/architecture/comparison/#实测输出',
    );
    expect(siteHref('/roadmap#now', 'en')).toBe('/roadmap/#now');
  });

  test('static assets are never locale-prefixed', () => {
    expect(siteHref('/favicon.svg', 'zh')).toBe('/favicon.svg');
    expect(siteHref('/client/assets/app.css', 'zh')).toBe('/client/assets/app.css');
    expect(siteHref('/pagefind/pagefind.js', 'en')).toBe('/pagefind/pagefind.js');
  });

  test('external and relative targets pass through unchanged', () => {
    for (const target of [
      'https://example.com/docs',
      '//cdn.example.com/x.js',
      'mailto:hi@example.com',
      'tel:+123',
      '#anchor',
      './relative',
      'relative',
    ]) {
      expect(siteHref(target, 'en')).toBe(target);
      expect(siteHref(target, 'zh')).toBe(target);
    }
  });
});

describe('normalizeSiteHref', () => {
  test('normalizes slash-less and slashed internal hrefs to one form', () => {
    expect(normalizeSiteHref('/docs')).toBe('/docs/');
    expect(normalizeSiteHref('/docs/')).toBe('/docs/');
    expect(normalizeSiteHref('/zh')).toBe('/zh/');
    expect(normalizeSiteHref('/zh/docs')).toBe('/zh/docs/');
    expect(normalizeSiteHref('/zh/404')).toBe('/zh/404');
    expect(normalizeSiteHref('/404/')).toBe('/404');
    expect(normalizeSiteHref('/')).toBe('/');
    expect(normalizeSiteHref('/zh/')).toBe('/zh/');
  });

  test('absolute URLs on the site origin are normalized; foreign hosts are not', () => {
    expect(normalizeSiteHref(`${SITE_ORIGIN}/docs`)).toBe(`${SITE_ORIGIN}/docs/`);
    expect(normalizeSiteHref(`${SITE_ORIGIN}/zh/docs#x`)).toBe(`${SITE_ORIGIN}/zh/docs/#x`);
    expect(normalizeSiteHref(`${SITE_ORIGIN}/`)).toBe(`${SITE_ORIGIN}/`);
    expect(normalizeSiteHref(`${SITE_ORIGIN}`)).toBe(`${SITE_ORIGIN}/`);
    expect(normalizeSiteHref('https://example.com/docs')).toBe('https://example.com/docs');
  });

  test('is idempotent', () => {
    for (const href of [
      '/docs/',
      '/zh/',
      '/zh/404',
      '/404',
      '/guide/a/?x=1#h',
      '/favicon.svg',
      `${SITE_ORIGIN}/docs/`,
      '#x',
      'https://example.com/x',
    ]) {
      const once = normalizeSiteHref(href);
      expect(normalizeSiteHref(once)).toBe(once);
    }
  });

  test('does not invent a slash for anchors or relative references', () => {
    expect(normalizeSiteHref('#element')).toBe('#element');
    expect(normalizeSiteHref('./x')).toBe('./x');
  });
});
