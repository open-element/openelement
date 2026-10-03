/**
 * @openelement/router/cli/start - CLI: serve built output (start | preview)
 *
 * Modes:
 *   start (default)  - serve dist/ via the node:http fetch server
 *                      (`internal/node-http.ts`) with the standard
 *                      fetch(Request): Response dispatch. When
 *                      dist/server/index.js exists, dynamic routes and
 *                      mutations dispatch to it.
 *                      (`pnpm start` in a generated project.)
 *   preview          - static-only `vite preview`; refuses to run when
 *                      dist/server/index.js exists because `vite preview`
 *                      cannot serve dynamic routes.
 *                      (`pnpm preview` in a generated project.)
 *
 * Node/Workers/Bun deploys are produced by the Nitro mount from the same
 * standard fetch entry; this CLI serves the local/preview surface only.
 */

import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import process from 'node:process';
import { dirname, join } from 'pathe';
import { serveFetch } from '../internal/node-http.ts';
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

async function main(): Promise<void> {
  let parsed: { mode: ServeMode; rest: string[]; debug: boolean };
  try {
    parsed = extractServeMode(process.argv.slice(2));
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
 * Nearest enclosing deno.json that declares a Deno workspace, walking up
 * from cwd. The preview subprocess (`deno run npm:vite preview`) must reuse
 * it as `--config`: Vite externalizes workspace bare imports
 * (`@openelement/*`) when bundling vite.config.ts and the Deno runtime
 * resolves them through the active config. A tasks-only fixture deno.json
 * (no workspace/imports) would leave them unresolvable and float the Vite
 * version. npm consumers have no workspace root, so resolution falls back
 * to their node_modules exactly as before.
 */
function findWorkspaceConfig(from: string): string | null {
  let dir = from;
  for (;;) {
    const candidate = join(dir, 'deno.json');
    if (existsSync(candidate)) {
      try {
        const parsed = JSON.parse(readFileSync(candidate, 'utf8')) as {
          workspace?: unknown;
        };
        if (Array.isArray(parsed.workspace)) return candidate;
      } catch {
        // Unreadable config: keep walking up.
      }
    }
    const parent = join(dir, '..');
    if (parent === dir) return null;
    dir = parent;
  }
}

/**
 * B5: the generated starter is a plain Node/pnpm project, so on a
 * Node host preview spawns the app's OWN vite install (a devDependency) —
 * no runtime registry hop and no host CLI in the consumer's path. The Deno
 * host keeps the `deno run npm:vite` form for in-workspace flows.
 */
function isDenoHost(): boolean {
  return Boolean((process.versions as Record<string, string | undefined>).deno);
}

/** The app-local vite JS entry, resolved through the app's own package.json. */
function nodeViteBin(root: string): string {
  const requireFromApp = createRequire(join(root, 'package.json'));
  return join(dirname(requireFromApp.resolve('vite/package.json')), 'bin', 'vite.js');
}

async function runPreview(viteArgs: string[]): Promise<void> {
  if (existsSync(serverEntry)) {
    console.error(
      `[openElement preview] This project has request-time routes (${DEFAULT_OUT_DIR}/server).\n` +
        '  `vite preview` cannot serve dynamic loader/action routes.\n' +
        '  Use: pnpm start\n' +
        '  (or: node node_modules/@openelement/router/src/cli/start.js)',
    );
    process.exit(1);
  }
  if (!isDenoHost()) {
    const code = await new Promise<number>((resolveCode, rejectSpawn) => {
      const child = spawn(process.execPath, [nodeViteBin(root), 'preview', ...viteArgs], {
        stdio: 'inherit',
      });
      child.on('error', rejectSpawn);
      child.on('close', (closedCode) => resolveCode(closedCode ?? 1));
    });
    process.exit(code);
  }
  const workspaceConfig = findWorkspaceConfig(root);
  const configArgs = workspaceConfig === null ? [] : ['--config', workspaceConfig];
  // Preview shells to the Vite native binding: scoped build-host permissions
  // with prompts off (least privilege — never -A).
  const code = await new Promise<number>((resolveCode, rejectSpawn) => {
    const child = spawn(
      'deno',
      [
        'run',
        ...configArgs,
        '--allow-read',
        '--allow-write',
        '--allow-env',
        '--allow-net',
        '--allow-run',
        '--allow-sys',
        '--allow-ffi',
        '--no-prompt',
        'npm:vite',
        'preview',
        ...viteArgs,
      ],
      { stdio: 'inherit' },
    );
    child.on('error', rejectSpawn);
    child.on('close', (closedCode) => resolveCode(closedCode ?? 1));
  });
  process.exit(code);
}

async function runStart(): Promise<void> {
  const rawPort = process.env['OPEN_ELEMENT_PORT'] ?? process.env['PORT'] ?? '4173';
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

  serveFetch({ hostname, port, handler });
  console.log(
    `[openElement start] http://${hostname === '0.0.0.0' ? 'localhost' : hostname}:${port}`,
  );
}

function processEnvRecord(): Record<string, string> {
  const record: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) record[key] = value;
  }
  return record;
}

const isMainModule = import.meta.main;

if (isMainModule) {
  try {
    await main();
  } catch (error) {
    // #1413: message (+ cause chain) by default, raw stack only under --debug.
    console.error(renderCliFailure(error, cliDebug));
    process.exit(1);
  }
}
