/**
 * Non-root-base fixture server (S-C2/S-12) — dependency-free.
 *
 * A tiny Node `http` bridge around the shared dispatch adapter
 * (packages/router/src/vite/internal/static-serve.ts — the same code path
 * `cli/start.ts` uses), so the fixture needs no server package of its own.
 *
 * It serves the built app the way a path-mounted deployment serves it: the
 * configured prefix (`/sub`) is stripped before the tree is resolved — static
 * files from dist/ and request-time routes delegated to the generated
 * dist/server/index.js — while every URL the browser is given keeps the base.
 * The response body is pumped chunk by chunk, so a streamed document keeps
 * streaming (no content-length, head first).
 *
 * Usage: node server.ts --port 4181 --dir ../dist --base /sub
 */

import { createServer } from 'node:http';
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
const BASE = (args.base ?? '/sub').replace(/\/$/, '');

const serverEntry = await importRequestTimeServer(join(ROOT, 'server/index.js'));

createServer((nodeRequest, nodeResponse) => {
  void (async () => {
    try {
      const url = new URL(
        nodeRequest.url ?? '/',
        `http://${nodeRequest.headers.host ?? 'localhost'}`,
      );
      if (url.pathname !== BASE && !url.pathname.startsWith(`${BASE}/`)) {
        nodeResponse.statusCode = 404;
        nodeResponse.end('Not Found');
        return;
      }
      const stripped = new URL((url.pathname.slice(BASE.length) || '/') + url.search, url.origin);
      const request = new Request(stripped, {
        method: nodeRequest.method,
        headers: nodeRequest.headers as HeadersInit,
      });
      const response = await dispatchRequest(request, {
        distDir: ROOT,
        serverMod: serverEntry,
        env: process.env as Record<string, string>,
        onHandlerError: (error) => console.error('[base-path fixture] handler error:', error),
      });
      nodeResponse.statusCode = response.status;
      response.headers.forEach((value, key) => nodeResponse.setHeader(key, value));
      if (response.body) {
        for await (const chunk of response.body) nodeResponse.write(Buffer.from(chunk));
      }
      nodeResponse.end();
    } catch (error) {
      // The response body never carries error text or stacks: the fixture is
      // an e2e server, but the habit is the product's. Diagnostics stay in
      // the server log.
      console.error('[base-path fixture] request failed:', error);
      nodeResponse.statusCode = 500;
      nodeResponse.end('Internal Server Error');
    }
  })();
}).listen(PORT, '127.0.0.1', () => {
  console.log(`base-path fixture server -> http://127.0.0.1:${PORT}${BASE} (root: ${ROOT})`);
});
