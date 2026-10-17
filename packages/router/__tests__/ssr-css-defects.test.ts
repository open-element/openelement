/**
 * N-2 SSR inline-CSS defects — consumer form through the real Router build
 * entry (SSG route output; `packages/router/src/cli/build.ts`).
 *
 * Two defects in the SSR style half of the alpha15 style-asset protocol:
 *
 *   N-2A — the SSR rule parser truncates at a `}` inside a CSS string
 *   (`ShimStyleSheet.parseRules`, raw brace counting with no string/comment
 *   state). A URL-less author sheet whose bytes contain
 *   `.a::before { content: "}" }` reaches the document as malformed inline
 *   CSS. The serializer's only inline channel is the marked
 *   `<style data-oe-static-styles>` text the parser feeds (ADR-0164 S-C2/S-10:
 *   "SSR serializes its rules verbatim"), so a truncation is a corrupted
 *   document, not a cosmetic difference.
 *
 *   N-2B — the SSR global `CSSStyleSheet` stub (`ssr-polyfills.ts`) drops
 *   every sheet: `replaceSync` is a no-op and `cssRules` always returns [].
 *   A URL-less author sheet constructed through the global (the constructor
 *   the browser semantics of the S-10 contract name) contributes nothing to
 *   the server-rendered document — a silent style loss, where the contract
 *   promises verbatim rules and "never a silent drop".
 *
 * Why a legacy (pre-#1558) artifact package: today's compiled grammar admits
 * one style form (`.css` imports in `static styles`, OEC9029) and no runtime
 * top-level statements (OEC9008), so an in-memory sheet cannot be authored in
 * a compiled module. The artifact recovery explicitly keeps pre-#1558
 * inline-sheet modules working ("artifacts compiled before #1558 (legacy
 * inline sheets that referenced a `StyleSheet` built in a plain module)
 * therefore keep riding the old path unchanged",
 * packages/compiler/src/internal/compiler/compiled-artifact-style-requests.ts).
 * This suite builds such a package the way a consumer build sees it: through
 * `compileElementModule`'s own artifact emission, with the legacy styles
 * member restored, consumed by the real CLI build.
 *
 * Recorded on the pre-fix revision (4edf71be3): N-2A renders the truncated
 * rule `oe-n2-a p::before { content: "}` (the closing brace and the second
 * rule's prefix are re-attached to the wrong boundary); N-2B renders no style
 * node at all. Situation A (the sheet is built after the SSR polyfill
 * initialized, through the same global) is the reachable silent-loss shape
 * and is pinned here.
 *
 * Situation B — construction at MODULE-EVALUATION time through the global —
 * is OUTSIDE the promised authoring contract and is pinned as the loud
 * failure it already is (never a silent style loss):
 *   - the one documented authoring form arrays `.css` imports in `static
 *     styles` (www/content/docs/guide/styling.md:21,58) and the compiled
 *     grammar rejects runtime top-level statements with OEC9008
 *     (www/content/docs/guide/compiled-grammar.md:20);
 *   - the SSR global is installed by the generated entry BODY
 *     (build-ssg.ts:319-323; ssr-polyfills.ts), after ESM import evaluation —
 *     only `customElements` ships as the output banner that runs before
 *     imports, because route modules `define()` at top level;
 *   - the S-C2/S-10 amendment (ADR-0164:675-693) pins the serialization of a
 *     reachable URL-less sheet, not a construction window, and the
 *     module-top-level spelling the framework's own server adapters use is
 *     element's cross-realm `StyleSheet` (style-assets.ts:853-855).
 * Observable failure, reproduced through this file's build entry:
 * `ReferenceError: CSSStyleSheet is not defined` and a non-zero build exit
 * before any page HTML is written (the `Situation B` test below).
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { compileElementModule } from '@openelement/compiler';

const REPO_ROOT = join(import.meta.dirname!, '..', '..', '..');
const ROUTER_BUILD_CLI = join(REPO_ROOT, 'packages', 'router', 'src', 'cli', 'build.ts');

/** N-2A's sheet: a `}` inside a string, then a second rule (one rule/line). */
const N2A_CSS = 'oe-n2-a p::before { content: "}" }\noe-n2-a p { color: rgb(1, 2, 3); }\n';
/** N-2B's sheet: ordinary bytes; loss is the defect, not the content. */
const N2B_CSS = 'oe-n2-b p { color: rgb(4, 5, 6); }\n';

const N2A_PAGE_TEXT = 'n2a legacy page';
const N2B_PAGE_TEXT = 'n2b lazy page';

/** Situation B's sheet: ordinary bytes; the failure is the ordering, not the content. */
const N2C_CSS = 'oe-n2-c p { color: rgb(7, 8, 9); }\n';
const N2C_PAGE_TEXT = 'n2c loud page';

const fixtureRoots: string[] = [];

async function write(joinPath: string, content: string): Promise<void> {
  await mkdir(joinPath.slice(0, joinPath.lastIndexOf('/')), { recursive: true });
  await writeFile(joinPath, content, 'utf8');
}

/**
 * A compiled page artifact for one legacy package: real `compileElementModule`
 * emission with the packer's type strips applied and the legacy in-memory
 * styles member restored (the pre-#1558 shape the artifact path documents).
 */
function legacyArtifactPage(options: {
  pkgDir: string;
  tag: string;
  className: string;
  text: string;
  stylesMember: string;
}): string {
  const source = [
    "import { element, OpenElement } from '@openelement/element';",
    '',
    `@element('${options.tag}', { root: 'shadow-open' })`,
    `export default class ${options.className} extends OpenElement {`,
    '  render() {',
    `    return <p>${options.text}</p>;`,
    '  }',
    '}',
    '',
  ].join('\n');
  const compiled = compileElementModule(source, join(options.pkgDir, 'index.tsx'), {});
  if (compiled === null) throw new Error(`${options.tag} did not compile to an artifact`);
  const artifact = compiled.code
    .replaceAll('static __partProgram: typeof __partProgram =', 'static __partProgram =')
    .replaceAll(
      'static __compiledProperties: typeof __compiledProperties =',
      'static __compiledProperties =',
    )
    .replaceAll(
      'static __elementMetadata: typeof __elementMetadata =',
      'static __elementMetadata =',
    )
    .replaceAll('static props: typeof __compiledProps =', 'static props =')
    .replaceAll(
      'static observedAttributes: typeof __observedAttributes =',
      'static observedAttributes =',
    )
    .replaceAll('const __observedAttributes: string[] =', 'const __observedAttributes =')
    .replaceAll('render(): never {', 'render() {')
    .replace(/\/\/# sourceMappingURL=.*$/m, '');
  return artifact.replace(
    '  static observedAttributes = __observedAttributes;',
    '  static observedAttributes = __observedAttributes;\n' + options.stylesMember,
  );
}

async function writeLegacyPackage(
  appDir: string,
  pkgName: string,
  files: { 'index.js': string; 'sheet.js'?: string },
): Promise<void> {
  const pkgDir = join(appDir, 'node_modules', '@acme', pkgName);
  await write(
    join(pkgDir, 'package.json'),
    JSON.stringify({ name: `@acme/${pkgName}`, private: true, type: 'module', main: './index.js' }),
  );
  for (const [name, content] of Object.entries(files)) {
    await write(join(pkgDir, name), content);
  }
}

/** The consumer-shaped app scaffold both fixtures share: manifest, config, links. */
async function writeAppScaffold(appDir: string): Promise<void> {
  await write(
    join(appDir, 'package.json'),
    JSON.stringify({ name: 'oe-n2-ssr-css-proof', private: true, type: 'module' }),
  );
  await write(
    join(appDir, 'vite.config.ts'),
    [
      "import { openElement } from '@openelement/router/vite';",
      "import { defineConfig } from 'vite';",
      '',
      'export default defineConfig({ plugins: [openElement()] });',
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
}

/** Spawn the real CLI build in `cwd`; resolve with its exit code and captured output. */
async function runBuild(cwd: string): Promise<{ code: number; logs: string }> {
  const build = spawn(process.execPath, [ROUTER_BUILD_CLI], { cwd });
  let logs = '';
  build.stdout.on('data', (chunk) => (logs += chunk));
  build.stderr.on('data', (chunk) => (logs += chunk));
  const code = await new Promise<number>((resolve) => build.on('exit', (c) => resolve(c ?? -1)));
  return { code, logs };
}

async function buildFixture(): Promise<string> {
  const created = await mkdtemp(join(tmpdir(), 'oe-n2-ssr-css-'));
  const root = await realpath(created);
  fixtureRoots.push(created);
  const appDir = join(root, 'app');

  await writeAppScaffold(appDir);

  // N-2A: the sheet is built at module top level by element's cross-realm
  // `StyleSheet` (the SSR shim) and arrayed in the legacy styles member.
  await writeLegacyPackage(appDir, 'oe-n2-legacy-a', {
    'index.js': [
      "import sheet from './sheet.js';",
      '',
      legacyArtifactPage({
        pkgDir: join(appDir, 'node_modules', '@acme', 'oe-n2-legacy-a'),
        tag: 'oe-n2-a',
        className: 'OeN2APage',
        text: N2A_PAGE_TEXT,
        stylesMember: '  static styles = [sheet];',
      }),
      '',
    ].join('\n'),
    'sheet.js': [
      "import { StyleSheet } from '@openelement/element';",
      '',
      'const sheet = new StyleSheet();',
      `sheet.replaceSync(${JSON.stringify(N2A_CSS)});`,
      'export default sheet;',
      '',
    ].join('\n'),
  });

  // N-2B: the sheet is constructed through the global `CSSStyleSheet` — the
  // constructor the SSR stub owns. Construction at render time (the members
  // accessor) is the shape that reaches the installed global; a top-level
  // construction fails loudly before the polyfill installs and is pinned as
  // the out-of-contract situation-B failure below, never as supported.
  await writeLegacyPackage(appDir, 'oe-n2-legacy-b', {
    'index.js': [
      legacyArtifactPage({
        pkgDir: join(appDir, 'node_modules', '@acme', 'oe-n2-legacy-b'),
        tag: 'oe-n2-b',
        className: 'OeN2BPage',
        text: N2B_PAGE_TEXT,
        stylesMember: [
          '  static get styles() {',
          '    const sheet = new CSSStyleSheet();',
          `    sheet.replaceSync(${JSON.stringify(N2B_CSS)});`,
          '    return [sheet];',
          '  }',
        ].join('\n'),
      }),
      '',
    ].join('\n'),
  });

  await write(
    join(appDir, 'app', 'routes', 'index.tsx'),
    [
      "import { definePage } from '@openelement/router';",
      "import LegacyAPage from '@acme/oe-n2-legacy-a';",
      '',
      "export default definePage(LegacyAPage, { renderIntent: { mode: 'static' } });",
      '',
    ].join('\n'),
  );
  await write(
    join(appDir, 'app', 'routes', 'defect-b.tsx'),
    [
      "import { definePage } from '@openelement/router';",
      "import LegacyBPage from '@acme/oe-n2-legacy-b';",
      '',
      "export default definePage(LegacyBPage, { renderIntent: { mode: 'static' } });",
      '',
    ].join('\n'),
  );

  return appDir;
}

/**
 * Situation B's fixture, built by its own app: the component module's plain
 * sibling (`sheet.js`) constructs the sheet through the global `CSSStyleSheet`
 * at MODULE-EVALUATION time — before the SSR entry body's polyfill can run.
 * One route only, so the expected loud failure leaves no rendered page behind.
 */
async function buildLoudFixture(): Promise<string> {
  const created = await mkdtemp(join(tmpdir(), 'oe-n2-ssr-css-loud-'));
  const root = await realpath(created);
  fixtureRoots.push(created);
  const appDir = join(root, 'app');

  await writeAppScaffold(appDir);

  await writeLegacyPackage(appDir, 'oe-n2-legacy-c', {
    'index.js': [
      "import sheet from './sheet.js';",
      '',
      legacyArtifactPage({
        pkgDir: join(appDir, 'node_modules', '@acme', 'oe-n2-legacy-c'),
        tag: 'oe-n2-c',
        className: 'OeN2CPage',
        text: N2C_PAGE_TEXT,
        stylesMember: '  static styles = [sheet];',
      }),
      '',
    ].join('\n'),
    'sheet.js': [
      '// Situation B: construction at module-evaluation time through the global.',
      'const sheet = new CSSStyleSheet();',
      `sheet.replaceSync(${JSON.stringify(N2C_CSS)});`,
      'export default sheet;',
      '',
    ].join('\n'),
  });

  await write(
    join(appDir, 'app', 'routes', 'defect-c.tsx'),
    [
      "import { definePage } from '@openelement/router';",
      "import LegacyCPage from '@acme/oe-n2-legacy-c';",
      '',
      "export default definePage(LegacyCPage, { renderIntent: { mode: 'static' } });",
      '',
    ].join('\n'),
  );
  return appDir;
}

let appDir: string;
let buildLogs = '';

beforeAll(async () => {
  appDir = await buildFixture();
  const { code, logs } = await runBuild(appDir);
  buildLogs = logs;
  expect(code, `N-2 fixture build failed:\n${buildLogs}`).toEqual(0);
  if (process.env.OE_KEEP_FIXTURE) console.log(`[fixture] ${appDir}`);
}, 240_000);

afterAll(async () => {
  if (process.env.OE_KEEP_FIXTURE) return;
  for (const root of fixtureRoots.splice(0)) {
    await rm(root, { recursive: true, force: true });
  }
});

/** The marked inline text node's content, or undefined when none was emitted. */
function inlineStyleText(html: string): string | undefined {
  return /<style data-oe-static-styles>([\s\S]*?)<\/style>/.exec(html)?.[1];
}

test('N-2A: a `}` inside a CSS string does not truncate the inline SSR rule text', async () => {
  const html = await readFile(join(appDir, 'dist', 'index.html'), 'utf8');
  expect(html, 'the page rendered (non-vacuous)').toContain(N2A_PAGE_TEXT);
  const css = inlineStyleText(html);
  expect(css, 'the URL-less author sheet rides the inline channel').toBeDefined();
  expect(
    css,
    'the author CSS bytes reach the document verbatim — a `}` inside a string ' +
      'is content, never a rule boundary',
  ).toBe(N2A_CSS);
});

test('N-2B: a sheet constructed through the SSR CSSStyleSheet global keeps its rules', async () => {
  const html = await readFile(join(appDir, 'dist', 'defect-b', 'index.html'), 'utf8');
  expect(html, 'the page rendered (non-vacuous)').toContain(N2B_PAGE_TEXT);
  const css = inlineStyleText(html);
  expect(css, 'the URL-less author sheet must serialize verbatim, never be silently dropped').toBe(
    N2B_CSS,
  );
});

test(
  'Situation B (outside the contract): module-evaluation-time `new CSSStyleSheet()` ' +
    'fails the build loudly — never a silent style loss',
  async () => {
    const loudDir = await buildLoudFixture();
    const { code, logs } = await runBuild(loudDir);
    if (process.env.OE_KEEP_FIXTURE) console.log(`[loud fixture] ${loudDir}`);
    expect(
      code,
      'the module-top-level construction must not be swallowed into a styled-less page:\n' + logs,
    ).not.toEqual(0);
    expect(
      logs,
      'the loud failure names the uninstalled global (the documented ordering constraint)',
    ).toContain('ReferenceError: CSSStyleSheet is not defined');
    expect(
      existsSync(join(loudDir, 'dist', 'defect-c', 'index.html')),
      'no page is emitted without the sheet the build refused to lose',
    ).toBe(false);
  },
  240_000,
);
