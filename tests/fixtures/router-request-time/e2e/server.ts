/**
 * Request-time fixture server.
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
 *   node server.ts --port 4180 --dir ../dist
 */

import { serve } from '@hono/node-server';
import process from 'node:process';
import { join, resolve } from 'node:path';
import {
  dispatchRequest,
  importRequestTimeServer,
} from '../../../../packages/router/src/vite/internal/static-serve.ts';

const args: Record<string, string> = {};
const cliArgs = process.argv.slice(2);
for (let i = 0; i < cliArgs.length; i += 2) {
  if (cliArgs[i].startsWith('--')) args[cliArgs[i].slice(2)] = cliArgs[i + 1] ?? '';
}

const PORT = Number(args.port ?? '4180');
const ROOT = resolve(process.cwd(), args.dir ?? '../dist');

const serverEntry = await importRequestTimeServer(join(ROOT, 'server/index.js'));

serve({
  port: PORT,
  hostname: '127.0.0.1',
  fetch: (request) =>
    dispatchRequest(request, {
      distDir: ROOT,
      serverMod: serverEntry,
      env: process.env,
      onHandlerError: (error) => console.error('[fixture server] handler error:', error),
    }),
});

console.log(`request-time fixture server -> http://127.0.0.1:${PORT} (root: ${ROOT})`);
