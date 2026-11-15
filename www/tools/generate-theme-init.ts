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
 *   - the contract module must stay import-free (whole-tree AST scan, so a
 *     dynamic `import()` is caught at any depth), syntactically valid
 *     (transpile diagnostics), and the symbols the shell reads must be its
 *     real CommonJS exports (emitted AST, not a substring occurrence);
 *   - the assembled text is parsed as the classic script it is and scanned
 *     with the site's machine-path guard before it is allowed to be written.
 *
 * `--check` regenerates in memory and requires byte-identical output, like the
 * other `www` generators. The output is Git-tracked, so the check must run
 * BEFORE `generate:all` in a gate (a trailing check would compare bytes the
 * generator just wrote).
 */
import { readFile, writeFile } from 'node:fs/promises';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { Script } from 'node:vm';
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

/** The contract exports the shell reads. A name in a comment, or an unexported
 * declaration, is not an export: the boot script would throw without them. */
const REQUIRED_EXPORTS = ['THEME_STORAGE_KEY', 'resolveSiteTheme', 'applyDocumentTheme'];

/** The first module-loader construct at ANY depth, or null. A classic script
 * has no loader, and CommonJS output turns a missed `import()` into a
 * `require()` the browser cannot resolve. */
function findModuleLoaderSyntax(file: ts.SourceFile): string | null {
  let violation: string | null = null;
  const visit = (node: ts.Node): void => {
    if (violation !== null) return;
    if (ts.isImportDeclaration(node)) violation = 'an import declaration';
    else if (ts.isImportEqualsDeclaration(node)) violation = 'an import-equals declaration';
    else if (ts.isExportDeclaration(node)) violation = 'an export declaration';
    else if (ts.isMetaProperty(node) && node.keywordToken === ts.SyntaxKind.ImportKeyword) {
      violation = 'import.meta';
    } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      violation = 'a dynamic import() call';
    } else if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'require'
    ) {
      violation = 'a require() call';
    }
    if (violation === null) ts.forEachChild(node, visit);
  };
  visit(file);
  return violation;
}

/** Transpile, failing closed on the syntax errors `transpileModule` would
 * otherwise paper over by emitting partial output. */
function transpileContract(source: string): string {
  const result = ts.transpileModule(source, {
    fileName: CONTRACT_SOURCE,
    reportDiagnostics: true,
    compilerOptions: {
      target: ts.ScriptTarget.ES2020,
      module: ts.ModuleKind.CommonJS,
      removeComments: true,
      sourceMap: false,
      inlineSourceMap: false,
      inlineSources: false,
      newLine: ts.NewLineKind.LineFeed,
    },
  });
  const errors = (result.diagnostics ?? []).filter(
    (diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error,
  );
  if (errors.length > 0) {
    const detail = errors
      .map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, ' '))
      .join('; ');
    throw new Error(`${CONTRACT_SOURCE} must transpile without a syntax error: ${detail}`);
  }
  return result.outputText;
}

/** The assembled file must parse as a classic script and behave as one: the
 * shell's symbols must be real `exports.<name> = …` assignments in it. */
function assertClassicScript(generated: string): void {
  try {
    // V8 parses this exactly as a classic <script>; module syntax throws here.
    new Script(generated);
  } catch (error) {
    throw new Error(`${THEME_INIT_ARTIFACT} must be a classic script: ${(error as Error).message}`);
  }

  const file = ts.createSourceFile(
    THEME_INIT_ARTIFACT,
    generated,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS,
  );
  const exported = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      ts.isPropertyAccessExpression(node.left) &&
      ts.isIdentifier(node.left.expression) &&
      node.left.expression.text === 'exports' &&
      ts.isIdentifier(node.left.name)
    ) {
      exported.add(node.left.name.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(file);

  const missing = REQUIRED_EXPORTS.find((symbol) => !exported.has(symbol));
  if (missing !== undefined) {
    throw new Error(
      `theme-init generation would be vacuous: compiled contract does not export ${missing}.`,
    );
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

  const violation = findModuleLoaderSyntax(
    ts.createSourceFile(CONTRACT_SOURCE, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS),
  );
  if (violation !== null) {
    throw new Error(
      `${CONTRACT_SOURCE} must stay import-free: the pre-paint script is a classic script, ` +
        `and the contract carries ${violation}.`,
    );
  }

  const compiled = transpileContract(source);
  // The transpiled CommonJS block opens with its own `"use strict";`. Inside
  // the shell it is no longer a directive prologue (it follows declarations),
  // so it is a no-effect expression — the shell carries the directive at the
  // top instead. Dropping it keeps the artifact clean for static analysis.
  const compiledBody = compiled.replace(/^"use strict";\n/, '');

  const generated = renderShell(compiledBody.trimEnd());
  assertClassicScript(generated);

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
