/**
 * Codemod: `Deno.*` runtime APIs → node:* (B3 test migration, step 2).
 *
 * Companion to codemod-deno-test-to-vitest.ts (which converts registration
 * and assertions). This one ports the runtime surface the converted suites
 * exercise, so the migrated files run under the Node-host vitest runner.
 *
 *   node tools/repo/codemod-deno-runtime-to-node.ts --dry
 *   node tools/repo/codemod-deno-runtime-to-node.ts
 *
 * Idempotent: output contains none of the mapped `Deno.X` forms in code
 * regions. String/template/comment/regex regions are masked (same scanner
 * as codemod #1); every rewrite is counted per file.
 *
 * ─── MAPPING TABLE (mechanical) ───────────────────────────────────────────
 * process surface (node:process):
 *   Deno.cwd()                 → process.cwd()
 *   Deno.chdir(p)              → process.chdir(p)
 *   Deno.exit(c)               → process.exit(c)
 *   Deno.execPath()            → process.execPath
 *   Deno.args                  → process.argv.slice(2)
 *   Deno.memoryUsage()         → process.memoryUsage()
 *   Deno.env.get(k)            → process.env[k]
 *   Deno.env.set(k, v)         → process.env[k] = v
 *   Deno.env.has(k)            → process.env[k] !== undefined
 *   Deno.env.toObject()        → { ...process.env }
 *   Deno.build.os === 'windows'  → process.platform === 'win32'
 *   Deno.build.os !== 'windows'  → process.platform !== 'win32'
 *
 * async fs (node:fs/promises, named imports):
 *   Deno.readTextFile(p)       → readFile(p, 'utf8')
 *   Deno.readFile(p)           → readFile(p)            (binary, no opts)
 *   Deno.writeFile(p, d)       → writeFile(p, d)        (binary, no opts)
 *   Deno.writeTextFile(p, d)   → writeFile(p, d)        (string data defaults
 *                               to utf8; options → manual)
 *   Deno.remove(p[, {recursive: true}]) → rm(p[, {recursive: true}])
 *   Deno.mkdir(p[, {recursive: true}])  → mkdir(p[, {recursive: true}])
 *   Deno.makeTempDir() / ({prefix: P})
 *                              → mkdtemp(join(tmpdir(), '' / P))
 *                              (node appends the random suffix after the
 *                              prefix — same path shape as Deno's temp dir)
 *   Deno.stat / lstat / copyFile / rename / symlink / realPath → same names
 *                               (node fs APIs accept URL args like Deno's)
 *
 * sync fs (node:fs, named imports):
 *   Deno.readTextFileSync(p)   → readFileSync(p, 'utf8')
 *   Deno.writeTextFileSync(p, d) → writeFileSync(p, d)
 *   Deno.mkdirSync / statSync / chmodSync → same names
 *   Deno.removeSync(p[, {recursive: true}]) → rmSync(p[, {recursive: true}])
 *   Deno.makeTempDirSync() / ({prefix: P}) → mkdtempSync(join(tmpdir(), …))
 *   Deno.realPathSync(p)       → realpathSync(p)
 *
 * ─── MANUAL LIST (fail closed — file skipped, listed) ────────────────────
 *   Deno.Command / ChildProcess     → node:child_process spawn reshaping
 *   Deno.serve / listen / listenTls / connect / NetAddr / hostname
 *                                   → node:http / node:net server rewrites
 *   Deno.errors.*                   → errno checks (ENOENT et al)
 *   Deno.readDir / readDirSync      → Dirent shape differs (methods not
 *                               properties); hand-written readdirSync
 *   Deno.makeTempFile               → mkdtemp + write composition
 *   Deno.dlopen                     → process.dlopen
 *   Deno.version / noColor / build (other than .os windows compares)
 *                                   → no mechanical equivalent
 *   Deno.env bare / any writeText|writeFile|readFile|stat with options
 *                                   → flag semantics need case review
 * ──────────────────────────────────────────────────────────────────────────
 */

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Scanner, scanRegions, regionTester } from './codemod-deno-test-to-vitest.ts';

const DRY = process.argv.includes('--dry');

const ROOTS = ['packages', 'apps', 'www', 'tools', 'tests'];
const EXCLUDED_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'dist-e2e',
  'dist-test-ssg-render',
  'custom-dist',
  '.output',
  'coverage',
  'benchmarks', // stays on the deno host (root `bench` script), not in B3 scope
]);
const EXCLUDED_PATH_PATTERNS: Array<(rel: string) => boolean> = [
  (rel) => rel.startsWith('www/app/data/'), // generated content; string mentions masked anyway
  (rel) => rel.startsWith('packages/element/__wtr__/'), // wtr browser universe — replaced by hand, not codemodded
  (rel) => rel === 'tools/repo/codemod-deno-test-to-vitest.ts', // codemod #1 quotes Deno.* in its mapping table
  (rel) => rel === 'tools/repo/codemod-deno-runtime-to-node.ts', // this script
  (rel) => /(^|\/)consumer-packaged-/.test(rel), // deno-run templates for consumer sandboxes
  (rel) => rel.endsWith('snapshot-prototype.ts') || rel.endsWith('qualify.ts'), // deno-run fixture scripts, not under vitest
  (rel) =>
    rel.startsWith('tests/fixtures/') && !rel.startsWith('tests/fixtures/web-component-interop/'), // fixture universes with their own runners (e2e), not under vitest
];
const EXTENSIONS = new Set(['.ts', '.tsx', '.mts', '.mjs']);

// Deno APIs with no mechanical mapping — the file goes to the manual batch
const MANUAL_APIS = new Set([
  'Command',
  'ChildProcess',
  'serve',
  'listen',
  'listenTls',
  'connect',
  'NetAddr',
  'hostname',
  'errors',
  'readDir',
  'readDirSync',
  'makeTempFile',
  'dlopen',
  'DirEntry',
  'version',
  'noColor',
  'json',
]);

type Need = {
  fsPromises: Set<string>;
  fsSync: Set<string>;
  process: boolean;
  join: boolean;
  tmpdir: boolean;
};

const NEED_EMPTY: Need = {
  fsPromises: new Set(),
  fsSync: new Set(),
  process: false,
  join: false,
  tmpdir: false,
};

function mergeNeed(need: Need, add: Partial<Need>): void {
  for (const n of add.fsPromises ?? []) need.fsPromises.add(n);
  for (const n of add.fsSync ?? []) need.fsSync.add(n);
  need.process ||= add.process ?? false;
  need.join ||= add.join ?? false;
  need.tmpdir ||= add.tmpdir ?? false;
}

type FileStats = {
  file: string;
  rewrites: Record<string, number>;
  importsAdded: number;
  notes: string[];
  skipped: boolean;
};

class SkipFile extends Error {}

type Edit = { start: number; end: number; replacement: string };

function transformFile(filePath: string, relFile: string): FileStats | null {
  const src = fs.readFileSync(filePath, 'utf8');
  if (!/\bDeno\.[A-Za-z_]/.test(src)) return null;

  const stats: FileStats = {
    file: relFile,
    rewrites: {},
    importsAdded: 0,
    notes: [],
    skipped: false,
  };
  const regions = scanRegions(src);
  const codeAt = regionTester(regions);
  const scanner = new Scanner(src, regions);

  try {
    // pass 0: fail closed on manual-only APIs and unmapped shapes
    const seen = new Map<string, number[]>();
    for (const m of src.matchAll(/\bDeno\.([A-Za-z_]+)/g)) {
      if (!codeAt(m.index)) continue;
      const api = m[1]!;
      seen.set(api, [...(seen.get(api) ?? []), m.index]);
      if (MANUAL_APIS.has(api)) {
        throw new SkipFile(`manual: Deno.${api} has no mechanical node:* mapping`);
      }
    }
    for (const [api, positions] of seen) {
      for (const pos of positions) {
        if (api === 'env') {
          const after = src.slice(pos + 8, pos + 30);
          if (!/^\s*\.\s*(get|set|has|toObject)\b/.test(after)) {
            throw new SkipFile('manual: Deno.env used in an unmapped shape');
          }
        } else if (api === 'build') {
          const after = src.slice(pos, pos + 48);
          if (!/^Deno\.build\.os\s*(===|!==)\s*'(windows|linux|darwin)'/.test(after)) {
            throw new SkipFile('manual: Deno.build used in an unmapped shape');
          }
        } else if (
          api === 'writeTextFile' ||
          api === 'writeFile' ||
          api === 'readFile' ||
          api === 'readTextFile' ||
          api === 'stat' ||
          api === 'lstat'
        ) {
          const openParen = src.indexOf('(', pos);
          if (openParen === -1) throw new SkipFile(`manual: Deno.${api} without a call paren`);
          const close = scanner.balanced(openParen);
          const maxArgs = api === 'writeTextFile' || api === 'writeFile' ? 2 : 1;
          if (scanner.args(openParen, close).length > maxArgs) {
            throw new SkipFile(
              `manual: Deno.${api} with options — flag semantics need case review`,
            );
          }
        }
      }
    }

    const need: Need = { ...NEED_EMPTY, fsPromises: new Set(), fsSync: new Set() };
    const edits: Edit[] = [];

    // call-shaped rewrites: the matched span is the callee, the balanced span
    // covers the argument list
    const call = (
      re: RegExp,
      build: (args: string[]) => { text: string; api: string; need?: Partial<Need> },
    ): void => {
      const re2 = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
      let mm: RegExpExecArray | null;
      while ((mm = re2.exec(src))) {
        if (!codeAt(mm.index)) continue;
        const openParen = mm.index + mm[0].length - 1;
        const close = scanner.balanced(openParen);
        const args = scanner.args(openParen, close).map((a) => a.text.trim());
        const out = build(args);
        edits.push({ start: mm.index, end: close, replacement: out.text });
        stats.rewrites[out.api] = (stats.rewrites[out.api] ?? 0) + 1;
        if (out.need) mergeNeed(need, out.need);
        re2.lastIndex = close;
      }
    };

    // token-shaped rewrites: the matched span is the whole rewrite
    const token = (
      re: RegExp,
      build: () => { text: string; api: string; need?: Partial<Need> },
    ): void => {
      const re2 = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
      let mm: RegExpExecArray | null;
      while ((mm = re2.exec(src))) {
        if (!codeAt(mm.index)) continue;
        const out = build();
        edits.push({ start: mm.index, end: mm.index + mm[0].length, replacement: out.text });
        stats.rewrites[out.api] = (stats.rewrites[out.api] ?? 0) + 1;
        if (out.need) mergeNeed(need, out.need);
      }
    };

    const P: Partial<Need> = { process: true };
    token(/Deno\.cwd\s*\(\s*\)/, () => ({ text: 'process.cwd()', api: 'cwd', need: P }));
    token(/Deno\.execPath\s*\(\s*\)/, () => ({
      text: 'process.execPath',
      api: 'execPath',
      need: P,
    }));
    token(/Deno\.memoryUsage\s*\(\s*\)/, () => ({
      text: 'process.memoryUsage()',
      api: 'memoryUsage',
      need: P,
    }));
    call(/Deno\.chdir\s*\(/, (a) => ({
      text: `process.chdir(${a.join(', ')})`,
      api: 'chdir',
      need: P,
    }));
    call(/Deno\.exit\s*\(/, (a) => ({
      text: `process.exit(${a.join(', ')})`,
      api: 'exit',
      need: P,
    }));
    call(/Deno\.env\.get\s*\(/, (a) => ({ text: `process.env[${a[0]}]`, api: 'env.get', need: P }));
    call(/Deno\.env\.set\s*\(/, (a) => ({
      text: `process.env[${a[0]}] = ${a[1]}`,
      api: 'env.set',
      need: P,
    }));
    call(/Deno\.env\.has\s*\(/, (a) => ({
      text: `(process.env[${a[0]}] !== undefined)`,
      api: 'env.has',
      need: P,
    }));
    call(/Deno\.env\.toObject\s*\(\s*\)/, () => ({
      text: '{ ...process.env }',
      api: 'env.toObject',
      need: P,
    }));
    token(/Deno\.args\b/, () => ({ text: 'process.argv.slice(2)', api: 'args', need: P }));
    token(/Deno\.build\.os\s*===\s*'windows'/, () => ({
      text: "process.platform === 'win32'",
      api: 'build.os',
      need: P,
    }));
    token(/Deno\.build\.os\s*!==\s*'windows'/, () => ({
      text: "process.platform !== 'win32'",
      api: 'build.os',
      need: P,
    }));

    const F = (names: string[]): Partial<Need> => ({ fsPromises: names });
    const S = (names: string[]): Partial<Need> => ({ fsSync: names });
    const T = (names: string[]): Partial<Need> => ({ fsPromises: names, tmpdir: true, join: true });

    call(/Deno\.readTextFile\s*\(/, (a) => ({
      text: `readFile(${a[0]}, 'utf8')`,
      api: 'readTextFile',
      need: F(['readFile']),
    }));
    call(/Deno\.readFile\s*\(/, (a) => ({
      text: `readFile(${a.join(', ')})`,
      api: 'readFile',
      need: F(['readFile']),
    }));
    call(/Deno\.writeFile\s*\(/, (a) => ({
      text: `writeFile(${a.join(', ')})`,
      api: 'writeFile',
      need: F(['writeFile']),
    }));
    call(/Deno\.writeTextFile\s*\(/, (a) => ({
      text: `writeFile(${a.join(', ')})`,
      api: 'writeTextFile',
      need: F(['writeFile']),
    }));
    call(/Deno\.remove\s*\(/, (a) => ({
      text: `rm(${a.join(', ')})`,
      api: 'remove',
      need: F(['rm']),
    }));
    call(/Deno\.mkdir\s*\(/, (a) => ({
      text: `mkdir(${a.join(', ')})`,
      api: 'mkdir',
      need: F(['mkdir']),
    }));
    call(/Deno\.makeTempDir\s*\(/, (a) => ({
      text: `mkdtemp(join(tmpdir(), ${prefixOf(a)}))`,
      api: 'makeTempDir',
      need: T(['mkdtemp']),
    }));
    call(/Deno\.stat\s*\(/, (a) => ({
      text: `stat(${a.join(', ')})`,
      api: 'stat',
      need: F(['stat']),
    }));
    call(/Deno\.lstat\s*\(/, (a) => ({
      text: `lstat(${a.join(', ')})`,
      api: 'lstat',
      need: F(['lstat']),
    }));
    call(/Deno\.copyFile\s*\(/, (a) => ({
      text: `copyFile(${a.join(', ')})`,
      api: 'copyFile',
      need: F(['copyFile']),
    }));
    call(/Deno\.rename\s*\(/, (a) => ({
      text: `rename(${a.join(', ')})`,
      api: 'rename',
      need: F(['rename']),
    }));
    call(/Deno\.symlink\s*\(/, (a) => ({
      text: `symlink(${a.join(', ')})`,
      api: 'symlink',
      need: F(['symlink']),
    }));
    call(/Deno\.realPath\s*\(/, (a) => ({
      text: `realpath(${a.join(', ')})`,
      api: 'realPath',
      need: F(['realpath']),
    }));

    call(/Deno\.readTextFileSync\s*\(/, (a) => ({
      text: `readFileSync(${a[0]}, 'utf8')`,
      api: 'readTextFileSync',
      need: S(['readFileSync']),
    }));
    call(/Deno\.writeTextFileSync\s*\(/, (a) => ({
      text: `writeFileSync(${a.join(', ')})`,
      api: 'writeTextFileSync',
      need: S(['writeFileSync']),
    }));
    call(/Deno\.mkdirSync\s*\(/, (a) => ({
      text: `mkdirSync(${a.join(', ')})`,
      api: 'mkdirSync',
      need: S(['mkdirSync']),
    }));
    call(/Deno\.removeSync\s*\(/, (a) => ({
      text: `rmSync(${a.join(', ')})`,
      api: 'removeSync',
      need: S(['rmSync']),
    }));
    call(/Deno\.statSync\s*\(/, (a) => ({
      text: `statSync(${a.join(', ')})`,
      api: 'statSync',
      need: S(['statSync']),
    }));
    call(/Deno\.chmodSync\s*\(/, (a) => ({
      text: `chmodSync(${a.join(', ')})`,
      api: 'chmodSync',
      need: S(['chmodSync']),
    }));
    call(/Deno\.realPathSync\s*\(/, (a) => ({
      text: `realpathSync(${a.join(', ')})`,
      api: 'realPathSync',
      need: S(['realpathSync']),
    }));
    call(/Deno\.makeTempDirSync\s*\(/, (a) => ({
      text: `mkdtempSync(join(tmpdir(), ${prefixOf(a)}))`,
      api: 'makeTempDirSync',
      need: { fsSync: new Set(['mkdtempSync']), tmpdir: true, join: true },
    }));

    const importEdits = buildImportEdits(src, need, stats);
    const all = [...edits, ...importEdits].sort((a, b) => a.start - b.start);
    for (let k = 1; k < all.length; k++) {
      if (all[k]!.start < all[k - 1]!.end) throw new SkipFile('manual: overlapping rewrites');
    }
    let out = src;
    for (let k = all.length - 1; k >= 0; k--) {
      const e = all[k]!;
      out = out.slice(0, e.start) + e.replacement + out.slice(e.end);
    }

    // audit: no mechanical-surface Deno API survives in code regions
    // (`Deno.test` is codemod #1's registration surface and is not this
    // script's concern — files awaiting their manual registration conversion
    // legitimately still carry it)
    const outRegions = scanRegions(out);
    const outCodeAt = regionTester(outRegions);
    for (const mm of out.matchAll(/\bDeno\.([A-Za-z_]+)/g)) {
      if (outCodeAt(mm.index) && !MANUAL_APIS.has(mm[1]!) && mm[1] !== 'test') {
        throw new SkipFile(`manual: Deno.${mm[1]} survived the rewrite`);
      }
    }
    if (!DRY) fs.writeFileSync(filePath, out);
    return stats;
  } catch (error) {
    if (error instanceof SkipFile) {
      stats.notes.push(error.message);
      stats.skipped = true;
      return stats;
    }
    throw error;
  }
}

/** Extract the prefix expression from a Deno.makeTempDir([{prefix: P}]) arg list. */
function prefixOf(args: string[]): string {
  if (args.length === 0 || args[0] === '') return "''";
  const km = /^\{\s*prefix\s*:\s*([\s\S]+?)\s*\}$/.exec(args[0]!);
  if (!km) throw new SkipFile(`manual: makeTempDir arg ${args[0]!.slice(0, 40)}`);
  return km[1]!;
}

function buildImportEdits(src: string, need: Need, stats: FileStats): Edit[] {
  const edits: Edit[] = [];
  if (
    need.fsPromises.size === 0 &&
    need.fsSync.size === 0 &&
    !need.process &&
    !need.join &&
    !need.tmpdir
  ) {
    return edits;
  }
  const codeAt = regionTester(scanRegions(src));
  const importRe = /import\s*(?:\{([^}]*)\}|(\w+))\s*from\s*(['"])(node:[a-z/]+)\3\s*;\n/g;
  const covered = new Map<
    string,
    { start: number; end: number; names: Set<string>; defaultName: string | null }
  >();
  let m: RegExpExecArray | null;
  while ((m = importRe.exec(src))) {
    if (!codeAt(m.index)) continue;
    covered.set(m[4]!, {
      start: m.index,
      end: m.index + m[0].length,
      names: new Set(
        (m[1] ?? '')
          .split(',')
          .map((n) => n.trim())
          .filter(Boolean),
      ),
      defaultName: m[2] ?? null,
    });
  }
  const wanted: Array<[string, Set<string> | null, string | null]> = [];
  if (need.fsPromises.size > 0) wanted.push(['node:fs/promises', need.fsPromises, null]);
  if (need.fsSync.size > 0) wanted.push(['node:fs', need.fsSync, null]);
  if (need.tmpdir) wanted.push(['node:os', new Set(['tmpdir']), null]);
  if (need.join) wanted.push(['node:path', new Set(['join']), null]);
  // node:process exports DEFAULT process — never a named { process }
  if (need.process) wanted.push(['node:process', null, 'process']);

  const insertions: string[] = [];
  for (const [spec, names, defaultName] of wanted) {
    const existing = covered.get(spec);
    if (existing) {
      const missing = names ? [...names].filter((n) => !existing.names.has(n)) : [];
      const needsDefault = defaultName !== null && existing.defaultName === null;
      if (missing.length === 0 && !needsDefault) continue;
      if (existing.defaultName !== null && defaultName !== null) continue; // default already present
      const mergedNames = [...new Set([...existing.names, ...missing])].sort();
      const parts: string[] = [];
      if (defaultName !== null || existing.defaultName !== null) {
        parts.push(defaultName ?? existing.defaultName!);
      }
      if (mergedNames.length > 0) parts.push(`{ ${mergedNames.join(', ')} }`);
      edits.push({
        start: existing.start,
        end: existing.end,
        replacement: `import ${parts.join(', ')} from '${spec}';\n`,
      });
      stats.importsAdded++;
    } else {
      insertions.push(
        defaultName !== null
          ? `import ${defaultName} from '${spec}';`
          : `import { ${[...names!].sort().join(', ')} } from '${spec}';`,
      );
      stats.importsAdded++;
    }
  }
  if (insertions.length > 0) {
    const firstImport = /^import\b/m.exec(src);
    if (firstImport && codeAt(firstImport.index)) {
      const lineStart = src.lastIndexOf('\n', firstImport.index) + 1;
      edits.push({ start: lineStart, end: lineStart, replacement: `${insertions.join('\n')}\n` });
    } else {
      edits.push({ start: 0, end: 0, replacement: `${insertions.join('\n')}\n` });
    }
  }
  return edits;
}

function walk(dir: string, out: string[]): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!EXCLUDED_DIRS.has(entry.name)) walk(full, out);
      continue;
    }
    if (!EXTENSIONS.has(path.extname(entry.name))) continue;
    out.push(full);
  }
}

function main(): void {
  const files: string[] = [];
  for (const root of ROOTS) walk(path.resolve(root), files);

  const results: FileStats[] = [];
  for (const file of files) {
    const rel = path.relative('.', file);
    if (EXCLUDED_PATH_PATTERNS.some((match) => match(rel))) continue;
    let stats: FileStats | null = null;
    try {
      stats = transformFile(file, rel);
    } catch (error) {
      console.error(`FAILED on ${rel}:`, error);
      process.exitCode = 1;
      return;
    }
    if (stats !== null) results.push(stats);
  }

  const changed = results.filter((r) => !r.skipped);
  const manual = results.filter((r) => r.skipped);
  const totalRewrites = changed.reduce(
    (s, r) => s + Object.values(r.rewrites).reduce((a, b) => a + b, 0),
    0,
  );

  console.log(`codemod-deno-runtime-to-node ${DRY ? '(dry)' : '(applied)'}`);
  console.log(
    `scanned ${files.length} files · ${results.length} candidates (code-region Deno.*) · ` +
      `${changed.length} transformed (${totalRewrites} rewrites) · ${manual.length} manual-batch`,
  );

  console.log(`\n── per-file transform stats (${changed.length}) ──`);
  for (const r of changed) {
    const rw = Object.entries(r.rewrites)
      .map(([k, v]) => `${k}×${v}`)
      .join(' ');
    console.log(`  ${r.file}  ${rw}${r.importsAdded ? `  imports+${r.importsAdded}` : ''}`);
  }

  console.log(`\n── manual batch (${manual.length}) ──`);
  for (const r of manual) {
    console.log(`  ${r.file}`);
    for (const note of r.notes) console.log(`    - ${note}`);
  }

  if (DRY) console.log('\n(dry run — nothing written)');
}

const invokedDirectly = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (invokedDirectly) main();
