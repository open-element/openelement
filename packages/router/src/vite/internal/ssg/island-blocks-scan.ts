/**
 * Island blocks scan (#1548) — the blocks axis of runtime-shape
 * specialization.
 *
 * The generated client entry imports one of the four `@openelement/element`
 * entries; which one is right for the when/each Block builders is a fact
 * about the app's compiled Part Programs, and the compiler is that fact's
 * single owner: `program.blocks` is non-empty exactly when a module lowered
 * a conditional or list Block. This scan asks the compiler — through the
 * same public `compileElementModule` the Vite plugin runs, never a private
 * re-implementation — whether ANY module reachable from the admitted island
 * entries produces Block Parts.
 *
 * The scan walks the island modules' import closure (relative imports by
 * path, bare imports through Node resolution, so workspace package islands
 * and their internal edges are covered) and compiles every `.ts/.tsx/.js`
 * module it reaches. Non-compiled modules return no program and contribute
 * nothing; only compiler output can carry Block Parts.
 *
 * Posture is the #1416 asymmetry applied to the second axis: the two
 * failure directions are not symmetric. Scanning "blocks" onto an
 * app without them costs the bundle bytes the axis exists to save; scanning
 * "no blocks" onto an app WITH them breaks every when/each Part at runtime
 * (the element runtime fails closed with
 * `OE_RUNTIME_BLOCK_BUILDERS_MISSING`). So every inconclusive answer — an
 * island specifier that resolves nowhere, a module that fails to compile, a
 * walk that outgrows its visit budget — resolves to "might use blocks", and
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

/** Inputs for {@linkcode islandsMightUseBlocks}; the island set as the entry builders see it. */
export interface IslandsBlocksScanInput {
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

/**
 * Whether one module's TEXT embeds a compiled Part Program carrying Block
 * Parts — the packed-package form of the blocks truth (alpha15, found by the
 * packaged-consumer appliance). A packed install ships COMPILED modules:
 * their programs ride as embedded JSON (`const __partProgram = {...}`) that
 * {@linkcode compileElementModule} cannot re-derive — it sees no authoring
 * grammar and returns null, so a packed component's when/each Block was
 * invisible to the scan and the build aliased the blocks-free element entry.
 *
 * Posture stays one-directional: a non-empty `"blocks"` array beside the
 * `__partProgram` marker is PROOF of blocks (the wire grammar always emits
 * the key, and a non-empty array always opens with an object); anything else
 * contributes nothing — absence is still only ever proven by compiling the
 * authoring source.
 */
function compiledArtifactMightUseBlocks(source: string): boolean {
  if (!source.includes('__partProgram')) return false;
  return /"blocks"\s*:\s*\[\s*\{/.test(source);
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
      // The whole extension list, `.ts` included: an extensionless specifier
      // resolved against a `.ts` neighbour is ordinary bundler resolution, and
      // dropping it here silently loses the module's import closure — exactly
      // the guess this scan is not allowed to make (`SCAN_EXTENSIONS[0]` is
      // `.ts`, so slicing the raw-stem entry off the list is not a no-op).
      ...SCAN_EXTENSIONS.map((extension) => `${stem}${extension}`),
      ...SCAN_EXTENSIONS.map((extension) => `${stem}/index${extension}`),
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
 * Whether the app's island client graph might execute when/each Block Parts.
 * `true` means "proven blocks usage, or anything short of proof of absence" —
 * the caller keeps a builders-carrying element entry. `false` means every
 * admitted island module and its import closure compiled with an empty
 * `program.blocks`, so the blocks-free entry is safe.
 */
export function islandsMightUseBlocks(input: IslandsBlocksScanInput): boolean {
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
    // block truth is unknown — the full runtime stays.
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
      if (compiled !== null && compiled.program.blocks.length > 0) return true;
    } catch {
      // A module the compiler cannot settle here would fail the real build
      // transform with its own diagnostic; for this scan its truth is unknown.
      return true;
    }
    // A pre-compiled module (a packed package's dist) proves blocks from its
    // own embedded program — the compiler pass above sees no grammar in it.
    if (compiledArtifactMightUseBlocks(source)) return true;
    for (const specifier of importSpecifiers(source)) {
      const target = resolveImport(file, specifier, input.root);
      if (target !== null) queue.push(target.replaceAll('\\', '/'));
    }
  }
  return false;
}

/**
 * The exact alias that resolves the element runtime to the blocks-free entry
 * for the whole client build (#1548) — the emission half of the blocks axis.
 *
 * The generated client entry's specifier alone cannot prune the blocks
 * cluster: every compiled island module imports `@openelement/element` for
 * its base class, and the package's `sideEffects` declaration (#1425) keeps
 * the default entry's installs alive in every graph that touches it. The
 * client build therefore resolves the bare specifier itself — exactly this
 * one specifier (the alias is anchor-anchored: this build's string aliases
 * prefix-match and would rewrite the subpaths too), never its subpaths
 * (jsx-runtime, authoring, build-utils and the entry variants keep their own
 * exports) — to the sibling `no-blocks` entry of whichever package layout
 * the build resolved (source `.ts` in the workspace, compiled `.js` in a
 * packed install).
 *
 * Returned `undefined` (keep the default resolution, keep the full runtime)
 * when anything is short of certain: the app aliases the element package
 * itself, or the resolved entry's sibling cannot be located. The alias only
 * ever removes code the scan proved unreachable; a resolution surprise falls
 * back to today's graph.
 */
export function elementRuntimeBlocksAlias(
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
  const blocksFreeEntry = join(dirname(resolvedEntry), `no-blocks${extension}`);
  if (!existsSync(blocksFreeEntry)) return undefined;
  return { find: /^@openelement\/element$/, replacement: blocksFreeEntry };
}
