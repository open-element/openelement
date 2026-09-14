/**
 * Minimal static file server for the site-light-probe fixture E2E.
 *
 * Thin CLI wrapper around tools/lib/static-server.ts: serving behavior (MIME
 * table, candidate-path order, traversal guard) is the shared lib's; this
 * script only keeps the port preference + findPort retry the Playwright
 * webServer needs.
 *
 * Usage (scoped permissions, never -A):
 *   deno run --allow-read --allow-net --allow-env --deny-ffi --no-prompt e2e/static-server.ts --port 4281 --dir ../dist
 */

import { findPort, serveStatic } from '../../../../tools/lib/static-server.ts';

const args: Record<string, string> = {};
for (let i = 0; i < Deno.args.length; i += 2) {
  if (Deno.args[i].startsWith('--')) args[Deno.args[i].slice(2)] = Deno.args[i + 1] ?? '';
}

const PORT = Number(args.port ?? '4281');
const ROOT = args.dir ?? '../dist';

const server = serveStatic(ROOT, { port: findPort(PORT) });
console.log(`site-light-probe fixture static server listening on ${server.origin}`);
