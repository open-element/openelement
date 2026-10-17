/**
 * @openelement/router — a CSS-only client build with Tailwind enabled (alpha15
 * S lane, defect D).
 *
 * The defect this pins: a native app with no admitted client islands and no
 * `data-open-enhance` forms whose Tailwind entry is enabled generated the
 * island-free CSS-only entry (the document stylesheet is its only import), yet
 * the client build's element-runtime chunk guard still demanded a runtime
 * chunk — the guard keyed off the style-only flag, which explicitly excluded
 * Tailwind. The build failed closed on
 * `OE_CLIENT_BUILD_ELEMENT_RUNTIME_CHUNK_MISSING` even though the generated
 * entry imports no runtime at all.
 *
 * The contract: the runtime requirement is a property of the GENERATED ENTRY,
 * not of the emission shape. So this app must build, ship both stylesheets
 * (document sheet + the shadow components' sheet, with the DSD links the SSR
 * half declares) and still ship ZERO client JavaScript. A runtime chunk must
 * never be emitted merely to satisfy the guard, and the shadow utility
 * resource must never be dropped on this path.
 */

import { spawn } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
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

/** Zero islands, no enhanced forms, Tailwind ON, one static shadow component. */
async function buildCssOnlyFixture(): Promise<string> {
  const created = await mkdtemp(join(tmpdir(), 'oe-tailwind-css-only-'));
  const root = await realpath(created);
  fixtureRoots.push(created);
  const appDirPath = join(root, 'app');

  await write(
    join(appDirPath, 'package.json'),
    JSON.stringify({ name: 'oe-tailwind-css-only-proof', private: true, type: 'module' }),
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
    join(appDirPath, 'openelement.config.ts'),
    [
      "import { defineConfig } from '@openelement/router';",
      '',
      "export default defineConfig({ tailwind: { theme: ['app/theme.css'] } });",
      '',
    ].join('\n'),
  );
  await write(join(appDirPath, 'app', 'theme.css'), '@theme { --color-proof-role: #123456; }\n');
  await write(
    join(appDirPath, 'app', 'components', 'css-only-card.tsx'),
    [
      "import { element, OpenElement } from '@openelement/element';",
      '',
      "@element('css-only-card', { root: 'shadow-open' })",
      'export default class CssOnlyCard extends OpenElement {',
      '  render() {',
      "    return <div class='p-[13px]'>css only</div>;",
      '  }',
      '}',
      '',
    ].join('\n'),
  );
  await write(
    join(appDirPath, 'app', 'routes', 'index.tsx'),
    [
      "import { definePage } from '@openelement/router';",
      "import CssOnlyCard from '../components/css-only-card.tsx';",
      '',
      "export default definePage(CssOnlyCard, { head: { title: 'CSS-only Tailwind proof' } });",
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
  await symlink(
    join(REPO_ROOT, 'node_modules', 'tailwindcss'),
    join(appDirPath, 'node_modules', 'tailwindcss'),
  );
  return appDirPath;
}

beforeAll(async () => {
  appDir = await buildCssOnlyFixture();
  const build = spawn(process.execPath, [ROUTER_BUILD_CLI], { cwd: appDir });
  build.stdout.on('data', (chunk) => (buildLogs += chunk));
  build.stderr.on('data', (chunk) => (buildLogs += chunk));
  const code = await new Promise<number>((resolve) => build.on('exit', (c) => resolve(c ?? -1)));
  expect(code, `CSS-only Tailwind fixture build failed:\n${buildLogs}`).toEqual(0);
  if (process.env.OE_KEEP_FIXTURE) console.log(`[fixture] ${appDir}`);
}, 240_000);

afterAll(async () => {
  if (process.env.OE_KEEP_FIXTURE) return;
  for (const root of fixtureRoots.splice(0)) {
    await rm(root, { recursive: true, force: true });
  }
});

test('both stylesheets are emitted and linked: the document sheet and the shadow component sheet', async () => {
  const assetsDir = join(appDir, 'dist', 'client', 'assets');
  const cssFiles = (await readdir(assetsDir)).filter((name) => name.endsWith('.css'));
  const bodies = new Map(
    await Promise.all(
      cssFiles.map(async (name) => [name, await readFile(join(assetsDir, name), 'utf8')] as const),
    ),
  );

  const html = await readFile(join(appDir, 'dist', 'index.html'), 'utf8');
  const documentHref = html.match(/<link rel="stylesheet" href="([^"]+)"/)?.[1];
  expect(documentHref, 'the document stylesheet is linked').toBeTruthy();
  const documentName = documentHref!.split('/').pop()!;
  expect(bodies.has(documentName), 'the document stylesheet is an emitted asset').toBe(true);

  const componentSheets = [...bodies.entries()].filter(([name]) => name !== documentName);
  expect(componentSheets, 'the shadow components sheet is emitted').toHaveLength(1);
  expect(componentSheets[0]![1], 'the admitted utility compiled into the sheet').toMatch(
    /padding:\s*13px/,
  );

  const declared = [
    ...html.matchAll(/<link rel="stylesheet" href="([^"]+)" data-oe-static-styles/g),
  ].map((match) => match[1]!);
  expect(declared, 'the shadow component declares its sheet in the DSD template').toContain(
    `/client/assets/${componentSheets[0]![0]}`,
  );
});

test('the CSS-only build ships no client JavaScript and no runtime chunk', () => {
  expect(
    existsSync(join(appDir, 'dist', 'client', 'islands')),
    'no island bundle may be emitted',
  ).toBe(false);
  expect(
    existsSync(join(appDir, 'dist', 'island-manifests')),
    'no island manifest pass runs without a client manifest',
  ).toBe(false);
  const assetsDir = join(appDir, 'dist', 'client', 'assets');
  const clientAssets = existsSync(assetsDir) ? readdirSync(assetsDir) : [];
  expect(
    clientAssets.filter((name) => name.endsWith('.js')),
    'no JavaScript asset ships for a CSS-only build',
  ).toEqual([]);
  expect(buildLogs, 'the emission stage ran and reported itself').toContain(
    'Style-only emission complete',
  );
});
