/**
 * ui-dogfood fixture server.
 *
 * Static-only: every route is prerendered, so the canonical dispatchRequest
 * (packages/router/src/vite/internal/static-serve.ts, #1100) runs with a
 * null server module — the same request path the request-time fixture and
 * cli/start prove in CI.
 *
 * Usage:
 *   node server.ts --port 4197 --dir ../dist
 */

import { serve } from '@hono/node-server';
import process from 'node:process';
import { resolve } from 'node:path';
import { dispatchRequest } from '../../../../packages/router/src/vite/internal/static-serve.ts';

const args: Record<string, string> = {};
const cliArgs = process.argv.slice(2);
for (let i = 0; i < cliArgs.length; i += 2) {
  if (cliArgs[i].startsWith('--')) args[cliArgs[i].slice(2)] = cliArgs[i + 1] ?? '';
}

const PORT = Number(args.port ?? '4197');
const ROOT = resolve(process.cwd(), args.dir ?? '../dist');

serve({
  port: PORT,
  hostname: '127.0.0.1',
  fetch: (request) => dispatchRequest(request, { distDir: ROOT, serverMod: null }),
});

console.log(`ui-dogfood fixture server -> http://127.0.0.1:${PORT} (root: ${ROOT})`);
