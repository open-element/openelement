/**
 * Error-code catalog generator (#1413 W3, P6: the code table is a derived
 * artifact).
 *
 * The `/errors` page must not carry a hand-written code list: a table that is
 * typed by hand rots the moment a compiler diagnostic is renamed, added or
 * removed, and nothing fails. This generator derives the catalog from the
 * definitions themselves:
 *
 *   compiler diagnostics — every `fail(node, 'OEC9xxx', message)` and every
 *     `{ code: 'OEC9xxx', message }` literal in the semantic core, read with
 *     the TypeScript AST. Each code keeps its first authored message (template
 *     placeholders become `…`) as its representative text, its source
 *     file/line, and how many sites raise it.
 *   authoring codes — imported from the router's error-code maps
 *     (`internal/error-codes.ts`), which are the constants the throws use.
 *   runtime codes — imported from the element error protocol map.
 *
 * Every code carries a phase and a severity. Those are DERIVED from the code
 * family, and the family lookup fails closed: an unrecognized code stops the
 * generator instead of landing on the page with no classification. So a new
 * code cannot reach `/errors` unclassified, and a new code in source cannot
 * be absent from `/errors` — the coverage check below proves exactly that by
 * re-scanning the sources for `OEC\d{4}` literals and requiring every one of
 * them to appear in the catalog.
 *
 * `--check` regenerates in memory and fails on drift; it additionally fails
 * when the extraction misses a literal the sources contain, so the gate
 * cannot pass by extracting less.
 */
import { formatJson } from '@openelement/element/build-utils';
import { fromFileUrl, join, relative, resolve } from '@std/path';
import ts from 'typescript';
import {
  IslandErrorCode,
  PageErrorCode,
  ServeErrorCode,
} from '../../packages/router/src/internal/error-codes.ts';
import { ErrorCode } from '../../packages/element/src/internal/protocol/errors.ts';

export const ERROR_REFERENCE_ARTIFACT = 'www/app/data/_generated-error-reference.ts';

const repoRoot = fromFileUrl(new URL('../../', import.meta.url));

/** Sources whose diagnostic literals define the compiler half of the table. */
const COMPILER_SOURCES = [
  'packages/element/src/internal/compiler/semantic-core/compile.ts',
  'packages/element/src/internal/compiler/semantic-core/module-analysis.ts',
];

/** One error code as it appears on `/errors`. */
export interface ErrorCodeRecord {
  code: string;
  family: string;
  phase: string;
  severity: string;
  /** Representative authored message; template placeholders render as `…`. */
  message: string;
  source: { path: string; line: number };
  /** How many sites raise this code (compiler codes; 1 for constant maps). */
  occurrences: number;
  anchor: string;
}

export interface ErrorReferenceBuild {
  codes: ErrorCodeRecord[];
  failures: string[];
}

/**
 * Family → phase/severity. The family is derived from the code's own shape,
 * so the mapping is a classification rule, not a code list: `codesForFamily`
 * throws for any code the rule does not recognize.
 */
const FAMILY_RULES: Array<{ test: RegExp; family: string; phase: string; severity: string }> = [
  { test: /^OEC\d{4}$/, family: 'compiler', phase: 'build', severity: 'error' },
  { test: /^OE_PAGE_/, family: 'page authoring', phase: 'validation', severity: 'error' },
  { test: /^OE_ISLAND_/, family: 'island authoring', phase: 'validation', severity: 'error' },
  { test: /^OE_SERVE_/, family: 'serve CLI', phase: 'validation', severity: 'error' },
  { test: /^OE_/, family: 'runtime', phase: 'render', severity: 'error' },
  { test: /^SSR_RENDER_ERROR$/, family: 'runtime', phase: 'ssr', severity: 'error' },
  { test: /^BOUNDARY_CAUGHT$/, family: 'runtime', phase: 'render', severity: 'warning' },
  { test: /^UNKNOWN$/, family: 'runtime', phase: 'unknown', severity: 'error' },
];

function classify(code: string): { family: string; phase: string; severity: string } {
  for (const rule of FAMILY_RULES) {
    if (rule.test.test(code)) {
      return { family: rule.family, phase: rule.phase, severity: rule.severity };
    }
  }
  throw new Error(
    `error reference: code '${code}' matches no family rule — add a rule so the catalog can ` +
      'classify it (phase and severity are part of the documented contract)',
  );
}

/**
 * Render a diagnostic message argument as one line: string literals and
 * template quasis concatenate, and every interpolated expression becomes `…`,
 * because the interpolation is per-site data (a tag name, an attribute name)
 * and the catalog documents the definition, not one instance.
 *
 * A message built by a helper call carries no literal text at all; those are
 * named explicitly, because "the message text is dynamic" is not a usable
 * catalog entry, whereas the reason it is dynamic is.
 */
const DERIVED_MESSAGES: Readonly<Record<string, string>> = {
  diagnosticMessage: "the parser's own message for the malformed source",
};

function renderMessage(node: ts.Node): string {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isTemplateExpression(node)) {
    let text = node.head.text;
    for (const span of node.templateSpans) {
      text += '…' + span.literal.text;
    }
    return text;
  }
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    return renderMessage(node.left) + renderMessage(node.right);
  }
  if (
    ts.isParenthesizedExpression(node) || ts.isAsExpression(node) ||
    ts.isTypeAssertionExpression(node)
  ) {
    return renderMessage(node.expression);
  }
  if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
    const derived = DERIVED_MESSAGES[node.expression.text];
    if (derived !== undefined) return derived;
  }
  return '…';
}

function isCodeLiteral(node: ts.Node | undefined): node is ts.StringLiteral {
  return node !== undefined && ts.isStringLiteral(node) && /^OEC\d{4}$/.test(node.text);
}

/** Shape-independent scan: every string literal in the file that IS a code. */
function scanCodeLiterals(source: ts.SourceFile): Set<string> {
  const literals = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (isCodeLiteral(node)) literals.add(node.text);
    ts.forEachChild(node, visit);
  };
  visit(source);
  return literals;
}

interface Extraction {
  codes: Map<string, { message: string; line: number; occurrences: number }>;
  /** Every OEC literal the file contains, extracted or not. */
  literals: Set<string>;
}

function extractCompilerCodes(text: string, path: string): Extraction {
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TS);
  const codes = new Map<string, { message: string; line: number; occurrences: number }>();
  const literals = scanCodeLiterals(source);

  const record = (code: string, message: string, node: ts.Node): void => {
    const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
    const existing = codes.get(code);
    if (existing === undefined) {
      codes.set(code, { message, line, occurrences: 1 });
      return;
    }
    existing.occurrences += 1;
  };

  const visit = (node: ts.Node): void => {
    // `fail(target, 'OEC9011', message)` and `this.fail(...)` alike: the
    // literal is the first OEC-shaped argument and the message follows it.
    if (ts.isCallExpression(node)) {
      for (let index = 0; index < node.arguments.length; index++) {
        const argument = node.arguments[index];
        if (!isCodeLiteral(argument)) continue;
        const message = node.arguments[index + 1];
        record(argument.text, message ? renderMessage(message) : '', argument);
      }
    }
    // `{ code: 'OEC9015', message: … }` — the thrown-diagnostic object form.
    if (ts.isObjectLiteralExpression(node)) {
      const codeProperty = node.properties.find((property) =>
        ts.isPropertyAssignment(property) &&
        ts.isIdentifier(property.name) &&
        property.name.text === 'code'
      );
      if (
        codeProperty && ts.isPropertyAssignment(codeProperty) &&
        isCodeLiteral(codeProperty.initializer)
      ) {
        const messageProperty = node.properties.find((property) =>
          ts.isPropertyAssignment(property) &&
          ts.isIdentifier(property.name) &&
          property.name.text === 'message'
        );
        const message = messageProperty && ts.isPropertyAssignment(messageProperty)
          ? renderMessage(messageProperty.initializer)
          : '';
        record(codeProperty.initializer.text, message, codeProperty);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return { codes, literals };
}

/**
 * The mechanism this whole file exists for (#1413): a code must be on
 * `/errors` before it is in the source, and the ONLY enforceable direction is
 * source → catalog.
 *
 * - `source ⟹ catalog`: a diagnostic literal the compiler can raise but the
 *   catalog does not list is a failure. That is the direction a new code
 *   trips: it cannot ship undocumented.
 * - `catalog ⟹ source`: deliberately NOT asserted, in either direction of
 *   intent. A catalogued code with no raising site yet is the documented-first
 *   state the acceptance describes (publish the code, then land the check
 *   that throws it), and nothing about that state is a defect.
 *
 * Kept pure and exported so both directions can be pinned by a test rather
 * than by reading this comment.
 */
export function coverageFailures(
  catalog: readonly string[],
  literals: ReadonlySet<string>,
): string[] {
  const catalogued = new Set(catalog);
  const failures: string[] = [];
  for (const code of [...literals].sort()) {
    if (!catalogued.has(code)) {
      failures.push(
        `compiler literal '${code}' is in the source but not on /errors — add it to the ` +
          'diagnostic sources the catalog is generated from, and document it before it ships',
      );
    }
  }
  return failures;
}

/** Flatten a code constant map (`{ NAME: 'VALUE' }`) into its values. */
function constantCodes(map: Record<string, string>): string[] {
  return Object.values(map);
}

/**
 * Representative messages for codes whose text lives at the throw site rather
 * than next to the constant. These are copied from the shipped message the
 * corresponding throw produces; the coverage test in
 * `www/__tests__/error-reference.test.ts` asserts each one still appears in
 * the source that raises the code, so a curated entry cannot outlive its
 * message.
 */
const CONSTANT_MESSAGES: Readonly<Record<string, string>> = {
  OE_PAGE_NOT_COMPILED_CLASS:
    'definePage() requires the compiled page element class as its first argument',
  OE_PAGE_DESCRIPTOR_SHAPE: 'definePage() requires an object descriptor',
  OE_PAGE_ROUTE_INTENT: 'definePage route.layout must be a layout name string or false',
  OE_PAGE_PROJECTOR: 'definePage() props must be a projector function',
  OE_PAGE_RENDER_MODE: "renderIntent.mode must be 'static' or 'dynamic'",
  OE_ISLAND_DESCRIPTOR_SHAPE: 'defineIslandConfig() requires an object descriptor',
  OE_ISLAND_HYDRATE: 'Invalid island hydrate strategy',
  OE_ISLAND_TAGS: 'defineIslandConfig() tags must be a non-empty array',
  OE_ISLAND_EXPORT_NAMES: 'defineIslandConfig() exportNames must be an object',
  OE_SERVE_MODE: 'unknown --mode',
  SSR_RENDER_ERROR: 'SSR render failed',
  BOUNDARY_CAUGHT: 'an error boundary caught a render failure',
  UNKNOWN: 'the framework could not classify the failure',
};

export async function buildErrorReference(): Promise<ErrorReferenceBuild> {
  const failures: string[] = [];
  const records: ErrorCodeRecord[] = [];
  const seen = new Set<string>();
  const allLiterals = new Set<string>();

  const push = (
    record: Omit<ErrorCodeRecord, 'family' | 'phase' | 'severity' | 'anchor'>,
  ): void => {
    if (seen.has(record.code)) {
      failures.push(`duplicate code '${record.code}' in the catalog`);
      return;
    }
    seen.add(record.code);
    let classification: { family: string; phase: string; severity: string };
    try {
      classification = classify(record.code);
    } catch (error) {
      failures.push(String(error instanceof Error ? error.message : error));
      return;
    }
    records.push({
      ...record,
      ...classification,
      anchor: `err-${record.code.replace(/_/g, '-').toLowerCase()}`,
    });
  };

  for (const relativePath of COMPILER_SOURCES) {
    const absolute = join(repoRoot, relativePath);
    let text: string;
    try {
      text = await Deno.readTextFile(absolute);
    } catch (error) {
      failures.push(`${relativePath}: unreadable (${error})`);
      continue;
    }
    const extraction = extractCompilerCodes(text, relativePath);
    for (const literal of extraction.literals) allLiterals.add(literal);
    const missing = [...extraction.literals].filter((code) => !extraction.codes.has(code));
    for (const code of missing) {
      failures.push(
        `${relativePath}: OEC literal '${code}' was not extracted with a message — the ` +
          'extractor and the diagnostic call shape have drifted',
      );
    }
    for (const [code, entry] of extraction.codes) {
      push({
        code,
        message: entry.message,
        source: { path: relativePath, line: entry.line },
        occurrences: entry.occurrences,
      });
    }
  }

  // Router authoring + serve codes, read from the constant maps the throws use.
  const constantSource = 'packages/router/src/internal/error-codes.ts';
  for (const code of constantCodes(PageErrorCode)) {
    push({
      code,
      message: CONSTANT_MESSAGES[code] ?? '',
      source: { path: constantSource, line: 0 },
      occurrences: 1,
    });
  }
  for (const code of constantCodes(IslandErrorCode)) {
    push({
      code,
      message: CONSTANT_MESSAGES[code] ?? '',
      source: { path: constantSource, line: 0 },
      occurrences: 1,
    });
  }
  for (const code of constantCodes(ServeErrorCode)) {
    push({
      code,
      message: CONSTANT_MESSAGES[code] ?? '',
      source: { path: constantSource, line: 0 },
      occurrences: 1,
    });
  }

  // Element runtime codes, read from the protocol map.
  const runtimeSource = 'packages/element/src/internal/protocol/errors.ts';
  for (const code of constantCodes(ErrorCode)) {
    push({
      code,
      message: CONSTANT_MESSAGES[code] ?? '',
      source: { path: runtimeSource, line: 0 },
      occurrences: 1,
    });
  }

  // A constant code with no representative message would land on `/errors` as
  // an empty row; that is a missing entry, not an acceptable table cell.
  for (const record of records) {
    if (record.message.trim() === '') {
      failures.push(`code '${record.code}' has no representative message`);
    }
  }

  records.sort((a, b) => a.code.localeCompare(b.code));

  // The mechanism's enforceable direction: every OEC literal in the sources
  // must be catalogued. See coverageFailures() for why the reverse is not.
  for (const failure of coverageFailures(records.map((record) => record.code), allLiterals)) {
    failures.push(failure);
  }

  return { codes: records, failures };
}

export function renderErrorReferenceModule(build: ErrorReferenceBuild): string {
  const payload = {
    generatedFrom: [
      ...COMPILER_SOURCES,
      'packages/router/src/internal/error-codes.ts',
      'packages/element/src/internal/protocol/errors.ts',
    ],
    codes: build.codes,
  };
  return '// Auto-generated by www/tools/generate-error-reference.ts (#1413) — do not edit\n' +
    '// Source of truth: every `fail(…, OEC9xxx, …)` / `{ code: OEC9xxx }` literal in the\n' +
    '// element semantic core, plus the element error-protocol and router error-code maps.\n' +
    '// Regenerate with `deno task --cwd www generate:errors`; the file is untracked and\n' +
    '// rebuilt before test/site:build.\n' +
    `export const errorReference = ${formatJson(payload).trimEnd()} as const;\n`;
}

/** The compiler-source OEC literals, for the coverage assertions in the gate. */
export async function compilerCodeLiterals(): Promise<Set<string>> {
  const literals = new Set<string>();
  for (const relativePath of COMPILER_SOURCES) {
    const text = await Deno.readTextFile(join(repoRoot, relativePath));
    const extraction = extractCompilerCodes(text, relativePath);
    for (const code of extraction.literals) literals.add(code);
  }
  return literals;
}

/** Repo-relative path of the generated artifact, for gate messages. */
export function artifactPath(): string {
  return relative(repoRoot, resolve(repoRoot, ERROR_REFERENCE_ARTIFACT));
}

if (import.meta.main) {
  const check = Deno.args.includes('--check');
  const build = await buildErrorReference();
  if (build.failures.length > 0) {
    console.error('error reference validation failed:');
    for (const failure of build.failures) console.error(`- ${failure}`);
    Deno.exit(1);
  }
  const module = renderErrorReferenceModule(build);
  if (check) {
    let existing: string;
    try {
      existing = await Deno.readTextFile(join(repoRoot, ERROR_REFERENCE_ARTIFACT));
    } catch {
      console.error(
        `${ERROR_REFERENCE_ARTIFACT} is missing; run deno task --cwd www generate:errors`,
      );
      Deno.exit(1);
    }
    if (existing !== module) {
      console.error(
        `${ERROR_REFERENCE_ARTIFACT} is stale; run deno task --cwd www generate:errors ` +
          '(the /errors page must never carry a hand-edited code table)',
      );
      Deno.exit(1);
    }
    console.log(
      `Error reference check passed (${build.codes.length} codes, ${ERROR_REFERENCE_ARTIFACT} is byte-identical).`,
    );
  } else {
    await Deno.writeTextFile(join(repoRoot, ERROR_REFERENCE_ARTIFACT), module);
    console.log(
      `Wrote ${build.codes.length} error codes to ${ERROR_REFERENCE_ARTIFACT}`,
    );
  }
}
