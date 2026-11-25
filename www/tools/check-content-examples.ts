/**
 * Content gate: one discovery pass over the authored Markdown, three
 * invariants. Every fenced `@openelement/*` named import must resolve
 * against the generated export inventory (no broken teaching imports), every
 * TypeScript/JavaScript fence in the maintained authoring surface must
 * type-check against the real framework sources (#1159, B2.4; hardened
 * #1307), and every fence that authors a COMPILED unit must actually compile
 * through the real compiler (the docs-bug gate: a recipe the reader copies
 * must build). Merging the import inventory into this entry keeps the fence
 * parser, the content walk, and the diagnostics in one place; the former
 * standalone content-imports checker is retired.
 *
 * Compile invariant (fail closed): a fence is admitted by the same two
 * admission bridges the real build uses — the generated-element compiler,
 * then `compileServerComponentIfAdmitted`
 * for a server-function page module — with the router's own island sidecar
 * (`ISLAND_ADMISSION`, so `export const openElement = defineIslandConfig(…)`
 * is admitted exactly as in an app). An OEC diagnostic fails the gate with
 * the compiler's own boundary+fix message, so a documented recipe cannot rot
 * into "does not build". De-duplication is by fence bytes (the en/zh pairs
 * carry identical code).
 *
 * Fragment rule: a fence that is not a whole compiled unit (a JSX snippet, a
 * `render()` body excerpt, an options object, a config block) is exactly the
 * fence where BOTH admission bridges answer null — that is the compiler's
 * own module boundary, never a heuristic here. Such fences stay covered by
 * the type-check invariant and are not compile-run.
 *
 * Documented-rejection exclusion (deliberate, small, per-page): the grammar
 * reference (`compiled-grammar.md` + its `.zh.md` mirror) intentionally prints
 * REJECTED forms next to the admitted ones; a whole-page compile run cannot
 * tell a teaching-negative fence from a teaching-positive one, and the
 * admitted forms on that page are covered by the compiler's own suites. No
 * other page is excluded — a page that merely shows real code is a bug when
 * the compiler refuses it, not an exclusion.
 *
 * Type-check scope and suppression: see below.
 *
 * (Original) Content example type-check gate: TypeScript
 * fenced code blocks in the authored bilingual guides that import
 * `@openelement/*` must type-check against the current framework sources.
 * zh duplicates of an en block are deduped by content. Fails closed with
 * compiler diagnostics.
 *
 * Fence policy (#1307): ```ts, ```tsx and the ```typescript alias are
 * type-checked; ```js/```javascript fences that import `@openelement/*` are
 * checked too (compiled as TS — JavaScript snippets must be valid TypeScript
 * syntax), so the alias can no longer smuggle an unchecked framework example
 * past the gate. Fence openers also tolerate trailing whitespace/CRLF after the
 * language token; spacing never silently removes a fence from the checked set.
 *
 * Elision convention: guide snippets are written as consumer-project modules
 * and legitimately omit application context. The harness therefore suppresses
 * only the diagnostics that express that elision — unresolved non-framework
 * module specifiers (TS2307 outside `@openelement/*`; the virtual
 * `@openelement/generated/*` namespace is adapter-generated consumer code),
 * undefined names from elided app code (TS2304 — but NOT when the undefined
 * name is a documented framework export: an import-elided snippet calling a
 * framework function must import it, so wrong-argument calls against the
 * real API stay visible, #1307), implicit-any (TS7006) and property access on
 * the uninferred loader-data generic (TS2339 on `{}`). Everything on the
 * framework surface — unknown `@openelement` modules or exports,
 * argument/assignability errors against real APIs, syntax and JSX errors —
 * fails the gate.
 */
import ts from 'typescript';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readPackages } from '../../tools/lib/package-graph.ts';
import { apiReference } from '../app/data/_generated-api-reference.ts';
import {
  compileGeneratedElementIfAdmitted,
  compileServerComponentIfAdmitted,
} from '../../packages/compiler/src/compiler.ts';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import process from 'node:process';

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));

/** The maintained authoring surface. */
const CHECKED_CONTENT_DIRS = ['www/content/docs/guide', 'www/content/docs/architecture'];

/** Every documented framework export + custom-element class name. */
function frameworkExportNames(): ReadonlySet<string> {
  const names = new Set<string>();
  for (const pkg of apiReference.packages) {
    for (const subpath of pkg.subpaths) {
      for (const exported of subpath.exports) names.add(exported.name);
    }
  }
  for (const element of apiReference.elements) names.add(element.className);
  return names;
}

export interface ExampleFailure {
  file: string;
  message: string;
}

export interface ContentExample {
  /** First source document the block was found in. */
  file: string;
  index: number;
  lang: string;
  code: string;
}

// Trailing whitespace and CRLF after the language token are tolerated: a fence
// opener must never be skipped silently for spacing, which would turn an
// unchecked example into an apparent pass.
const FENCE_PATTERN = /```(ts|tsx|typescript|javascript|js)[^\S\n]*\n([\s\S]*?)```/g;

/** Fence discovery for import validation; language label is optional. */
const ANY_FENCE = /```(?:ts|tsx|js|javascript|typescript)?[^\S\n]*\n([\s\S]*?)```/g;

/**
 * Authoring-pattern tripwires (#1522 C1): two teaching-example shapes that
 * regress real framework behavior are banned outright in the maintained
 * authoring surface. (1) A `render()` body that declares a local before its
 * return — compiled render methods are a single return expression; derived
 * values belong in `computed()` fields or module scope. (2) A hand-rolled
 * `.replace('{placeholder}', …)` over a message pattern — plural/select
 * rules live inside the ICU pattern, and only a real formatter
 * (intl-messageformat, paraglide, …) can apply them.
 */
const RENDER_LOCAL_DECLARATION =
  /render\s*\(\s*\)\s*(?::[^{=;]*)?\{(?:(?!\breturn\b)[^}])*\b(?:const|let)\s/;
const ICU_MANUAL_REPLACE = /\.\s*replace\s*\(\s*(['"`])\s*\{/;

/** Scan one document's type-checked fences for the banned authoring shapes. */
export function validateAuthoringPatterns(file: string, markdown: string): ExampleFailure[] {
  const failures: ExampleFailure[] = [];
  for (const fence of markdown.matchAll(FENCE_PATTERN)) {
    const code = fence[2];
    if (RENDER_LOCAL_DECLARATION.test(code)) {
      failures.push({
        file,
        message:
          'render() declares a local before its return — keep render() a single return ' +
          'expression; derive values with computed() fields or module scope',
      });
    }
    if (ICU_MANUAL_REPLACE.test(code)) {
      failures.push({
        file,
        message:
          "a .replace('{…}') unpacks a message pattern by hand — pass the pattern and its " +
          'arguments to a real formatter (intl-messageformat, paraglide, …)',
      });
    }
  }
  return failures;
}

const NAMED_IMPORT =
  /import\s+(?:type\s+)?(?:[A-Za-z_$][\w$]*\s*,\s*)?\{([^}]*)\}\s*from\s*['"](@openelement\/[^'"]+)['"]/g;

/** Every `@openelement/*` specifier the generated inventory knows. */
function frameworkImportInventory(): Map<string, Set<string>> {
  const inventory = new Map<string, Set<string>>();
  for (const pkg of apiReference.packages) {
    for (const subpath of pkg.subpaths) {
      const specifier =
        subpath.subpath === '.' ? pkg.name : `${pkg.name}/${subpath.subpath.replace(/^\.\//, '')}`;
      inventory.set(specifier, new Set(subpath.exports.map((item) => item.name)));
    }
  }
  return inventory;
}

/** Validate every named framework import in the document's fences. */
export function validateFrameworkImports(
  file: string,
  markdown: string,
  inventory: Map<string, Set<string>> = frameworkImportInventory(),
): ExampleFailure[] {
  const failures: ExampleFailure[] = [];
  for (const fence of markdown.matchAll(ANY_FENCE)) {
    for (const statement of fence[1].matchAll(NAMED_IMPORT)) {
      const specifier = statement[2];
      const known = inventory.get(specifier);
      if (!known) {
        failures.push({ file, message: `unknown @openelement subpath '${specifier}'` });
        continue;
      }
      for (const raw of statement[1].split(',')) {
        // `type X` inline modifiers and `X as Y` aliases resolve to X.
        const name = raw
          .replace(/^\s*type\s+/, '')
          .split(/\s+as\s+/)[0]
          .trim();
        if (!name) continue;
        if (!known.has(name)) {
          failures.push({ file, message: `'${name}' is not exported from '${specifier}'` });
        }
      }
    }
  }
  return failures;
}

/** Normalize fence aliases; js/javascript are checked as TypeScript (header). */
function normalizeFenceLang(lang: string): string {
  if (lang === 'typescript') return 'ts';
  if (lang === 'javascript' || lang === 'js') return 'ts';
  return lang;
}

/** Extract unique fenced blocks that import @openelement packages. */
export function extractExamples(file: string, markdown: string): ContentExample[] {
  const examples: ContentExample[] = [];
  for (const match of markdown.matchAll(FENCE_PATTERN)) {
    const code = match[2];
    if (!code.includes('@openelement/')) continue;
    examples.push({ file, index: examples.length, lang: normalizeFenceLang(match[1]), code });
  }
  return examples;
}

/**
 * Pages that intentionally document rejected grammar (see the header): the
 * ONLY compile-run exclusions. Keep this list per-page and rationale-bearing;
 * growing it to hide a real docs bug is exactly the regression this gate
 * exists to catch.
 */
export const COMPILE_EXCLUDED_PAGES: ReadonlyMap<string, string> = new Map([
  [
    'www/content/docs/guide/compiled-grammar.md',
    'the grammar reference prints rejected forms beside the admitted ones; ' +
      'admitting whole-page fences would either wave the rejected forms through or ' +
      'bury the admitted examples, and the admitted forms are pinned by the compiler suites',
  ],
  [
    'www/content/docs/guide/compiled-grammar.zh.md',
    'zh mirror of the grammar reference (same rationale)',
  ],
]);

/**
 * True when this example's page is an explicit documented-rejection page.
 *
 * The content walk hands ABSOLUTE paths (it readdir()s an absolute root), while
 * the allowlist is written with repo-relative keys. Accept both spellings: a
 * plain map lookup silently missed every walked page, so the documented
 * exclusion was unreachable and only the tests — which pass relative fixture
 * names — saw it work.
 */
export function isCompileExcluded(file: string): boolean {
  if (COMPILE_EXCLUDED_PAGES.has(file)) return true;
  return COMPILE_EXCLUDED_PAGES.has(relative(repoRoot, file));
}

/** The compiler options the real build passes: the router's island sidecar. */

/** One fence's virtual module id; the compiler derives diagnostics/source maps from it. */
function virtualExampleId(example: ContentExample, index: number): string {
  return `${example.file}#fence-${index + 1}.tsx`;
}

/** Extract coded compiler diagnostics from a failed admission bridge. */
function compilerDiagnostics(error: unknown): Array<{ code: string; message: string }> {
  const diagnostics = (error as { diagnostics?: Array<{ code?: unknown; message?: unknown }> })
    .diagnostics;
  if (!Array.isArray(diagnostics)) return [];
  return diagnostics.map((diagnostic) => ({
    code: typeof diagnostic.code === 'string' ? diagnostic.code : 'OEC????',
    message: typeof diagnostic.message === 'string' ? diagnostic.message : String(diagnostic),
  }));
}

/**
 * Run one example fence through the real compiler admission bridges. Returns
 * the failures the build would report; [] means the fence is either a valid
 * compiled unit or the compiler's own module boundary rejected it as a
 * fragment (null from both bridges), which the type-check invariant covers.
 */
export function compileExample(example: ContentExample): ExampleFailure[] {
  if (isCompileExcluded(example.file)) return [];
  const id = virtualExampleId(example, example.index);
  try {
    // The GENERATED lane (Alpha16 retired the class lane): a documented example that
    // declares a sidecar is admitted by the same entry the build's transform uses.
    // The tag comes from the AUTHORED sidecar — the entry needs one, and a documented
    // example pins its own; an example without one is not a component and contributes
    // no verdict here, exactly as the class bridge answered for a non-class module.
    const declaredTag = /defineIslandConfig\(\{[^}]*\btag:\s*'([^']+)'/.exec(example.code)?.[1];
    if (
      declaredTag !== undefined &&
      compileGeneratedElementIfAdmitted(example.code, id, { site: { tag: declaredTag } }) !== null
    ) {
      return [];
    }
    if (compileServerComponentIfAdmitted(example.code, id) !== null) return [];
    return [];
  } catch (error) {
    const diagnostics = compilerDiagnostics(error);
    if (diagnostics.length === 0) {
      return [{ file: example.file, message: `example failed to compile: ${String(error)}` }];
    }
    return diagnostics.map((diagnostic) => ({
      file: `${example.file} (block ${example.index + 1})`,
      message: `${diagnostic.code}: ${diagnostic.message}`,
    }));
  }
}

/** Compile-run every maintained-surface example fence (fail closed on OEC diagnostics). */
export function compileExamples(examples: ContentExample[]): ExampleFailure[] {
  return examples.flatMap((example) => compileExample(example));
}

/** Build a paths map resolving workspace @openelement/* specifiers to files. */
export async function workspacePaths(): Promise<Record<string, string[]>> {
  const paths: Record<string, string[]> = {};
  for (const pkg of await readPackages()) {
    const entries =
      typeof pkg.exports === 'string'
        ? { '.': pkg.exports }
        : ((pkg.exports ?? {}) as Record<string, string>);
    for (const [key, target] of Object.entries(entries)) {
      if (typeof target !== 'string') continue;
      const specifier = key === '.' ? pkg.name : `${pkg.name}/${key.replace(/^\.\//, '')}`;
      paths[specifier] = [`${pkg.dir}/${target.replace(/^\.\//, '')}`];
    }
  }
  return paths;
}

/**
 * Type-check the given example blocks against the real framework. Each block
 * is compiled as its own module in one shared program so diagnostics carry
 * the example's virtual file name.
 */
export async function typeCheckExamples(examples: ContentExample[]): Promise<ExampleFailure[]> {
  if (examples.length === 0) return [];
  // The temp dir must live inside the workspace so node_modules resolution
  // (vite, preact, ...) walks up to the repo's dependencies; `.tmp` is
  // gitignored, so create it first (clean CI checkouts do not carry it).
  const tmpRoot = join(repoRoot, '.tmp');
  await mkdir(tmpRoot, { recursive: true });
  const dir = await mkdtemp(join(tmpRoot, 'content-examples-'));
  try {
    // Project-shape side-effect imports (`import './components/x.tsx'`) name
    // files of the reader's project, not the docs tree: retarget them at an
    // empty stub so teaching examples check the framework usage, not the
    // reader's filesystem. Value imports (`from './x'`) are left alone and
    // still fail closed when unresolvable.
    await writeFile(`${dir}/__project_shape_stub.ts`, 'export {};\n');
    const files: string[] = [];
    for (const [index, example] of examples.entries()) {
      const name = `example-${index}.${example.lang}`;
      const code = example.code.replaceAll(
        /(^|\n)\s*import\s*(['"])\.[^'"]*\2\s*;?/g,
        (_, prefix, quote) => `${prefix}import ${quote}./__project_shape_stub.ts${quote};`,
      );
      await writeFile(`${dir}/${name}`, code);
      files.push(`${dir}/${name}`);
    }
    const paths = await workspacePaths();
    const options: ts.CompilerOptions = {
      allowImportingTsExtensions: true,
      experimentalDecorators: true,
      jsx: ts.JsxEmit.ReactJSX,
      jsxImportSource: '@openelement/element',
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      noEmit: true,
      skipLibCheck: true,
      strict: true,
      target: ts.ScriptTarget.ESNext,
      baseUrl: repoRoot,
      paths,
      // Doc snippets are teaching material, not shippable modules: unused
      // locals and missing return-type annotations are not defects there.
      noUnusedLocals: false,
      noUnusedParameters: false,
    };
    const program = ts.createProgram(files, options);
    const failures: ExampleFailure[] = [];
    for (const [index, file] of files.entries()) {
      const source = program.getSourceFile(file);
      if (!source) {
        failures.push({ file: examples[index].file, message: 'example failed to parse' });
        continue;
      }
      const diagnostics = [
        ...program.getSyntacticDiagnostics(source),
        ...program.getSemanticDiagnostics(source),
      ];
      for (const diagnostic of diagnostics) {
        if (suppressElidedDiagnostic(diagnostic)) continue;
        const position = diagnostic.file?.getLineAndCharacterOfPosition(diagnostic.start ?? 0);
        failures.push({
          file: `${examples[index].file} (block ${examples[index].index + 1})`,
          message: `TS${diagnostic.code} at line ${(position?.line ?? 0) + 1}: ${ts.flattenDiagnosticMessageText(
            diagnostic.messageText,
            ' ',
          )}`,
        });
      }
    }
    return failures;
  } finally {
    await rm(dir, { recursive: true });
  }
}

/**
 * Elided-context suppression (see the module header): returns true only for
 * diagnostics that express documented snippet elision, never framework-surface
 * errors.
 */
export function suppressElidedDiagnostic(
  diagnostic: ts.Diagnostic,
  frameworkNames: ReadonlySet<string> = frameworkExportNames(),
): boolean {
  const text = ts.flattenDiagnosticMessageText(diagnostic.messageText, ' ');
  if (diagnostic.code === 2307) {
    // Unresolved module: only framework modules are harness truth. The
    // `@openelement/generated/*` namespace is adapter-emitted consumer code.
    if (/Cannot find module '@openelement\/(?!generated\/)/.test(text)) return false;
    return true;
  }
  // Undefined names from elided application code — but never a documented
  // framework export: those must be imported so calls are checked (#1307).
  if (diagnostic.code === 2304) {
    const name = text.match(/Cannot find name '([^']+)'/)?.[1];
    if (name !== undefined && frameworkNames.has(name)) return false;
    return true;
  }
  // Implicit-any in teaching snippets.
  if (diagnostic.code === 7006) return true;
  // Property access on the uninferred loader-data generic (`{}`).
  if (diagnostic.code === 2339 && text.includes(`on type '{}'`)) return true;
  return false;
}

export interface ContentGateResult {
  importFailures: ExampleFailure[];
  exampleFailures: ExampleFailure[];
  patternFailures: ExampleFailure[];
  compileFailures: ExampleFailure[];
}

export async function checkContent(): Promise<ContentGateResult> {
  const inventory = frameworkImportInventory();
  const importFailures: ExampleFailure[] = [];
  const patternFailures: ExampleFailure[] = [];
  const seen = new Set<string>();
  const examples: ContentExample[] = [];
  // One walk over the whole content tree: import validation applies to every
  // fence anywhere under www/content; type-checking and the authoring-pattern
  // tripwires apply to the maintained authoring surface only.
  for (const entry of await readdir(join(repoRoot, 'www/content'), {
    recursive: true,
    withFileTypes: true,
  })) {
    if (entry.isDirectory() || (!entry.name.endsWith('.md') && !entry.name.endsWith('.mdx'))) {
      continue;
    }
    const entryPath = `${entry.parentPath}/${entry.name}`;
    const markdown = await readFile(entryPath, 'utf8');
    importFailures.push(...validateFrameworkImports(entryPath, markdown, inventory));
    if (!CHECKED_CONTENT_DIRS.some((dir) => entryPath.startsWith(join(repoRoot, dir)))) continue;
    patternFailures.push(...validateAuthoringPatterns(entryPath, markdown));
    for (const example of extractExamples(entryPath, markdown)) {
      // en/zh translations carry identical code — check each block once.
      if (seen.has(example.code)) continue;
      seen.add(example.code);
      examples.push(example);
    }
  }
  return {
    importFailures,
    patternFailures,
    exampleFailures: await typeCheckExamples(examples),
    compileFailures: compileExamples(examples),
  };
}

if (import.meta.main) {
  const { importFailures, patternFailures, exampleFailures, compileFailures } =
    await checkContent();
  if (importFailures.length > 0) {
    console.error('Content import check failed:');
    for (const failure of importFailures) {
      console.error(`- ${failure.file}: ${failure.message}`);
    }
  }
  if (patternFailures.length > 0) {
    console.error('Content authoring-pattern check failed:');
    for (const failure of patternFailures) {
      console.error(`- ${failure.file}: ${failure.message}`);
    }
  }
  if (exampleFailures.length > 0) {
    console.error('Content example type-check failed:');
    for (const failure of exampleFailures) {
      console.error(`- ${failure.file}: ${failure.message}`);
    }
  }
  if (compileFailures.length > 0) {
    console.error('Content example compile failed (the documented code does not build):');
    for (const failure of compileFailures) {
      console.error(`- ${failure.file}: ${failure.message}`);
    }
  }
  if (
    importFailures.length > 0 ||
    patternFailures.length > 0 ||
    exampleFailures.length > 0 ||
    compileFailures.length > 0
  ) {
    process.exit(1);
  }
  console.log(
    'Content gate passed (imports resolved, authoring patterns clean, examples type-checked ' +
      'and compiled).',
  );
}
