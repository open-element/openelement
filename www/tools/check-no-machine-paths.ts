/**
 * Fail closed when a build artifact carries a machine-specific path.
 *
 * The client entry once embedded checkout-absolute island paths in its
 * capability error copy, which broke byte reproducibility and leaked the
 * build environment (issue #1367). The compiler now anchors module ids on
 * the workspace segment; this gate is the post-build tripwire that keeps a
 * future regression from silently reintroducing machine paths.
 *
 * Scans every TEXT file under www/dist. Binary artifacts (compressed
 * Pagefind fragments, images, fonts) are skipped: a machine path cannot
 * leak through them, and decoding them as text produces replacement bytes
 * that coincidentally match drive-path markers.
 */
import { walk } from '@std/fs/walk';
import { fromFileUrl, join } from '@std/path';

const repoRoot = fromFileUrl(new URL('../../', import.meta.url));
const dist = join(repoRoot, 'www/dist');

export const MACHINE_PATH_MARKERS: Array<[RegExp, string]> = [
  [/\/Users\/[A-Za-z0-9._-]+\//, 'macOS home path'],
  [/\/home\/[A-Za-z0-9._-]+\//, 'Linux home path'],
  [/\/private\/tmp\//, 'private temp path'],
  [/\/var\/folders\//, 'macOS temp path'],
  // Linux CI roots: /tmp/<dir>/, /builds/<org>/, /root/<dir>/ and the
  // hosted-toolcache prefix. The trailing segment keeps prose mentions of a
  // bare '/tmp/' out of the gate while still catching build-root leaks.
  [/\/tmp\/[A-Za-z0-9._-]+\//, 'Linux temp path'],
  [/\/builds\/[A-Za-z0-9._-]+\//, 'CI builds path'],
  [/\/root\/[A-Za-z0-9._-]+\//, 'Linux root home path'],
  [/\/opt\/hostedtoolcache\//, 'hosted toolcache path'],
  // Realistic Windows machine paths only: a backslash path with at least two
  // segments, or a forward-slash path with at least three — minified code and
  // prose routinely contain short lookalikes like 'e:/p4--'.
  [/[A-Za-z]:\\[A-Za-z0-9._-]+(?:\\[A-Za-z0-9._-]+)+/, 'Windows drive path'],
  [/[A-Za-z]:\/(?:[A-Za-z0-9._-]+\/){2,}[A-Za-z0-9._-]+/, 'Windows drive path'],
];

/**
 * Directories whose text artifacts ship to consumers: the site output plus
 * any package build output that exists in this checkout (derived, so a new
 * package dist is covered without editing a list).
 */
export async function scanRoots(repoRoot: string): Promise<string[]> {
  const roots: string[] = [];
  const siteDist = join(repoRoot, 'www/dist');
  try {
    if ((await Deno.stat(siteDist)).isDirectory) roots.push(siteDist);
  } catch {
    // Missing site build is handled by the caller's error message.
  }
  for await (const entry of Deno.readDir(join(repoRoot, 'packages'))) {
    if (!entry.isDirectory) continue;
    const dist = join(repoRoot, 'packages', entry.name, 'dist');
    try {
      if ((await Deno.stat(dist)).isDirectory) roots.push(dist);
    } catch {
      // No build output for this package.
    }
  }
  return roots;
}

/** Whether the bytes decode as UTF-8 text (no replacement characters). */
export function isTextArtifact(bytes: Uint8Array): boolean {
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return true;
  } catch {
    return false;
  }
}

/** The first machine-path marker in a text artifact, or null. */
export function findMachinePath(text: string): { label: string; match: string } | null {
  for (const [pattern, label] of MACHINE_PATH_MARKERS) {
    const match = pattern.exec(text);
    if (match) return { label, match: match[0] };
  }
  return null;
}

async function main(): Promise<void> {
  const roots = await scanRoots(repoRoot);
  if (roots.length === 0) {
    console.error(
      `machine-path check: no build output found (expected ${dist}) — run the site build first (deno task site:build).`,
    );
    Deno.exit(1);
  }
  const failures: string[] = [];
  const oversize: string[] = [];
  let scanned = 0;
  let skippedBinary = 0;
  for (const root of roots) {
    for await (const entry of walk(root, { includeDirs: false })) {
      const bytes = await Deno.readFile(entry.path);
      // Cheap pre-filter: decoding megabytes of media wastes the gate budget.
      // Oversize files are listed, never silently skipped.
      if (bytes.length > 4_000_000) {
        oversize.push(`${entry.path.slice(root.length + 1)} (${bytes.length}B)`);
        continue;
      }
      if (!isTextArtifact(bytes)) {
        skippedBinary++;
        continue;
      }
      scanned++;
      const hit = findMachinePath(new TextDecoder().decode(bytes));
      if (hit) failures.push(`${entry.path.slice(root.length + 1)}: ${hit.label} '${hit.match}'`);
    }
  }

  if (failures.length > 0) {
    console.error('machine-path check failed (artifacts must not carry build-machine paths):');
    for (const failure of failures.slice(0, 20)) console.error(`- ${failure}`);
    if (failures.length > 20) console.error(`... and ${failures.length - 20} more`);
    Deno.exit(1);
  }
  if (oversize.length > 0) {
    console.log(`oversize files not scanned (${oversize.length}): ${oversize.join(', ')}`);
  }
  console.log(
    `machine-path check passed (${scanned} text files scanned across ${roots.length} root(s), ${skippedBinary} binary skipped).`,
  );
}

if (import.meta.main) await main();
