/**
 * Minimal static file server for openElement E2E tests.
 *
 * Thin CLI wrapper around tools/lib/static-server.ts: the serving contract —
 * IANA MIME table with an explicit UTF-8 charset on text/*, production
 * candidate-path fallback (`.html` pretty URLs and directory indexes),
 * cache-control policy, single-range `Range: bytes=a-b` support (206, 416
 * when unsatisfiable), 400 on malformed percent-encoding, 403 on path
 * traversal (`..`, NUL), 404 when no candidate exists — is the shared lib's
 * implementation, pinned by tools/lib/static-server.test.ts. What this
 * script itself keeps is the --port/--dir CLI contract, the findPort retry
 * the Playwright webServer needs, and the orphan self-reaping below.
 *
 * Pure node:* entry: runs on a bare Node >= 24 (type stripping — no
 * transpile step, no permission flags; the process only reads the served
 * tree), so the fresh-clone Site E2E lane needs no deno binary.
 *
 * Usage:
 *   node www/e2e/static-server.ts --port 4174 --dir www/dist
 */

import process from 'node:process';
import { findPort, serveStatic } from '../../tools/lib/static-server.ts';

// --key takes the next argv element verbatim (a value that itself starts
// with `--` also registers as a key, and the last occurrence wins) — the
// same pair-parse semantics this entry always had.
const args: Record<string, string> = {};
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  if (argv[i].startsWith('--')) args[argv[i].slice(2)] = argv[i + 1] ?? '';
}

const PORT = Number(args.port ?? '4174');
const ROOT = args.dir ?? 'www/dist';

// Orphan self-reaping: Playwright owns this server as its child and kills it
// on teardown, but a hard kill of Playwright (or of the whole gate process
// tree) orphans the server with nobody left to reap it. Because the
// Playwright config pins a deterministic port with `reuseExistingServer:
// false`, such an orphan fails every later run closed with "port is already
// used" (seen 2026-10-04: a server orphaned at 03:05 wedged the 16:44 gate
// on port 4174). So poll the parent PID: an orphaned POSIX process is
// reparented to init/launchd (PID 1) — comparing against that sentinel,
// rather than a parent PID captured at startup, also catches a parent that
// dies while this module's imports are still evaluating. The same contract
// applies to a manually started server: its shell dying ends it, which is
// the right lifetime for a test server.
const PARENT_POLL_MS = 1_000;

const server = await serveStatic(ROOT, { port: await findPort(PORT) });
console.log(`E2E static server listening on ${server.origin}`);

const orphanWatch = setInterval(() => {
  if (process.ppid !== 1) return;
  console.log('E2E static server: orphaned (parent exited) — shutting down');
  clearInterval(orphanWatch);
  // serveStatic's close() already ends the raw server and all its
  // connections.
  void server.close();
  // Never hang on a slow close or an open keep-alive socket.
  setTimeout(() => process.exit(0), 1_000).unref();
}, PARENT_POLL_MS);
// The listening server keeps the event loop alive; the watch itself must not.
orphanWatch.unref();
