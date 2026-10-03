/**
 * Minimal static file server for openElement E2E tests.
 *
 * Pure node:* entry (#1509 follow-up): the fresh-clone lane runs the Site
 * E2E gate on a Node 24 runner with no deno binary, and the previous
 * webServer command (`exec deno run ...`) died with exit 127 before
 * Playwright could start. Serving behavior is unchanged — this file layers
 * exactly like tools/lib/static-server.ts: content-type/candidate-path/
 * cache-control rules come from the router's static-serve helpers and HTTP
 * binding goes through the node:http fetch adapter
 * (packages/router/src/internal/node-http.ts serveFetch); what this script
 * itself keeps is the --port/--dir CLI contract and the findPort retry the
 * Playwright webServer needs.
 *
 * Serving contract (shared with tools/lib, pinned by its tests): IANA MIME
 * table with an explicit UTF-8 charset on text/*, production candidate-path
 * fallback (`.html` pretty URLs and directory indexes), single-range
 * `Range: bytes=a-b` support (206, 416 when unsatisfiable), cache-control
 * policy, 400 on malformed percent-encoding, 403 on path traversal
 * (`..`, NUL), 404 when no candidate exists.
 *
 * Usage (Node >= 24 direct run — type stripping, no transpile step, no
 * permission flags: the process only reads the served tree):
 *   node www/e2e/static-server.ts --port 4174 --dir www/dist
 */

import { readFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { join } from 'node:path';
import process from 'node:process';
import { serveFetch } from '../../packages/router/src/internal/node-http.ts';
import {
  cacheControlFor,
  contentTypeFor,
  staticFileCandidates,
} from '../../packages/router/src/vite/internal/static-serve.ts';

interface StaticServer {
  origin: string;
  close(): Promise<void>;
}

/**
 * Single-range `Range: bytes=a-b` support. Media scrubbing (video.currentTime
 * seeks) requires a seekable resource: without 206 responses the browser
 * media stack reports `seekable.length === 0` and ignores every seek. Real
 * static hosts all support ranges — the test server must match them.
 */
function respondWithRange(
  body: Uint8Array<ArrayBuffer>,
  path: string,
  rangeHeader: string | null,
): Response {
  const headers: Record<string, string> = {
    'content-type': contentTypeFor(path),
    'accept-ranges': 'bytes',
  };
  const cacheControl = cacheControlFor(path);
  if (cacheControl) headers['cache-control'] = cacheControl;
  const match = rangeHeader?.match(/^bytes=(\d*)-(\d*)$/);
  if (!match || (match[1] === '' && match[2] === '')) {
    return new Response(body, { headers });
  }
  const size = body.byteLength;
  const start = match[1] === '' ? Math.max(0, size - Number(match[2])) : Number(match[1]);
  const end = match[1] !== '' && match[2] !== '' ? Math.min(Number(match[2]), size - 1) : size - 1;
  if (start > end || start >= size) {
    return new Response('Range not satisfiable', {
      status: 416,
      headers: { 'content-range': `bytes */${size}` },
    });
  }
  return new Response(body.subarray(start, end + 1), {
    status: 206,
    headers: { ...headers, 'content-range': `bytes ${start}-${end}/${size}` },
  });
}

async function readCandidate(
  root: string,
  pathname: string,
  rangeHeader: string | null,
): Promise<Response | null> {
  let safePath: string;
  try {
    safePath = decodeURIComponent(pathname);
  } catch (error) {
    if (error instanceof URIError) return new Response('Bad Request', { status: 400 });
    throw error;
  }
  if (safePath.includes('..') || safePath.includes('\0')) {
    return new Response('Forbidden', { status: 403 });
  }

  const candidates = staticFileCandidates(pathname).map((candidate) => join(root, candidate));

  for (const candidate of candidates) {
    try {
      const body = await readFile(candidate);
      return respondWithRange(body, candidate, rangeHeader);
    } catch {
      // Try the next candidate.
    }
  }
  return null;
}

interface ServeStaticOptions {
  /** Preferred port; defaults to 0 (OS-assigned). */
  port?: number;
}

/**
 * Try to find an available loopback port starting from `preferred`.
 * Returns `preferred` when every candidate is occupied.
 */
export async function findPort(preferred: number, maxAttempts = 20): Promise<number> {
  for (let port = preferred; port < preferred + maxAttempts; port++) {
    if (await portFree(port)) return port;
  }
  return preferred;
}

/** Bind-and-close probe: `true` when the loopback port accepts a listener. */
function portFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = createServer();
    probe.once('listening', () => {
      probe.close(() => resolve(true));
    });
    probe.once('error', () => resolve(false));
    probe.listen({ port, host: '127.0.0.1' });
  });
}

/**
 * Bind the static server on node:http via the fetch adapter
 * (packages/router/src/internal/node-http.ts serveFetch). Resolves once the
 * socket is listening, so `origin` carries the OS-assigned port.
 */
export function serveStatic(root: string, options: ServeStaticOptions = {}): Promise<StaticServer> {
  return new Promise((resolve, reject) => {
    const server: Server = serveFetch({
      hostname: '127.0.0.1',
      port: options.port ?? 0,
      handler: async (request) => {
        const response = await readCandidate(
          root,
          new URL(request.url).pathname,
          request.headers.get('range'),
        );
        return response ?? new Response('Not found', { status: 404 });
      },
    });
    server.once('listening', () => {
      const addr = server.address();
      if (addr === null || typeof addr === 'string') {
        reject(new Error('static server: loopback listener has no port'));
        return;
      }
      resolve({
        origin: `http://127.0.0.1:${addr.port}`,
        close: () =>
          new Promise<void>((resolveClose, rejectClose) => {
            server.close((error) => (error ? rejectClose(error) : resolveClose()));
            server.closeAllConnections();
          }),
      });
    });
    server.once('error', reject);
  });
}

// --key takes the next argv element verbatim (a value that itself starts
// with `--` also registers as a key, and the last occurrence wins) — the
// same pair-parse semantics this entry always had.
const args: Record<string, string> = {};
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  if (argv[i].startsWith('--')) args[argv[i].slice(2)] = argv[i + 1] ?? '';
}

const PORT = Number(args.port ?? '4174');
const ROOT = args.dir ?? 'www/dist';

const server = await serveStatic(ROOT, { port: await findPort(PORT) });
console.log(`E2E static server listening on ${server.origin}`);
