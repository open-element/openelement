/**
 * Shared static file server for smoke tooling (#788).
 *
 * Serves a built output directory over HTTP with content-type mapping and
 * production candidate-path fallback (`.html` pretty URLs and directory
 * indexes). Path traversal (`..`, NUL) is rejected with 403.
 */

import {
  cacheControlFor,
  contentTypeFor,
  staticFileCandidates,
} from '../../packages/router/src/vite/internal/static-serve.ts';
import { join } from '@std/path';

interface StaticServer {
  origin: string;
  close(): Promise<void>;
}

export function contentType(path: string): string {
  return contentTypeFor(path);
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
    'content-type': contentType(path),
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
      const body = await Deno.readFile(candidate);
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
export function findPort(preferred: number, maxAttempts = 20): number {
  for (let port = preferred; port < preferred + maxAttempts; port++) {
    try {
      const listener = Deno.listen({ port, hostname: '127.0.0.1' });
      listener.close();
      return port;
    } catch {
      // Port in use; try the next one.
    }
  }
  return preferred;
}

export function serveStatic(root: string, options: ServeStaticOptions = {}): StaticServer {
  const server = Deno.serve(
    { port: options.port ?? 0, hostname: '127.0.0.1' },
    async (request) => {
      const response = await readCandidate(
        root,
        new URL(request.url).pathname,
        request.headers.get('range'),
      );
      return response ?? new Response('Not found', { status: 404 });
    },
  );
  const addr = server.addr as Deno.NetAddr;
  return {
    origin: `http://127.0.0.1:${addr.port}`,
    close: () => server.shutdown(),
  };
}
