/**
 * @openelement/router/cli/start - CLI: serve built output (start | preview)
 *
 * Modes:
 *   start (default)  - serve dist/ via Deno.serve with the standard
 *                      fetch(Request): Response dispatch. When
 *                      dist/server/index.js exists, dynamic routes and
 *                      mutations dispatch to it.
 *                      (`deno task start` in a generated project.)
 *   preview          - static-only `vite preview`; refuses to run when
 *                      dist/server/index.js exists because `vite preview`
 *                      cannot serve dynamic routes.
 *                      (`deno task preview` in a generated project.)
 *
 * Node/Workers/Bun deploys are produced by the Nitro mount from the same
 * standard fetch entry; this CLI maintains no Node HTTP bridge.
 */

import { existsSync } from '../internal/host-path.ts';
import { join } from '../internal/host-path.ts';
import { formatError } from '@openelement/element';
import { DEFAULT_OUT_DIR } from '../vite/internal/paths.ts';
import { extractServeMode, type ServeMode } from '../internal/serve-mode.ts';
import {
  createFetchHandler,
  importRequestTimeServer,
  type RequestTimeServerModule,
} from '../vite/internal/static-serve.ts';

const root = Deno.cwd();
const distDir = join(root, DEFAULT_OUT_DIR);
const serverEntry = join(distDir, 'server', 'index.js');
const hostname = Deno.env.get('OPEN_ELEMENT_HOST') ?? '0.0.0.0';

async function main(): Promise<void> {
  let parsed: { mode: ServeMode; rest: string[] };
  try {
    parsed = extractServeMode(Deno.args);
  } catch (error) {
    console.error(formatError(error));
    Deno.exit(1);
  }

  if (!existsSync(distDir)) {
    console.error(
      `[openElement ${parsed.mode}] ${DEFAULT_OUT_DIR}/ not found. Run \`deno task build\` first.`,
    );
    Deno.exit(1);
  }

  if (parsed.mode === 'preview') {
    await runPreview(parsed.rest);
    return;
  }
  await runStart();
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
        const parsed = JSON.parse(Deno.readTextFileSync(candidate)) as {
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

async function runPreview(viteArgs: string[]): Promise<void> {
  if (existsSync(serverEntry)) {
    console.error(
      `[openElement preview] This project has request-time routes (${DEFAULT_OUT_DIR}/server).\n` +
        '  `vite preview` cannot serve dynamic loader/action routes.\n' +
        '  Use: deno task start\n' +
        '  (or: deno run --allow-read --allow-write --allow-env --allow-net --allow-run --allow-sys --allow-ffi --no-prompt npm:@openelement/router/cli/start)',
    );
    Deno.exit(1);
  }
  const workspaceConfig = findWorkspaceConfig(root);
  const configArgs = workspaceConfig === null ? [] : ['--config', workspaceConfig];
  // Preview shells to the Vite native binding: scoped build-host permissions
  // with prompts off (least privilege — never -A).
  const command = new Deno.Command('deno', {
    args: [
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
    stdin: 'inherit',
    stdout: 'inherit',
    stderr: 'inherit',
  });
  const { code } = await command.output();
  Deno.exit(code);
}

async function runStart(): Promise<void> {
  const rawPort = Deno.env.get('OPEN_ELEMENT_PORT') ?? Deno.env.get('PORT') ?? '4173';
  const port = Number(rawPort);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    console.error(
      `[openElement start] Invalid port "${rawPort}": expected an integer between 1 and 65535 ` +
        '(OPEN_ELEMENT_PORT / PORT).',
    );
    Deno.exit(1);
  }

  let serverMod: RequestTimeServerModule | null = null;
  if (existsSync(serverEntry)) {
    serverMod = await importRequestTimeServer(serverEntry);
    if (typeof serverMod.default !== 'function') {
      console.error(
        '[openElement start] dist/server/index.js has no default export.',
      );
      Deno.exit(1);
    }
    console.log(
      '[openElement start] request-time server entry loaded (dynamic routes enabled)',
    );
  } else {
    console.log(
      '[openElement start] no dist/server — static-only preview',
    );
  }

  const handler = createFetchHandler({
    distDir,
    serverMod,
    env: denoEnvRecord(),
  });

  Deno.serve({ hostname, port }, handler);
  console.log(
    `[openElement start] http://${hostname === '0.0.0.0' ? 'localhost' : hostname}:${port}`,
  );
}

function denoEnvRecord(): Record<string, string> {
  const record: Record<string, string> = {};
  for (const [key, value] of Object.entries(Deno.env.toObject())) {
    if (value !== undefined) record[key] = value;
  }
  return record;
}

const isMainModule = import.meta.main;

if (isMainModule) {
  try {
    await main();
  } catch (error) {
    console.error(
      `Start failed: ${error instanceof Error ? error.stack ?? error.message : String(error)}`,
    );
    Deno.exit(1);
  }
}
