/**
 * Minimal static file server for the site-light-probe fixture E2E.
 *
 * Thin CLI wrapper around tools/lib/static-server.ts: serving behavior (MIME
 * table, candidate-path order, traversal guard) is the shared lib's; this
 * script only keeps the port preference + findPort retry the Playwright
 * webServer needs.
 *
 * Usage:
 *   node e2e/static-server.ts --port 4281 --dir ../dist
 */

import process from 'node:process';
import { findPort, serveStatic } from '../../../../tools/lib/static-server.ts';

const args: Record<string, string> = {};
const cliArgs = process.argv.slice(2);
for (let i = 0; i < cliArgs.length; i += 2) {
  if (cliArgs[i].startsWith('--')) args[cliArgs[i].slice(2)] = cliArgs[i + 1] ?? '';
}

const PORT = Number(args.port ?? '4281');
const ROOT = args.dir ?? '../dist';

const port = await findPort(PORT);
const server = serveStatic(ROOT, { port });
console.log(`site-light-probe fixture static server listening on ${server.origin}`);
