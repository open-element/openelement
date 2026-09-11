/**
 * @openelement/router — live-socket adversarial audit for the shared
 * node:http ↔ Fetch bridge (#1146 areas 1 and 6; ADR-0141 locks "request
 * abort, response cancellation, drain, listener cleanup, keep-alive reuse
 * and repeated-run resource behavior").
 *
 * Real servers (cli/start.ts and the generated dist/server/serve.mjs) are
 * booted on loopback against a request-time entry that records abort/cancel/
 * production counters in-band and exposes them via /stats, so server-side
 * bridge behavior is asserted from the outside:
 *  - 1c: one keep-alive socket carries N sequential requests; server FD
 *    count and stderr (MaxListenersExceededWarning) pin per-request listener
 *    cleanup on the shared socket;
 *  - 1d: real client abort mid-upload, real disconnect mid-response, real
 *    slow-reader backpressure (server must pause production), and a client
 *    that disconnects while the handler is still working;
 *  - 6a: 5x100 live aborted uploads — abort propagation counted, server and
 *    client FD stability via lsof, stderr stays clean;
 *  - 6b: 3x500 requests over one keep-alive socket against a server booted
 *    with --v8-flags=--expose-gc — post-GC heapUsed must converge:
 *    batch-over-batch delta <= 1 MiB and total drift <= 1.5 MiB (threshold
 *    pre-registered here; ~2 KiB/request of retained garbage would breach).
 */

import { assert, assertEquals } from '@std/assert';
import { join } from '@std/path';
import { renderStandaloneServerModule } from '../src/vite/internal/ssg/ssg-helpers.ts';

const startCli = join(import.meta.dirname!, '../src/cli/start.ts');
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const MIB = 1024 * 1024;

/**
 * Request-time entry with in-band audit counters. GETs fall through the
 * static miss to the server; POSTs dispatch directly — same shape as the
 * parity entry in node-bridge-http.test.ts.
 */
const SERVER_ENTRY = `const stats = {
  requests: 0,
  abortedUploads: 0,
  slowProduced: 0,
  slowCancelled: 0,
  bigProduced: 0,
  bigCancelled: 0,
  slowHandlerDone: 0,
  slowHandlerCancelled: 0,
  slowHandlerPulls: 0,
};
function heapUsed() {
  try {
    return typeof Deno !== 'undefined' ? Deno.memoryUsage().heapUsed : -1;
  } catch {
    return -1;
  }
}
export function isRequestTimePath() { return false; }
export default async function openElementRequestTimeServer({ req }) {
  const url = new URL(req.url);
  stats.requests++;
  if (url.pathname === '/stats') {
    if (typeof gc === 'function') gc();
    return Response.json({ ...stats, heapUsed: heapUsed() });
  }
  if (url.pathname === '/ok') return new Response('ok');
  if (url.pathname === '/upload') {
    try {
      await req.text();
      return new Response('uploaded');
    } catch {
      stats.abortedUploads++;
      return new Response('aborted mid-upload', { status: 499 });
    }
  }
  if (url.pathname === '/slow-stream') {
    const stream = new ReadableStream({
      async pull(controller) {
        await new Promise((r) => setTimeout(r, 15));
        stats.slowProduced++;
        controller.enqueue(new TextEncoder().encode('chunk-' + stats.slowProduced + '\\n'));
        if (stats.slowProduced >= 200) controller.close();
      },
      cancel() { stats.slowCancelled++; },
    });
    return new Response(stream);
  }
  if (url.pathname === '/big') {
    const stream = new ReadableStream({
      pull(controller) {
        stats.bigProduced++;
        controller.enqueue(new Uint8Array(1024).fill(stats.bigProduced % 251));
        if (stats.bigProduced >= 8192) controller.close();
      },
      cancel() { stats.bigCancelled++; },
    });
    return new Response(stream);
  }
  if (url.pathname === '/slow-handler') {
    await new Promise((r) => setTimeout(r, 400));
    stats.slowHandlerDone++;
    // Two chunks: a pump that completed 'normally' into the dead socket
    // pulls twice; a pump parked in waitForDrain pulls once; a correctly
    // cancelled stream stops at one and fires cancel().
    const stream = new ReadableStream({
      pull(controller) {
        stats.slowHandlerPulls++;
        controller.enqueue(new TextEncoder().encode('late-' + stats.slowHandlerPulls));
        if (stats.slowHandlerPulls >= 2) controller.close();
      },
      cancel() { stats.slowHandlerCancelled++; },
    });
    return new Response(stream);
  }
  return new Response('fallback ' + url.pathname);
}
`;

// ── loopback process helpers ─────────────────────────────────────────

function freePort(): number {
  const probe = Deno.listen({ hostname: '127.0.0.1', port: 0 });
  const port = (probe.addr as Deno.NetAddr).port;
  probe.close();
  return port;
}

async function makeDist(): Promise<string> {
  const dir = await Deno.makeTempDir();
  const serverDir = join(dir, 'dist', 'server');
  await Deno.mkdir(serverDir, { recursive: true });
  await Deno.writeTextFile(join(dir, 'dist', 'index.html'), '<h1>audit</h1>\n');
  await Deno.writeTextFile(join(serverDir, 'package.json'), '{"type":"module"}\n');
  await Deno.writeTextFile(join(serverDir, 'index.js'), SERVER_ENTRY);
  await Deno.writeTextFile(join(serverDir, 'serve.mjs'), renderStandaloneServerModule());
  return dir;
}

function boot(
  kind: 'start' | 'serve.mjs',
  dir: string,
  port: number,
  options: { exposeGc?: boolean },
  stderrSink: string[],
): Deno.ChildProcess {
  const args = ['run'];
  if (options.exposeGc) args.push('--v8-flags=--expose-gc');
  args.push('-A', kind === 'start' ? startCli : join(dir, 'dist', 'server', 'serve.mjs'));
  const server = new Deno.Command(Deno.execPath(), {
    args,
    cwd: dir,
    env: { OPEN_ELEMENT_PORT: String(port), OPEN_ELEMENT_HOST: '127.0.0.1' },
    stdout: 'null',
    stderr: 'piped',
  }).spawn();
  // Drain stderr continuously so a noisy server can never block on a full
  // pipe, and so leak/crash evidence survives the assertions below.
  const reader = server.stderr.getReader();
  (async () => {
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        stderrSink.push(decoder.decode(value, { stream: true }));
      }
    } catch {
      // The process was killed mid-read; the sink keeps what it has.
    }
  })();
  return server;
}

async function stop(server: Deno.ChildProcess | undefined): Promise<void> {
  try {
    server?.kill('SIGTERM');
  } catch {
    // The process may have already exited.
  }
  await server?.status.catch(() => undefined);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Evidence goes to the real stderr so it survives test-output capture. */
function evidence(line: string): void {
  Deno.stderr.writeSync(encoder.encode(`[audit-evidence] ${line}\n`));
}

/** Open-FD count via lsof (macOS has no /proc; Deno 2 removed Deno.resources()). */
async function fdCount(pid: number): Promise<number | null> {
  try {
    const output = await new Deno.Command('/usr/sbin/lsof', {
      args: ['-nP', '-p', String(pid)],
      stdout: 'piped',
      stderr: 'null',
    }).output();
    if (!output.success) return null;
    const lines = decoder.decode(output.stdout).trim().split('\n');
    return Math.max(0, lines.length - 1); // header row
  } catch {
    return null;
  }
}

function assertFdStable(
  before: number | null,
  after: number | null,
  slack: number,
  what: string,
): void {
  evidence(`${what}: open FDs ${before} -> ${after} (slack ${slack})`);
  if (before === null || after === null) return; // lsof unavailable — recorded INCONCLUSIVE in the audit report
  assert(
    Math.abs(after - before) <= slack,
    `${what}: open FDs drifted ${before} -> ${after} (allowed +/-${slack})`,
  );
}

function assertStderrClean(sink: string[], what: string): void {
  const text = sink.join('');
  const bad = /Unhandled|uncaught|ERR_STREAM|MaxListenersExceeded/i;
  assertEquals(
    bad.test(text),
    false,
    `${what}: server stderr must stay free of unhandled rejections, stream errors and listener-leak warnings; got:\n${
      text.slice(0, 3000)
    }`,
  );
}

// ── minimal raw HTTP/1.1 client over Deno.connect (full socket control) ──

interface RawResponse {
  status: number;
  headers: Record<string, string>;
  body: Uint8Array;
}

function findCrlf(buf: Uint8Array): number {
  for (let i = 0; i + 1 < buf.length; i++) {
    if (buf[i] === 13 && buf[i + 1] === 10) return i;
  }
  return -1;
}

function withDeadline<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timeout waiting for ${what}`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

class RawConn {
  private conn: Deno.Conn;
  private buf = new Uint8Array(0);
  eof = false;

  private constructor(conn: Deno.Conn) {
    this.conn = conn;
  }

  static async connect(port: number): Promise<RawConn> {
    return new RawConn(await Deno.connect({ hostname: '127.0.0.1', port }));
  }

  close(): void {
    try {
      this.conn.close();
    } catch {
      // Already closed.
    }
  }

  /** Pull more bytes off the socket into the parse buffer; false at EOF. */
  private async pump(): Promise<boolean> {
    const chunk = new Uint8Array(16384);
    const n = await withDeadline(this.conn.read(chunk), 20000, 'socket read');
    if (n === null) {
      this.eof = true;
      return false;
    }
    const merged = new Uint8Array(this.buf.length + n);
    merged.set(this.buf);
    merged.set(chunk.subarray(0, n), this.buf.length);
    this.buf = merged;
    return true;
  }

  private take(n: number): Uint8Array {
    const out = this.buf.slice(0, n);
    this.buf = this.buf.slice(n);
    return out;
  }

  private async readLine(): Promise<string> {
    for (;;) {
      const at = findCrlf(this.buf);
      if (at >= 0) {
        const line = decoder.decode(this.take(at));
        this.take(2);
        return line;
      }
      if (!(await this.pump())) throw new Error('EOF while reading a response line');
    }
  }

  async writeRequest(options: {
    method?: string;
    path: string;
    headers?: Record<string, string>;
    body?: Uint8Array;
  }): Promise<void> {
    let head = `${options.method ?? 'GET'} ${options.path} HTTP/1.1\r\nhost: 127.0.0.1\r\n`;
    for (const [key, value] of Object.entries(options.headers ?? {})) {
      head += `${key}: ${value}\r\n`;
    }
    head += '\r\n';
    const headBytes = encoder.encode(head);
    const payload = options.body
      ? (() => {
        const all = new Uint8Array(headBytes.length + options.body!.length);
        all.set(headBytes);
        all.set(options.body!, headBytes.length);
        return all;
      })()
      : headBytes;
    let offset = 0;
    while (offset < payload.length) {
      offset += await withDeadline(
        this.conn.write(payload.subarray(offset)),
        10000,
        'socket write',
      );
    }
  }

  /**
   * Read one full response (chunked or content-length or read-to-EOF).
   * `onBody` runs after each body chunk; while it is pending NOTHING is
   * read from the socket, so a slow hook creates real TCP backpressure.
   */
  async readResponse(onBody?: (bodyBytes: number) => void | Promise<void>): Promise<RawResponse> {
    const statusLine = await this.readLine();
    const status = Number(statusLine.split(/\s+/)[1]);
    const headers: Record<string, string> = {};
    for (;;) {
      const line = await this.readLine();
      if (line === '') break;
      const at = line.indexOf(':');
      headers[line.slice(0, at).trim().toLowerCase()] = line.slice(at + 1).trim();
    }
    const parts: Uint8Array[] = [];
    let bodyBytes = 0;
    if ((headers['transfer-encoding'] ?? '').includes('chunked')) {
      for (;;) {
        const size = parseInt(await this.readLine(), 16);
        if (size === 0) {
          await this.readLine(); // final CRLF
          break;
        }
        while (this.buf.length < size + 2) {
          if (!(await this.pump())) throw new Error('EOF inside a chunked body');
        }
        parts.push(this.take(size));
        this.take(2); // chunk CRLF
        bodyBytes += size;
        await onBody?.(bodyBytes);
      }
    } else if (headers['content-length'] !== undefined) {
      const total = Number(headers['content-length']);
      while (bodyBytes < total) {
        if (this.buf.length === 0 && !(await this.pump())) {
          throw new Error('EOF inside a fixed body');
        }
        const piece = this.take(Math.min(this.buf.length, total - bodyBytes));
        parts.push(piece);
        bodyBytes += piece.length;
        await onBody?.(bodyBytes);
      }
    } else {
      while (await this.pump()) {
        if (this.buf.length === 0) continue;
        const piece = this.take(this.buf.length);
        parts.push(piece);
        bodyBytes += piece.length;
        await onBody?.(bodyBytes);
      }
    }
    const body = new Uint8Array(bodyBytes);
    let at = 0;
    for (const part of parts) {
      body.set(part, at);
      at += part.length;
    }
    return { status, headers, body };
  }
}

async function rawGet(port: number, path: string): Promise<RawResponse> {
  const conn = await RawConn.connect(port);
  try {
    await conn.writeRequest({ path, headers: { connection: 'close' } });
    return await conn.readResponse();
  } finally {
    conn.close();
  }
}

interface Stats {
  requests: number;
  abortedUploads: number;
  slowProduced: number;
  slowCancelled: number;
  bigProduced: number;
  bigCancelled: number;
  slowHandlerDone: number;
  slowHandlerCancelled: number;
  slowHandlerPulls: number;
  heapUsed: number;
}

async function stats(port: number): Promise<Stats> {
  const res = await rawGet(port, '/stats');
  assertEquals(res.status, 200, '/stats must stay reachable');
  return JSON.parse(decoder.decode(res.body)) as Stats;
}

async function waitForStat(
  port: number,
  predicate: (s: Stats) => boolean,
  timeoutMs: number,
  what: string,
): Promise<Stats> {
  const deadline = Date.now() + timeoutMs;
  let last: Stats | undefined;
  while (Date.now() < deadline) {
    last = await stats(port);
    if (predicate(last)) return last;
    await sleep(50);
  }
  throw new Error(
    `${what}: condition not met within ${timeoutMs}ms; last stats: ${JSON.stringify(last)}`,
  );
}

async function waitUp(port: number): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      await rawGet(port, '/ok');
      return;
    } catch {
      await sleep(100);
    }
  }
  throw new Error(`server on :${port} did not come up`);
}

/** Abort a POST /upload after 64 bytes of a declared 1 MiB body. */
async function abortedUpload(port: number): Promise<void> {
  const conn = await RawConn.connect(port);
  await conn.writeRequest({
    method: 'POST',
    path: '/upload',
    headers: { 'content-length': String(MIB), 'content-type': 'application/octet-stream' },
    body: new Uint8Array(64),
  });
  conn.close();
}

// ── 1d parity vectors: real disconnects against BOTH production servers ──

async function runDisconnectVectors(
  port: number,
  kind: string,
  stderrSink: string[],
): Promise<void> {
  // (i) real client abort mid-upload: the bridge must propagate the socket
  // close into the Fetch request so the handler's await req.text() rejects.
  const beforeUpload = await stats(port);
  await abortedUpload(port);
  const afterUpload = await waitForStat(
    port,
    (s) => s.abortedUploads === beforeUpload.abortedUploads + 1,
    5000,
    `${kind}: abort propagation into the request handler`,
  );
  evidence(
    `${kind} 1d-i: abortedUploads ${beforeUpload.abortedUploads} -> ${afterUpload.abortedUploads}`,
  );

  // (ii) real response disconnect mid-body: the client walks away from a
  // slow 200-chunk stream; the bridge must cancel the web stream and the
  // server must STOP producing (no unbounded pumping into a dead socket).
  const beforeSlow = await stats(port);
  const slow = await RawConn.connect(port);
  await slow.writeRequest({ path: '/slow-stream' });
  let sawChunk = false;
  await slow.readResponse((bodyBytes) => {
    if (bodyBytes > 0 && !sawChunk) {
      sawChunk = true;
      slow.close(); // client goes away mid-body
    }
  }).catch(() => {
    // Our own close aborts the local parse; the server side is what matters.
  });
  assert(sawChunk, `${kind}: must have received at least one chunk before disconnecting`);
  const cancelled = await waitForStat(
    port,
    (s) => s.slowCancelled === beforeSlow.slowCancelled + 1,
    5000,
    `${kind}: response-stream cancel after client disconnect`,
  );
  await sleep(400); // at 15ms/chunk a live pump would add ~26 more chunks
  const halted = await stats(port);
  assert(
    halted.slowProduced - cancelled.slowProduced <= 2,
    `${kind}: only the in-flight pull may complete after cancel (was ${cancelled.slowProduced}, became ${halted.slowProduced})`,
  );
  assert(
    halted.slowProduced < beforeSlow.slowProduced + 20,
    `${kind}: produced ${
      halted.slowProduced - beforeSlow.slowProduced
    } chunks for a dead client (of 200) — unbounded pumping`,
  );
  evidence(
    `${kind} 1d-ii: slowProduced ${beforeSlow.slowProduced} -> ${cancelled.slowProduced} (halted), slowCancelled ${halted.slowCancelled}`,
  );

  // (iii) client disconnects while the handler is still working: the
  // response 'close' fires BEFORE writeWebResponse attaches its listeners,
  // the late response body must still be cancelled, and the server must
  // survive without unhandled rejections. Health and stderr are checked
  // even when the cancel expectation fails, so one run carries full
  // evidence.
  const beforeHandler = await stats(port);
  const early = await RawConn.connect(port);
  await early.writeRequest({ path: '/slow-handler' });
  await sleep(50);
  early.close();
  await waitForStat(
    port,
    (s) => s.slowHandlerDone === beforeHandler.slowHandlerDone + 1,
    5000,
    `${kind}: slow handler completion after client disconnect`,
  );
  let cancelObserved = true;
  try {
    await waitForStat(
      port,
      (s) => s.slowHandlerCancelled === beforeHandler.slowHandlerCancelled + 1,
      5000,
      `${kind}: body cancel when 'close' precedes writeWebResponse`,
    );
  } catch {
    cancelObserved = false;
  }
  const afterHandler = await stats(port);
  // Mechanism readout: pulls=1 means the pump parked in waitForDrain on the
  // dead socket; pulls=2 means it pumped both chunks into the void; in both
  // cases cancelled=0 means the web body stream was never released.
  evidence(
    `${kind} 1d-iii: slowHandlerDone=${afterHandler.slowHandlerDone} slowHandlerPulls=${afterHandler.slowHandlerPulls} slowHandlerCancelled=${afterHandler.slowHandlerCancelled}`,
  );

  const health = await rawGet(port, '/ok');
  assertEquals(health.status, 200, `${kind}: server must stay healthy after disconnect vectors`);
  assertStderrClean(stderrSink, `${kind} disconnect vectors`);
  assert(
    cancelObserved,
    `${kind}: the late response body was never cancelled — 'close' fired before writeWebResponse subscribed (pulls=${afterHandler.slowHandlerPulls}, cancelled=${afterHandler.slowHandlerCancelled})`,
  );
}

for (const kind of ['start', 'serve.mjs'] as const) {
  Deno.test({
    name:
      `1d: live disconnect vectors (${kind}) — upload abort, mid-body disconnect, disconnect during handler`,
    sanitizeOps: false,
    sanitizeResources: false,
    fn: async () => {
      const dir = await makeDist();
      const port = freePort();
      const stderrSink: string[] = [];
      let server: Deno.ChildProcess | undefined;
      try {
        server = boot(kind, dir, port, {}, stderrSink);
        await waitUp(port);
        await runDisconnectVectors(port, kind, stderrSink);
      } finally {
        await stop(server);
        await Deno.remove(dir, { recursive: true });
      }
    },
  });
}

// ── 1c: keep-alive socket reuse (live, start.ts) ─────────────────────

Deno.test({
  name: '1c: one keep-alive socket carries 50 sequential requests; no FD or listener growth',
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const dir = await makeDist();
    const port = freePort();
    const stderrSink: string[] = [];
    let server: Deno.ChildProcess | undefined;
    try {
      server = boot('start', dir, port, {}, stderrSink);
      await waitUp(port);
      await sleep(500); // let waitUp probes fully close before the FD baseline
      const fdBase = await fdCount(server.pid);

      const conn = await RawConn.connect(port);
      for (let i = 0; i < 50; i++) {
        await conn.writeRequest({ path: '/ok' });
        const res = await conn.readResponse();
        assertEquals(res.status, 200, `request ${i} on the shared socket`);
        assertEquals(decoder.decode(res.body), 'ok');
      }
      assertEquals(conn.eof, false, 'the server must keep the keep-alive socket open');
      conn.close();
      await sleep(500);

      assertFdStable(fdBase, await fdCount(server.pid), 1, '1c server');
      // 50 sequential requests on ONE socket: a leaked per-request socket
      // 'close' listener would cross MaxListeners(10) and warn on stderr.
      assertStderrClean(stderrSink, '1c keep-alive');
    } finally {
      await stop(server);
      await Deno.remove(dir, { recursive: true });
    }
  },
});

// ── 1d-iii: real slow-reader backpressure (live, start.ts) ───────────

Deno.test({
  name: '1d: slow reader + 8 MiB response — server pauses production and delivers intact',
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const dir = await makeDist();
    const port = freePort();
    const stderrSink: string[] = [];
    let server: Deno.ChildProcess | undefined;
    try {
      server = boot('start', dir, port, {}, stderrSink);
      await waitUp(port);

      const conn = await RawConn.connect(port);
      await conn.writeRequest({ path: '/big' });
      const checkpoint = { ran: false, produced: -1, producedAfterStall: -1 };
      const res = await conn.readResponse(async (bodyBytes) => {
        if (bodyBytes < 65536) {
          await sleep(3); // slow reader: ~64 chunks over ~200ms
        } else if (!checkpoint.ran) {
          // Client stalled: nothing is read from the socket while this hook
          // pends, so kernel buffers fill; res.write() must have returned
          // false and the pump must be parked in waitForDrain. Production may
          // still legitimately continue into remaining kernel buffer capacity
          // right at the stall point (platform-dependent: ~830 chunks on macOS
          // loopback, ~2560 on Linux CI), so an absolute snapshot bound is not
          // portable. Instead poll /stats until two consecutive reads agree —
          // quiescence is the platform-robust signal that the pump has parked.
          checkpoint.ran = true;
          const deadline = Date.now() + 10_000;
          let previous = -1;
          for (;;) {
            checkpoint.produced = (await stats(port)).bigProduced;
            if (checkpoint.produced === previous) break; // quiesced: pump parked
            previous = checkpoint.produced;
            if (Date.now() > deadline) break; // the assertions below report the failure
            await sleep(50);
          }
          await sleep(300); // keep stalling — a live pump would add ~300 chunks
          checkpoint.producedAfterStall = (await stats(port)).bigProduced;
        }
      });
      conn.close();

      assertEquals(res.status, 200);
      assertEquals(res.body.length, 8192 * 1024, 'the full 8 MiB body must arrive intact');
      for (let block = 0; block < 8192; block += 512) {
        assertEquals(
          res.body[block * 1024],
          (block + 1) % 251,
          `block ${block} content must match the generator pattern`,
        );
      }
      assert(checkpoint.ran, 'the backpressure checkpoint must have run');
      // Equilibrium proof: while the client is stalled, production must HALT
      // (pump parked in waitForDrain) — not merely slow down.
      assertEquals(
        checkpoint.producedAfterStall,
        checkpoint.produced,
        `production continued while the client was stalled (${checkpoint.produced} -> ${checkpoint.producedAfterStall}) — drain backpressure is not pausing the pump`,
      );
      // Bounded proof: with the client at 64 consumed chunks a non-draining
      // pump would have pulled all 8192 chunks into user space; a draining
      // pump stops at transport buffer capacity. The ceiling is platform-
      // dependent (~830 chunks on macOS loopback, ~2560 on Linux CI with the
      // default 4 MiB tcp_wmem ceiling), so the bound sits at 75% of the body:
      // above every observed platform ceiling, far below the 8192 a
      // non-draining pump reaches.
      assert(
        checkpoint.produced < 6144,
        `server produced ${checkpoint.produced} chunks (of 8192) for a client stalled at 64 KiB — the response is being buffered, not drained`,
      );
      evidence(
        `1d-drain: bigProduced quiesced at ${checkpoint.produced} with 64 KiB consumed and halted (still ${checkpoint.producedAfterStall} after a further 300ms stall); total ${
          (await stats(port)).bigProduced
        }`,
      );
      assertStderrClean(stderrSink, '1d backpressure');
    } finally {
      await stop(server);
      await Deno.remove(dir, { recursive: true });
    }
  },
});

// ── 6a (live): 5x100 aborted uploads — propagation, FDs, clean stderr ──

Deno.test({
  name: '6a: 5x100 live aborted uploads — every abort propagates, FDs stable, stderr clean',
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const dir = await makeDist();
    const port = freePort();
    const stderrSink: string[] = [];
    let server: Deno.ChildProcess | undefined;
    try {
      server = boot('start', dir, port, {}, stderrSink);
      await waitUp(port);
      await sleep(500);
      const fdBaseServer = await fdCount(server.pid);
      const fdBaseClient = await fdCount(Deno.pid);
      const base = (await stats(port)).abortedUploads;

      for (let iteration = 0; iteration < 5; iteration++) {
        for (let batch = 0; batch < 5; batch++) {
          await Promise.all(Array.from({ length: 20 }, () => abortedUpload(port)));
        }
        await waitForStat(
          port,
          (s) => s.abortedUploads >= base + (iteration + 1) * 100,
          10000,
          `6a iteration ${iteration}: abort propagation`,
        );
      }
      const finalStats = await stats(port);
      assertEquals(
        finalStats.abortedUploads,
        base + 500,
        'every one of the 500 aborted uploads must reach the handler as an abort',
      );
      evidence(`6a: abortedUploads ${base} -> ${finalStats.abortedUploads} over 5x100 cycles`);

      await sleep(500);
      assertFdStable(fdBaseServer, await fdCount(server.pid), 2, '6a server');
      assertFdStable(fdBaseClient, await fdCount(Deno.pid), 2, '6a client');

      const health = await rawGet(port, '/ok');
      assertEquals(health.status, 200, 'server must stay healthy after 500 aborted uploads');
      assertStderrClean(stderrSink, '6a abort cycles');
    } finally {
      await stop(server);
      await Deno.remove(dir, { recursive: true });
    }
  },
});

// ── 6b: 3x500 complete cycles on one keep-alive socket; heap converges ──

Deno.test({
  name: '6b: 3x500 keep-alive cycles — post-GC heap converges, FDs stable',
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const dir = await makeDist();
    const port = freePort();
    const stderrSink: string[] = [];
    let server: Deno.ChildProcess | undefined;
    try {
      server = boot('start', dir, port, { exposeGc: true }, stderrSink);
      await waitUp(port);
      await sleep(500);
      const fdBaseServer = await fdCount(server.pid);

      const heap: number[] = [];
      const conn = await RawConn.connect(port);
      for (let batch = 0; batch < 3; batch++) {
        for (let i = 0; i < 500; i++) {
          await conn.writeRequest({ path: '/ok' });
          const res = await conn.readResponse();
          assertEquals(res.status, 200, `batch ${batch} request ${i}`);
          assertEquals(decoder.decode(res.body), 'ok');
        }
        // /stats runs gc() before measuring (server booted with --expose-gc).
        heap.push((await stats(port)).heapUsed);
      }
      assertEquals(conn.eof, false, 'one socket must carry all 1500 requests');
      conn.close();
      await sleep(500);

      evidence(
        `6b: post-GC heapUsed per 500-request batch: ${
          heap.map((h) => (h / MIB).toFixed(2) + ' MiB').join(' -> ')
        }`,
      );
      // Pre-registered convergence threshold: after the batch-1 warmup the
      // post-GC heap must stay flat — batch-over-batch delta <= 1 MiB and
      // total drift <= 1.5 MiB (~2 KiB/request retained would breach it).
      assert(
        heap[1] - heap[0] <= MIB,
        `batch 2 heap grew ${((heap[1] - heap[0]) / MIB).toFixed(2)} MiB (allowed 1 MiB)`,
      );
      assert(
        heap[2] - heap[1] <= MIB,
        `batch 3 heap grew ${((heap[2] - heap[1]) / MIB).toFixed(2)} MiB (allowed 1 MiB)`,
      );
      assert(
        heap[2] - heap[0] <= 1.5 * MIB,
        `post-warmup heap drift ${((heap[2] - heap[0]) / MIB).toFixed(2)} MiB (allowed 1.5 MiB)`,
      );

      assertFdStable(fdBaseServer, await fdCount(server.pid), 1, '6b server');
      assertStderrClean(stderrSink, '6b repetition');
    } finally {
      await stop(server);
      await Deno.remove(dir, { recursive: true });
    }
  },
});
