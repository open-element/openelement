/**
 * VOID_TAGS single-owner guard (issue #1220, M4).
 *
 * One canonical, import-free, host-free owner:
 *   packages/element/src/internal/protocol/void-tags.ts
 * The runtime module (internal/core/html-escape.ts) and the Part Program
 * exchange artifact (internal/protocol/part-program.ts) re-export it, and the
 * compiler/runtime/serializer consumers reference it. This guard asserts the
 * owner matches the HTML Standard void-element set and that no production
 * module re-introduces a second definition. Test-harness DOM facades under
 * __tests__ are independent serializers and intentionally out of scope.
 */

import { readFile } from 'node:fs/promises';
import { expect, test } from 'vitest';

const REPO_ROOT = new URL('../../../', import.meta.url);

const OWNER = 'packages/element/src/internal/protocol/void-tags.ts';
const REEXPORTERS = [
  'packages/element/src/internal/core/html-escape.ts',
  'packages/element/src/internal/protocol/part-program.ts',
];
const CONSUMERS = [
  'packages/element/src/internal/compiled/serializer/serialize-program.ts',
  'packages/element/src/internal/compiled/server/shared.ts',
  'packages/element/src/internal/compiler/semantic-core/lower-program.ts',
];

/** The full HTML Standard void-element set (param included). */
const HTML_VOID_ELEMENTS = [
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr',
];

function voidTagsBlock(source: string, path: string): string {
  const match = source.match(
    /VOID_TAGS(?::\s*ReadonlySet<string>)?\s*=\s*new Set\(\[([\s\S]*?)\]\)/,
  );
  expect(match, `${path}: VOID_TAGS set definition not found`).toBeTruthy();
  return match[1];
}

test('VOID_TAGS owner matches the HTML Standard void-element set', async () => {
  const source = await readFile(new URL(OWNER, REPO_ROOT), 'utf8');
  const tags = [...voidTagsBlock(source, OWNER).matchAll(/'([^']+)'/g)].map((m) => m[1]);
  expect(tags).toEqual(HTML_VOID_ELEMENTS);
});

test('VOID_TAGS has one definition; the runtime and protocol re-export it', async () => {
  const owner = await readFile(new URL(OWNER, REPO_ROOT), 'utf8');
  expect(
    owner.includes('export const VOID_TAGS'),
    `${OWNER}: must own the definition`,
  ).toBeTruthy();
  for (const path of REEXPORTERS) {
    const source = await readFile(new URL(path, REPO_ROOT), 'utf8');
    expect(
      !/VOID_TAGS[^=]*=\s*new Set\(/.test(source),
      `${path}: must not redefine VOID_TAGS`,
    ).toBeTruthy();
    expect(
      /void-tags\.ts/.test(source) && /\bVOID_TAGS\b/.test(source),
      `${path}: must import/re-export the canonical VOID_TAGS owner`,
    ).toBeTruthy();
  }
});

test('VOID_TAGS consumers reference the shared set instead of redefining it', async () => {
  for (const path of CONSUMERS) {
    const source = await readFile(new URL(path, REPO_ROOT), 'utf8');
    expect(
      !source.includes('const VOID_TAGS') && !/VOID_TAGS[^=]*=\s*new Set\(/.test(source),
      `${path}: re-introduced a local VOID_TAGS definition`,
    ).toBeTruthy();
    expect(
      /\bVOID_TAGS\b/.test(source),
      `${path}: expected to use the imported VOID_TAGS`,
    ).toBeTruthy();
  }
});
