/** Dependency boundaries observed from installed packages and emitted browser assets. */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import ts from 'typescript';

/** Boundary pattern: no compiler, router-internal tooling, host or workspace leakage. */
const BOUNDARY_ID_PATTERN = /compiler|router(?:\/src)?\/vite|router\/cli(?:[/.]|$)|node:/;
const BOUNDARY_SPECIFIER_PATTERN =
  /compiler|router(?:\/src)?\/vite|router\/cli(?:[/.]|$)|^node:|workspace:/;
// The vite/cli alternatives are anchored ((?:[/.]|$)) so a legitimate module
// name like ./internal/router/client-router.js — whose path carries the
// substring "router/cli" — is not flagged as a router/cli tooling edge. The
// anchored `router(?:\/src)?\/(?:vite|cli)` form covers both the router/src
// and plain router spellings of the vite plugins and the CLI.
export const DECLARATION_LEAK_PATTERN =
  /compiler|router(?:\/src)?\/(?:vite|cli)(?:[/.]|$)|\bvite\b|^node:|workspace:/;

/**
 * Type-bearing module specifiers of one declaration file: `import ... from`
 * and `export ... from` edges. Side-effect-only imports (no import clause)
 * are excluded — they carry no consumer type surface. The vp generator emits
 * them faithfully into `.d.ts` for module-order fidelity, so a packed
 * declaration graph may reference an optional peer; leak scans must still see
 * every specifier, and only the resolution walk uses this edge set.
 */
export function declarationTypeEdges(text: string): string[] {
  const source = ts.createSourceFile(
    'graph.d.ts',
    text,
    ts.ScriptTarget.ESNext,
    true,
    ts.ScriptKind.TS,
  );
  const edges: string[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isImportDeclaration(node) &&
      node.importClause !== undefined &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      edges.push(node.moduleSpecifier.text);
    } else if (
      ts.isExportDeclaration(node) &&
      node.moduleSpecifier !== undefined &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      edges.push(node.moduleSpecifier.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return edges;
}

// The one packed-artifact declaration walker: consumer-packaged-element,
// consumer-packaged-ui and the router leg below all walk with it. The leak
// scan sees every specifier in the graph (including side-effect-only
// imports); the resolution walk follows type-bearing edges only
// (declarationTypeEdges) — a packed graph may reference an optional peer that
// the consumer has not installed, and such a side-effect-only import carries
// no type surface to resolve. Missing declarations (pack dropped them) are
// reported module-by-module; any problem fails the caller's cell.

export interface PackedDeclarationWalk {
  /** Distinct declaration modules visited. */
  modules: number;
  /** Leak, unresolved-edge, and missing-declaration violations. */
  problems: string[];
}

export function walkPackedDeclarations(options: {
  /** Absolute entry declaration files to walk from (callers pre-verify them). */
  entries: readonly string[];
  /** Defaults to DECLARATION_LEAK_PATTERN. */
  leakPattern?: RegExp;
}): PackedDeclarationWalk {
  const leakPattern = options.leakPattern ?? DECLARATION_LEAK_PATTERN;
  const host = {
    fileExists: (name: string): boolean => {
      try {
        return statSync(name).isFile();
      } catch {
        return false;
      }
    },
    readFile: (name: string): string | undefined => {
      try {
        return readFileSync(name, 'utf8');
      } catch {
        return undefined;
      }
    },
  };
  const leaks: string[] = [];
  const unresolved: string[] = [];
  const missingDeclarations: string[] = [];
  const seen = new Set<string>();
  const walk = (path: string): void => {
    if (seen.has(path)) return;
    seen.add(path);
    const text = readFileSync(path, 'utf8');
    // Leak scan sees every specifier, including side-effect-only imports.
    for (const { fileName } of ts.preProcessFile(text).importedFiles) {
      if (leakPattern.test(fileName)) leaks.push(`${path} -> ${fileName}`);
    }
    // Resolution walk follows type-bearing edges only (see declarationTypeEdges).
    for (const fileName of declarationTypeEdges(text)) {
      const resolved = ts.resolveModuleName(
        fileName,
        path,
        {
          moduleResolution: ts.ModuleResolutionKind.Bundler,
          module: ts.ModuleKind.ESNext,
        },
        host,
      ).resolvedModule;
      if (!resolved) {
        unresolved.push(`${path} -> ${fileName}`);
        continue;
      }
      if (!/\.d\.[cm]?ts$/.test(resolved.resolvedFileName)) {
        missingDeclarations.push(
          `${path} -> ${fileName} (resolves to ${resolved.resolvedFileName}; ` +
            'the packed tarball ships no .d.ts for this module)',
        );
        continue;
      }
      walk(resolved.resolvedFileName);
    }
  };
  for (const entry of options.entries) walk(entry);
  const problems: string[] = [];
  if (leaks.length > 0) problems.push(`leaky declaration edges:\n${leaks.join('\n')}`);
  if (unresolved.length > 0) {
    problems.push(`unresolved declaration edges:\n${unresolved.join('\n')}`);
  }
  if (missingDeclarations.length > 0) {
    problems.push(`modules lacking packed declarations:\n${missingDeclarations.join('\n')}`);
  }
  return { modules: seen.size, problems };
}

/**
 * Router-leg boundary cell: follow .d.ts import edges from the published
 * @openelement/router entries (index/document) through the shared walker.
 * Every edge must resolve to a declaration file, and no edge may name the
 * compiler, router-internal tooling, vite, a host builtin or a workspace
 * specifier. The retired ./lit and ./lit-ssr declaration entries are no longer
 * part of the packed surface.
 */
function walkRouterDeclarations(tmp: string): string {
  const routerSrc = join(tmp, 'node_modules', '@openelement', 'router', 'src');
  const entries = ['index.d.ts', 'document.d.ts'];
  const missingEntries = entries.filter((entry) => !existsSync(join(routerSrc, entry)));
  if (missingEntries.length > 0) {
    throw new Error(
      'Packed @openelement/router tarball lacks declaration entries ' +
        `(vp pack dropped them): ${missingEntries.join(', ')}`,
    );
  }
  const { modules, problems } = walkPackedDeclarations({
    entries: entries.map((entry) => join(routerSrc, entry)),
  });
  if (problems.length > 0) {
    throw new Error(
      `Packed @openelement/router declaration graph violations:\n${problems.join('\n')}`,
    );
  }
  return `${modules} declaration modules resolved clean from index/document`;
}

// ─── Packed element-leaf module graph (boundary cell) ───────────────────────
//
// #1339 review: the kernel-free claim for the element leaves must hold on the
// PACKED artifact, not only the workspace source graph (which
// packages/router/__tests__/entry-graph-boundary.test.ts proves). Walk the
// installed @openelement/element/src/{html,logger,authoring}.js graphs inside
// the consumer's node_modules and require the Native runtime kernel (the root
// barrel, the compiled-runtime facade, the compiled serializer, the signal
// engine) to be unreachable. This is a real module-graph walk over the
// installed artifact, not a string search.

const PACKED_KERNEL_PATTERNS = [
  /\/src\/index\.js$/, // the runtime barrel
  /\/src\/public-runtime\.js$/, // the compiled-runtime facade
  /\/src\/internal\/compiled\//, // the Part Program kernel/serializer
  /\/src\/internal\/signal\//, // the signal engine
];

function assertPackedElementLeavesKernelFree(tmp: string): string {
  const elementDir = join(tmp, 'node_modules', '@openelement', 'element');
  const pkgJson = JSON.parse(readFileSync(join(elementDir, 'package.json'), 'utf8'));
  const seen = new Set<string>();
  const stack: string[] = [];
  for (const subpath of ['./html', './logger', './authoring']) {
    const entry = pkgJson.exports?.[subpath];
    const entryFile = typeof entry === 'string' ? entry : entry?.import;
    if (typeof entryFile !== 'string') {
      throw new Error(`packed @openelement/element lacks the ${subpath} export`);
    }
    stack.push(join(elementDir, entryFile));
  }
  while (stack.length > 0) {
    const file = stack.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    const text = readFileSync(file, 'utf8');
    for (const { fileName } of ts.preProcessFile(text).importedFiles) {
      if (!fileName.startsWith('.')) continue;
      const target = join(dirname(file), fileName);
      for (const pattern of PACKED_KERNEL_PATTERNS) {
        if (pattern.test(target)) {
          throw new Error(
            `packed element leaf graph reaches the Native runtime kernel: ${file} -> ${fileName}`,
          );
        }
      }
      stack.push(target);
    }
  }
  return `${seen.size} packed leaf modules kernel-free (html/logger/authoring)`;
}

export function assertPackedAppBoundaries(tmp: string): string {
  const declarationSummary = walkRouterDeclarations(tmp);
  const packedLeafSummary = assertPackedElementLeavesKernelFree(tmp);
  const clientDir = join(tmp, 'dist', 'client');
  if (!existsSync(clientDir)) {
    throw new Error(
      `No dist/client browser bundle (build cell failed); declaration graph: ${declarationSummary}`,
    );
  }
  const assets = readdirSync(clientDir, { recursive: true, withFileTypes: true })
    .filter((entry) => !entry.isDirectory() && entry.name.endsWith('.js'))
    .map((entry) => ({ path: join(entry.parentPath, entry.name), name: entry.name }));
  if (assets.length === 0) {
    throw new Error('dist/client contains no JS assets to scan');
  }
  for (const asset of assets) {
    const assetPath = asset.path;
    if (BOUNDARY_ID_PATTERN.test(assetPath.slice(clientDir.length))) {
      throw new Error(`Browser asset path crosses the boundary: ${assetPath}`);
    }
    const text = readFileSync(assetPath, 'utf8');
    for (const { fileName } of ts.preProcessFile(text).importedFiles) {
      if (BOUNDARY_SPECIFIER_PATTERN.test(fileName)) {
        throw new Error(`Browser bundle boundary leak: ${assetPath} imports ${fileName}`);
      }
    }
  }
  return `${declarationSummary}; ${packedLeafSummary}; ${assets.length} dist/client assets clean`;
}
