/**
 * Generate the pre-paint theme boot script from the theme contract.
 *
 * `www/public/theme-init.js` runs as a classic synchronous script before first
 * paint, so it cannot import `packages/ui/src/theme-contract.ts` at runtime.
 * This generator is the P6 derived-artifact bridge: the contract stays the one
 * owner of the acceptance rule and the one writer of `html[data-theme]`, and
 * this file is regenerated from it byte-for-byte.
 *
 * Determinism (the `--check` gates depend on it):
 *   - `ts.transpileModule` with a fixed option set and no source maps;
 *   - the shell contains no timestamp, version, `__dirname` or
 *     `import.meta.url`, so the output is machine-independent;
 *   - the contract module must stay import-free (checked here, fail closed);
 *   - the assembled text is scanned with the site's machine-path guard before
 *     it is allowed to be written.
 *
 * `--check` regenerates in memory and requires byte-identical output, like the
 * other `www` generators. The output is Git-tracked, so the check must run
 * BEFORE `generate:all` in a gate (a trailing check would compare bytes the
 * generator just wrote).
 */
import { readFile, writeFile } from 'node:fs/promises';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { findMachinePath } from './check-no-machine-paths.ts';

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
export const CONTRACT_SOURCE = 'packages/ui/src/theme-contract.ts';
export const THEME_INIT_ARTIFACT = 'www/public/theme-init.js';

const GENERATED_HEADER = [
  '// GENERATED FILE — do not edit.',
  `// Source: ${CONTRACT_SOURCE}`,
  '// Generator: www/tools/generate-theme-init.ts (--check enforces byte equality).',
].join('\n');

/** Fail closed if the contract stops being self-contained. */
function assertImportFree(source: string, path: string): void {
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  for (const statement of file.statements) {
    if (ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement)) {
      throw new Error(
        `${path} must stay import-free: the pre-paint script is a classic script. ` +
          `Move the imported symbol into the contract module.`,
      );
    }
  }
  if (/\brequire\s*\(/.test(source)) {
    throw new Error(`${path} must not call require(): the pre-paint script has no module loader.`);
  }
}

/** The fixed runtime shell. No machine-dependent values may enter this text. */
function renderShell(compiledContract: string): string {
  return `${GENERATED_HEADER}
(function () {
  'use strict';
  if (typeof document === 'undefined') return;

  const exports = {};
  const module = { exports: exports };
${compiledContract}
  const contract = module.exports;

  let saved = null;
  try {
    saved = localStorage.getItem(contract.THEME_STORAGE_KEY);
  } catch {
    // localStorage may be blocked in private browsing or restricted contexts.
  }

  let prefersLight = false;
  try {
    const matchMedia = globalThis.matchMedia;
    if (typeof matchMedia === 'function') {
      prefersLight = matchMedia.call(globalThis, '(prefers-color-scheme: light)').matches === true;
    }
  } catch {
    // matchMedia may be unavailable or throw in old/embedded WebViews.
  }

  const theme = contract.resolveSiteTheme(saved, prefersLight);
  contract.applyDocumentTheme(document.documentElement, theme);

  try {
    // Synchronous marker proving theme-init ran before first paint.
    document.documentElement.dataset.themeInit = '1';
  } catch {
    // Ignore errors: the marker is diagnostic only.
  }
})();
`;
}

export async function renderThemeInit(root: string): Promise<string> {
  const contractPath = `${root}/${CONTRACT_SOURCE}`;
  const source = await readFile(contractPath, 'utf8');
  assertImportFree(source, CONTRACT_SOURCE);

  const compiled = ts.transpileModule(source, {
    fileName: CONTRACT_SOURCE,
    compilerOptions: {
      target: ts.ScriptTarget.ES2020,
      module: ts.ModuleKind.CommonJS,
      removeComments: true,
      sourceMap: false,
      inlineSourceMap: false,
      inlineSources: false,
      newLine: ts.NewLineKind.LineFeed,
    },
  }).outputText;
  // The transpiled CommonJS block opens with its own `"use strict";`. Inside
  // the shell it is no longer a directive prologue (it follows declarations),
  // so it is a no-effect expression — the shell carries the directive at the
  // top instead. Dropping it keeps the artifact clean for static analysis.
  const compiledBody = compiled.replace(/^"use strict";\n/, '');

  for (const symbol of ['resolveSiteTheme', 'applyDocumentTheme']) {
    if (!compiledBody.includes(symbol)) {
      throw new Error(
        `theme-init generation would be vacuous: compiled contract does not export ${symbol}.`,
      );
    }
  }

  const generated = renderShell(compiledBody.trimEnd());
  const machinePath = findMachinePath(generated);
  if (machinePath) {
    throw new Error(
      `theme-init output contains a machine path (${machinePath.label}: ${machinePath.match}); ` +
        'the artifact must be reproducible on any machine.',
    );
  }
  return generated;
}

async function main(): Promise<void> {
  const check = process.argv.slice(2).includes('--check');
  const generated = await renderThemeInit(repoRoot);
  const outFile = `${repoRoot}/${THEME_INIT_ARTIFACT}`;

  if (!check) {
    await writeFile(outFile, generated);
    console.log(`theme-init written: ${generated.length} bytes.`);
    return;
  }

  let current = '';
  try {
    current = await readFile(outFile, 'utf8');
  } catch {
    // Missing output is drift; fall through to the mismatch path.
  }
  if (current !== generated) {
    console.error(
      'theme-init drift: regenerate with ' +
        '`vp run --no-cache --fail-if-no-match --filter @openelement/www generate:theme-init`.',
    );
    process.exit(1);
  }
  console.log('theme-init check passed.');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await main();
}
