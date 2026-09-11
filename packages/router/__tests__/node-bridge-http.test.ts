/**
 * @openelement/router — live HTTP parity proof for the shared
 * node:http ↔ Fetch bridge (internal/node-bridge.ts).
 *
 * Boots BOTH production servers against the same minimal request-time
 * dist/server handler and runs the same vector set against each:
 *  - multi Set-Cookie round-trip: a handler writing two (chunked-session-
 *    shaped) cookies must deliver both, on cli/start.ts and on the generated
 *    serve.mjs alike;
 *  - Host-derived request URL: the handler sees the validated Host origin
 *    (this is the URL the ADR-0122 §3 CSRF Origin compare runs against);
 *  - proxy opt-in: X-Forwarded-* ignored by default, honored with
 *    OPEN_ELEMENT_TRUST_PROXY=1;
 *  - hostile Host values fall back to the listen address.
 *
 * The dist/server/serve.mjs copy is produced by the real generator
 * (renderStandaloneServerModule), so the two servers provably run the same
 * bridge source.
 */

import { assert, assertEquals } from '@std/assert';
import { join } from '@std/path';
import { request } from 'node:http';
import { renderStandaloneServerModule } from '../src/vite/internal/ssg/ssg-helpers.ts';

const startCli = join(import.meta.dirname!, '../src/cli/start.ts');

/** Minimal request-time server entry exercising both bridge directions. */
const SERVER_ENTRY = `export function isRequestTimePath() { return false; }
export default async function openElementRequestTimeServer({ req }) {
  const url = new URL(req.url);
  if (url.pathname === '/cookies') {
    const headers = new Headers({ 'content-type': 'text/plain' });
    headers.append('set-cookie', 'sb-proj-auth-token.0=chunk-zero; Path=/; HttpOnly; SameSite=Lax');
    headers.append('set-cookie', 'sb-proj-auth-token.1=chunk-one; Path=/; HttpOnly; SameSite=Lax');
    return new Response('cookies', { status: 200, headers });
  }
  if (url.pathname === '/origin') return Response.json({ origin: url.origin });
  if (url.pathname === '/echo') return new Response(await req.text());
  return new Response('fallback ' + url.pathname);
}
`;

interface HttpResult {
  status: number;
  setCookie: string[];
  body: string;
}

function http(
  port: number,
  path: string,
  headers: Record<string, string> = {},
  options: { method?: string; body?: string } = {},
): Promise<HttpResult> {
  return new Promise((resolve, reject) => {
    const req = request({
      hostname: '127.0.0.1',
      port,
      path,
      method: options.method ?? 'GET',
      headers,
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () =>
        resolve({
          status: res.statusCode ?? 0,
          setCookie: res.headers['set-cookie'] ?? [],
          body: data,
        }));
    });
    req.on('error', reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

async function waitUp(port: number): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      await http(port, '/origin');
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  throw new Error(`server on :${port} did not come up`);
}

function freePort(): number {
  const probe = Deno.listen({ hostname: '127.0.0.1', port: 0 });
  const port = (probe.addr as Deno.NetAddr).port;
  probe.close();
  return port;
}

/** Build a temp dist/ (static index + server entry + generated serve.mjs). */
async function makeDist(): Promise<string> {
  const dir = await Deno.makeTempDir();
  const serverDir = join(dir, 'dist', 'server');
  await Deno.mkdir(serverDir, { recursive: true });
  await Deno.writeTextFile(join(dir, 'dist', 'index.html'), '<h1>bridge</h1>\n');
  await Deno.writeTextFile(join(serverDir, 'package.json'), '{"type":"module"}\n');
  await Deno.writeTextFile(join(serverDir, 'index.js'), SERVER_ENTRY);
  await Deno.writeTextFile(join(serverDir, 'serve.mjs'), renderStandaloneServerModule());
  return dir;
}

function boot(kind: 'start' | 'serve.mjs', dir: string, port: number, trustProxy: boolean) {
  const env: Record<string, string> = {
    OPEN_ELEMENT_PORT: String(port),
    OPEN_ELEMENT_HOST: '127.0.0.1',
  };
  if (trustProxy) env.OPEN_ELEMENT_TRUST_PROXY = '1';
  const args = kind === 'start'
    ? ['run', '-A', startCli]
    : ['run', '-A', join(dir, 'dist', 'server', 'serve.mjs')];
  return new Deno.Command(Deno.execPath(), {
    args,
    // cli/start.ts serves process.cwd()/dist; serve.mjs resolves its own dir.
    cwd: dir,
    env,
    stdout: 'null',
    stderr: 'null',
  }).spawn();
}

async function stop(server: Deno.ChildProcess | undefined): Promise<void> {
  try {
    server?.kill('SIGTERM');
  } catch {
    // The process may have already exited.
  }
  await server?.status.catch(() => undefined);
}

/** The identical vector set runs against both servers. */
async function runBridgeVectors(port: number, trustPort: number): Promise<void> {
  // 1. Multi Set-Cookie round-trip: BOTH chunked session cookies arrive.
  const cookies = await http(port, '/cookies');
  assertEquals(cookies.status, 200);
  assertEquals(cookies.setCookie.length, 2, 'both Set-Cookie headers must survive the bridge');
  assert(cookies.setCookie[0].startsWith('sb-proj-auth-token.0=chunk-zero'));
  assert(cookies.setCookie[1].startsWith('sb-proj-auth-token.1=chunk-one'));

  // 2. Host-derived URL: the handler (and the ADR-0122 §3 CSRF Origin
  //    compare) sees the Host origin, not the listen address.
  const hostOrigin = await http(port, '/origin', { host: 'app.example.com' });
  assertEquals(JSON.parse(hostOrigin.body).origin, 'http://app.example.com');

  // 3. Proxy headers ignored by default.
  const untrusted = await http(port, '/origin', {
    host: 'app.example.com',
    'x-forwarded-proto': 'https',
    'x-forwarded-host': 'evil.example',
  });
  assertEquals(JSON.parse(untrusted.body).origin, 'http://app.example.com');

  // 4. Hostile Host (userinfo) falls back to the listen address.
  const hostile = await http(port, '/origin', { host: 'a@evil.com' });
  assertEquals(JSON.parse(hostile.body).origin, `http://127.0.0.1:${port}`);

  // 5. POST body streams through the bridge.
  const echo = await http(port, '/echo', { 'content-type': 'text/plain' }, {
    method: 'POST',
    body: 'hello-body',
  });
  assertEquals(echo.body, 'hello-body');

  // 6. OPEN_ELEMENT_TRUST_PROXY=1: forwarded proto + host are honored.
  const trusted = await http(trustPort, '/origin', {
    host: 'internal:8080',
    'x-forwarded-proto': 'https',
    'x-forwarded-host': 'app.example.com',
  });
  assertEquals(JSON.parse(trusted.body).origin, 'https://app.example.com');
  const trustedHostOnly = await http(trustPort, '/origin', {
    host: 'app.example.com',
    'x-forwarded-proto': 'https',
  });
  assertEquals(JSON.parse(trustedHostOnly.body).origin, 'https://app.example.com');
  // ...and the multi-cookie channel works in trust mode too.
  const trustedCookies = await http(trustPort, '/cookies');
  assertEquals(trustedCookies.setCookie.length, 2);
}

for (const kind of ['start', 'serve.mjs'] as const) {
  Deno.test({
    name: `node bridge over HTTP (${kind}): cookies, Host URL, proxy opt-in`,
    sanitizeOps: false,
    sanitizeResources: false,
    fn: async () => {
      const dir = await makeDist();
      const port = freePort();
      const trustPort = freePort();
      let server: Deno.ChildProcess | undefined;
      let trustServer: Deno.ChildProcess | undefined;
      try {
        server = boot(kind, dir, port, false);
        trustServer = boot(kind, dir, trustPort, true);
        await waitUp(port);
        await waitUp(trustPort);
        await runBridgeVectors(port, trustPort);
      } finally {
        await stop(server);
        await stop(trustServer);
        await Deno.remove(dir, { recursive: true });
      }
    },
  });
}
