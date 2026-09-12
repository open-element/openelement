/**
 * Shared HTTP helpers for the desktop examples (deno-desktop-mastodon and
 * deno-desktop-reader). Extracted so the two servers stop drifting; both
 * main.ts files import from here instead of keeping verbatim copies.
 */

export function readTextSafe(url: URL): string | null {
  try {
    return Deno.readTextFileSync(url);
  } catch {
    return null;
  }
}

export async function readFileSafe(url: URL): Promise<Uint8Array<ArrayBuffer> | null> {
  try {
    return await Deno.readFile(url);
  } catch {
    return null;
  }
}

export function html(body: string): Response {
  return new Response(body, { headers: { 'content-type': 'text/html' } });
}

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

export function byteBody(bytes: Uint8Array<ArrayBuffer>): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

export function serveFile(bytes: Uint8Array<ArrayBuffer>, ext: string): Response {
  const mime: Record<string, string> = {
    '.js': 'application/javascript',
    '.mjs': 'application/javascript',
    '.css': 'text/css',
    '.html': 'text/html',
    '.json': 'application/json',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
  };
  return new Response(byteBody(bytes), {
    headers: { 'content-type': mime[ext] ?? 'application/octet-stream' },
  });
}

export function notFound(): Response {
  return new Response('Not Found', { status: 404 });
}

export function serverError(): Response {
  return new Response('Internal Server Error', {
    status: 500,
    headers: { 'content-type': 'text/plain' },
  });
}

export function methodNotAllowed(): Response {
  return new Response('Method Not Allowed', { status: 405 });
}

export function closeApp(server: Deno.HttpServer): Response {
  setTimeout(() => {
    void server.shutdown().finally(() => Deno.exit(0));
  }, 25);
  return json({ closing: true });
}

export interface DesktopDispatch {
  req: Request;
  url: URL;
  pathname: string;
  /** Basename extension when the path looks like a file ('' otherwise). */
  ext: string;
}

/**
 * Loopback-only HTTP server skeleton shared by the desktop examples: PORT
 * env (default 8000), the /api/app/close endpoint, a try/catch around the
 * app-specific dispatch so the webview stays alive, and the startup log.
 */
export function serveDesktopApp(
  label: string,
  dispatch: (ctx: DesktopDispatch) => Promise<Response> | Response,
): Deno.HttpServer {
  const port = Number(Deno.env.get('PORT') ?? 8000);
  // Loopback only: this is a desktop app, it must not be reachable from the LAN.
  const server: Deno.HttpServer = Deno.serve(
    { hostname: '127.0.0.1', port },
    async (req: Request) => {
      try {
        const url = new URL(req.url);
        const pathname = url.pathname;
        const dotIndex = pathname.lastIndexOf('.');
        const ext = dotIndex > pathname.lastIndexOf('/') ? pathname.slice(dotIndex) : '';

        if (pathname === '/api/app/close') {
          if (req.method !== 'POST') return methodNotAllowed();
          return closeApp(server);
        }

        return await dispatch({ req, url, pathname, ext });
      } catch (err) {
        console.error(`[${label}] Handler error:`, err);
        return serverError();
      }
    },
  );

  const addr = server.addr as Deno.NetAddr;
  console.log(`[${label}] Listening on http://${addr.hostname}:${addr.port}/`);
  return server;
}
