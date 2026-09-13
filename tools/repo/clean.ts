// esm-boundary:scanner
/**
 * Cross-platform clean tool (1.0 Alpha baseline).
 *
 * Root tasks must not shell out to `rm -rf`: it does not exist on Windows
 * cmd. This tool removes paths relative to the current working directory
 * and is the only sanctioned deletion primitive inside `deno task` strings.
 * Each pattern may be an exact relative path or a `*`-basename glob matched
 * against its parent directory (one level, no `**` recursion).
 *
 * Usage:
 *   deno run --allow-read --allow-write tools/repo/clean.ts <pattern...>
 */
import { expandGlob } from '@std/fs';

const patterns = Deno.args;
if (patterns.length === 0) {
  console.error('tools/repo/clean.ts requires at least one path pattern');
  Deno.exit(2);
}

let removed = 0;
for (const pattern of patterns) {
  if (pattern.includes('*')) {
    for await (const entry of expandGlob(pattern)) {
      await Deno.remove(entry.path, { recursive: true });
      removed++;
    }
  } else {
    try {
      await Deno.remove(pattern, { recursive: true });
      removed++;
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) throw error;
    }
  }
}
console.log(`clean ok: removed ${removed} path(s)`);
