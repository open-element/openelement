/**
 * @openelement/router/cli/start - CLI: serve built output (start | preview)
 *
 * #601: one-command path after `build` so dynamic routes are reachable
 * without tribal Nitro wiring.
 * #622: cross-runtime — works in Node 18+, Deno, and Bun via node:http.
 * #859 (ADR-0123 item 4): `cli/start` and `cli/preview` merged into one
 * command with a mode flag; one entry, one doc.
 *
 * Modes:
 *   start (default)  — serve dist/ statically via node:http and, when
 *                      dist/server/index.js exists, dispatch dynamic routes
 *                      and mutations to it.
 *   preview          — static-only `vite preview`; refuses to run when
 *                      dist/server/index.js exists (real request-time routes,
 *                      #601) because `vite preview` is silently wrong for
 *                      dynamic routes. Pure-static builds produce no
 *                      dist/server at all (#953), so preview always runs
 *                      for them. Preview delegates to
 *                      `vite preview` spawned via `deno run -A npm:vite`, so
 *                      this mode requires the Deno runtime on PATH.
 *
 * Usage:
 *   node packages/router/src/cli/start.ts   (Node with --experimental-strip-types or tsx)
 *   deno run -A npm:@openelement/router/cli/start [--mode=start|preview] [-- vite preview args]
 *   OPEN_ELEMENT_PORT=4173 deno task start
 *
 * Env: OPEN_ELEMENT_PORT / PORT, OPEN_ELEMENT_HOST, and
 * OPEN_ELEMENT_TRUST_PROXY=1 to honour X-Forwarded-Proto/Host when a trusted
 * reverse proxy terminates TLS (internal/node-bridge.ts; forwarded headers
 * are never trusted by default).
 */

import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { basename, join } from 'node:path';
import process from 'node:process';
import { formatError } from '@openelement/element';
import { DEFAULT_OUT_DIR } from '../vite/internal/paths.ts';
import {
  createStartRequestHandler,
  importRequestTimeServer,
  type RequestTimeServerModule,
} from '../vite/internal/static-serve.ts';

const root = process.cwd();
const distDir = join(root, DEFAULT_OUT_DIR);
const serverEntry = join(distDir, 'server', 'index.js');
const hostname = process.env.OPEN_ELEMENT_HOST || '0.0.0.0';

type ServeMode = 'start' | 'preview';

/**
 * Splits `--mode=start|preview` (or `--mode start|preview`) off the CLI args;
 * the remaining args pass through to `vite preview` in preview mode.
 */
export function extractServeMode(argv: string[]): { mode: ServeMode; rest: string[] } {
  const rest: string[] = [];
  let mode: ServeMode = 'start';
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const inline = arg.match(/^--mode=(.+)$/);
    if (inline) {
      mode = parseMode(inline[1]);
    } else if (arg === '--mode') {
      const value = argv[++i];
      if (value === undefined) {
        throw new Error('[openElement start] --mode requires a value: start or preview.');
      }
      mode = parseMode(value);
    } else {
      rest.push(arg);
    }
  }
  return { mode, rest };
}

function parseMode(value: string): ServeMode {
  if (value === 'start' || value === 'preview') return value;
  throw new Error(`[openElement start] unknown --mode "${value}"; expected start or preview.`);
}

async function main(): Promise<void> {
  let parsed: { mode: ServeMode; rest: string[] };
  try {
    parsed = extractServeMode(process.argv.slice(2));
  } catch (error) {
    console.error(formatError(error));
    process.exit(1);
  }

  if (!existsSync(distDir)) {
    console.error(
      `[openElement ${parsed.mode}] ${DEFAULT_OUT_DIR}/ not found. Run \`deno task build\` first.`,
    );
    process.exit(1);
  }

  if (parsed.mode === 'preview') {
    await runPreview(parsed.rest);
    return;
  }
  await runStart();
}

async function runPreview(viteArgs: string[]): Promise<void> {
  if (existsSync(serverEntry)) {
    console.error(
      `[openElement preview] This project has request-time routes (${DEFAULT_OUT_DIR}/server).\n` +
        '  `vite preview` cannot serve dynamic loader/action routes.\n' +
        '  Use: deno task start\n' +
        '  (or: deno run -A npm:@openelement/router/cli/start)',
    );
    process.exit(1);
  }
  // Static-only: delegate to vite preview
  const { spawn } = await import('node:child_process');
  const child = spawn('deno', ['run', '-A', 'npm:vite', 'preview', ...viteArgs], {
    stdio: 'inherit',
    shell: false,
  });
  child.on('error', (err) => {
    console.error(
      `[openElement preview] Failed to launch vite preview (requires Deno on PATH): ${err.message}`,
    );
    process.exit(1);
  });
  child.on('exit', (code) => process.exit(code ?? 1));
}

async function runStart(): Promise<void> {
  // Same validation as the generated serve.mjs (ssg-helpers.ts): a malformed
  // OPEN_ELEMENT_PORT must fail with guidance, not ERR_SOCKET_BAD_PORT.
  const rawPort = process.env.OPEN_ELEMENT_PORT || process.env.PORT || '4173';
  const port = Number(rawPort);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    console.error(
      `[openElement start] Invalid port "${rawPort}": expected an integer between 1 and 65535 ` +
        '(OPEN_ELEMENT_PORT / PORT).',
    );
    process.exit(1);
  }

  let serverMod: RequestTimeServerModule | null = null;
  if (existsSync(serverEntry)) {
    serverMod = await importRequestTimeServer(serverEntry);
    if (typeof serverMod.default !== 'function') {
      console.error(
        '[openElement start] dist/server/index.js has no default export.',
      );
      process.exit(1);
    }
    console.log(
      '[openElement start] request-time server entry loaded (dynamic routes enabled)',
    );
  } else {
    console.log(
      '[openElement start] no dist/server — static-only preview',
    );
  }

  const trustProxy = process.env.OPEN_ELEMENT_TRUST_PROXY === '1';
  const server = createServer(createStartRequestHandler({
    distDir,
    serverMod,
    env: processEnv,
    host: hostname,
    port,
    trustProxy,
  }));

  server.listen(port, hostname, () => {
    console.log(
      `[openElement start] http://${hostname === '0.0.0.0' ? 'localhost' : hostname}:${port}`,
    );
  });
}

// ─── Cross-runtime HTTP helpers (#622) ─────────────────────────────
// The node:http ↔ Fetch bridge (URL construction from validated Host /
// opted-in X-Forwarded-*, multi Set-Cookie preservation) lives in
// internal/node-bridge.ts — single source, also embedded verbatim into the
// generated dist/server/serve.mjs (renderStandaloneServerModule).

// Loader `env` contract is Record<string, string>; process.env may carry
// undefined values, which are filtered out (never forwarded).
const processEnv: Record<string, string> = {};
for (const key of Object.keys(process.env)) {
  const value = process.env[key];
  if (value !== undefined) processEnv[key] = value;
}

// Cross-runtime entry detection (#622): Deno uses import.meta.main,
// Node/Bun execute the module directly when invoked as CLI — match the
// real entry filename instead of a substring heuristic.
const isMainModule = typeof (import.meta as { main?: boolean }).main === 'boolean'
  ? (import.meta as { main?: boolean }).main === true
  : ['start.ts', 'start.js', 'start.mjs', 'start.cjs'].includes(basename(process.argv[1] ?? ''));

if (isMainModule) {
  try {
    await main();
  } catch (error) {
    console.error(
      `Start failed: ${error instanceof Error ? error.stack ?? error.message : String(error)}`,
    );
    process.exit(1);
  }
}
