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
  // Realistic Windows machine paths only: a backslash path with at least two
  // segments, or a forward-slash path with at least three — minified code and
  // prose routinely contain short lookalikes like 'e:/p4--'.
  [/[A-Za-z]:\\[A-Za-z0-9._-]+(?:\\[A-Za-z0-9._-]+)+/, 'Windows drive path'],
  [/[A-Za-z]:\/(?:[A-Za-z0-9._-]+\/){2,}[A-Za-z0-9._-]+/, 'Windows drive path'],
];

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

const failures: string[] = [];
let scanned = 0;
let skippedBinary = 0;
for await (const entry of walk(dist, { includeDirs: false })) {
  const bytes = await Deno.readFile(entry.path);
  // Cheap pre-filter: decoding megabytes of media wastes the gate budget.
  if (bytes.length > 4_000_000) {
    skippedBinary++;
    continue;
  }
  if (!isTextArtifact(bytes)) {
    skippedBinary++;
    continue;
  }
  scanned++;
  const hit = findMachinePath(new TextDecoder().decode(bytes));
  if (hit) failures.push(`${entry.path.slice(dist.length + 1)}: ${hit.label} '${hit.match}'`);
}

if (failures.length > 0) {
  console.error('machine-path check failed (artifacts must not carry build-machine paths):');
  for (const failure of failures.slice(0, 20)) console.error(`- ${failure}`);
  if (failures.length > 20) console.error(`... and ${failures.length - 20} more`);
  Deno.exit(1);
}
console.log(
  `machine-path check passed (${scanned} text files scanned, ${skippedBinary} binary/oversize skipped).`,
);
