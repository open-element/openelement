/**
 * @openelement/router — style-only client build (alpha15 S lane, S-C2/S-12).
 *
 * An app whose components are ALL server-rendered — no islands, no
 * `data-open-enhance` forms, no Tailwind — still owns authored `.css` sheets,
 * and the SSR build declares every URL-addressable sheet as a resource. Phase 2
 * (the client build) is the protocol's ONE emission owner, so it must run for
 * such an app even though nothing is delivered to the browser:
 *
 *   - the sheet is emitted as a content-addressed asset and declared by a
 *     marked `<link>` in the prerendered page (never inlined);
 *   - NO client JavaScript ships: the generated entry is the island-free
 *     placeholder, the build's JS half is dropped, and the pinned
 *     zero-client-JS shape (dist/client absent) stays exactly as it is for an
 *     app that owns no sheet at all (`static-only-build.test.ts`).
 *
 * RED before the fix: the orchestrator skipped Phase 2 entirely for this app
 * shape, so Phase 3 failed closed on every sheet with
 * `OE_CLIENT_BUILD_STYLE_ASSET_UNREGISTERED` (reproduced on the packed
 * non-root-base fixture; the fix adds the server-rendered-pages term to the
 * Phase 2 gate and the style-only emission path in buildClient).
 */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, expect, test } from 'vitest';

const REPO_ROOT = join(import.meta.dirname!, '..', '..', '..');
const ROUTER_BUILD_CLI = join(REPO_ROOT, 'packages', 'router', 'src', 'cli', 'build.ts');

const fixtureRoots: string[] = [];
let appDir: string;
let buildLogs = '';

async function write(joinedPath: string, content: string): Promise<void> {
  await mkdir(joinedPath.slice(0, joinedPath.lastIndexOf('/')), { recursive: true });
  await writeFile(joinedPath, content, 'utf8');
}

/** The server-only app: one light-root page component with its own sheet. */
async function buildServerOnlyFixture(): Promise<string> {
  const created = await mkdtemp(join(tmpdir(), 'oe-style-only-'));
  const root = await realpath(created);
  fixtureRoots.push(created);
  const appDirPath = join(root, 'app');

  await write(
    join(appDirPath, 'package.json'),
    JSON.stringify({ name: 'oe-style-only-proof', private: true, type: 'module' }),
  );
  await write(
    join(appDirPath, 'vite.config.ts'),
    [
      "import { openElement } from '@openelement/router/vite';",
      "import { defineConfig } from 'vite';",
      '',
      "export default defineConfig({ base: '/', plugins: [openElement()] });",
      '',
    ].join('\n'),
  );
  await write(
    join(appDirPath, 'app', 'components', 'server-only-page.css'),
    '.server-only-rule { color: rgb(1, 2, 3); }\n',
  );
  await write(
    join(appDirPath, 'app', 'components', 'server-only-page.tsx'),
    [
      "import { element, OpenElement } from '@openelement/element';",
      "import pageStyles from './server-only-page.css';",
      '',
      "@element('server-only-page', { root: 'light' })",
      'export default class ServerOnlyPage extends OpenElement {',
      '  static override styles = [pageStyles];',
      '  render() {',
      "    return <p class='server-only-rule'>server only</p>;",
      '  }',
      '}',
      '',
    ].join('\n'),
  );
  await write(
    join(appDirPath, 'app', 'routes', 'index.tsx'),
    [
      "import { definePage } from '@openelement/router';",
      "import ServerOnlyPage from '../components/server-only-page.tsx';",
      '',
      "export default definePage(ServerOnlyPage, { head: { title: 'Style-only build proof' } });",
      '',
    ].join('\n'),
  );

  await mkdir(join(appDirPath, 'node_modules', '@openelement'), { recursive: true });
  await symlink(
    join(REPO_ROOT, 'packages', 'router'),
    join(appDirPath, 'node_modules', '@openelement', 'router'),
  );
  await symlink(
    join(REPO_ROOT, 'packages', 'element'),
    join(appDirPath, 'node_modules', '@openelement', 'element'),
  );
  await symlink(join(REPO_ROOT, 'node_modules', 'vite'), join(appDirPath, 'node_modules', 'vite'));
  await symlink(
    join(REPO_ROOT, 'packages', 'router', 'node_modules', 'hono'),
    join(appDirPath, 'node_modules', 'hono'),
  );
  return appDirPath;
}

beforeAll(async () => {
  appDir = await buildServerOnlyFixture();
  const build = spawn(process.execPath, [ROUTER_BUILD_CLI], { cwd: appDir });
  build.stdout.on('data', (chunk) => (buildLogs += chunk));
  build.stderr.on('data', (chunk) => (buildLogs += chunk));
  const code = await new Promise<number>((resolve) => build.on('exit', (c) => resolve(c ?? -1)));
  expect(code, `style-only fixture build failed:\n${buildLogs}`).toEqual(0);
}, 240_000);

afterAll(async () => {
  for (const root of fixtureRoots.splice(0)) {
    await rm(root, { recursive: true, force: true });
  }
});

test('an island-free app emits its server-rendered sheet as an external asset', async () => {
  const assetsDir = join(appDir, 'dist', 'client', 'assets');
  const cssFiles = (await readdir(assetsDir)).filter((name) => name.endsWith('.css'));
  expect(cssFiles, 'the server-rendered sheet was emitted').toHaveLength(1);
  const body = await readFile(join(assetsDir, cssFiles[0]!), 'utf8');
  expect(body, 'the emitted bytes are the authored sheet, @scope-projected').toContain(
    '@scope (server-only-page)',
  );
  expect(body).toContain('.server-only-rule');

  const html = await readFile(join(appDir, 'dist', 'index.html'), 'utf8');
  const declared = [
    ...html.matchAll(/<link rel="stylesheet" href="([^"]+)" data-oe-static-styles \/>/g),
  ].map((match) => match[1]!);
  expect(declared, 'the page declares the emitted asset as a marked link').toContain(
    `/client/assets/${cssFiles[0]!}`,
  );
  expect(html, 'no framework inline stylesheet').not.toContain('<style data-oe-static-styles>');
});

test('the style-only build ships no client JavaScript', () => {
  expect(
    existsSync(join(appDir, 'dist', 'client', 'islands')),
    'no island bundle may be emitted for an island-free app',
  ).toBe(false);
  expect(
    existsSync(join(appDir, 'dist', 'island-manifests')),
    'no island manifest pass runs without a client manifest',
  ).toBe(false);
  expect(buildLogs, 'the emission stage ran and reported itself').toContain(
    'Style-only emission complete',
  );
});
