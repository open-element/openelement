/**
 * Island regions scan (#1548) — the regions axis of runtime-shape
 * specialization.
 *
 * The generated client entry imports one of the four `@openelement/element`
 * entries; which one is right for the when/each Region builders is a fact
 * about the app's compiled Part Programs, and the compiler is that fact's
 * single owner: `program.regions` is non-empty exactly when a module lowered
 * a conditional or list Region. This scan asks the compiler — through the
 * same public `compileElementModule` the Vite plugin runs, never a private
 * re-implementation — whether ANY module reachable from the admitted island
 * entries produces Region Parts.
 *
 * The scan walks the island modules' import closure (relative imports by
 * path, bare imports through Node resolution, so workspace package islands
 * and their internal edges are covered) and compiles every `.ts/.tsx/.js`
 * module it reaches. Non-compiled modules return no program and contribute
 * nothing; only compiler output can carry Region Parts.
 *
 * Posture is the #1416 asymmetry applied to the second axis: the two
 * failure directions are not symmetric. Scanning "regions" onto an
 * app without them costs the bundle bytes the axis exists to save; scanning
 * "no regions" onto an app WITH them breaks every when/each Part at runtime
 * (the element runtime fails closed with
 * `OE_RUNTIME_REGION_BUILDERS_MISSING`). So every inconclusive answer — an
 * island specifier that resolves nowhere, a module that fails to compile, a
 * walk that outgrows its visit budget — resolves to "might use regions", and
 * the caller keeps a builders-carrying entry. The scan only ever saves bytes;
 * it never gets to guess its way into a broken page.
 */

import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, isAbsolute, join, resolve } from 'pathe';
import ts from 'typescript';
import {
  compileElementModule,
  stableModuleId,
  type SemanticCoreOptions,
  type StaticSidecarDescriptor,
} from '@openelement/compiler';
import type { IslandDecl } from '@openelement/protocol/ssg';

/** The bare specifier the client build specializes: the element package's default entry. */
const ELEMENT_ENTRY_SPECIFIER = '@openelement/element';

/** Module extensions whose text can carry (or import to) compiled programs. */
const SCAN_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts'] as const;

/**
 * The visit budget: an island closure larger than this is treated as
 * inconclusive (the full runtime stays). A guard against pathological graphs,
 * not a measured limit — real app closures are far below it.
 */
const MAX_VISITED_MODULES = 2000;

/** Inputs for {@linkcode islandsMightUseRegions}; the island set as the entry builders see it. */
export interface IslandsRegionsScanInput {
  /** The Vite project root (module-id anchoring and relative-island resolution). */
  root: string;
  /** The app's islands directory (local island files resolve under it). */
  islandsDir: string;
  islandTagNames: readonly string[];
  /** Relative file paths for local islands, as `buildClientIslandEntries` consumes them. */
  islandFiles: readonly (string | undefined)[];
  /** Declared package islands (bare module specifiers). */
  packageIslandDecls: readonly IslandDecl[];
  /** Compiler-behavior islands (bare module specifiers), scanned like package islands. */
  compilerBehaviorDecls?: readonly IslandDecl[];
  /** Static-sidecar descriptors the admitting host injects — the same ones the Vite plugin gets. */
  staticSidecars?: readonly StaticSidecarDescriptor[];
}

/** Whether one module text imports/re-exports/dynamically imports something. */
function importSpecifiers(source: string): string[] {
  const sf = ts.createSourceFile('__scan__.ts', source, ts.ScriptTarget.Latest, false);
  const out: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      out.push(node.moduleSpecifier.text);
    } else if (
      ts.isExportDeclaration(node) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      out.push(node.moduleSpecifier.text);
    } else if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments[0] &&
      ts.isStringLiteral(node.arguments[0])
    ) {
      out.push(node.arguments[0].text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

function stripSpecifierQuery(specifier: string): string {
  return specifier.split('?', 1)[0].split('#', 1)[0];
}

/** Probe a path without extension assumptions into an existing source file. */
function probeSourceFile(base: string): string | null {
  const withoutExtension = /\.(?:[cm]?[tj]sx?)$/.test(base)
    ? base.replace(/\.(?:[cm]?[tj]sx?)$/, '')
    : base;
  const stems = withoutExtension === base ? [base] : [base, withoutExtension];
  for (const stem of stems) {
    for (const candidate of [
      stem,
      ...SCAN_EXTENSIONS.slice(1).map((extension) => `${stem}${extension}`),
      ...SCAN_EXTENSIONS.slice(1).map((extension) => `${stem}/index${extension}`),
    ]) {
      try {
        readFileSync(candidate, 'utf8');
        return candidate;
      } catch {
        // Not a readable file at this spelling; keep probing.
      }
    }
  }
  return null;
}

/** Resolve one import specifier from one importing file, or null when unknown. */
function resolveImport(fromFile: string, specifier: string, root: string): string | null {
  const clean = stripSpecifierQuery(specifier);
  if (clean === '') return null;
  if (clean.startsWith('.')) {
    return probeSourceFile(resolve(dirname(fromFile), clean));
  }
  if (clean.startsWith('/')) {
    return probeSourceFile(resolve(root, clean.slice(1)));
  }
  // Bare specifier: Node resolution from the importing file (workspace
  // packages resolve through their real paths). css/json/virtual specifiers
  // fail here and are skipped — they cannot carry compiled programs.
  try {
    return createRequire(fromFile).resolve(clean);
  } catch {
    return null;
  }
}

/** Resolve one declared island module path (local file, root-absolute or bare specifier). */
function resolveDeclaredModule(root: string, modulePath: string): string | null {
  if (modulePath.startsWith('.')) return probeSourceFile(resolve(root, modulePath));
  if (isAbsolute(modulePath)) return probeSourceFile(modulePath);
  try {
    return createRequire(join(root, 'package.json')).resolve(modulePath);
  } catch {
    return null;
  }
}

/**
 * Whether the app's island client graph might execute when/each Region Parts.
 * `true` means "proven regions usage, or anything short of proof of absence" —
 * the caller keeps a builders-carrying element entry. `false` means every
 * admitted island module and its import closure compiled with an empty
 * `program.regions`, so the regions-free entry is safe.
 */
export function islandsMightUseRegions(input: IslandsRegionsScanInput): boolean {
  const seeds: string[] = [];
  input.islandTagNames.forEach((tagName, index) => {
    seeds.push(
      resolve(
        input.root,
        input.islandFiles[index]
          ? `${input.islandsDir}/${input.islandFiles[index]}`
          : `${input.islandsDir}/${tagName}.ts`,
      ),
    );
  });
  for (const decl of [...input.packageIslandDecls, ...(input.compilerBehaviorDecls ?? [])]) {
    const found = resolveDeclaredModule(input.root, decl.modulePath);
    // An island module the scan cannot even locate is a graph member whose
    // region truth is unknown — the full runtime stays.
    if (found === null) return true;
    seeds.push(found);
  }

  const options: SemanticCoreOptions = input.staticSidecars
    ? { staticSidecars: [...input.staticSidecars] }
    : {};
  const visited = new Set<string>();
  const queue = [...seeds];
  while (queue.length > 0) {
    const file = queue.pop()!.replaceAll('\\', '/');
    if (visited.has(file)) continue;
    visited.add(file);
    if (visited.size > MAX_VISITED_MODULES) return true;
    if (!SCAN_EXTENSIONS.some((extension) => file.endsWith(extension))) continue;
    let source: string;
    try {
      source = readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    try {
      const compiled = compileElementModule(source, stableModuleId(file, input.root), options);
      if (compiled !== null && compiled.program.regions.length > 0) return true;
    } catch {
      // A module the compiler cannot settle here would fail the real build
      // transform with its own diagnostic; for this scan its truth is unknown.
      return true;
    }
    for (const specifier of importSpecifiers(source)) {
      const target = resolveImport(file, specifier, input.root);
      if (target !== null) queue.push(target.replaceAll('\\', '/'));
    }
  }
  return false;
}

/**
 * The exact alias that resolves the element runtime to the regions-free entry
 * for the whole client build (#1548) — the emission half of the regions axis.
 *
 * The generated client entry's specifier alone cannot prune the regions
 * cluster: every compiled island module imports `@openelement/element` for
 * its base class, and the package's `sideEffects` declaration (#1425) keeps
 * the default entry's installs alive in every graph that touches it. The
 * client build therefore resolves the bare specifier itself — exactly this
 * one specifier (the alias is anchor-anchored: this build's string aliases
 * prefix-match and would rewrite the subpaths too), never its subpaths
 * (jsx-runtime, authoring, build-utils and the entry variants keep their own
 * exports) — to the sibling `no-regions` entry of whichever package layout
 * the build resolved (source `.ts` in the workspace, compiled `.js` in a
 * packed install).
 *
 * Returned `undefined` (keep the default resolution, keep the full runtime)
 * when anything is short of certain: the app aliases the element package
 * itself, or the resolved entry's sibling cannot be located. The alias only
 * ever removes code the scan proved unreachable; a resolution surprise falls
 * back to today's graph.
 */
export function elementRuntimeRegionsAlias(
  root: string,
  userAliases: readonly { find: string | RegExp; replacement: string }[],
  resolveElementEntry: (specifier: string) => string = (specifier): string =>
    createRequire(join(root, 'package.json')).resolve(specifier),
): { find: RegExp; replacement: string } | undefined {
  for (const alias of userAliases) {
    const hitsElement =
      typeof alias.find === 'string'
        ? alias.find === ELEMENT_ENTRY_SPECIFIER
        : alias.find.test(ELEMENT_ENTRY_SPECIFIER);
    if (hitsElement) {
      // An alias that resolves the element specifier itself keeps the user's
      // resolution — the build does not second-guess it.
      return undefined;
    }
  }
  let resolvedEntry: string;
  try {
    resolvedEntry = resolveElementEntry(ELEMENT_ENTRY_SPECIFIER);
  } catch {
    return undefined;
  }
  const extension = resolvedEntry.endsWith('.ts') ? '.ts' : '.js';
  const regionsFreeEntry = join(dirname(resolvedEntry), `no-regions${extension}`);
  if (!existsSync(regionsFreeEntry)) return undefined;
  return { find: /^@openelement\/element$/, replacement: regionsFreeEntry };
}
