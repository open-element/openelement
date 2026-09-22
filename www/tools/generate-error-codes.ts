/**
 * Error-code reference generator (#1414 item 3, co-built with the W3 error
 * experience).
 *
 * The code table is a derived artifact (P6): the OEC diagnostics ARE the data
 * source, so this tool renders www/app/data/_generated-error-codes.ts from the
 * call sites in packages/<name>/src instead of letting the site keep a
 * hand-written list. Two families are collected:
 *
 *   OEC diagnostics — every `OEC####` literal in the retained packages, with
 *     the static message argument at each call site. A code that exists in the
 *     source therefore cannot be missing from the /errors page: the page reads
 *     this module, so `www#check:error-codes` (gate:release, the release
 *     train) fails closed on any drift between the two.
 *   Runtime codes — the `ErrorCode` constants declared in
 *     packages/element/src/internal/protocol/errors.ts, with their own JSDoc.
 *
 * `--check` regenerates in memory and requires byte-identical output. The
 * module is generated (gitignored) and rebuilt before test/site:build.
 */
import { formatJson } from '@openelement/element/build-utils';
import { walk } from '@std/fs/walk';
import { fromFileUrl, join } from '@std/path';
import ts from 'typescript';
import { readPackages, releasePublishOrder } from '../../tools/lib/package-graph.ts';

export const ERROR_CODES_ARTIFACT = 'www/app/data/_generated-error-codes.ts';
/** The page whose table must project this artifact (never restate it). */
const ERROR_CODES_PAGE = 'www/app/components/page-errors.tsx';
/** The route that projects the generated inventory onto the page. */
const ERROR_CODES_ROUTE = 'www/app/routes/errors.tsx';
const repoRoot = fromFileUrl(new URL('../../', import.meta.url));
/** The single declaration site of the runtime ErrorCode constants. */
const RUNTIME_CODES_SOURCE = 'packages/element/src/internal/protocol/errors.ts';

export interface CodeOccurrence {
  path: string;
  line: number;
  /** The static message text at this call site, `''` when it is dynamic. */
  message: string;
}

export interface DiagnosticCode {
  code: string;
  /** Shortest normalized message across call sites — the table's one-line gloss. */
  summary: string;
  /** Every distinct normalized message, sorted. */
  messages: string[];
  occurrences: CodeOccurrence[];
}

export interface RuntimeCode {
  name: string;
  value: string;
  summary: string;
}

export interface ErrorCodesBuild {
  diagnostics: DiagnosticCode[];
  runtime: RuntimeCode[];
  failures: string[];
}

const OEC_CODE = /^OEC\d{4}$/;

/**
 * Normalize a message for display: collapse whitespace and replace template
 * interpolations with `…`, so (`attribute name "${name}" is unsafe`) reads as
 * a stable, source-independent sentence. The raw text is never edited, only
 * this rendered copy.
 */
function normalizeMessage(text: string): string {
  return text.replace(/\s+/g, ' ').replaceAll('${', '…${').trim();
}

/** Unwrap `as const` / `satisfies` / parentheses around an expression. */
function unwrapExpression(node: ts.Expression): ts.Expression {
  let current = node;
  while (
    ts.isAsExpression(current) || ts.isSatisfiesExpression(current) ||
    ts.isParenthesizedExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

/**
 * Render a message expression as the table's display text. Literals contribute
 * their text; template holes and non-literal subexpressions render as `…` (a
 * call renders as `callee(…)`), so a partly dynamic message still documents
 * itself and a wholly dynamic one reads as its own producer. Nothing here is
 * invented: every character comes from the source expression.
 */
function renderStaticText(node: ts.Node | undefined): string {
  if (!node) return '';
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isTemplateExpression(node)) {
    return node.head.text +
      node.templateSpans.map((span) => `…${span.literal.text}`).join('');
  }
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    return renderStaticText(node.left) + renderStaticText(node.right);
  }
  if (ts.isCallExpression(node)) return `${node.expression.getText()}(…)`;
  if (ts.isIdentifier(node)) return node.text;
  return '…';
}

/** The message following a code literal in the enclosing call, when static. */
function messageAfter(node: ts.Node): string {
  const parent = node.parent;
  // Call shape: fail(node, 'OECXXXX', 'message')
  if (parent && ts.isCallExpression(parent)) {
    const index = parent.arguments.indexOf(node as ts.Expression);
    if (index !== -1) {
      for (let next = index + 1; next < parent.arguments.length; next++) {
        const text = renderStaticText(parent.arguments[next]);
        if (text !== '' && text !== '…') return text;
      }
      return '';
    }
  }
  // Diagnostic-object shape: { code: 'OECXXXX', message: ... }
  if (
    parent && ts.isPropertyAssignment(parent) && ts.isIdentifier(parent.name) &&
    parent.name.text === 'code' && parent.parent && ts.isObjectLiteralExpression(parent.parent)
  ) {
    for (const property of parent.parent.properties) {
      if (
        ts.isPropertyAssignment(property) && ts.isIdentifier(property.name) &&
        property.name.text === 'message'
      ) {
        const text = renderStaticText(unwrapExpression(property.initializer));
        return text === '…' ? '' : text;
      }
    }
  }
  return '';
}

/** Every string literal in the file whose text is an OEC code. */
function collectCodes(
  source: ts.SourceFile,
  path: string,
  out: Map<string, CodeOccurrence[]>,
): void {
  const visit = (node: ts.Node): void => {
    const isCodeLiteral = (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) &&
      OEC_CODE.test(node.text);
    if (isCodeLiteral) {
      const line = source.getLineAndCharacterOfPosition(node.getStart()).line + 1;
      const list = out.get(node.text) ?? [];
      list.push({ path, line, message: normalizeMessage(messageAfter(node)) });
      out.set(node.text, list);
      // A code literal that is a call's own argument also carries the message
      // as a following argument; keep walking so nested calls are collected.
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
}

/** The runtime ErrorCode const object: name, value and its leading JSDoc. */
function collectRuntimeCodes(text: string, path: string, failures: string[]): RuntimeCode[] {
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const codes: RuntimeCode[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) &&
      node.name.text === 'ErrorCode' &&
      node.initializer
    ) {
      const initializer = unwrapExpression(node.initializer);
      if (!ts.isObjectLiteralExpression(initializer)) {
        failures.push(`${path}: ErrorCode is not an object literal`);
      } else {
        for (const property of initializer.properties) {
          if (!ts.isPropertyAssignment(property) || !ts.isIdentifier(property.name)) continue;
          const initializer = unwrapExpression(property.initializer);
          const value =
            ts.isStringLiteral(initializer) || ts.isNoSubstitutionTemplateLiteral(initializer)
              ? initializer.text
              : '';
          if (value === '') {
            failures.push(`${path}: ErrorCode.${property.name.text} has no static value`);
            continue;
          }
          const summary = ts.getJSDocCommentsAndTags(property)
            .map((doc) =>
              ts.isJSDoc(doc)
                ? ts.displayPartsToString(doc.comment).replace(/\s+/g, ' ').trim()
                : typeof (doc as ts.JSDocTag).comment === 'string'
                ? String((doc as ts.JSDocTag).comment)
                : ''
            )
            .filter((text) => text !== '')
            .join(' ');
          codes.push({ name: property.name.text, value, summary });
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return codes.sort((a, b) => a.value.localeCompare(b.value));
}

export async function buildErrorCodes(): Promise<ErrorCodesBuild> {
  const failures: string[] = [];
  const packages = releasePublishOrder(await readPackages());
  const occurrences = new Map<string, CodeOccurrence[]>();

  for (const info of packages) {
    for await (
      const entry of walk(join(info.dir, 'src'), { includeDirs: false, exts: ['.ts', '.tsx'] })
    ) {
      const path = entry.path.slice(repoRoot.length).replace(/^\//, '');
      const text = await Deno.readTextFile(entry.path);
      const source = ts.createSourceFile(
        path,
        text,
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TSX,
      );
      collectCodes(source, path, occurrences);
    }
  }

  const diagnostics: DiagnosticCode[] = [...occurrences.entries()].map(([code, sites]) => {
    const sorted = [...sites].sort((a, b) =>
      a.path === b.path ? a.line - b.line : a.path.localeCompare(b.path)
    );
    const messages = [...new Set(sorted.map((site) => site.message).filter((m) => m !== ''))]
      .sort();
    // The gloss is the message the code actually raises most often — the
    // shape most call sites agree on — with ties going to the first in
    // sorted order, so the table never invents a description.
    const counts = new Map<string, number>();
    for (const message of sorted.map((site) => site.message)) {
      if (message === '') continue;
      counts.set(message, (counts.get(message) ?? 0) + 1);
    }
    let summary = '';
    let best = 0;
    for (const message of messages) {
      const count = counts.get(message) ?? 0;
      if (count > best) {
        summary = message;
        best = count;
      }
    }
    return { code, summary, messages, occurrences: sorted };
  }).sort((a, b) => a.code.localeCompare(b.code));

  if (diagnostics.length === 0) {
    failures.push('no OEC diagnostic codes found in the retained packages');
  }

  const runtimeSource = join(repoRoot, RUNTIME_CODES_SOURCE);
  let runtimeText: string;
  try {
    runtimeText = await Deno.readTextFile(runtimeSource);
  } catch (cause) {
    throw new Error(`runtime code source ${RUNTIME_CODES_SOURCE} is missing`, { cause });
  }
  const runtime = collectRuntimeCodes(runtimeText, RUNTIME_CODES_SOURCE, failures);
  if (runtime.length === 0) {
    failures.push(`${RUNTIME_CODES_SOURCE} declares no ErrorCode constants`);
  }

  await checkPageIsProjection(diagnostics, failures);

  return { diagnostics, runtime, failures };
}

/**
 * The /errors page must be a projection of the generated inventory, never a
 * second copy of it (P6). Two machine checks make that structural rather than
 * a convention: the route module must import the generated artifact (it is the
 * one that projects the inventory onto the presentation element's properties),
 * and neither the page element nor the route may contain an `OEC####` literal —
 * a hand-written code list would be exactly such a literal, and the generated
 * rows already carry every code.
 */
async function checkPageIsProjection(
  diagnostics: readonly DiagnosticCode[],
  failures: string[],
): Promise<void> {
  const pageFiles = [ERROR_CODES_PAGE, ERROR_CODES_ROUTE];
  const texts = new Map<string, string>();
  for (const relative of pageFiles) {
    let text: string;
    try {
      text = await Deno.readTextFile(join(repoRoot, relative));
    } catch (cause) {
      throw new Error(`${relative} is missing`, { cause });
    }
    texts.set(relative, text);
    const literal = text.match(/OEC\d{4}/);
    if (literal) {
      failures.push(
        `${relative} contains the hard-coded code '${literal[0]}'; the /errors table must ` +
          'project the generated inventory instead of restating codes',
      );
    }
  }
  if (!(texts.get(ERROR_CODES_ROUTE) ?? '').includes('_generated-error-codes.ts')) {
    failures.push(
      `${ERROR_CODES_ROUTE} must import ${ERROR_CODES_ARTIFACT}: the /errors table has one ` +
        'generated source, never a hand-written list',
    );
  }
  if (diagnostics.length === 0) return;
  // The page's family lookup is authored copy keyed by code prefix; a new
  // family whose prefix has no entry would silently fall back to a generic
  // label, so every generated prefix must be covered by some entry.
  const routeText = await Deno.readTextFile(join(repoRoot, ERROR_CODES_ROUTE));
  const familyPrefixes = [...routeText.matchAll(/'(OEC\d{2,})'/g)].map((match) => match[1]);
  for (const prefix of new Set(diagnostics.map((record) => record.code.slice(0, 5)))) {
    if (!familyPrefixes.some((family) => prefix.startsWith(family))) {
      failures.push(
        `${ERROR_CODES_ROUTE}: no code family entry covers '${prefix}…' — add the family ` +
          'label so the new codes are not labelled generically',
      );
    }
  }
}

export function renderErrorCodesModule(build: ErrorCodesBuild): string {
  const payload = {
    diagnostics: build.diagnostics,
    runtime: build.runtime,
  };
  return '// Auto-generated by www/tools/generate-error-codes.ts (#1414) — do not edit\n' +
    '// Source of truth: the OEC code literals in packages/<name>/src and the\n' +
    '// ErrorCode constants in packages/element/src/internal/protocol/errors.ts.\n' +
    '// Regenerate with `deno task --cwd www generate:error-codes`; the file is\n' +
    '// untracked and rebuilt before test/site:build.\n' +
    `export const errorCodes = ${formatJson(payload).trimEnd()} as const;\n`;
}

if (import.meta.main) {
  const check = Deno.args.includes('--check');
  const build = await buildErrorCodes();
  if (build.failures.length > 0) {
    console.error('error-code reference validation failed:');
    for (const failure of build.failures) console.error(`- ${failure}`);
    Deno.exit(1);
  }
  const module = renderErrorCodesModule(build);
  if (check) {
    let existing: string;
    try {
      existing = await Deno.readTextFile(join(repoRoot, ERROR_CODES_ARTIFACT));
    } catch {
      console.error(
        `${ERROR_CODES_ARTIFACT} is missing; run deno task --cwd www generate:error-codes`,
      );
      Deno.exit(1);
    }
    if (existing !== module) {
      console.error(
        `${ERROR_CODES_ARTIFACT} is stale; run deno task --cwd www generate:error-codes`,
      );
      Deno.exit(1);
    }
    console.log(`Error-code reference check passed (${ERROR_CODES_ARTIFACT} is byte-identical).`);
  } else {
    await Deno.writeTextFile(join(repoRoot, ERROR_CODES_ARTIFACT), module);
    const callSites = build.diagnostics.reduce((sum, code) => sum + code.occurrences.length, 0);
    console.log(
      `Wrote ${build.diagnostics.length} OEC codes (${callSites} call sites) and ` +
        `${build.runtime.length} runtime codes to ${ERROR_CODES_ARTIFACT}`,
    );
  }
}
