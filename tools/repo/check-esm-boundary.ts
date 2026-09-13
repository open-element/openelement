// esm-boundary:scanner
/**
 * Fail-closed pure-ESM boundary gate (1.0 Alpha baseline).
 *
 * "Pure ESM" is proven by semantics and artifacts, not extensions:
 *
 * - first-party source, templates, and tracked tooling use ESM only:
 *   no `.cjs`, no `require()`, no `module.exports`, no `__dirname` /
 *   `__filename`, no CommonJS conditional `exports.require`
 * - no tracked first-party `.mjs`: npm products ship `.js` + `.d.ts` under
 *   `"type": "module"`, and first-party generated code is `.js`
 * - third-party tool output (Nitro `.output/server/index.mjs`) is out of
 *   scope: it is never tracked, never packed, never templated
 *
 * Scanner exemption (documented, narrow): a file whose first code line is
 * `// esm-boundary:scanner` intentionally names CJS constructs because it
 * scans for them (a scanner testing scanners). No other exemption exists.
 *
 * Exemptions (documented, narrow):
 * - `packages/element/__wtr__/*.config.js`: runs under Node via the WTR
 *   runner, covered by the local ESM package boundary (`type: module`);
 *   still ESM syntax, only the host is Node
 * - `vendor/`, `node_modules/`, build output (`dist/`, Nitro `.output`
 *   trees, `.nitro/`), and dependency lockfiles: third-party territory
 *
 * Usage: deno run --allow-read --allow-run tools/repo/check-esm-boundary.ts
 */

const SOURCE_ROOTS = [
  'packages/element/src',
  'packages/router/src',
  'packages/create/src',
  'packages/create/templates',
  'packages/ui/src',
  'tools',
];

const CJS_PATTERNS: { pattern: RegExp; message: string }[] = [
  { pattern: /\brequire\s*\(\s*['"]/, message: 'CommonJS require()' },
  { pattern: /\bmodule\.exports\b/, message: 'CommonJS module.exports' },
  { pattern: /\b__dirname\b/, message: 'CommonJS __dirname' },
  { pattern: /\b__filename\b/, message: 'CommonJS __filename' },
  { pattern: /define\s*\(\s*\[/, message: 'AMD define()' },
];

export interface EsmViolation {
  where: string;
  message: string;
}

export function firstCodeLine(text: string): string {
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#!')) continue;
    return trimmed;
  }
  return '';
}

export function scanCjsSyntax(files: { path: string; text: string }[]): EsmViolation[] {
  const violations: EsmViolation[] = [];
  for (const file of files) {
    if (file.path.endsWith('.md')) continue;
    if (firstCodeLine(file.text).startsWith('// esm-boundary:scanner')) continue;
    for (const { pattern, message } of CJS_PATTERNS) {
      if (pattern.test(file.text)) violations.push({ where: file.path, message });
    }
  }
  return violations;
}

export function scanExportsConditions(
  records: { path: string; exports?: unknown }[],
): EsmViolation[] {
  const violations: EsmViolation[] = [];
  const visit = (path: string, node: unknown): void => {
    if (Array.isArray(node)) {
      for (const entry of node) visit(path, entry);
    } else if (node !== null && typeof node === 'object') {
      for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
        if (key === 'require') {
          violations.push({ where: path, message: 'CommonJS conditional export' });
        } else visit(path, value);
      }
    }
  };
  for (const record of records) {
    if (record.exports !== undefined) visit(`${record.path} exports`, record.exports);
  }
  return violations;
}

async function trackedFiles(): Promise<string[]> {
  const command = new Deno.Command('git', {
    args: ['ls-files'],
    stdout: 'piped',
    stderr: 'null',
  });
  const { code, stdout } = await command.output();
  if (code !== 0) throw new Error('git ls-files failed');
  return new TextDecoder().decode(stdout).split('\n').map((line) => line.trim()).filter(Boolean);
}

function inSourceRoot(path: string): boolean {
  return SOURCE_ROOTS.some((root) => path === root || path.startsWith(`${root}/`));
}

if (import.meta.main) {
  const violations: EsmViolation[] = [];
  const files = await trackedFiles();
  for (const path of files) {
    if (path.endsWith('.mjs')) {
      violations.push({
        where: path,
        message: 'tracked first-party .mjs; ship .js under type: module',
      });
    } else if (path.endsWith('.cjs')) {
      violations.push({ where: path, message: 'tracked CommonJS file' });
    }
  }
  const syntaxFiles: { path: string; text: string }[] = [];
  const exportRecords: { path: string; exports?: unknown }[] = [];
  for (const path of files) {
    if (!inSourceRoot(path)) continue;
    if (
      path.endsWith('.ts') || path.endsWith('.tsx') || path.endsWith('.js') || path.endsWith('.mjs')
    ) {
      try {
        syntaxFiles.push({ path, text: await Deno.readTextFile(path) });
      } catch {
        // removed between ls-files and read; ignore
      }
    }
    if (path.endsWith('/deno.json') || path.endsWith('/package.json')) {
      try {
        const manifest = JSON.parse(await Deno.readTextFile(path)) as { exports?: unknown };
        exportRecords.push({ path, exports: manifest.exports });
      } catch {
        // unparseable manifest; other gates own that
      }
    }
  }
  violations.push(...scanCjsSyntax(syntaxFiles));
  violations.push(...scanExportsConditions(exportRecords));
  if (violations.length > 0) {
    for (const violation of violations) {
      console.error(`FAIL ${violation.where}: ${violation.message}`);
    }
    console.error(`${violations.length} esm-boundary violation(s)`);
    Deno.exit(1);
  }
  console.log(`esm-boundary ok (${syntaxFiles.length} first-party modules scanned)`);
}
