/**
 * node:http ↔ fetch adapter for the router CLI (`src/cli/start.ts`).
 *
 * The start CLI dispatches through the standard fetch(Request): Response
 * handler (`createFetchHandler` in `vite/internal/static-serve.ts`) — the
 * same entry the Nitro mount serves in production. This module is the
 * mechanical bridge that runs that handler on node:http: it adapts an
 * IncomingMessage into a fetch Request (streaming the request body for
 * methods that carry one) and a fetch Response into the ServerResponse
 * (streaming the response body, so prerendered/streaming responses flush
 * incrementally, as the previous Deno-host server did).
 *
 * Error containment mirrors that server's: a malformed request line answers
 * 400 and an escaping handler failure answers 500; the fetch handler itself
 * owns the user-facing error copy.
 *
 * Disconnect propagation (ADR-0158, "Flow control and cancellation"):
 * `Request.signal` and stream `cancel()` converge on one idempotent cleanup.
 * This adapter owns the host side of that convergence — the client socket's
 * disconnect aborts `Request.signal` BEFORE the handler is dispatched, so
 * loader/stream work observes it through the signal (the one
 * `createStreamRequestScope` fans out from) instead of only after the
 * response body conversion.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { Readable } from 'node:stream';
import type { ReadableStream as NodeWebReadableStream } from 'node:stream/web';

/** Standard fetch handler contract shared with the Nitro mount. */
export type FetchHandler = (request: Request) => Promise<Response>;

/** Build a fetch Request from a node IncomingMessage. */
function requestFromIncoming(
  req: IncomingMessage,
  fallbackHost: string,
  signal: AbortSignal,
): Request {
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) {
      for (const item of value) headers.append(name, item);
    } else if (value !== undefined) {
      headers.set(name, value);
    }
  }
  const host = req.headers.host ?? fallbackHost;
  const method = req.method ?? 'GET';
  const init: RequestInit & { duplex?: 'half' } = { method, headers, signal };
  if (method !== 'GET' && method !== 'HEAD') {
    // Stream the request body (the Deno-host server did the same); the
    // generated request-time handlers consume it through
    // request.json()/text()/formData().
    init.body = Readable.toWeb(req) as unknown as ReadableStream<Uint8Array>;
    init.duplex = 'half';
  }
  return new Request(`http://${host}${req.url ?? '/'}`, init);
}

/** Write a fetch Response onto a node ServerResponse. */
function sendResponse(res: ServerResponse, response: Response, method: string): void {
  res.statusCode = response.status;
  response.headers.forEach((value, name) => {
    if (name === 'set-cookie') return;
    res.setHeader(name, value);
  });
  // Multiple Set-Cookie values must stay separate headers (RFC 9110); the
  // Headers iteration would join them into one comma-glued value.
  const setCookies = response.headers.getSetCookie();
  if (setCookies.length > 0) res.setHeader('set-cookie', setCookies);

  if (method === 'HEAD' || response.status === 204 || response.status === 304) {
    res.end();
    return;
  }
  const body = response.body;
  if (body === null) {
    res.end();
    return;
  }
  const stream = Readable.fromWeb(body as unknown as NodeWebReadableStream<Uint8Array>);
  res.on('close', () => stream.destroy());
  stream.on('error', () => res.destroy());
  stream.pipe(res);
}

/**
 * Start an HTTP server on `hostname:port` that dispatches to the fetch
 * handler. The call returns immediately (the server keeps the process alive),
 * matching the shape of the previous Deno-host `serve({ hostname, port },
 * handler)` call.
 */
export function serveFetch(options: {
  hostname: string;
  port: number;
  handler: FetchHandler;
}): Server {
  const fallbackHost = `${options.hostname}:${options.port}`;
  const server = createServer((req, res) => {
    void (async () => {
      // ADR-0158: the disconnect detection is wired before the handler runs.
      // The Request below carries this controller's signal, so a hanging
      // handler (or one awaiting loader/stream work) observes the client
      // going away through `request.signal` instead of never.
      const abort = new AbortController();
      let request: Request;
      try {
        request = requestFromIncoming(req, fallbackHost, abort.signal);
      } catch {
        res.statusCode = 400;
        res.end('Bad Request');
        return;
      }
      const onAborted = () => abort.abort();
      const onReqClose = () => {
        // IncomingMessage 'close' also fires after a fully answered exchange
        // (measured: it follows ServerResponse 'finish', with the response
        // already flushed); only a response that never finished means the
        // client disconnected mid-exchange.
        if (!res.writableFinished) abort.abort();
      };
      const detach = () => {
        req.off('aborted', onAborted);
        req.off('close', onReqClose);
        res.off('close', onResClose);
      };
      const onResClose = () => {
        // 'close' is the final event of the exchange on both the answered
        // and the disconnected path; an unflushed response here means the
        // disconnect slipped past the request-side listeners above.
        if (!res.writableFinished) abort.abort();
        // The exchange is over either way — drop the listeners so a reused
        // keep-alive socket cannot fire stale handlers on the next request.
        detach();
      };
      req.on('aborted', onAborted);
      req.on('close', onReqClose);
      res.on('close', onResClose);
      // A disconnect that already landed before the listeners attached.
      if (req.destroyed && !res.writableFinished) abort.abort();
      let response: Response;
      try {
        response = await options.handler(request);
      } catch (error) {
        console.error('[openElement start] request dispatch failure:', error);
        response = new Response('Internal Server Error', { status: 500 });
      }
      sendResponse(res, response, req.method ?? 'GET');
    })().catch((error) => {
      console.error('[openElement start] response write failure:', error);
      res.destroy();
    });
  });
  server.on('clientError', (error, socket) => {
    if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
  });
  server.listen(options.port, options.hostname);
  return server;
}
