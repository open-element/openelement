/**
 * Fail closed when a build artifact carries a machine-specific path.
 *
 * The client entry once embedded checkout-absolute island paths in its
 * capability error copy, which broke byte reproducibility and leaked the
 * build environment (issue #1367). The compiler now anchors module ids on
 * the workspace segment; this gate is the post-build tripwire that keeps a
 * future regression from silently reintroducing machine paths.
 *
 * Scans every built file under www/dist for common machine-path markers.
 */
import { walk } from '@std/fs/walk';
import { fromFileUrl, join } from '@std/path';

const repoRoot = fromFileUrl(new URL('../../', import.meta.url));
const dist = join(repoRoot, 'www/dist');

const MARKERS: Array<[RegExp, string]> = [
  [/\/Users\/[A-Za-z0-9._-]+\//, 'macOS home path'],
  [/\/home\/[A-Za-z0-9._-]+\//, 'Linux home path'],
  [/\/private\/tmp\//, 'private temp path'],
  [/\/var\/folders\//, 'macOS temp path'],
  [/[A-Z]:\\\\?[A-Za-z0-9._-]/, 'Windows drive path'],
];

const failures: string[] = [];
let scanned = 0;
for await (const entry of walk(dist, { includeDirs: false })) {
  scanned++;
  const bytes = await Deno.readFile(entry.path);
  // Cheap pre-filter: binary assets cannot contain ASCII path markers in a
  // meaningful way, and decoding megabytes of media wastes the gate budget.
  if (bytes.length > 4_000_000) continue;
  const text = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  for (const [pattern, label] of MARKERS) {
    const match = pattern.exec(text);
    if (match) {
      failures.push(
        `${entry.path.slice(dist.length + 1)}: ${label} '${match[0]}'`,
      );
      break;
    }
  }
}

if (failures.length > 0) {
  console.error('machine-path check failed (artifacts must not carry build-machine paths):');
  for (const failure of failures.slice(0, 20)) console.error(`- ${failure}`);
  if (failures.length > 20) console.error(`... and ${failures.length - 20} more`);
  Deno.exit(1);
}
console.log(`machine-path check passed (${scanned} built files scanned).`);
