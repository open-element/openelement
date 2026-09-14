/**
 * Public declaration closure for packed npm tarballs.
 *
 * `deno pack` may drop a private module's standalone `.d.ts`
 * (`Could not generate types ... Types will not be included for this module`)
 * while still generating a complete public export declaration. The only proof
 * that a dropped declaration is harmless is reachability: if no public
 * declaration transitively imports the module, no consumer type surface can
 * miss it.
 *
 * This module builds the reachable closure of declaration files starting at
 * every public `types` target and following package-local relative edges:
 *   - `import ... from`, `export ... from`, `import("...")`, and
 *     `export * from` (TypeScript AST via typescript-ast)
 *   - `/// <reference path="..." />` triple-slash references
 * Bare, npm:, jsr:, node:, and URL specifiers are external and produce no
 * edge. Relative edges must stay inside the package root and resolve to an
 * existing declaration; cycles terminate through the visited set.
 *
 * The graph is deliberately conservative: a missing declaration on a
 * reachable edge fails the release, and a dropped declaration is only
 * classified as a known upstream warning when it is provably unreachable.
 */

import { extractStaticModuleSpecifiers } from './typescript-ast.ts';

export interface DeclarationGraph {
  /** Package-relative declaration files reachable from the public type roots. */
  reached: string[];
  /** Reachable relative edges that resolved to no declaration file. */
  missing: Array<{ from: string; specifier: string }>;
  /** Relative edges that escaped the package root (must never happen). */
  escaped: Array<{ from: string; specifier: string }>;
}

export interface DeclarationIo {
  exists: (path: string) => boolean;
  read: (path: string) => string;
}

export interface DroppedDeclarationWarning {
  /** Package-relative path of the warned source module. */
  relative: string;
  raw: string;
}

export interface ClassifiedDeclarationWarnings {
  /** Dropped declarations unreachable from every public declaration. */
  knownUpstream: DroppedDeclarationWarning[];
  /** Dropped declarations the public closure depends on: always fail. */
  reachableFromPublicTypes: DroppedDeclarationWarning[];
}

const DECLARATION_EXTENSIONS = ['.d.ts', '.d.mts', '.d.cts'] as const;
const SOURCE_EXTENSION = /\.(mjs|cjs|js|jsx|ts|tsx|mts|cts)$/;
const TRIPLE_SLASH_PATH = /\/\/\/\s*<reference\s+path\s*=\s*["']([^"']+)["']/g;

/** Normalize both platform separators so Windows input behaves like POSIX. */
function toPosix(path: string): string {
  return path.replaceAll('\\', '/');
}

/**
 * Collapse `a/./b` and `a/b/../c`; return null when the path escapes its
 * root (leading `..`) or is absolute.
 */
function normalizeRelative(path: string): string | null {
  if (path.startsWith('/') || /^[A-Za-z]:\//.test(path)) return null;
  const segments: string[] = [];
  for (const segment of toPosix(path).split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') {
      if (segments.length === 0) return null;
      segments.pop();
      continue;
    }
    segments.push(segment);
  }
  return segments.length === 0 ? null : segments.join('/');
}

function dirnameOf(path: string): string {
  const index = path.lastIndexOf('/');
  return index <= 0 ? '' : path.slice(0, index);
}

function isRelativeSpecifier(specifier: string): boolean {
  const spec = toPosix(specifier);
  return spec === '.' || spec === '..' || spec.startsWith('./') || spec.startsWith('../');
}

/**
 * Declaration candidates for one resolved module target, in preference
 * order. This repository's compiler output is pure-ESM `.d.ts`; the `.d.mts`
 * and `.d.cts` fallbacks keep the resolver honest for consumers that carry
 * them.
 */
export function declarationCandidates(target: string): string[] {
  const path = toPosix(target);
  if (DECLARATION_EXTENSIONS.some((extension) => path.endsWith(extension))) {
    return [path];
  }
  if (path.endsWith('.mjs') || path.endsWith('.mts')) {
    const base = path.slice(0, -4);
    return [`${base}.d.mts`, `${base}.d.ts`, `${base}.d.cts`];
  }
  if (path.endsWith('.cjs') || path.endsWith('.cts')) {
    const base = path.slice(0, -4);
    return [`${base}.d.cts`, `${base}.d.ts`, `${base}.d.mts`];
  }
  const base = path.replace(SOURCE_EXTENSION, '');
  return [
    `${base}.d.ts`,
    `${base}.d.mts`,
    `${base}.d.cts`,
    `${base}/index.d.ts`,
    `${base}/index.d.mts`,
    `${base}/index.d.cts`,
  ];
}

function tripleSlashPaths(source: string): string[] {
  const found: string[] = [];
  for (const match of source.matchAll(TRIPLE_SLASH_PATH)) {
    if (match[1]) found.push(match[1]);
  }
  return found;
}

/**
 * Build the public declaration closure. `roots` are the package-relative
 * `types` targets of the packed exports map (already verified to exist by the
 * caller, but re-resolution keeps this function total).
 */
export function buildDeclarationClosure(
  roots: readonly string[],
  io: DeclarationIo,
): DeclarationGraph {
  const reached = new Set<string>();
  const missing: Array<{ from: string; specifier: string }> = [];
  const escaped: Array<{ from: string; specifier: string }> = [];
  const queue: string[] = [];

  const enqueue = (path: string | null): void => {
    if (!path || reached.has(path)) return;
    reached.add(path);
    queue.push(path);
  };
  for (const root of roots) {
    enqueue(normalizeRelative(root));
  }

  while (queue.length > 0) {
    const file = queue.shift() as string;
    if (!io.exists(file)) {
      // A root that does not exist is the caller's export-types check; a
      // reachable edge that does not exist is the caller's missing proof.
      continue;
    }
    const source = io.read(file);
    const specifiers = [
      ...extractStaticModuleSpecifiers(source, file).map((entry) => entry.value),
      ...tripleSlashPaths(source),
    ];
    for (const rawSpecifier of specifiers) {
      if (!isRelativeSpecifier(rawSpecifier)) continue;
      const specifier = toPosix(rawSpecifier);
      const joined = normalizeRelative(
        `${dirnameOf(file)}/${specifier}`,
      );
      if (joined === null) {
        escaped.push({ from: file, specifier: rawSpecifier });
        continue;
      }
      const candidates = declarationCandidates(joined);
      const resolved = candidates.find((candidate) => io.exists(candidate));
      if (!resolved) {
        missing.push({ from: file, specifier: rawSpecifier });
        continue;
      }
      enqueue(resolved);
    }
  }

  return {
    reached: [...reached].sort(),
    missing,
    escaped,
  };
}

/**
 * Declaration candidates for a warned source module (the path `deno pack`
 * prints). A source with no recognizable extension yields no candidates and
 * therefore cannot match the closure: it is treated as unreachable.
 */
export function warnedDeclarationCandidates(sourceRelative: string): string[] {
  const path = toPosix(sourceRelative);
  if (DECLARATION_EXTENSIONS.some((extension) => path.endsWith(extension))) {
    return [path];
  }
  if (!SOURCE_EXTENSION.test(path)) return [];
  return declarationCandidates(path);
}

/**
 * Classify dropped-declaration warnings against the closure. Only a warned
 * module whose declaration is provably outside the public reachable set may
 * be treated as an upstream private warning.
 */
export function classifyDroppedDeclarationWarnings(
  graph: DeclarationGraph,
  warnings: readonly DroppedDeclarationWarning[],
): ClassifiedDeclarationWarnings {
  const reached = new Set(graph.reached);
  const knownUpstream: DroppedDeclarationWarning[] = [];
  const reachableFromPublicTypes: DroppedDeclarationWarning[] = [];
  for (const warning of warnings) {
    const candidates = warnedDeclarationCandidates(warning.relative);
    if (candidates.some((candidate) => reached.has(candidate))) {
      reachableFromPublicTypes.push(warning);
    } else {
      knownUpstream.push(warning);
    }
  }
  return { knownUpstream, reachableFromPublicTypes };
}

/** Default filesystem IO over an extracted package root. */
export function packageRootDeclarationIo(packageRoot: string): DeclarationIo {
  return {
    exists: (path) => {
      try {
        return Deno.statSync(`${packageRoot}/${path}`).isFile;
      } catch {
        return false;
      }
    },
    read: (path) => Deno.readTextFileSync(`${packageRoot}/${path}`),
  };
}
