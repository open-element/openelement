/**
 * Shadow candidate discovery through the package.json `imports` form (alpha15
 * S lane, defect B).
 *
 * The defect this pins: a static shadow component reached through a
 * `package.json` `imports` subpath (`#components/alias-card.tsx`) or a
 * configured alias never entered the candidate discovery inventory — the
 * inventory came from a scanner that follows RELATIVE imports only — so the
 * component's utility stylesheet was never compiled and its DSD templates
 * shipped without the declarative `<link>`. The build SUCCEEDED while the
 * component lost every utility rule: the silent-loss shape the S lane exists to
 * prevent.
 *
 * The fixture is the A/B the contract demands, in one build:
 *   - `relative-card` is reached by a relative specifier (the known-good path);
 *   - `alias-card` is reached only through the app's `imports` map.
 * Both are authored identically (a shadow component whose entire styling is one
 * arbitrary-value utility), so a difference in the emitted artifacts can only
 * come from discovery, never from the authoring form.
 *
 * Arbitrary-value utilities are used as the marker: `p-[13px]`/`p-[17px]`
 * compile to literal declarations, so the assertion does not depend on any
 * Tailwind scale value.
 *
 * Run: pnpm --filter @openelement/router test
 */

import { spawn } from 'node:child_process';
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

const THEME_CSS = '@theme { --color-proof-role: #123456; }\n';

const fixtureRoots: string[] = [];

async function write(path: string, content: string): Promise<void> {
  await mkdir(path.slice(0, path.lastIndexOf('/')), { recursive: true });
  await writeFile(path, content);
}

/** One shadow component whose entire styling is a single arbitrary utility. */
function cardSource(tagName: string, padding: string): string {
  return [
    "import { element, OpenElement } from '@openelement/element';",
    '',
    `@element('${tagName}', { root: 'shadow-open' })`,
    `export default class ${tagName.replace(/(^|-)([a-z])/g, (_, __, c: string) => c.toUpperCase())} extends OpenElement {`,
    '  render() {',
    `    return <div class="p-[${padding}px]">${tagName}</div>;`,
    '  }',
    '}',
    '',
  ].join('\n');
}

async function buildFixture(): Promise<string> {
  const created = await mkdtemp(join(tmpdir(), 'oe-tailwind-candidate-discovery-'));
  // Node resolution answers realpaths (macOS /var vs /private/var).
  const root = await realpath(created);
  fixtureRoots.push(created);
  const appDir = join(root, 'app');

  await write(
    join(appDir, 'package.json'),
    JSON.stringify(
      {
        name: 'oe-tailwind-candidate-discovery-proof',
        private: true,
        type: 'module',
        // The aliased reachability form the defect missed. Node/Vite resolve
        // `#components/…` against this map, relative to the package root.
        imports: { '#components/*': './app/components/*' },
      },
      null,
      2,
    ),
  );
  await write(
    join(appDir, 'vite.config.ts'),
    [
      "import { openElement } from '@openelement/router/vite';",
      "import { defineConfig } from 'vite';",
      '',
      "export default defineConfig({ base: '/', plugins: [openElement()] });",
      '',
    ].join('\n'),
  );
  await write(
    join(appDir, 'openelement.config.ts'),
    [
      "import { defineConfig } from '@openelement/router';",
      '',
      "export default defineConfig({ tailwind: { theme: ['app/theme.css'] } });",
      '',
    ].join('\n'),
  );
  await write(join(appDir, 'app', 'theme.css'), THEME_CSS);
  await write(
    join(appDir, 'app', 'components', 'alias-card.tsx'),
    cardSource('oe-alias-card', '13'),
  );
  await write(
    join(appDir, 'app', 'components', 'relative-card.tsx'),
    cardSource('oe-relative-card', '17'),
  );
  await write(
    join(appDir, 'app', 'components', 'proof-page.tsx'),
    [
      "import { element, OpenElement } from '@openelement/element';",
      "import '#components/alias-card.tsx';",
      "import './relative-card.tsx';",
      '',
      "@element('proof-page', { root: 'light' })",
      'export default class ProofPage extends OpenElement {',
      '  render() {',
      '    return (',
      '      <div>',
      '        <oe-alias-card></oe-alias-card>',
      '        <oe-relative-card></oe-relative-card>',
      '      </div>',
      '    );',
      '  }',
      '}',
      '',
    ].join('\n'),
  );
  await write(
    join(appDir, 'app', 'routes', 'index.tsx'),
    [
      "import { definePage } from '@openelement/router';",
      "import ProofPage from '../components/proof-page.tsx';",
      '',
      "export default definePage(ProofPage, { renderIntent: { mode: 'static' } });",
      '',
    ].join('\n'),
  );

  // pnpm-style symlinks to the workspace packages (the layout a consumer has).
  await mkdir(join(appDir, 'node_modules', '@openelement'), { recursive: true });
  await symlink(
    join(REPO_ROOT, 'packages', 'router'),
    join(appDir, 'node_modules', '@openelement', 'router'),
  );
  await symlink(
    join(REPO_ROOT, 'packages', 'element'),
    join(appDir, 'node_modules', '@openelement', 'element'),
  );
  await symlink(join(REPO_ROOT, 'node_modules', 'vite'), join(appDir, 'node_modules', 'vite'));
  await symlink(
    join(REPO_ROOT, 'packages', 'router', 'node_modules', 'hono'),
    join(appDir, 'node_modules', 'hono'),
  );
  await symlink(
    join(REPO_ROOT, 'node_modules', 'tailwindcss'),
    join(appDir, 'node_modules', 'tailwindcss'),
  );
  return appDir;
}

let appDir: string;
let buildLogs = '';

beforeAll(async () => {
  appDir = await buildFixture();
  const build = spawn(process.execPath, [ROUTER_BUILD_CLI], { cwd: appDir });
  build.stdout.on('data', (chunk) => (buildLogs += chunk));
  build.stderr.on('data', (chunk) => (buildLogs += chunk));
  const code = await new Promise<number>((resolve) => build.on('exit', (c) => resolve(c ?? -1)));
  expect(code, `candidate-discovery fixture build failed:\n${buildLogs}`).toEqual(0);
  if (process.env.OE_KEEP_FIXTURE) console.log(`[fixture] ${appDir}`);
}, 240_000);

afterAll(async () => {
  if (process.env.OE_KEEP_FIXTURE) return;
  for (const root of fixtureRoots.splice(0)) {
    await rm(root, { recursive: true, force: true });
  }
});

/** Every emitted client stylesheet's text, keyed by file name. */
async function emittedSheets(): Promise<Map<string, string>> {
  const assetsDir = join(appDir, 'dist', 'client', 'assets');
  const files = (await readdir(assetsDir)).filter((file) => file.endsWith('.css'));
  return new Map(
    await Promise.all(
      files.map(async (file) => [file, await readFile(join(assetsDir, file), 'utf8')] as const),
    ),
  );
}

test('an #imports-reached shadow component reaches the component sheet exactly like a relative one', async () => {
  const html = await readFile(join(appDir, 'dist', 'index.html'), 'utf8');
  const documentHref = html.match(/<link rel="stylesheet" href="([^"]+)"/)?.[1];
  expect(documentHref, 'the document stylesheet is linked').toBeTruthy();
  const documentName = documentHref!.split('/').pop()!;

  const sheets = await emittedSheets();
  const componentSheets = [...sheets.entries()].filter(([name]) => name !== documentName);
  expect(componentSheets, 'the component sheet is emitted').toHaveLength(1);
  const componentSheet = componentSheets[0]![1];

  // The known-good path (relative import) and the alias path must be
  // indistinguishable in the compiled sheet: both tokens' rules are present.
  expect(componentSheet, 'the relative-import candidate compiles into the sheet').toMatch(
    /padding:\s*17px/,
  );
  expect(componentSheet, 'the #imports-reached candidate compiles into the sheet').toMatch(
    /padding:\s*13px/,
  );
});

test('both shadow components declare the component stylesheet in their DSD template', async () => {
  const html = await readFile(join(appDir, 'dist', 'index.html'), 'utf8');
  const declared = [
    ...html.matchAll(/<link rel="stylesheet" href="([^"]+)" data-oe-static-styles/g),
  ];
  // One declarative link per shadow component whose classes were admitted; the
  // page element itself is light-root, so it adds none.
  expect(declared, 'each utility-carrying shadow component declares the sheet').toHaveLength(2);
  const targets = new Set(declared.map((match) => match[1]));
  expect(targets.size, 'both declarations address the same content-addressed asset').toEqual(1);
  const [target] = [...targets];
  expect(target, 'the declared target is the emitted component sheet').toMatch(
    /^\/client\/assets\/[0-9a-f]{12}\.css$/,
  );
});
