/**
 * Minimal static file server for openElement E2E tests.
 *
 * Thin CLI wrapper around tools/lib/static-server.ts: serving behavior (MIME
 * table, candidate-path order, traversal guard) is the shared lib's; this
 * script only keeps the port preference + findPort retry the Playwright
 * webServer needs.
 *
 * Usage:
 *   deno run -A www/e2e/static-server.ts --port 4174 --dir www/dist
 */

import { findPort, serveStatic } from '../../tools/lib/static-server.ts';

const args = Object.fromEntries(
  Deno.args.reduce<string[]>((acc, arg, i, arr) => {
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const value = arr[i + 1] ?? '';
      acc.push(key, value);
    }
    return acc;
  }, [])
    .map((v, i, a) => (i % 2 === 0 ? [v, a[i + 1]] : null))
    .filter((pair): pair is [string, string] => pair !== null),
);

const PORT = Number(args.port ?? '4174');
const ROOT = args.dir ?? 'www/dist';

const server = serveStatic(ROOT, { port: findPort(PORT) });
console.log(`E2E static server listening on ${server.origin}`);
