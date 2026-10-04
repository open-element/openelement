/**
 * app-flow-lit fixture server.
 *
 * Identical contract to the request-time fixture server: static files from
 * dist/, request-time routes delegated to dist/server/index.js via the shared
 * adapter static-serve module (#732).
 *
 * Usage:
 *   node server.ts --port 4181 --dir ../dist
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

const PORT = Number(args.port ?? '4181');
const ROOT = resolve(process.cwd(), args.dir ?? '../dist');

const serverEntry = await importRequestTimeServer(join(ROOT, 'server/index.js'));

// Wire observer (#1339 §5, same contract as the native fixture): records
// exactly what arrives over HTTP for /guards POSTs — before the framework
// parses anything — so the e2e can compare the enhanced and native submission
// tuples byte for byte.
let lastSubmission: {
  method: string;
  url: string;
  contentType: string;
  actionHeader: string | null;
  rawBody: string;
} | null = null;

serve({
  port: PORT,
  hostname: '127.0.0.1',
  fetch: async (request) => {
    const url = new URL(request.url);
    if (url.pathname === '/__wire/last') {
      return Response.json({ last: lastSubmission });
    }
    if (url.pathname === '/__wire/reset') {
      lastSubmission = null;
      return new Response('ok');
    }
    if (request.method === 'POST' && url.pathname.startsWith('/guards')) {
      const rawBody = await request.clone().text();
      lastSubmission = {
        method: request.method,
        url: request.url,
        contentType: request.headers.get('content-type') ?? '',
        actionHeader: request.headers.get('x-openelement-action'),
        rawBody,
      };
    }
    return dispatchRequest(request, {
      distDir: ROOT,
      serverMod: serverEntry,
      env: process.env,
      onHandlerError: (error) => console.error('[app-flow-lit server] handler error:', error),
    });
  },
});

console.log(`app-flow-lit fixture server -> http://127.0.0.1:${PORT} (root: ${ROOT})`);
