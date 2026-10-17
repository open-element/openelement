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
 * incrementally).
 *
 * Error containment: a malformed request line answers
 * 400 and an escaping handler failure answers 500; the fetch handler itself
 * owns the user-facing error copy.
 *
 * Disconnect propagation (flow control and cancellation): `Request.signal`
 * and stream `cancel()` converge on one idempotent cleanup.
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

/**
 * How this bridge reconstructs the origin of the Request it hands the fetch
 * handler.
 *
 * The origin is not cosmetic: the same-origin CSRF floor compares a browser's
 * `Origin` header against the request URL's own origin, so an origin this
 * bridge invents decides whether a legitimate form POST is admitted. Behind a
 * TLS-terminating proxy the browser's scheme is `https` while this process
 * only ever sees plain HTTP, so a hardcoded `http://<Host>` made every
 * same-origin POST from the public site compare unequal and answer 403.
 *
 * Both knobs are the OPERATOR's declaration, and neither reads a header unless
 * the operator has said the peer is a proxy — a forwarded header is client
 * input on a directly reachable port, and honouring it there would let a
 * caller choose the origin the CSRF comparison is made against.
 */
export interface RequestOriginPolicy {
  /**
   * The origin the deployment is reachable at, as the browser sees it
   * (`https://example.test`). Wins over every header, because it is the answer
   * the operator states rather than one the caller supplies.
   */
  readonly publicOrigin?: string;
  /**
   * Read `Forwarded` / `X-Forwarded-Proto` / `X-Forwarded-Host` because the
   * only thing that can reach this port is a proxy the operator controls.
   */
  readonly trustProxy?: boolean;
}

/** The first value of a possibly-repeated, possibly-comma-joined header. */
function firstHeaderValue(value: string | string[] | undefined): string | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  const first = raw?.split(',')[0]?.trim();
  return first === undefined || first === '' ? undefined : first;
}

/**
 * Reconstruct the request origin under the declared policy. With neither knob
 * set the answer is `http://<Host>` — unchanged, and correct for a
 * deployment served directly.
 */
function requestOrigin(
  req: IncomingMessage,
  fallbackHost: string,
  policy: RequestOriginPolicy,
): string {
  if (policy.publicOrigin !== undefined) return policy.publicOrigin.replace(/\/+$/, '');
  const host = req.headers.host ?? fallbackHost;
  if (policy.trustProxy !== true) return `http://${host}`;
  // RFC 7239 `Forwarded: for=…;proto=https;host=example.test`, falling back to
  // the de-facto X-Forwarded-* pair. Both are only read under trustProxy.
  let forwardedProto: string | undefined;
  let forwardedHost: string | undefined;
  const forwarded = firstHeaderValue(req.headers.forwarded);
  if (forwarded !== undefined) {
    for (const parameter of forwarded.split(';')) {
      const [rawName, ...rest] = parameter.split('=');
      const name = rawName?.trim().toLowerCase();
      const value = rest.join('=').trim().replace(/^"|"$/g, '');
      if (name === 'proto') forwardedProto = value;
      if (name === 'host') forwardedHost = value;
    }
  }
  const proto = (
    forwardedProto ?? firstHeaderValue(req.headers['x-forwarded-proto'])
  )?.toLowerCase();
  const authority = forwardedHost || firstHeaderValue(req.headers['x-forwarded-host']) || host;
  // Only the two schemes an origin can carry; anything else is not a scheme a
  // browser could have used, so the header is ignored rather than trusted.
  const scheme = proto === 'https' ? 'https' : 'http';
  return `${scheme}://${authority}`;
}

/** Build a fetch Request from a node IncomingMessage. */
function requestFromIncoming(
  req: IncomingMessage,
  fallbackHost: string,
  signal: AbortSignal,
  policy: RequestOriginPolicy,
): Request {
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) {
      for (const item of value) headers.append(name, item);
    } else if (value !== undefined) {
      headers.set(name, value);
    }
  }
  const method = req.method ?? 'GET';
  const init: RequestInit & { duplex?: 'half' } = { method, headers, signal };
  if (method !== 'GET' && method !== 'HEAD') {
    // Stream the request body; the generated request-time handlers consume
    // it through request.json()/text()/formData().
    init.body = Readable.toWeb(req) as unknown as ReadableStream<Uint8Array>;
    init.duplex = 'half';
  }
  const origin = requestOrigin(req, fallbackHost, policy);
  return new Request(`${origin}${req.url ?? '/'}`, init);
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
    // These answers carry no body on the wire, but the fetch Response can
    // still hold one (a HEAD request answered with a constructed Response;
    // 204/304-with-body is unreachable through the Response constructor yet
    // kept symmetric). Leaving it unconsumed parks the stream forever, so it
    // is cancelled here. cancel() is async: a rejection is swallowed because
    // the answer is already committed and no channel remains to report it.
    void response.body?.cancel().catch(() => {});
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
 * handler. The call returns immediately (the server keeps the process alive).
 *
 * Listen failures are not contained here: they surface on the returned
 * Server's 'error' event with node's default (no listener attached means the
 * error throws), so an embedder keeps wiring its own handler. The start CLI
 * (`src/cli/start.ts`) attaches one that answers EADDRINUSE/EACCES with an
 * actionable line.
 */
export function serveFetch(
  options: {
    hostname: string;
    port: number;
    handler: FetchHandler;
  } & RequestOriginPolicy,
): Server {
  const fallbackHost = `${options.hostname}:${options.port}`;
  const policy: RequestOriginPolicy = {
    ...(options.publicOrigin === undefined ? {} : { publicOrigin: options.publicOrigin }),
    ...(options.trustProxy === undefined ? {} : { trustProxy: options.trustProxy }),
  };
  const server = createServer((req, res) => {
    void (async () => {
      // Disconnect detection is wired BEFORE the handler runs. The Request
      // below carries this controller's signal, so a hanging
      // handler (or one awaiting loader/stream work) observes the client
      // going away through `request.signal` instead of never.
      const abort = new AbortController();
      let request: Request;
      try {
        request = requestFromIncoming(req, fallbackHost, abort.signal, policy);
      } catch {
        res.statusCode = 400;
        res.end('Bad Request');
        return;
      }
      const onAborted = () => abort.abort();
      const onReqClose = () => {
        // Request-side 'close' is not a disconnect by itself: it also fires
        // when the message completes (body fully received, before the
        // handler consumes it). Only an incomplete request — a torn upload
        // — aborts here; any disconnect after completion is caught by the
        // res 'close' listener below.
        if (!req.complete && !res.writableFinished) abort.abort();
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
      // A disconnect that already landed before the listeners attached. Only
      // an incomplete request counts: `complete`, not `destroyed`, separates
      // a torn upload from a request whose body arrived whole (a consumed
      // stream can report destroyed too).
      if (req.destroyed && !req.complete) abort.abort();
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
