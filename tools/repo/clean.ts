// esm-boundary:scanner
/**
 * Cross-platform clean tool (1.0 Alpha baseline).
 *
 * Root tasks must not shell out to `rm -rf`: it does not exist on Windows
 * cmd. This tool removes ONLY allowlisted, repo-generated paths and is the
 * only sanctioned deletion primitive inside `deno task` strings.
 *
 * Every target is repo-relative and validated twice: against the built-in
 * allowlist below and against the resolved repo root, so `/`, `~`, HOME,
 * `..` escapes, absolute paths, empty strings and unknown/broad patterns are
 * refused before anything is deleted. Targets are never user content: env
 * files, databases, media sources and unknown ignored files are out of scope
 * by construction.
 *
 * Usage:
 *   deno run --allow-read --allow-write tools/repo/clean.ts            # default generated targets
 *   deno run --allow-read --allow-write tools/repo/clean.ts --deep     # + installed dependency trees
 *   deno run --allow-read --allow-write tools/repo/clean.ts <pattern>  # allowlisted pattern(s)
 */
import { expandGlob } from '@std/fs';
import { fromFileUrl, isAbsolute, join, relative, resolve, SEPARATOR } from '@std/path';

/** Generated build/test output with no long-term value. Safe by default. */
export const DEFAULT_TARGETS: readonly string[] = [
  'packages/*/dist',
  'packages/*/dist-test-*',
  'packages/*/custom-dist',
  'packages/*/*.tgz',
  'packages/*/pack-*.log',
  'apps/site/dist',
  'apps/site/.openElement',
  'apps/saas/dist',
  'apps/saas/.openElement',
  'apps/saas/.output',
  'apps/saas/.output-*',
  'apps/saas/.nitro',
  'apps/saas/.wrangler',
  'dist',
  'custom-dist',
  'dist-test-*',
  'playwright-report',
  'test-results',
  'coverage',
  '.coverage',
  '.coverage-*',
  '.coverage-check',
  '.openElement',
  'tests/e2e/starter-smoke/work',
  'tests/fixtures/*/dist',
  'tests/fixtures/*/test-results',
  'tests/fixtures/*/.nitro',
  'tests/fixtures/*/.wrangler',
  'tests/fixtures/*/.output',
  'tests/fixtures/*/.output-*',
];

/** Opt-in extras: reinstallable dependency trees, never touched by default. */
export const DEEP_TARGETS: readonly string[] = [
  '.deno',
  'apps/saas/node_modules',
  'packages/element/__wtr__/node_modules',
  'tests/fixtures/*/node_modules',
];

const ALLOWLIST = new Set([...DEFAULT_TARGETS, ...DEEP_TARGETS]);

/** Rejects anything that is not a repo-relative, narrowly scoped path pattern. */
export function assertSafeTarget(target: string): void {
  if (target.length === 0) throw new Error('clean: empty target');
  if (target.includes('\0')) throw new Error(`clean: NUL in target '${target}'`);
  if (target.startsWith('~')) throw new Error(`clean: home-relative target '${target}'`);
  if (target.includes('\\')) throw new Error(`clean: windows separator in target '${target}'`);
  if (isAbsolute(target) || /^[A-Za-z]:/.test(target)) {
    throw new Error(`clean: absolute target '${target}'`);
  }
  const segments = target.split('/');
  let wildcardSegments = 0;
  for (const segment of segments) {
    if (segment === '' || segment === '.' || segment === '..') {
      throw new Error(`clean: illegal path segment in target '${target}'`);
    }
    if ((segment.match(/\*/g)?.length ?? 0) > 1 || segment.includes('**')) {
      throw new Error(`clean: broad glob in target '${target}'`);
    }
    if (segment.includes('*')) wildcardSegments++;
  }
  if (wildcardSegments > 2) throw new Error(`clean: broad glob in target '${target}'`);
  if (target === '*') throw new Error(`clean: broad target '${target}'`);
}

/** Fails closed unless `resolved` is a strict descendant of `root`. */
function assertWithinRoot(root: string, target: string, resolved: string): void {
  const rootWithSep = root.endsWith(SEPARATOR) ? root : `${root}${SEPARATOR}`;
  if (resolved === root || !resolved.startsWith(rootWithSep)) {
    throw new Error(`clean: '${target}' resolves outside the repo root (${resolved})`);
  }
}

export interface CleanArgs {
  targets: readonly string[];
  deep: boolean;
}

/** Parses CLI args; explicit patterns must be allowlisted, never invented. */
export function parseCleanArgs(args: readonly string[]): CleanArgs {
  const deep = args.includes('--deep');
  const unknownFlag = args.find((arg) => arg.startsWith('--') && arg !== '--deep');
  if (unknownFlag) throw new Error(`clean: unknown flag '${unknownFlag}'`);
  const patterns = args.filter((arg) => arg !== '--deep');
  if (patterns.length === 0) {
    return { targets: deep ? [...DEFAULT_TARGETS, ...DEEP_TARGETS] : DEFAULT_TARGETS, deep };
  }
  for (const pattern of patterns) {
    if (!ALLOWLIST.has(pattern)) {
      throw new Error(`clean: '${pattern}' is not an allowlisted generated path`);
    }
  }
  return { targets: patterns, deep };
}

export interface CleanIo {
  log: (message: string) => void;
}

/**
 * Deletes every allowlisted target under `root`. Refuses non-allowlisted
 * patterns, paths escaping `root`, unresolved broad targets, and entries whose
 * real path leaves the repo through a symlinked parent. Symlinked entries are
 * removed as links only.
 */
export async function cleanTargets(
  root: string,
  targets: readonly string[],
  io: CleanIo = { log: console.log },
): Promise<number> {
  const resolvedRoot = resolve(root);
  const realRoot = await Deno.realPath(resolvedRoot);
  for (const target of targets) {
    assertSafeTarget(target);
    if (!ALLOWLIST.has(target)) {
      throw new Error(`clean: '${target}' is not an allowlisted generated path`);
    }
  }

  let removed = 0;
  const remove = async (absolute: string, label: string): Promise<void> => {
    let stat: Deno.FileInfo;
    try {
      stat = await Deno.lstat(absolute);
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) return;
      throw error;
    }
    assertWithinRoot(resolvedRoot, label, absolute);
    // A symlink is removed as a link; a real entry must live under the repo
    // even after resolving symlinked ancestors (fail closed on escapes).
    if (!stat.isSymlink) {
      assertWithinRoot(realRoot, label, await Deno.realPath(absolute));
    }
    await Deno.remove(absolute, { recursive: true });
    io.log(`clean: removed ${label}`);
    removed++;
  };
  for (const target of targets) {
    if (target.includes('*')) {
      for await (const entry of expandGlob(target, { root: resolvedRoot })) {
        const absolute = resolve(entry.path);
        await remove(absolute, relative(resolvedRoot, absolute));
      }
      continue;
    }
    await remove(resolve(join(resolvedRoot, target)), target);
  }
  return removed;
}

if (import.meta.main) {
  const { targets, deep } = parseCleanArgs(Deno.args);
  if (deep) {
    console.log(`clean --deep targets (${targets.length}):`);
    for (const target of targets) console.log(`  ${target}`);
  }
  const root = fromFileUrl(new URL('../..', import.meta.url));
  const removed = await cleanTargets(root, targets);
  console.log(`clean ok: removed ${removed} path(s)`);
}
