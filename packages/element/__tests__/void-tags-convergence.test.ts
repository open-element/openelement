/**
 * VOID_TAGS convergence guard (issue #1220, M4).
 *
 * The canonical void-element set lives in
 * packages/element/src/internal/core/html-escape.ts. Three modules cannot
 * import it by design and therefore carry a documented mechanical mirror:
 *   - packages/element/src/sanitize.ts (dependency-free by contract, ADR-0126)
 *   - packages/element/src/internal/compiled/program.ts (import-free exchange artifact)
 *   - packages/element/src/internal/compiler/semantic-core/program.ts (same mirror)
 * This guard asserts every mirror's tag list is identical to the canonical
 * list and that no other production module re-introduces a local VOID_TAGS
 * definition. Test-harness DOM facades under __tests__ are independent
 * serializers and intentionally out of scope.
 */

import { assert, assertEquals } from '@std/assert';

const REPO_ROOT = new URL('../../../', import.meta.url);

const CANONICAL = 'packages/element/src/internal/core/html-escape.ts';
const MIRRORS = [
  'packages/element/src/sanitize.ts',
  'packages/element/src/internal/compiled/program.ts',
  'packages/element/src/internal/compiler/semantic-core/program.ts',
];
const IMPORTERS = [
  'packages/element/src/internal/compiled/runtime.ts',
  'packages/element/src/internal/compiled/server/shared.ts',
  'packages/element/src/internal/compiler/semantic-core/compile.ts',
];

function voidTagsBlock(source: string, path: string): string {
  const match = source.match(
    /VOID_TAGS(?::\s*ReadonlySet<string>)?\s*=\s*new Set\(\[([\s\S]*?)\]\)/,
  );
  assert(match, `${path}: VOID_TAGS definition not found`);
  return match[1];
}

function tagList(block: string): string[] {
  return [...block.matchAll(/'([^']+)'/g)].map((match) => match[1]);
}

Deno.test('VOID_TAGS mirrors stay byte-identical to the canonical definition', async () => {
  const canonicalSource = await Deno.readTextFile(new URL(CANONICAL, REPO_ROOT));
  const canonicalTags = tagList(voidTagsBlock(canonicalSource, CANONICAL));
  assertEquals(canonicalTags, [
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
  ]);
  for (const path of MIRRORS) {
    const source = await Deno.readTextFile(new URL(path, REPO_ROOT));
    assertEquals(
      voidTagsBlock(source, path),
      voidTagsBlock(canonicalSource, CANONICAL),
      `${path}: VOID_TAGS mirror drifted from the canonical definition`,
    );
  }
});

Deno.test('VOID_TAGS consumers import the canonical set instead of redefining it', async () => {
  for (const path of IMPORTERS) {
    const source = await Deno.readTextFile(new URL(path, REPO_ROOT));
    assert(
      !source.includes('const VOID_TAGS'),
      `${path}: re-introduced a local VOID_TAGS definition`,
    );
    assert(
      /\bVOID_TAGS\b/.test(source),
      `${path}: expected to use the imported VOID_TAGS`,
    );
  }
});
