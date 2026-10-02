/**
 * node:* implementation of the @std/fs surface this repository uses.
 *
 * The npm/JSR mirror of @std/fs (@jsr/std__fs) calls `Deno.*` globals
 * internally, so it only runs under the Deno host; the B2 task surface runs
 * these scripts with node. This module keeps the walk semantics identical to
 * @std/fs (options `includeDirs`, `exts`, `match`, `skip`, `maxDepth`;
 * joined-path include/skip testing; root entry yielded first) so call sites
 * swap the import specifier and nothing else. `expandGlob` supports the
 * single-level `*` globs clean.ts allowlists.
 */
import { existsSync as nodeExistsSync, lstatSync, readdirSync, statSync } from 'node:fs';
import { lstat, realpath, stat } from 'node:fs/promises';
import { join, resolve } from '@std/path';

/** Minimal WalkEntry surface the repository consumes. */
export interface WalkEntry {
  path: string;
  name: string;
  isFile: boolean;
  isDirectory: boolean;
  isSymlink: boolean;
}

export interface WalkOptions {
  includeDirs?: boolean;
  includeFiles?: boolean;
  includeSymlinks?: boolean;
  exts?: string[];
  match?: RegExp[];
  skip?: RegExp[];
  maxDepth?: number;
}

function include(path: string, exts?: string[], match?: RegExp[], skip?: RegExp[]): boolean {
  if (exts && !exts.some((ext) => path.endsWith(ext.startsWith('.') ? ext : `.${ext}`))) {
    return false;
  }
  if (match && !match.some((pattern) => !!path.match(pattern))) return false;
  if (skip && skip.some((pattern) => !!path.match(pattern))) return false;
  return true;
}

async function rootEntry(root: string): Promise<WalkEntry> {
  const stats = await stat(root); // Deno.stat semantics: symlinks followed.
  const resolved = stats.isDirectory() ? await realpath(root) : root;
  return {
    path: root,
    name: root.split('/').pop() ?? root,
    isFile: stats.isFile(),
    isDirectory: stats.isDirectory(),
    isSymlink: resolved !== root,
  };
}

function rootEntrySync(root: string): WalkEntry {
  const stats = statSync(root);
  return {
    path: root,
    name: root.split('/').pop() ?? root,
    isFile: stats.isFile(),
    isDirectory: stats.isDirectory(),
    isSymlink: lstatSync(root).isSymbolicLink(),
  };
}

/** Async directory walk with @std/fs `walk()` semantics. */
export async function* walk(root: string, options: WalkOptions = {}): AsyncGenerator<WalkEntry> {
  const {
    maxDepth = Infinity,
    includeFiles = true,
    includeDirs = true,
    includeSymlinks = true,
    exts,
    match,
    skip,
  } = options;
  if (maxDepth < 0) return;
  if (includeDirs && include(root, exts, match, skip)) yield await rootEntry(root);
  if (maxDepth < 1 || !include(root, undefined, undefined, skip)) return;
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isSymbolicLink()) {
      if (includeSymlinks && include(path, exts, match, skip)) {
        const stats = await lstat(path);
        yield {
          path,
          name: entry.name,
          isFile: stats.isFile(),
          isDirectory: stats.isDirectory(),
          isSymlink: true,
        };
      }
      continue;
    }
    if (entry.isDirectory()) {
      yield* walk(path, { ...options, maxDepth: maxDepth - 1 });
    } else if (includeFiles && include(path, exts, match, skip)) {
      yield {
        path,
        name: entry.name,
        isFile: entry.isFile(),
        isDirectory: false,
        isSymlink: false,
      };
    }
  }
}

/** Sync directory walk with @std/fs `walkSync()` semantics. */
export function* walkSync(root: string, options: WalkOptions = {}): Generator<WalkEntry> {
  const {
    maxDepth = Infinity,
    includeFiles = true,
    includeDirs = true,
    includeSymlinks = true,
    exts,
    match,
    skip,
  } = options;
  if (maxDepth < 0) return;
  if (includeDirs && include(root, exts, match, skip)) yield rootEntrySync(root);
  if (maxDepth < 1 || !include(root, undefined, undefined, skip)) return;
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isSymbolicLink()) {
      if (includeSymlinks && include(path, exts, match, skip)) {
        const stats = lstatSync(path);
        yield {
          path,
          name: entry.name,
          isFile: stats.isFile(),
          isDirectory: stats.isDirectory(),
          isSymlink: true,
        };
      }
      continue;
    }
    if (entry.isDirectory()) {
      yield* walkSync(path, { ...options, maxDepth: maxDepth - 1 });
    } else if (includeFiles && include(path, exts, match, skip)) {
      yield {
        path,
        name: entry.name,
        isFile: entry.isFile(),
        isDirectory: false,
        isSymlink: false,
      };
    }
  }
}

/** `true` when the path exists (files and directories). Deno-host parity. */
export function existsSync(path: string): boolean {
  return nodeExistsSync(path);
}

export async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

export interface ExpandGlobOptions {
  root?: string;
  includeDirs?: boolean;
  exts?: string[];
  skip?: RegExp[];
}

/**
 * Glob expansion with the @std/fs `expandGlob` result shape ({ path, name,
 * isFile, isDirectory, isSymlink }). Supports `*` wildcards within any
 * segment (clean allowlists use mid-path stars, e.g. the clean target
 * packages star-slash dist); `**` stays unsupported.
 */
export async function* expandGlob(
  glob: string,
  options: ExpandGlobOptions = {},
): AsyncGenerator<WalkEntry> {
  if (glob.includes('**')) {
    throw new Error(`expandGlob: '**' is not supported, got '${glob}'`);
  }
  const root = options.root ?? '.';
  const segments = glob.split('/');
  const match = (name: string, segment: string): boolean => {
    const [head, ...rest] = segment.split('*');
    if (!name.startsWith(head)) return false;
    let cursor = name.slice(head.length);
    for (const part of rest) {
      const idx = cursor.lastIndexOf(part);
      if (idx < 0) return false;
      cursor = cursor.slice(idx + part.length);
    }
    return cursor.length === 0 || rest.length > 0;
  };
  async function* walkSegments(
    dir: string,
    rel: string,
    remaining: string[],
  ): AsyncGenerator<{ path: string; name: string; isDirectory: boolean }> {
    const segment = remaining[0];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('.') && segment === '*') continue;
      if (!match(entry.name, segment)) continue;
      const path = join(dir, entry.name);
      const relPath = rel ? `${rel}/${entry.name}` : entry.name;
      if (remaining.length === 1) {
        yield { path, name: entry.name, isDirectory: entry.isDirectory() };
      } else if (entry.isDirectory()) {
        yield* walkSegments(path, relPath, remaining.slice(1));
      }
    }
  }
  for await (const hit of walkSegments(resolve(root), '', segments)) {
    if (options.includeDirs === false && hit.isDirectory) continue;
    const stats = hit.isDirectory ? await stat(hit.path) : await lstat(hit.path);
    if (options.exts && !options.exts.some((ext) => hit.path.endsWith(ext))) continue;
    if (options.skip?.some((pattern) => !!hit.path.match(pattern))) continue;
    yield {
      path: hit.path,
      name: hit.name,
      isFile: stats.isFile(),
      isDirectory: stats.isDirectory(),
      isSymlink: stats.isSymbolicLink(),
    };
  }
}
