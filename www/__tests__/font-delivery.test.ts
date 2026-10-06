/**
 * Font-delivery seam drift guard (#1554, seams.md "Site font delivery").
 *
 * app/head.tsx is the one writer of the CDN font pins (stylesheet URLs +
 * integrity hashes + preloads); www/public/assets/manifest.json records the
 * same faces as `remote` third-party entries for provenance accounting, and
 * THIRD_PARTY_NOTICES.md names the versions in prose. A version rotation that
 * updates one side and not the other is the drift this test fails on — the
 * consumer form is exactly how the two artifacts agree today: the
 * `@<version>/` segment of every fontsource path head.tsx pins must be pinned
 * by the manifest too, and vice versa.
 */
import { expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FONT_CDN_ORIGIN, FONT_FACES, FONT_PRELOADS } from '../app/head.tsx';

interface ManifestEntry {
  path?: string;
  kind?: string;
  remote?: unknown;
}

const manifestRoot = JSON.parse(
  readFileSync(join(import.meta.dirname, '..', 'public', 'assets', 'manifest.json'), 'utf8'),
) as { assets?: ManifestEntry[] } | ManifestEntry[];

const entries: ManifestEntry[] = Array.isArray(manifestRoot)
  ? manifestRoot
  : (manifestRoot.assets ?? []);

const FONTSOURCE_PATH = /npm\/(@fontsource[^@]*@[0-9.]+)\//g;

/** The fontsource package-plus-version pin (`@fontsource/x@1.2.3`) in a path. */
function pins(paths: string[]): Set<string> {
  const found = new Set<string>();
  for (const path of paths) {
    for (const match of path.matchAll(FONTSOURCE_PATH)) found.add(match[1]!);
  }
  return found;
}

test('font delivery: head CDN origin is the pinned jsDelivr origin', () => {
  expect(FONT_CDN_ORIGIN).toEqual('https://cdn.jsdelivr.net');
});

test('font delivery: head pins and manifest remote entries pin the same fontsource versions', () => {
  const headPaths = [
    ...FONT_FACES.map((face) => face.css),
    ...FONT_PRELOADS.map((href) => href.replace(/^\//, '')),
  ];
  const headPins = pins(headPaths);
  expect(headPins.size, 'head.tsx pins at least one fontsource package').toBeGreaterThan(0);

  const manifestPaths = entries
    .filter((entry) => entry.kind === 'third-party')
    .map((entry) => entry.path ?? '');
  const manifestPins = pins(manifestPaths);

  const headOnly = [...headPins].filter((pin) => !manifestPins.has(pin));
  const manifestOnly = [...manifestPins].filter((pin) => !headPins.has(pin));
  expect(
    { headOnly, manifestOnly },
    'fontsource version pins drifted between app/head.tsx and the asset manifest — ' +
      'rotate both together (and THIRD_PARTY_NOTICES.md, the prose copy)',
  ).toEqual({ headOnly: [], manifestOnly: [] });
});

test('font delivery: every preload is the ./files/ sibling of a face stylesheet', () => {
  // head.tsx's preload contract: the preloaded woff2 must be what the linked
  // wght.css resolves, or the preload is wasted and the swap lands late.
  for (const preload of FONT_PRELOADS) {
    const pkgDir = preload.split('/files/')[0];
    const prefix = pkgDir + '/';
    expect(
      FONT_FACES.some((face) => face.css.startsWith(prefix)),
      'preload ' + preload + ' has no linked face stylesheet under ' + prefix,
    ).toBe(true);
  }
});
