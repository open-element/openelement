/**
 * App-flow-native fixture server (#1339).
 *
 * Serves the built app:
 *   - static files from dist/ (exact file, /path -> /path/index.html, /path.html)
 *   - request-time routes are delegated to the generated dist/server/index.js:
 *     the named isRequestTimePath export (derived from the route table,
 *     #556, narrowed to admission-only by #1215) decides whether a pathname
 *     could belong to request-time handling, and the default export takes a
 *     Nitro v3 event ({ req }) and returns a Response.
 *
 * The MIME table, static candidate rules, and the server-entry contract come
 * from the shared adapter source (#732) so this fixture cannot drift from
 * cli/start.ts again.
 *
 * Usage:
 *   deno run -A server.ts --port 4280 --dir ../dist
 */

import { join, resolve } from 'node:path';
import { dispatchRequest, importRequestTimeServer } from '../../../src/internal/static-serve.ts';

const args: Record<string, string> = {};
for (let i = 0; i < Deno.args.length; i += 2) {
  if (Deno.args[i].startsWith('--')) args[Deno.args[i].slice(2)] = Deno.args[i + 1] ?? '';
}

const PORT = Number(args.port ?? '4280');
const ROOT = resolve(Deno.cwd(), args.dir ?? '../dist');

const serverEntry = await importRequestTimeServer(join(ROOT, 'server/index.js'));

Deno.serve(
  { port: PORT, hostname: '127.0.0.1' },
  (request) =>
    dispatchRequest(request, {
      distDir: ROOT,
      serverMod: serverEntry,
      env: Deno.env.toObject(),
      onHandlerError: (error) => console.error('[fixture server] handler error:', error),
    }),
);

console.log(`app-flow-native fixture server -> http://127.0.0.1:${PORT} (root: ${ROOT})`);
