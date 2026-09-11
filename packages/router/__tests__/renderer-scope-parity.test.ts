/**
 * Renderer-scope binding corpus (B1.1 audit remediation, #1271 / finding F2).
 *
 * `rendererScopeMatches` (entry-route-helpers.ts) is the canonical codegen-time
 * scope predicate (used by entry-codegen.ts and entry-not-found-codegen.ts);
 * the generated `__matchingRenderers` function emitted by
 * `renderMatchingRenderersFn` is its runtime re-expression inside
 * self-contained generated entries, which cannot import adapter internals.
 * Before this test nothing bound the two: a predicate drift (trailing-slash,
 * boundary-separator or case handling) would have been silent. The corpus
 * below evaluates the generated function verbatim and requires observable
 * parity with the predicate for every (scope set, route path) pair.
 */

import { assertEquals } from '@std/assert';
import {
  rendererScopeMatches,
  renderMatchingRenderersFn,
} from '../src/vite/internal/ssg/entry-route-helpers.ts';
import type { RendererDecl } from '../src/vite/internal/protocol/ssg.ts';

function rendererDecls(scopes: readonly string[]): RendererDecl[] {
  return scopes.map((scope, index) => ({
    varName: `__renderer_${index}`,
    scope,
    importPath: `./_renderer_${index}.ts`,
    depth: 0,
  }));
}

/**
 * Evaluate the generated __matchingRenderers source verbatim. Each renderer
 * variable is bound to `{ default: <unique marker> }` so the returned array
 * identifies exactly which renderers the generated matcher selected.
 */
function evaluateGeneratedMatcher(
  renderers: RendererDecl[],
): (routePath: string) => unknown[] {
  const lines: string[] = [];
  renderMatchingRenderersFn(lines, renderers);
  const declarations = renderers
    .map((renderer, index) => `const ${renderer.varName} = { default: __markers[${index}] };`)
    .join('\n');
  const body = `${declarations}\n${lines.join('\n')}\nreturn __matchingRenderers;`;
  const factory = new Function('__markers', body) as (
    markers: unknown[],
  ) => (routePath: string) => unknown[];
  return factory(renderers.map((_, index) => ({ marker: index })));
}

/** Adversarial scope sets, including root-only, nested and sibling scopes. */
const SCOPE_SETS: ReadonlyArray<readonly string[]> = [
  ['/'],
  ['/docs'],
  ['/', '/docs'],
  ['/', '/docs', '/docs/api'],
  ['/docs', '/admin'],
  ['/docs/api'],
];

/** Route paths attacking exact, prefix, nested, non-match, boundary-separator and case handling. */
const ROUTE_PATHS: readonly string[] = [
  '/',
  '/docs',
  '/docs/',
  '/docs/api',
  '/docs/api/v1',
  '/docs/ap',
  '/docsify',
  '/documentation',
  '/Docs',
  '/admin',
  '/admin/users',
  '/other',
];

Deno.test('renderer scope parity: generated __matchingRenderers mirrors rendererScopeMatches', () => {
  for (const scopes of SCOPE_SETS) {
    const renderers = rendererDecls(scopes);
    const generated = evaluateGeneratedMatcher(renderers);
    for (const routePath of ROUTE_PATHS) {
      const expected = renderers
        .map((renderer, index) => ({ renderer, index }))
        .filter(({ renderer }) => rendererScopeMatches(routePath, renderer.scope))
        .map(({ index }) => ({ marker: index }));
      const actual = generated(routePath);
      assertEquals(
        actual,
        expected,
        `scope mirror diverged for scopes=${JSON.stringify(scopes)} routePath=${
          JSON.stringify(routePath)
        }`,
      );
    }
  }
});

Deno.test('renderer scope parity: boundary separators and case are significant', () => {
  // Pins the canonical predicate contract itself so a semantic change here
  // (not just a codegen/runtime skew) is a deliberate, reviewed act.
  assertEquals(rendererScopeMatches('/docs', '/docs'), true);
  assertEquals(rendererScopeMatches('/docs/api', '/docs'), true);
  assertEquals(rendererScopeMatches('/docsify', '/docs'), false);
  assertEquals(rendererScopeMatches('/Docs', '/docs'), false);
  assertEquals(rendererScopeMatches('/anything', '/'), true);
  assertEquals(rendererScopeMatches('/', '/'), true);
});
