/**
 * Lit/Native module-graph boundary (Beta.2.2, #1339 review item): prove with
 * a REAL static import-graph walk — not bundle string greps — that
 *
 *   1. the generated LIT server entry's module graph never reaches the Native
 *      runtime kernel (the package root barrel, the compiled-runtime facade,
 *      the compiled serializer or the signal engine), covering the source,
 *      dev-server (un-treeshaken, alias-resolved to source) and packed-artifact
 *      paths alike, since all three resolve the same subpath graph;
 *   2. the @openelement/element/html and /authoring leaves stay kernel-free;
 *   3. (negative control) the NATIVE entry's graph DOES reach the kernel — the
 *      walk can find it when it is actually present.
 *
 * Resolution mirrors what consumers get: package subpaths resolve through the
 * generated export map (generated-export-files.ts — the same map the adapter
 * aliases and the packed artifacts' package.json exports derive from), and
 * relative imports resolve on the real file system.
 */

import { assert, assertEquals } from '@std/assert';
import { dirname, resolve } from '@std/path';
import { buildEntryDescriptor, renderEntry } from '../src/internal/ssg/index.ts';
import { OPENELEMENT_EXPORT_FILES } from '../src/generated-export-files.ts';
import type { RouteEntry } from '../src/internal/protocol/framework.ts';

const REPO_ROOT = new URL('../../../', import.meta.url).pathname;

/** Static import/export specifiers of one module (side-effect imports included;
 *  statement-level `import type`/`export type` edges are erased at runtime and
 *  excluded — inline `type` specifiers in a value import keep the edge). */
function extractSpecifiers(source: string): string[] {
  const specs = new Set<string>();
  for (
    const match of source.matchAll(
      /(?:^|[;}])([\s]*)(?:import|export)\s+(?!type[\s{])(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]/gm,
    )
  ) {
    specs.add(match[2]);
  }
  return [...specs];
}

/**
 * Resolve a specifier to a repo file, or null when it is external to the
 * boundary claim (npm:/node:/hono/lit/@lit-labs runtime deps, and the
 * @openelement/generated/* build-time aliases produced by the adapter itself).
 */
function resolveSpecifier(spec: string, fromFile: string): string | null {
  if (spec.startsWith('.')) {
    const target = resolve(dirname(fromFile), spec);
    // Generated entries import the app's route modules relatively; the test
    // fixtures are virtual, so only on-disk files join the walk.
    try {
      return Deno.statSync(target).isFile ? target : null;
    } catch {
      return null;
    }
  }
  const pkgMatch = spec.match(/^@openelement\/(element|router|adapter-vite)(\/.*)?$/);
  if (!pkgMatch) return null;
  const [, pkg, suffix] = pkgMatch;
  // The generated export map keys are bare ('document', 'router/http', '.').
  const key = suffix ? suffix.slice(1) : '.';
  const file = OPENELEMENT_EXPORT_FILES[pkg]?.[key];
  if (!file) {
    throw new Error(`unmapped @openelement specifier in graph walk: ${spec} (from ${fromFile})`);
  }
  return resolve(REPO_ROOT, 'packages', pkg, file);
}

function walkModuleGraph(roots: string[]): { seen: Set<string>; parents: Map<string, string> } {
  const seen = new Set<string>();
  const parents = new Map<string, string>();
  const stack = [...roots];
  while (stack.length > 0) {
    const file = stack.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    const source = Deno.readTextFileSync(file);
    for (const spec of extractSpecifiers(source)) {
      const target = resolveSpecifier(spec, file);
      if (target && !seen.has(target)) {
        if (!parents.has(target)) parents.set(target, file);
        stack.push(target);
      }
    }
  }
  return { seen, parents };
}

/** The Native runtime kernel must never appear in a Lit graph. */
const KERNEL = [
  /packages\/element\/src\/index\.ts$/, // the runtime barrel
  /packages\/element\/src\/public-runtime\.ts$/, // the compiled-runtime facade
  /packages\/element\/src\/internal\/compiled\//, // the Part Program kernel/serializer
  /packages\/element\/src\/internal\/signal\//, // the signal engine
];

function assertKernelFree(
  graph: { seen: Set<string>; parents: Map<string, string> },
  label: string,
): void {
  for (const file of graph.seen) {
    for (const pattern of KERNEL) {
      if (pattern.test(file)) {
        // Report the full import path that pulled the kernel in.
        const chain: string[] = [file];
        let cur = file;
        while (graph.parents.has(cur)) {
          cur = graph.parents.get(cur)!;
          chain.unshift(cur);
        }
        assert(
          false,
          `${label} reached the Native runtime kernel: ${file}\nvia:\n  ${chain.join('\n  ')}`,
        );
      }
    }
  }
}

const litRoutes: RouteEntry[] = [
  { path: '/notes', filePath: 'notes.ts', type: 'page', varName: 'pageNotes', definePage: true },
];

/** Files a module specifiers' map directly to repo files (generated entries import bare specifiers). */
function graphRootsFromGenerated(source: string): string[] {
  const roots: string[] = [];
  for (const spec of extractSpecifiers(source)) {
    const target = resolveSpecifier(spec, REPO_ROOT);
    if (target) roots.push(target);
  }
  return roots;
}

Deno.test('lit server entry: module graph never reaches the Native runtime kernel', () => {
  const litEntry = renderEntry(
    buildEntryDescriptor(litRoutes, { renderer: 'lit', appShell: false, ssg: true }),
  );
  const graph = walkModuleGraph(graphRootsFromGenerated(litEntry));
  assertKernelFree(graph, 'lit server entry graph');
  // Sanity presence: the graph really contains the lit seam and the leaves.
  assert(graph.seen.has(resolve(REPO_ROOT, 'packages/router/src/lit-ssr.ts')), 'lit-ssr missing');
  assert(
    graph.seen.has(resolve(REPO_ROOT, 'packages/router/src/document.ts')),
    'document seam missing',
  );
  assert(graph.seen.has(resolve(REPO_ROOT, 'packages/element/src/html.ts')), 'html leaf missing');
});

Deno.test('element/html and element/authoring leaves are kernel-free', () => {
  for (const leaf of ['html.ts', 'authoring.ts']) {
    const graph = walkModuleGraph([resolve(REPO_ROOT, 'packages/element/src', leaf)]);
    assertKernelFree(graph, `@openelement/element/${leaf.replace('.ts', '')}`);
    // The leaves must be useful: the html graph carries the real serializer.
    if (leaf === 'html.ts') {
      assert(
        graph.seen.has(resolve(REPO_ROOT, 'packages/element/src/internal/core/html-escape.ts')),
        'html leaf must reach the single wrapInDocument implementation',
      );
    }
  }
});

Deno.test('negative control: the native server entry graph DOES reach the kernel', () => {
  const nativeEntry = renderEntry(buildEntryDescriptor(litRoutes, { ssg: true }));
  const graph = walkModuleGraph(graphRootsFromGenerated(nativeEntry));
  const reachesKernel = [...graph.seen].some((file) =>
    KERNEL.some((pattern) => pattern.test(file))
  );
  assertEquals(reachesKernel, true, 'the walk must find the Native kernel when it is present');
});
