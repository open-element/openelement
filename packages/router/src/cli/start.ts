/**
 * @openelement/router/cli/start - CLI: serve built output (start | preview)
 *
 * Modes:
 *   start (default)  - serve dist/ via the node:http fetch server
 *                      (`internal/node-http.ts`) with the standard
 *                      fetch(Request): Response dispatch. When
 *                      dist/server/index.js exists, dynamic routes and
 *                      mutations dispatch to it.
 *                      (`pnpm start` in a generated project — its script
 *                      runs `openelement start`.)
 *   preview          - static-only serving through the SAME dispatch: the
 *                      mode refuses dist/server/index.js up front (a build
 *                      with request-time routes is a `start` deployment),
 *                      so a preview boot is exactly `start` on a
 *                      pure-static deployment — one static contract across
 *                      both modes: pretty URLs resolve the real page, a
 *                      miss answers 404 + the build's 404.html, and
 *                      /404.html itself answers 404. Preview previously
 *                      delegated to `vite preview`, whose index.html
 *                      fallback answered 200 for every miss — two static
 *                      serving modes must not disagree, so preview now
 *                      rides `createFetchHandler`/`serveFetch` directly.
 *                      What preview KEEPS from the vite-preview flavor is
 *                      the local-preview ergonomics: `--port`/`--host`
 *                      flags, the 4173 default, next-port fallback probing
 *                      (unless `--strictPort`), and a loopback-only default
 *                      bind (`start` is the deployment server and binds
 *                      0.0.0.0; preview is local).
 *                      (`openelement start --mode=preview`; a generated
 *                      project ships no preview script.)
 *
 * Node/Workers/Bun deploys are produced by the Nitro mount from the same
 * standard fetch entry; this CLI serves the local/preview surface only.
 */

import { existsSync } from 'node:fs';
import process from 'node:process';
import { join } from 'pathe';
import type { Server } from 'node:http';
import { serveFetch, type FetchHandler } from '../internal/node-http.ts';
import { formatError } from '@openelement/element';
import { DEFAULT_OUT_DIR } from '../vite/internal/paths.ts';
import { extractServeMode, type ServeMode } from '../internal/serve-mode.ts';
import {
  createFetchHandler,
  importRequestTimeServer,
  type RequestTimeServerModule,
} from '../vite/internal/static-serve.ts';
import {
  detectAppConfigFile,
  importAppConfigModule,
  resolveAppConfig,
} from '../vite/app-config.ts';

const root = process.cwd();
const distDir = join(root, DEFAULT_OUT_DIR);
const serverEntry = join(distDir, 'server', 'index.js');
const hostname = process.env['OPEN_ELEMENT_HOST'] ?? '0.0.0.0';

/**
 * #1411: `cli/start` is the third reader of `openelement.config.ts`. It reads
 * the file through the host runtime (a plain dynamic import) and never through
 * Vite, so serving a built app needs no Vite config bundling. Nothing else in
 * this CLI consumes framework options: `dist/` already carries the built
 * document (head, shells, middleware) from the build-time resolution.
 */
async function loadProductionConfig(mode: ServeMode): Promise<void> {
  const configFile = detectAppConfigFile(root);
  if (configFile === null) return;
  try {
    const imported = await importAppConfigModule(configFile);
    const resolved = resolveAppConfig({ root, configFile, importedConfig: imported });
    // `start` is the deployment server, so an unconfigured CORS allowlist is a
    // production concern there. `preview` is local-only: same silence as dev.
    if (mode === 'start' && resolved.options.middleware?.corsOrigin === undefined) {
      console.warn(
        '[openElement start] middleware.corsOrigin is not configured: the built server only ' +
          'reflects localhost origins. Set it in openelement.config.ts before deploying.',
      );
    }
  } catch (error) {
    console.error(formatError(error));
    process.exit(1);
  }
}

async function main(argv: string[]): Promise<void> {
  let parsed: { mode: ServeMode; rest: string[]; debug: boolean };
  try {
    parsed = extractServeMode(argv);
  } catch (error) {
    console.error(renderCliFailure(error, false));
    process.exit(1);
  }
  cliDebug = parsed.debug;

  if (!existsSync(distDir)) {
    console.error(
      `[openElement ${parsed.mode}] ${DEFAULT_OUT_DIR}/ not found. Run \`pnpm build\` first.`,
    );
    process.exit(1);
  }

  await loadProductionConfig(parsed.mode);

  if (parsed.mode === 'preview') {
    await runPreview(parsed.rest);
    return;
  }
  await runStart();
}

/** `--debug` state for the process; set once by main() before any work runs. */
let cliDebug = false;

/**
 * How the CLI reports a fatal error (#1413).
 *
 * Default: one actionable line — `Error: <message>` walk of the cause chain
 * via the framework's own `formatError`, which already joins nested causes.
 * A raw stack is machine detail: it buries the message under framework
 * frames and is never what an author needs to fix a broken build or an
 * occupied port. `--debug` opts back into the full stack (plus `cause`), so
 * the information is one flag away rather than gone.
 */
function renderCliFailure(error: unknown, debug: boolean): string {
  const message = formatError(error);
  if (!debug) return `Start failed: ${message}`;
  const stack = error instanceof Error ? error.stack : undefined;
  return `Start failed: ${message}\n${stack ?? '(no stack captured)'}`;
}

/**
 * Preview serves the built static output through the same fetch dispatch the
 * start mode uses (the static-serve seam), with the vite-preview flavor of
 * local ergonomics: `--port`/`--host` flags, a 4173 default, and next-port
 * fallback probing when the requested port is busy (unless `--strictPort`).
 */

/** What preview parsed out of its pass-through arguments. */
interface PreviewListen {
  port: number;
  hostname: string;
  strictPort: boolean;
  /** Arguments preview does not understand; reported, never silently eaten. */
  ignored: string[];
}

/**
 * One actionable line per bind failure (#1413 style, no raw stack) — the same
 * shape the start mode's 'error' wiring answers with.
 */
function reportBindFailure(
  mode: ServeMode,
  error: NodeJS.ErrnoException,
  port: number,
  hostname: string,
): void {
  if (error?.code === 'EADDRINUSE') {
    console.error(
      `[openElement ${mode}] port ${port} on ${hostname} is already in use (EADDRINUSE) — ` +
        'stop the process using it or choose another port ' +
        (mode === 'preview' ? '(--port).' : '(OPEN_ELEMENT_PORT / PORT).'),
    );
  } else if (error?.code === 'EACCES') {
    console.error(
      `[openElement ${mode}] port ${port} on ${hostname} is not permitted for this user (EACCES) — ` +
        'choose another port ' +
        (mode === 'preview' ? '(--port).' : '(OPEN_ELEMENT_PORT / PORT).'),
    );
  } else {
    console.error(renderCliFailure(error, cliDebug));
  }
}

/** The listening log line: 0.0.0.0 prints as localhost, like `vite` does. */
function logListening(mode: ServeMode, hostname: string, port: number): void {
  console.log(
    `[openElement ${mode}] http://${hostname === '0.0.0.0' ? 'localhost' : hostname}:${port}`,
  );
}

function parsePortValue(raw: string, source: string, mode: ServeMode): number {
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    console.error(
      `[openElement ${mode}] Invalid port "${raw}" (from ${source}): expected an integer ` +
        'between 1 and 65535.',
    );
    process.exit(1);
  }
  return port;
}

/**
 * Parse preview's pass-through arguments. `--host` carries an optional value
 * (bare `--host` exposes the server on every interface, vite-preview
 * semantics); `--port` requires one. Everything unrecognized is collected and
 * reported — the old delegation forwarded it to `vite preview`, and a silent
 * drop would be a dishonest CLI surface.
 */
function parsePreviewFlags(rest: string[]): PreviewListen {
  let portRaw: string | undefined;
  let hostFlag: string | undefined;
  let hostBare = false;
  let strictPort = false;
  const ignored: string[] = [];
  for (let index = 0; index < rest.length; index++) {
    const arg = rest[index]!;
    if (arg === '--port') {
      const value = rest[index + 1];
      if (value === undefined) {
        console.error('[openElement preview] --port requires a value.');
        process.exit(1);
      }
      portRaw = value;
      index++;
    } else if (arg.startsWith('--port=')) {
      portRaw = arg.slice('--port='.length);
    } else if (arg === '--host' || arg.startsWith('--host=')) {
      if (arg.includes('=')) {
        hostFlag = arg.slice('--host='.length);
      } else {
        const value = rest[index + 1];
        if (value !== undefined && !value.startsWith('--')) {
          hostFlag = value;
          index++;
        } else {
          hostBare = true;
        }
      }
    } else if (arg === '--strictPort' || arg === '--strict-port') {
      strictPort = true;
    } else {
      ignored.push(arg);
    }
  }
  const rawPort = portRaw ?? process.env['OPEN_ELEMENT_PORT'] ?? process.env['PORT'] ?? '4173';
  const port = parsePortValue(
    rawPort,
    portRaw !== undefined ? '--port' : 'OPEN_ELEMENT_PORT / PORT',
    'preview',
  );
  const hostname =
    hostFlag ??
    (hostBare ? '0.0.0.0' : undefined) ??
    process.env['OPEN_ELEMENT_HOST'] ??
    'localhost';
  return { port, hostname, strictPort, ignored };
}

async function runPreview(rest: string[]): Promise<void> {
  if (existsSync(serverEntry)) {
    console.error(
      `[openElement preview] This project has request-time routes (${DEFAULT_OUT_DIR}/server).\n` +
        '  A static-only preview cannot serve dynamic loader/action routes.\n' +
        '  Use: pnpm start\n' +
        '  (or: openelement start)',
    );
    process.exit(1);
  }
  const listen = parsePreviewFlags(rest);
  if (listen.ignored.length > 0) {
    console.warn(
      `[openElement preview] ignoring unrecognized argument(s): ${listen.ignored.join(' ')} ` +
        '(preview serves dist/ itself; supported: --port, --host, --strictPort)',
    );
  }

  // One static contract with `start`: the same fetch handler over the same
  // dispatch, with no request-time module (the refusal above guarantees the
  // build shipped none), so pretty URLs, error-document misses, and the 404
  // status of /404.html all answer exactly as they do under `start`.
  const handler: FetchHandler = createFetchHandler({
    distDir,
    serverMod: null,
    env: processEnvRecord(),
  });

  // vite-preview parity: a busy port probes the next one upward until one
  // binds (strictPort turns the probe into the actionable failure instead).
  for (let port = listen.port; port <= 65535; port++) {
    const server = serveFetch({ hostname: listen.hostname, port, handler });
    const failure = await new Promise<NodeJS.ErrnoException | null>((resolve) => {
      server.once('listening', () => resolve(null));
      server.once('error', (error: NodeJS.ErrnoException) => resolve(error));
    });
    if (failure === null) {
      logListening('preview', listen.hostname, port);
      return;
    }
    // A server that never listened must be closed with a callback: the
    // callbackless form re-emits ERR_SERVER_NOT_RUNNING as an unhandled
    // 'error' event.
    server.close(() => {});
    if (failure.code !== 'EADDRINUSE' || listen.strictPort) {
      reportBindFailure('preview', failure, port, listen.hostname);
      process.exit(1);
    }
    console.log(`[openElement preview] Port ${port} is in use, trying another one...`);
  }
  console.error(
    `[openElement preview] no available port between ${listen.port} and 65535 on ` +
      `${listen.hostname}.`,
  );
  process.exit(1);
}

async function runStart(): Promise<void> {
  const rawPort = process.env['OPEN_ELEMENT_PORT'] ?? process.env['PORT'] ?? '4173';
  const port = parsePortValue(rawPort, 'OPEN_ELEMENT_PORT / PORT', 'start');

  let serverMod: RequestTimeServerModule | null = null;
  if (existsSync(serverEntry)) {
    serverMod = await importRequestTimeServer(serverEntry);
    if (typeof serverMod.default !== 'function') {
      console.error('[openElement start] dist/server/index.js has no default export.');
      process.exit(1);
    }
    console.log('[openElement start] request-time server entry loaded (dynamic routes enabled)');
  } else {
    console.log('[openElement start] no dist/server — static-only preview');
  }

  const handler = createFetchHandler({
    distDir,
    serverMod,
    env: processEnvRecord(),
  });

  const server: Server = serveFetch({ hostname, port, handler });
  // The bind outcome is asynchronous (serveFetch returns before listen
  // settles), so the success line waits for 'listening' and a failed bind
  // answers with one actionable line (#1413 style, no raw stack) instead of
  // the unhandled 'error' crash serveFetch's embedder default would raise.
  server.once('listening', () => logListening('start', hostname, port));
  server.on('error', (error: NodeJS.ErrnoException) => {
    reportBindFailure('start', error, port, hostname);
    process.exit(1);
  });
}

function processEnvRecord(): Record<string, string> {
  const record: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) record[key] = value;
  }
  return record;
}

/**
 * Run the serve CLI with the arguments that follow the command (the bin's
 * `start` subcommand passes them through verbatim, so `--mode=preview`
 * reaches the mode parser unchanged). Shared by the `openelement` bin
 * (cli.ts) and this module's own main block.
 */
export async function runServeCli(argv: string[]): Promise<void> {
  try {
    await main(argv);
  } catch (error) {
    // #1413: message (+ cause chain) by default, raw stack only under --debug.
    console.error(renderCliFailure(error, cliDebug));
    process.exit(1);
  }
}

if (import.meta.main) {
  await runServeCli(process.argv.slice(2));
}
