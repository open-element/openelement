/**
 * Resolver-driven static module reachability (S-C1.4, #1609).
 *
 * The client build's graph contains the islands and only the islands, so a
 * Page, Layout or component that the server renders alone is not in it — and
 * neither is the authored `.css` edge it declares. The build host already knows
 * which ROUTE/PAGE/LAYOUT sources the server renders; what it could not do was
 * follow their module edges, because the app is free to reach a component
 * through any specifier form the bundler understands: a relative path, a
 * `package.json` `imports` subpath (`#site-ui/open-artifact-panel.tsx`), a
 * configured alias, or a package export path.
 *
 * This walk asks the BUNDLER for every answer. Specifiers come from the
 * compiler's own module analysis (`analyzeModuleSemantics.moduleSpecifiers`),
 * resolution comes from the live plugin context (`this.resolve`, with the
 * importing module as the importer so alias, `imports` and export conditions
 * apply exactly as they do for a real import), and both are deduplicated by
 * RESOLVED module identity — never by specifier text, which is not an identity.
 *
 * The walk does not execute anything, does not import anything, and does not
 * write anything: a caller may admit the returned modules for their admission
 * facts alone.
 *
 * Deliberate boundaries, reported rather than glossed over:
 *
 * - a `.css` specifier is not followed here: that edge is the compiler's to
 *   register (`registerStyleEdges`), and following it would be a second
 *   dependency model;
 * - `external` resolutions (the resolver's own verdict) are skipped;
 * - virtual ids (`\0…`, browser/worker builtins, `data:`/`http:` specifiers)
 *   have no file to read and are skipped;
 * - DYNAMIC imports are not static edges: they are not part of the static
 *   reachability contract, and a dynamic-only dependency is exactly the case
 *   the SSR half must diagnose instead of guessing;
 * - non-source files (JSON, assets) are skipped;
 * - the walk is bounded by `maxModules` so a pathological graph fails loudly
 *   instead of crawling without limit.
 */

import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import { analyzeModuleSemantics } from '@openelement/compiler';

/** The plugin-context surface the walk needs (a real Vite/Rolldown context). */
export interface ModuleWalkResolver {
  resolve(
    specifier: string,
    importer?: string,
  ): Promise<{ id: string; external?: boolean | 'absolute' | 'relative' } | null>;
}

/** One walk's outcome: the deduplicated module set plus what was not followed. */
export interface ModuleWalkResult {
  /** Resolved module ids, in deterministic (breadth-first, seed-order) order. */
  readonly files: string[];
  /** Resolution outcomes that were deliberately not followed. */
  readonly skipped: {
    readonly external: number;
    readonly virtual: number;
    readonly nonSource: number;
    readonly unresolved: number;
    readonly dynamic: number;
  };
  /**
   * Dynamic `import('literal')` specifiers, collected only when the caller
   * opts in (`collectDynamicImports`). A dynamic import is not a static edge
   * and never enters `files` — the record exists so the caller can diagnose
   * what the scan-time reachability contract cannot prove.
   */
  readonly dynamicImports: ReadonlyArray<{ specifier: string; importer: string }>;
  /** True when the walk stopped at `maxModules` (a reported, not silent, stop). */
  readonly truncated: boolean;
}

const SOURCE_FILE_RE = /\.(ts|tsx|js|jsx|mts|mjs|cts|cjs)$/;
const DEFAULT_MAX_MODULES = 4000;

/**
 * Walk the static module graph from `seeds`, resolving every specifier through
 * the bundler and deduplicating by resolved identity.
 */
export async function walkModuleGraph(
  resolver: ModuleWalkResolver,
  seeds: Iterable<string>,
  options: { maxModules?: number; collectDynamicImports?: boolean } = {},
): Promise<ModuleWalkResult> {
  const maxModules = options.maxModules ?? DEFAULT_MAX_MODULES;
  const files: string[] = [];
  const visited = new Set<string>();
  const queue: string[] = [];
  const skipped = { external: 0, virtual: 0, nonSource: 0, unresolved: 0, dynamic: 0 };
  const dynamicImports: Array<{ specifier: string; importer: string }> = [];
  let truncated = false;

  const enqueue = (id: string): void => {
    if (visited.has(id)) return;
    visited.add(id);
    files.push(id);
    queue.push(id);
  };
  for (const seed of seeds) enqueue(seed);

  while (queue.length > 0) {
    if (files.length >= maxModules) {
      truncated = true;
      break;
    }
    const file = queue.shift()!;
    if (!SOURCE_FILE_RE.test(file)) continue;
    let source: string;
    try {
      source = await readFile(file, 'utf8');
    } catch {
      continue;
    }
    if (options.collectDynamicImports === true) {
      for (const specifier of dynamicImportSpecifiersOf(source, file)) {
        dynamicImports.push({ specifier, importer: file });
      }
    }
    for (const specifier of staticSpecifiersOf(source, file)) {
      let resolved: { id: string; external?: boolean | 'absolute' | 'relative' } | null;
      try {
        resolved = await resolver.resolve(specifier, file);
      } catch {
        skipped.unresolved += 1;
        continue;
      }
      if (resolved === null) {
        skipped.unresolved += 1;
        continue;
      }
      if (resolved.external === true) {
        skipped.external += 1;
        continue;
      }
      const id = resolved.id.split('?', 1)[0]!;
      if (id.startsWith('\0') || /^(data|https?):/.test(id) || id.startsWith('virtual:')) {
        skipped.virtual += 1;
        continue;
      }
      if (!SOURCE_FILE_RE.test(id)) {
        // `.css` lands here too: the compiler's style-edge registration owns
        // that edge, not this walk.
        skipped.nonSource += 1;
        continue;
      }
      enqueue(id);
    }
  }

  return { files, skipped, dynamicImports, truncated };
}

/**
 * The static specifiers one source spells. `moduleSpecifiers` covers static
 * import/export declarations only; a dynamic `import()` is deliberately not
 * part of the static reachability contract (`skipped.dynamic` is reserved for
 * callers that scan for them explicitly).
 */
function staticSpecifiersOf(source: string, file: string): readonly string[] {
  try {
    return analyzeModuleSemantics(source, file, { collectSpecifiers: true }).moduleSpecifiers ?? [];
  } catch {
    return [];
  }
}

/**
 * The dynamic `import('literal')` specifiers one source spells — the facts a
 * static walk cannot follow, recorded so a caller can diagnose them instead of
 * guessing. A non-literal (computed) argument is invisible here by the same
 * contract: nothing statically provable, nothing reported.
 */
function dynamicImportSpecifiersOf(source: string, file: string): readonly string[] {
  const specifiers: string[] = [];
  let sourceFile: ts.SourceFile;
  try {
    sourceFile = ts.createSourceFile(
      file,
      source,
      ts.ScriptTarget.Latest,
      /* setParentNodes */ false,
      file.endsWith('.tsx') || file.endsWith('.jsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );
  } catch {
    return specifiers;
  }
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments.length === 1 &&
      ts.isStringLiteralLike(node.arguments[0]!)
    ) {
      specifiers.push(node.arguments[0]!.text);
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sourceFile, visit);
  return specifiers;
}
