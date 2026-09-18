/**
 * Content gate: one discovery pass over the authored Markdown, two
 * invariants. Every fenced `@openelement/*` named import must resolve
 * against the generated export inventory (no broken teaching imports), and
 * every TypeScript/JavaScript fence in the maintained authoring surface
 * must type-check against the real framework sources (#1159, B2.4;
 * hardened #1307). Merging the import inventory into this entry keeps the
 * fence parser, the content walk, and the diagnostics in one place; the
 * former standalone content-imports checker is retired.
 *
 * Type-check scope and suppression: see below.
 *
 * (Original) Content example type-check gate: TypeScript
 * fenced code blocks in the authored bilingual guides that import
 * `@openelement/*` must type-check against the real v0.44 framework sources.
 * zh duplicates of an en block are deduped by content. Fails closed with
 * compiler diagnostics.
 *
 * Fence policy (#1307): ```ts, ```tsx and the ```typescript alias are
 * type-checked; ```js/```javascript fences that import `@openelement/*` are
 * checked too (compiled as TS — JavaScript snippets must be valid TypeScript
 * syntax), so the alias can no longer smuggle an unchecked framework example
 * past the gate.
 *
 * Blog exclusion (#1307 adjudication): www/content/blog is deliberately NOT
 * type-checked. Dispatches are dated historical records — their snippets
 * document the API surface of their era (LessJS-era names, since-removed
 * packages) and stay truthful as history, not as current authoring guidance.
 * The maintained authoring surface is guide/architecture, and it is fully
 * covered. The checked directory list is explicit below so widening the
 * surface is a deliberate edit.
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
import { fromFileUrl, join } from '@std/path';
import { walk } from '@std/fs/walk';
import { readPackages } from '../../tools/lib/package-graph.ts';
import { apiReference } from '../app/data/_generated-api-reference.ts';

const repoRoot = fromFileUrl(new URL('../../', import.meta.url));

/** The maintained authoring surface; blog is excluded deliberately (header). */
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

const FENCE_PATTERN = /```(ts|tsx|typescript|javascript|js)\n([\s\S]*?)```/g;

/** Fence discovery for import validation; language label is optional. */
const ANY_FENCE = /```(?:ts|tsx|js|javascript|typescript)?[^\S\n]*\n([\s\S]*?)```/g;

const NAMED_IMPORT =
  /import\s+(?:type\s+)?(?:[A-Za-z_$][\w$]*\s*,\s*)?\{([^}]*)\}\s*from\s*['"](@openelement\/[^'"]+)['"]/g;

/** Every `@openelement/*` specifier the generated inventory knows. */
function frameworkImportInventory(): Map<string, Set<string>> {
  const inventory = new Map<string, Set<string>>();
  for (const pkg of apiReference.packages) {
    for (const subpath of pkg.subpaths) {
      const specifier = subpath.subpath === '.'
        ? pkg.name
        : `${pkg.name}/${subpath.subpath.replace(/^\.\//, '')}`;
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
        const name = raw.replace(/^\s*type\s+/, '').split(/\s+as\s+/)[0].trim();
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

/** Build a paths map resolving workspace @openelement/* specifiers to files. */
export async function workspacePaths(): Promise<Record<string, string[]>> {
  const paths: Record<string, string[]> = {};
  for (const pkg of await readPackages()) {
    const entries = typeof pkg.exports === 'string'
      ? { '.': pkg.exports }
      : (pkg.exports ?? {}) as Record<string, string>;
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
  await Deno.mkdir(tmpRoot, { recursive: true });
  const dir = await Deno.makeTempDir({ dir: tmpRoot, prefix: 'content-examples-' });
  try {
    // Project-shape side-effect imports (`import './components/x.tsx'`) name
    // files of the reader's project, not the docs tree: retarget them at an
    // empty stub so teaching examples check the framework usage, not the
    // reader's filesystem. Value imports (`from './x'`) are left alone and
    // still fail closed when unresolvable.
    await Deno.writeTextFile(`${dir}/__project_shape_stub.ts`, 'export {};\n');
    const files: string[] = [];
    for (const [index, example] of examples.entries()) {
      const name = `example-${index}.${example.lang}`;
      const code = example.code.replaceAll(
        /(^|\n)\s*import\s*(['"])\.[^'"]*\2\s*;?/g,
        (_, prefix, quote) => `${prefix}import ${quote}./__project_shape_stub.ts${quote};`,
      );
      await Deno.writeTextFile(`${dir}/${name}`, code);
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
          message: `TS${diagnostic.code} at line ${(position?.line ?? 0) + 1}: ${
            ts.flattenDiagnosticMessageText(diagnostic.messageText, ' ')
          }`,
        });
      }
    }
    return failures;
  } finally {
    await Deno.remove(dir, { recursive: true });
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
}

export async function checkContent(): Promise<ContentGateResult> {
  const inventory = frameworkImportInventory();
  const importFailures: ExampleFailure[] = [];
  const seen = new Set<string>();
  const examples: ContentExample[] = [];
  // One walk over the whole content tree: import validation applies to every
  // fence anywhere under www/content; type-checking applies to the
  // maintained authoring surface only.
  for await (
    const entry of walk(join(repoRoot, 'www/content'), {
      includeDirs: false,
      exts: ['.md', '.mdx'],
    })
  ) {
    const markdown = await Deno.readTextFile(entry.path);
    importFailures.push(...validateFrameworkImports(entry.path, markdown, inventory));
    if (!CHECKED_CONTENT_DIRS.some((dir) => entry.path.startsWith(join(repoRoot, dir)))) continue;
    for (const example of extractExamples(entry.path, markdown)) {
      // en/zh translations carry identical code — check each block once.
      if (seen.has(example.code)) continue;
      seen.add(example.code);
      examples.push(example);
    }
  }
  return { importFailures, exampleFailures: await typeCheckExamples(examples) };
}

if (import.meta.main) {
  const { importFailures, exampleFailures } = await checkContent();
  if (importFailures.length > 0) {
    console.error('Content import check failed:');
    for (const failure of importFailures) {
      console.error(`- ${failure.file}: ${failure.message}`);
    }
  }
  if (exampleFailures.length > 0) {
    console.error('Content example type-check failed:');
    for (const failure of exampleFailures) {
      console.error(`- ${failure.file}: ${failure.message}`);
    }
  }
  if (importFailures.length > 0 || exampleFailures.length > 0) Deno.exit(1);
  console.log('Content gate passed (imports resolved, examples type-checked).');
}
