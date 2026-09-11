/**
 * node-bridge.ts — the node:http ↔ Fetch bridge, single source (#622-class
 * twin fix).
 *
 * The same Request/Response conversion used to be hand-duplicated between
 * cli/start.ts and the generated dist/server/serve.mjs template and drifted
 * into two HIGH findings:
 *
 *  1. Multi Set-Cookie loss: `headers.forEach((v, k) => res.setHeader(k, v))`
 *     collapses multiple Set-Cookie headers to the last one (chunked session
 *     cookies like sb-*-auth-token.0/.1 all but the last vanished). The
 *     response side now emits the `Headers.getSetCookie()` list as a node
 *     header array (available since Node 18.14 / Deno / Workers; guarded so
 *     older undici keeps the legacy joined behaviour).
 *  2. Request URL ignored Host/proto: the URL was built from the listen
 *     address, so behind a real domain the ADR-0122 §3 CSRF Origin compare
 *     false-403'd same-origin posts. The URL now comes from the validated
 *     Host header (malformed or userinfo-bearing Host values are refused and
 *     fall back to the listen address); X-Forwarded-Proto/Host are honoured
 *     only under the explicit OPEN_ELEMENT_TRUST_PROXY=1 opt-in — forwarded
 *     headers are never trusted by default.
 *
 * cli/start.ts imports these functions directly. The generated serve.mjs must
 * stay self-contained (dist/ is a portable artifact), so
 * renderStandaloneServerModule (internal/ssg/ssg-helpers.ts) embeds the exact
 * function sources via NODE_BRIDGE_EMBEDDED_FUNCTIONS + Function.toString()
 * (the Deno build host strips the type annotations, so the emitted source is
 * valid standalone JS; embedBridgeSource there fails the build loudly if a
 * host ever returns annotated source instead).
 */

import type { IncomingMessage, ServerResponse } from 'node:http';

interface NodeBridgeRequestState {
  abort(reason?: unknown): void;
  cleanup(): void;
}

interface NodeBridgeTrackedRequest extends Request {
  [key: symbol]: NodeBridgeRequestState | undefined;
}

/** Listen-address + proxy-trust context for URL resolution. */
export interface NodeBridgeListen {
  host: string;
  port: number;
  /** OPEN_ELEMENT_TRUST_PROXY=1 — honour X-Forwarded-Proto/Host. */
  trustProxy: boolean;
}

/** First value of a possibly multi-valued node header. */
function firstHeaderValue(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

/**
 * Validate a Host (or X-Forwarded-Host) header value before it is trusted as
 * the request URL authority. Returns the normalized `host` (lowercased
 * hostname, default port stripped) or null for malformed/hostile values:
 * anything `new URL` cannot parse, and anything carrying userinfo, a path,
 * a query or a fragment (`a@evil.com`, `example.com/x`, whitespace).
 */
function validateHostHeader(host: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(`http://${host}`);
  } catch {
    return null;
  }
  if (parsed.username || parsed.password) return null;
  if (parsed.pathname !== '/' || parsed.search || parsed.hash) return null;
  return parsed.host;
}

/**
 * Resolve the absolute request URL for an incoming node request.
 *
 * Trust order:
 *  - direct connections: the validated Host header decides the authority on
 *    plain http; without a (valid) Host the listen address is the fallback.
 *  - proxies (listen.trustProxy, from OPEN_ELEMENT_TRUST_PROXY=1):
 *    X-Forwarded-Proto (only the literal values `https`/`http`, first of a
 *    comma list) decides the scheme and X-Forwarded-Host (then Host) the
 *    authority. Forwarded headers are never trusted by default.
 *
 * The CSRF Origin compare (ADR-0122 §3) runs against this URL, so the origin
 * the browser sees is the origin the handler sees.
 */
export function resolveRequestUrl(
  rawTarget: string,
  nodeHeaders: Record<string, string | string[] | undefined>,
  listen: NodeBridgeListen,
): string {
  const listenHost = listen.host === '0.0.0.0' ? 'localhost' : listen.host;
  const bracketed = listenHost.includes(':') ? `[${listenHost}]` : listenHost;
  const fallbackBase = `http://${bracketed}:${listen.port}`;
  const hostHeader = firstHeaderValue(nodeHeaders.host);
  let proto = 'http';
  let host: string | undefined;
  if (listen.trustProxy) {
    const forwardedProto = firstHeaderValue(nodeHeaders['x-forwarded-proto']);
    if (forwardedProto) {
      const candidate = forwardedProto.split(',')[0].trim().toLowerCase();
      if (candidate === 'https' || candidate === 'http') proto = candidate;
    }
    host = firstHeaderValue(nodeHeaders['x-forwarded-host']) ?? hostHeader;
  } else {
    host = hostHeader;
  }
  if (host) {
    const validated = validateHostHeader(host.split(',')[0].trim());
    if (validated) return new URL(rawTarget || '/', `${proto}://${validated}`).href;
  }
  return new URL(rawTarget || '/', fallbackBase).href;
}

/**
 * node IncomingMessage → web Request. The body streams through a
 * ReadableStream; GET/HEAD carry no body.
 */
export function nodeRequestToWeb(req: IncomingMessage, listen: NodeBridgeListen): Request {
  const url = resolveRequestUrl(req.url || '/', req.headers, listen);
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value) headers.set(key, Array.isArray(value) ? value.join(', ') : value);
  }
  const method = req.method || 'GET';
  const hasBody = method !== 'GET' && method !== 'HEAD';
  const abortController = new AbortController();
  let bodyController: ReadableStreamDefaultController<Uint8Array> | null = null;
  let bodySettled = !hasBody;
  let cleaned = false;

  const abort = (reason: unknown = new DOMException('Client disconnected', 'AbortError')) => {
    if (!abortController.signal.aborted) abortController.abort(reason);
    if (!bodySettled && bodyController) {
      bodySettled = true;
      bodyController.error(reason);
    }
  };
  const onAborted = () => abort();
  const onError = (error: Error) => abort(error);
  const onSocketClose = () => abort();
  const onData = (chunk: Uint8Array) => {
    if (!bodySettled && bodyController) bodyController.enqueue(new Uint8Array(chunk));
  };
  const onEnd = () => {
    if (bodySettled || !bodyController) return;
    bodySettled = true;
    bodyController.close();
  };
  req.once('aborted', onAborted);
  req.once('error', onError);
  req.socket?.once('close', onSocketClose);

  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    req.removeListener('aborted', onAborted);
    req.removeListener('error', onError);
    req.socket?.removeListener('close', onSocketClose);
    req.removeListener('data', onData);
    req.removeListener('end', onEnd);
  };

  const request = new Request(url, {
    method,
    headers,
    signal: abortController.signal,
    body: hasBody
      ? new ReadableStream({
        start(controller) {
          bodyController = controller;
          req.on('data', onData);
          req.on('end', onEnd);
        },
        cancel(reason) {
          abort(reason);
          req.destroy(reason instanceof Error ? reason : undefined);
        },
      })
      : undefined,
    // @ts-expect-error Node 18 requires this for a non-GET body; ignored elsewhere.
    duplex: hasBody ? 'half' : undefined,
  });
  Object.defineProperty(request, Symbol.for('openelement.node-bridge-request'), {
    configurable: false,
    enumerable: false,
    value: { abort, cleanup } satisfies NodeBridgeRequestState,
  });
  return request;
}

function nodeBridgeRequestState(request: Request | undefined): NodeBridgeRequestState | undefined {
  if (!request) return undefined;
  return (request as NodeBridgeTrackedRequest)[
    Symbol.for('openelement.node-bridge-request')
  ];
}

/**
 * Copy web response headers onto a node response via `setHeader(key, value)`.
 * Set-Cookie goes out as the getSetCookie() array so multiple cookies survive
 * (a plain forEach + setHeader collapses them to the last one). Hosts without
 * Headers.getSetCookie (undici before Node 18.14) keep the legacy loop.
 */
export function applyWebResponseHeaders(
  webHeaders: Headers,
  setHeader: (key: string, value: string | string[]) => void,
): void {
  const cookies = typeof webHeaders.getSetCookie === 'function' ? webHeaders.getSetCookie() : null;
  webHeaders.forEach((value, key) => {
    if (cookies && key === 'set-cookie') return;
    setHeader(key, value);
  });
  if (cookies && cookies.length > 0) setHeader('set-cookie', cookies);
}

/**
 * Write a web Response onto a node ServerResponse: status, headers (with the
 * Set-Cookie array handling of applyWebResponseHeaders), then the streamed
 * body. A body pump failure ends the response instead of hanging. A response
 * that is already closed/destroyed on entry — the client disconnected while
 * the handler was still running (#1152) — cancels the body and cleans up
 * without writing.
 */
export function writeWebResponse(
  response: Response,
  res: ServerResponse,
  request?: Request,
): void {
  const requestState = nodeBridgeRequestState(request);
  let finished = false;
  let settled = false;
  let closed = false;
  const reader = response.body?.getReader();

  const cleanup = () => {
    res.removeListener('finish', onFinish);
    res.removeListener('close', onClose);
    res.removeListener('error', onError);
    requestState?.cleanup();
  };
  const onFinish = () => {
    finished = true;
    settled = true;
    cleanup();
  };
  const cancelBody = (reason: unknown): void => {
    if (settled) return;
    settled = true;
    requestState?.abort(reason);
    // #1154 (ADR-0141): initiate the body cancel first, but never gate
    // listener cleanup on it settling — a source cancel() may hang (e.g. it
    // awaits a dead upstream), and a hung cancel must not pin the bridge
    // listeners.
    try {
      void reader?.cancel(reason).catch(() => {
        // The source may already have errored or closed; cancellation is best-effort.
      });
    } catch {
      // A released or errored stream may throw synchronously; still best-effort.
    }
    cleanup();
  };
  const onClose = () => {
    closed = true;
    if (!finished) {
      const reason = new DOMException('Client disconnected', 'AbortError');
      requestState?.abort(reason);
      cancelBody(reason);
      return;
    }
    cleanup();
  };
  const onError = (error: Error) => {
    requestState?.abort(error);
    cancelBody(error);
  };

  // #1152 (ADR-0141): the client may have disconnected while the handler was
  // still running — res 'close'/'finish' then fired before the once-listeners
  // below exist and would never be observed: the pump would write into a dead
  // socket (a destroyed res accepts writes that never drain) and neither the
  // body cancel nor the listener cleanup would ever run. Detect an
  // already-terminal response up front: cancel the body source, run cleanup
  // and skip the write entirely.
  if (res.destroyed || res.closed || res.writableEnded) {
    cancelBody(new DOMException('Client disconnected', 'AbortError'));
    return;
  }

  res.statusCode = response.status;
  applyWebResponseHeaders(response.headers, (key, value) => res.setHeader(key, value));
  res.once('finish', onFinish);
  res.once('close', onClose);
  res.once('error', onError);

  if (!reader) {
    res.end();
    return;
  }
  const waitForDrain = () =>
    new Promise<void>((resolve, reject) => {
      if (closed) {
        reject(new DOMException('Client disconnected', 'AbortError'));
        return;
      }
      const remove = () => {
        res.removeListener('drain', onDrain);
        res.removeListener('close', onDrainClose);
        res.removeListener('error', onDrainError);
      };
      const onDrain = () => {
        remove();
        resolve();
      };
      const onDrainClose = () => {
        remove();
        reject(new DOMException('Client disconnected', 'AbortError'));
      };
      const onDrainError = (error: Error) => {
        remove();
        reject(error);
      };
      res.once('drain', onDrain);
      res.once('close', onDrainClose);
      res.once('error', onDrainError);
    });
  const pump = async () => {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        res.end();
        break;
      }
      if (!res.write(value)) await waitForDrain();
    }
  };
  pump().catch((error) => {
    cancelBody(error);
    if (!res.destroyed && !res.writableEnded) res.end();
  });
}

/**
 * The functions renderStandaloneServerModule embeds verbatim into the
 * generated dist/server/serve.mjs (self-contained by contract — it cannot
 * import this module). Dependency order: every function a later entry calls
 * appears earlier. Pinned by __tests__/node-bridge.test.ts.
 */
export const NODE_BRIDGE_EMBEDDED_FUNCTIONS = [
  firstHeaderValue,
  validateHostHeader,
  resolveRequestUrl,
  nodeRequestToWeb,
  nodeBridgeRequestState,
  applyWebResponseHeaders,
  writeWebResponse,
];
