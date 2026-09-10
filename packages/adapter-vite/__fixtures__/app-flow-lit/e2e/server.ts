/**
 * app-flow-lit fixture server.
 *
 * Identical contract to the request-time fixture server: static files from
 * dist/, request-time routes delegated to dist/server/index.js via the shared
 * adapter static-serve module (#732).
 *
 * Usage:
 *   deno run -A server.ts --port 4181 --dir ../dist
 */

import { join, resolve } from 'node:path';
import { dispatchRequest, importRequestTimeServer } from '../../../src/internal/static-serve.ts';

const args: Record<string, string> = {};
for (let i = 0; i < Deno.args.length; i += 2) {
  if (Deno.args[i].startsWith('--')) args[Deno.args[i].slice(2)] = Deno.args[i + 1] ?? '';
}

const PORT = Number(args.port ?? '4181');
const ROOT = resolve(Deno.cwd(), args.dir ?? '../dist');

const serverEntry = await importRequestTimeServer(join(ROOT, 'server/index.js'));

Deno.serve(
  { port: PORT, hostname: '127.0.0.1' },
  (request) =>
    dispatchRequest(request, {
      distDir: ROOT,
      serverMod: serverEntry,
      env: Deno.env.toObject(),
      onHandlerError: (error) => console.error('[app-flow-lit server] handler error:', error),
    }),
);

console.log(`app-flow-lit fixture server -> http://127.0.0.1:${PORT} (root: ${ROOT})`);
