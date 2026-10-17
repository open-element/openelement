/**
 * Canonical stylesheet resource identity (alpha15 S lane, S-C1.1) — the
 * deterministic guard for the Strict Claim acceptance rule.
 *
 * The guard is deliberately a pure-function test: the previous attempt at
 * negative coverage rewrote a live streaming SSR response in a browser and was
 * unstable, so the identity contract is pinned here instead, and the real
 * browser run covers the positive Claim path end to end.
 *
 * The rule under test: a marked DSD stylesheet link is accepted only when its
 * canonical URL — origin + pathname + search, resolved against the document
 * base — names a resource the build declared for that component. Syntax alone
 * never earns acceptance.
 */
import { expect, test } from 'vitest';
import {
  isExpectedStyleResource,
  styleResourceIdentity,
} from '../../src/internal/compiled/style-identity.ts';

/** A deployment whose document lives at this origin and base. */
const site = { baseURI: 'https://app.example/dashboard/' };

/** The origin-absolute spelling the client adapters carry. */
const seen = (identity: string) => identity;

test('an expected site asset is accepted in both spellings the pipeline produces', () => {
  // The server declares the site path; the client adapter carries the
  // bundler-resolved, origin-absolute URL. Same resource.
  const expected = ['/client/assets/card-abc123456789.css'];
  expect(isExpectedStyleResource('/client/assets/card-abc123456789.css', expected, site)).toBe(
    true,
  );
  expect(
    isExpectedStyleResource(
      'https://app.example/client/assets/card-abc123456789.css',
      expected,
      site,
    ),
  ).toBe(true);
});

test('a different, syntactically valid asset is rejected', () => {
  const expected = ['/client/assets/card-abc123456789.css'];
  expect(isExpectedStyleResource('/client/assets/dialog-000000000000.css', expected, site)).toBe(
    false,
  );
});

test('a different origin with the same path and query is rejected', () => {
  const expected = ['/client/assets/card-abc123456789.css'];
  expect(
    isExpectedStyleResource(
      'https://attacker.example/client/assets/card-abc123456789.css',
      expected,
      site,
    ),
    'a cross-origin link never passes for a site-owned resource',
  ).toBe(false);
});

test('a wrong content hash is rejected', () => {
  const expected = ['/client/assets/card-abc123456789.css'];
  expect(isExpectedStyleResource('/client/assets/card-ffffffffffff.css', expected, site)).toBe(
    false,
  );
});

test('a wrong version query is rejected, and the right one accepted', () => {
  const expected = ['/component-sheet.css?v=7f2a91c0'];
  expect(isExpectedStyleResource('/component-sheet.css?v=7f2a91c0', expected, site)).toBe(true);
  expect(isExpectedStyleResource('/component-sheet.css?v=0f000000', expected, site)).toBe(false);
  // A version suffix is part of the identity, not decoration: the unversioned
  // path is a different resource than the versioned one.
  expect(isExpectedStyleResource('/component-sheet.css', expected, site)).toBe(false);
});

test('a malformed href never matches a valid resource', () => {
  const expected = ['/client/assets/card-abc123456789.css'];
  expect(isExpectedStyleResource('not a url with spaces', expected, site)).toBe(false);
  expect(isExpectedStyleResource('', expected, site)).toBe(false);
  expect(isExpectedStyleResource('javascript:alert(1)', expected, site)).toBe(false);
  // A malformed expectation is its own identity and cannot be reached by a
  // resolved URL either.
  expect(isExpectedStyleResource('/client/assets/card-abc123456789.css', ['not a url'], site)).toBe(
    false,
  );
});

test('a trusted cross-origin resource must match in full', () => {
  const expected = ['https://cdn.example/assets/card-abc123456789.css'];
  expect(
    isExpectedStyleResource('https://cdn.example/assets/card-abc123456789.css', expected, site),
    'the declared external resource is accepted',
  ).toBe(true);
  expect(
    isExpectedStyleResource('/assets/card-abc123456789.css', expected, site),
    'a site-relative path is NOT the declared CDN resource',
  ).toBe(false);
  expect(
    isExpectedStyleResource(
      'https://other-cdn.example/assets/card-abc123456789.css',
      expected,
      site,
    ),
    'a different host serving the same path is not the declared resource',
  ).toBe(false);
});

test('an equivalent spelling of the same origin resolves to one identity', () => {
  // Origin-relative and origin-absolute are the same resource; a non-root
  // deployment base resolves the declared path against the deployment, not
  // against a build machine.
  const expected = ['/client/assets/card-abc123456789.css'];
  expect(
    isExpectedStyleResource('//app.example/client/assets/card-abc123456789.css', expected, site),
  ).toBe(true);
  expect(
    isExpectedStyleResource(
      'https://app.example/client/assets/card-abc123456789.css?',
      expected,
      site,
    ),
    'an empty query is not a version',
  ).toBe(true);
  const nested = { baseURI: 'https://app.example/deep/nested/page' };
  expect(
    isExpectedStyleResource('/client/assets/card-abc123456789.css', expected, nested),
    'a non-root deployment base keeps the site asset identity',
  ).toBe(true);
});

test('an encoded separator cannot collapse two different paths into one resource', () => {
  // `/a%2Fb.css` and `/a/b.css` address different resources; the encoder must
  // never be able to turn one into the other's identity.
  const expected = ['/client/assets/card.css'];
  expect(
    isExpectedStyleResource('/client/assets%2Fcard.css', expected, site),
    'an encoded slash is not a path separator',
  ).toBe(false);
});

test('opaque schemes cannot pass for a stylesheet resource', () => {
  const expected = ['/client/assets/card-abc123456789.css'];
  for (const href of [
    'data:text/css,body{}',
    'javascript:alert(1)',
    'blob:https://app.example/x',
  ]) {
    expect(isExpectedStyleResource(href, expected, site), href).toBe(false);
  }
});

test('no expectation means no acceptance', () => {
  expect(
    isExpectedStyleResource('/client/assets/card-abc123456789.css', [], site),
    'an absent fact must not inherit acceptance',
  ).toBe(false);
});

test('identity includes the origin, the path and the query', () => {
  expect(styleResourceIdentity('/a/b.css?v=1', site)).toBe('https://app.example/a/b.css?v=1');
  expect(styleResourceIdentity('https://other.example/a/b.css?v=1', site)).toBe(
    'https://other.example/a/b.css?v=1',
  );
  // Truly unparseable input has no canonical form: it keeps its raw text as
  // its own identity, so it can only match an identical raw string.
  expect(styleResourceIdentity('http://[', site)).toBe('http://[');
  // `seen` documents the client spelling this contract exists for.
  expect(styleResourceIdentity(seen('https://app.example/a/b.css?v=1'), site)).toBe(
    'https://app.example/a/b.css?v=1',
  );
});
