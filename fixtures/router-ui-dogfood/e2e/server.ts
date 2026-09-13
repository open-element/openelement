/**
 * ui-dogfood fixture server.
 *
 * Static-only: every route is prerendered, so the canonical dispatchRequest
 * (packages/router/src/vite/internal/static-serve.ts, #1100) runs with a
 * null server module — the same request path the request-time fixture and
 * cli/start prove in CI.
 *
 * Usage:
 *   deno run -A server.ts --port 4197 --dir ../dist
 */

import { resolve } from 'node:path';
import { dispatchRequest } from '../../../packages/router/src/vite/internal/static-serve.ts';

const args: Record<string, string> = {};
for (let i = 0; i < Deno.args.length; i += 2) {
  if (Deno.args[i].startsWith('--')) args[Deno.args[i].slice(2)] = Deno.args[i + 1] ?? '';
}

const PORT = Number(args.port ?? '4197');
const ROOT = resolve(Deno.cwd(), args.dir ?? '../dist');

Deno.serve(
  { port: PORT, hostname: '127.0.0.1' },
  (request) => dispatchRequest(request, { distDir: ROOT, serverMod: null }),
);

console.log(`ui-dogfood fixture server -> http://127.0.0.1:${PORT} (root: ${ROOT})`);
