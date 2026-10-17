/**
 * Fail closed on package-qualified `vp run` invocations that cannot report
 * "I matched nothing".
 *
 * The hazard this check exists for: `vp run <pkg>#<task>` resolves the
 * package part by exact package NAME and, when no package carries that name,
 * prints nothing and exits 0. A CI step can therefore address a package that
 * does not exist (a rename, a typo, a copied line) and the job still goes
 * green — the gate never ran. Measured against the vendored vp 1.0.0:
 *
 *   vp run @openelement/does-not-exist#test                  → exit 0, no output
 *   vp run --fail-if-no-match @openelement/does-not-exist#test → exit 0, no output
 *   vp run --no-cache --fail-if-no-match --filter @openelement/does-not-exist test
 *                                                            → exit 1, "No packages matched the filter"
 *
 * The middle line is the reason this check requires the EFFECTIVE form, not
 * the flag's presence. `--fail-if-no-match` is documented as a property of
 * `--filter`; on the `pkg#task` specifier form it is inert, so a flagged
 * specifier is exactly as silent as an unflagged one — and a check that called
 * it "protected" would wave the regression through. The fail-closed selection
 * is the `--filter` form plus the flag; the pair is what this scan verifies.
 *
 * Rules, applied to the gate surfaces a hand-written `vp run` can live in —
 * `.github/**` (workflow `run:` steps via the YAML AST with exact line
 * positions, plus every other file scanned linewise), `.githooks/**`, and the
 * package.json `scripts` of every workspace member and of the root manifest:
 *
 *   1. specifier-form a package-qualified invocation must select with
 *                    `--filter`/`-F`. The `pkg#task` specifier form is always a
 *                    violation — the flag cannot work on it, so a rename or a
 *                    typo stays a silent exit 0. The fix is the filter form;
 *                    "add the flag" is not a fix and is never advised for this
 *                    form. The violation text says whether the specifier
 *                    resolves today, why a path-shaped one could never
 *                    dispatch, and which half is unknown.
 *   2. no-flag       a `--filter`/`-F` selection must carry
 *                    `--fail-if-no-match`, or the filter's "matched nothing"
 *                    is silent too. Bare root tasks (`vp run fmt`) are not
 *                    package-qualified: they dispatch against the root
 *                    workspace package, always match, and are exempt.
 *
 * The executable is recognised by basename, so a path-prefixed invocation
 * (`node_modules/.bin/vp run …` in a git hook, which inherits no
 * node_modules/.bin PATH) is scanned exactly like a bare `vp run …`; the
 * matcher used to look for the literal token `vp` and reported a clean scan
 * over that whole form.
 *
 * An invocation that genuinely must not fail on no-match opt-out is exempted
 * by a written reason on the same line, or on any line of the same YAML step /
 * JSON script value:
 *
 *   vp run --filter @openelement/optional task  # vp-selector-flags-allow: <reason>
 *
 * The reason is mandatory: a bare marker does not exempt. Exemptions are
 * counted and printed, never silently dropped. This is deliberately a
 * different axis from `--fail-if-no-match`: the flag is the default, the
 * annotation is the reviewed exception.
 *
 * Single ownership: the flag is not injected here and no call site is
 * rewritten by this check. Every vp invocation the repository's own tooling
 * spawns goes through tools/repo/vp-dispatch.ts `vpTaskArgv`, which builds
 * `vp run --no-cache --fail-if-no-match --filter <pkg> <task>` for every gate
 * step and generator task — the flag is unconditional there, so a gate list
 * cannot omit it. This scan is the tripwire for the call sites that are *not*
 * tooling-spawned (workflow `run:` steps, hooks, package.json scripts), because
 * those are the only places the argv can be written by hand. The two halves
 * are complementary: one owner for the argv, one check for the hand-written
 * surface.
 *
 * CLI:
 *   node tools/repo/check-vp-selector-flags.ts [--root=<dir>]
 * Exit 0 = every scanned invocation is fail-closed; 1 = at least one
 * violation (printed with file:line and the offending invocation).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { isMap, isScalar, isSeq, LineCounter, parseDocument, type Document } from 'yaml';
import { readWorkspaces } from './workspace-tasks.ts';

export const ALLOW_MARKER = 'vp-selector-flags-allow:';
const FAIL_FLAG = '--fail-if-no-match';
/** Filter selection flags: the value is the following token. */
const FILTER_FLAGS = new Set(['--filter', '-F']);
const FLAG_EXEMPT_WHERE = 'a --filter selection must carry --fail-if-no-match';
/** The canonical, fail-closed shape the advice and the tooling both emit. */
const EFFECTIVE_FORM = `vp run --no-cache ${FAIL_FLAG} --filter <pkg> <task>`;

export type ViolationKind = 'specifier-form' | 'no-flag';

export interface Violation {
  kind: ViolationKind;
  /** Repository-relative path of the file carrying the invocation. */
  file: string;
  /** 1-based line, or 0 when the invocation comes from a JSON script value. */
  line: number;
  /** The offending invocation, whitespace-normalized. */
  invocation: string;
  detail: string;
}

export interface SelectorFacts {
  /** Workspace package name → declared script keys. */
  packages: Map<string, Set<string>>;
}

export interface ScanReport {
  violations: Violation[];
  /** Package-qualified invocations that carried the flag. */
  protectedCount: number;
  /** Package-qualified invocations exempted by a written reason. */
  exemptions: Array<{ file: string; line: number; reason: string }>;
  /** Every package-qualified invocation seen, protected or not. */
  qualifiedCount: number;
  filesScanned: number;
}

// ---------------------------------------------------------------------------
// Shell-lite tokenizer
// ---------------------------------------------------------------------------

/**
 * Split one shell command line into the invocations it can contain. The
 * metacharacters split; quoting is respected so a `#` inside a specifier is
 * never mistaken for a comment, and a trailing `# comment` never becomes a
 * token. This is a scanner, not a shell: it exists to find `vp run` argv, and
 * anything it cannot understand is left as a token rather than silently
 * dropped.
 */
export function splitInvocations(line: string): string[][] {
  const invocations: string[][] = [];
  let tokens: string[] = [];
  let token = '';
  let quote: '"' | "'" | undefined;
  const pushToken = (): void => {
    if (token !== '') tokens.push(token);
    token = '';
  };
  const pushInvocation = (): void => {
    pushToken();
    if (tokens.length > 0) invocations.push(tokens);
    tokens = [];
  };
  for (let index = 0; index < line.length; index += 1) {
    const ch = line[index]!;
    if (quote !== undefined) {
      if (ch === quote) quote = undefined;
      else token += ch;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === '#' && token === '') {
      // A `#` that starts a token is a shell comment; inside a token it is the
      // package/task separator (`@scope/pkg#task`).
      break;
    }
    if (ch === ' ' || ch === '\t') {
      pushToken();
      continue;
    }
    if (ch === ';' || ch === '&' || ch === '|') {
      pushInvocation();
      continue;
    }
    token += ch;
  }
  pushInvocation();
  return invocations;
}

/**
 * True when a token names the vp CLI: `vp`, a path-prefixed `…/vp` (a git hook
 * must spell the binary with its path — it inherits no node_modules/.bin
 * PATH), or a Windows shim (`vp.cmd`, `vp.exe`, `vp.ps1`). Anything else that
 * merely contains those letters is not the CLI.
 */
export function isVpExecutable(token: string): boolean {
  const base = token.slice(token.lastIndexOf('/') + 1);
  return base === 'vp' || /^vp\.(cmd|exe|ps1)$/i.test(base);
}

/** The `vp run …` argv of one invocation, or null when it is not one. */
export function vpRunArgv(tokens: readonly string[]): string[] | null {
  for (const [index, token] of tokens.entries()) {
    if (!isVpExecutable(token)) continue;
    if (tokens[index + 1] !== 'run') return null;
    return tokens.slice(index + 2);
  }
  return null;
}

/**
 * Cheap pre-filter before tokenizing: can this text carry a `vp run`? Kept
 * deliberately permissive (the exact judgement is `vpRunArgv`'s) but narrower
 * than "contains vp": a line that merely mentions the CLI in prose is not
 * tokenized.
 */
export function mentionsVpRun(text: string): boolean {
  return /(?:^|[\s;&|("'=])(?:[^\s;&|("'=]*\/)?vp(?:\.[a-z]+)?\s+run(?:\s|$)/.test(text);
}

// ---------------------------------------------------------------------------
// One invocation → violations
// ---------------------------------------------------------------------------

interface InvocationContext {
  file: string;
  line: number;
  /** The raw line / script value, used for the exemption marker. */
  text: string;
  /** Extra text the exemption marker may live in (a whole YAML step). */
  markerScope: string;
}

/** Walk one `vp run …` argv: is it package-qualified, and which rules does it break? */
export interface RunVerdict {
  /** The invocation addresses a package (a `pkg#task` specifier or a filter). */
  qualified: boolean;
  violations: Violation[];
}

/**
 * Why a `pkg#task` specifier is not a fixable selector: the text names what
 * would have run (so a rename/typo is legible) and reminds that the form
 * itself is the defect. Resolution is diagnosis only — the form is a violation
 * whether or not it resolves today.
 */
function specifierDetail(selector: string, facts: SelectorFacts): string {
  const hash = selector.indexOf('#');
  const pkg = selector.slice(0, hash);
  const task = selector.slice(hash + 1);
  const inert =
    `'${selector}' cannot report a no-match: ${FAIL_FLAG} is a property of ` +
    `--filter and is inert on this form; use '${EFFECTIVE_FORM}'`;
  if (pkg.includes('/') && !pkg.startsWith('@')) {
    return `${inert} ('${pkg}' is also a path selector; vp dispatches by exact package NAME, so it would exit 0)`;
  }
  const tasks = facts.packages.get(pkg);
  if (tasks === undefined) {
    return `${inert} (and '${pkg}' names no workspace package, so it exits 0 without running anything)`;
  }
  if (!tasks.has(task)) {
    return `${inert} (and ${pkg} declares no task '${task}')`;
  }
  return `${inert} (this one resolves today; the next rename or typo would not)`;
}

/** Analyze one `vp run …` argv against the workspace facts. */
export function analyzeVpRun(argv: readonly string[], facts: SelectorFacts): RunVerdict {
  const specifiers: string[] = [];
  let filterSelected = false;
  let hasFlag = false;
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]!;
    if (token === FAIL_FLAG) {
      hasFlag = true;
      continue;
    }
    if (token.startsWith('--filter=')) {
      filterSelected = true;
      continue;
    }
    if (FILTER_FLAGS.has(token)) {
      // The bare form takes the next token as the pattern; a missing value is
      // already a filter selection (vp rejects the invocation either way).
      filterSelected = true;
      const value = argv[index + 1];
      if (value !== undefined && !value.startsWith('-')) index += 1;
      continue;
    }
    if (token.startsWith('-')) continue;
    specifiers.push(token);
  }
  const selector = specifiers[0];
  const qualified = filterSelected || (selector !== undefined && selector.includes('#'));
  if (!qualified) return { qualified: false, violations: [] };

  const blank = { file: '', line: 0, invocation: '' };
  // The effective-form rule comes first and stands alone: on a `pkg#task`
  // specifier the missing-flag advice would be wrong (the flag does nothing
  // there), so a specifier reports the form defect and nothing else.
  if (selector !== undefined && selector.includes('#')) {
    return {
      qualified,
      violations: [{ ...blank, kind: 'specifier-form', detail: specifierDetail(selector, facts) }],
    };
  }
  if (!hasFlag) {
    return {
      qualified,
      violations: [
        {
          ...blank,
          kind: 'no-flag',
          detail: `${FLAG_EXEMPT_WHERE} (got ${[...argv].join(' ')})`,
        },
      ],
    };
  }
  return { qualified, violations: [] };
}

// ---------------------------------------------------------------------------
// Source scanning
// ---------------------------------------------------------------------------

/**
 * Every `run:` step body that can carry a shell command, anywhere in a parsed
 * YAML document (workflows, reusable workflows, composite actions, anchors),
 * paired with the 1-based line the `run:` key sits on.
 */
export function yamlRuns(text: string): Array<{ command: string; line: number }> {
  const lineCounter = new LineCounter();
  let document: Document;
  try {
    document = parseDocument(text, { lineCounter });
  } catch {
    return [];
  }
  const out: Array<{ command: string; line: number }> = [];
  const visit = (node: unknown): void => {
    if (isMap(node)) {
      for (const pair of node.items) {
        const key = pair.key;
        if (
          isScalar(key) &&
          key.value === 'run' &&
          isScalar(pair.value) &&
          typeof pair.value.value === 'string'
        ) {
          const start = key.range?.[0] ?? 0;
          // A block scalar's content begins on the line after its `run: |`
          // header; a plain `run: cmd` shares the header's line.
          const header = lineCounter.linePos(start).line;
          const offset = pair.value.value.includes('\n') ? 1 : 0;
          out.push({ command: pair.value.value, line: header + offset });
        } else {
          visit(pair.key);
          visit(pair.value);
        }
      }
      return;
    }
    if (isSeq(node)) {
      for (const item of node.items) visit(item);
    }
  };
  visit(document.contents);
  return out;
}

function collectFromLines(
  text: string,
  context: { file: string; markerScope: string; lineOffset?: number },
  facts: SelectorFacts,
  report: ScanReport,
): void {
  const lines = text.split('\n');
  const offset = context.lineOffset ?? 0;
  for (const [index, raw] of lines.entries()) {
    if (!mentionsVpRun(raw)) continue;
    const allow = raw.includes(ALLOW_MARKER);
    for (const tokens of splitInvocations(raw)) {
      const argv = vpRunArgv(tokens);
      if (argv === null) continue;
      record(
        argv,
        {
          file: context.file,
          line: offset + index + 1,
          text: raw,
          markerScope: context.markerScope,
        },
        facts,
        report,
        allow,
      );
    }
  }
}

function record(
  argv: readonly string[],
  context: InvocationContext,
  facts: SelectorFacts,
  report: ScanReport,
  lineHasMarker: boolean,
): void {
  const { qualified, violations } = analyzeVpRun(argv, facts);
  if (!qualified) return;
  report.qualifiedCount += 1;
  if (violations.length === 0) {
    report.protectedCount += 1;
    return;
  }
  const marker = lineHasMarker ? context.text : context.markerScope;
  if (marker.includes(ALLOW_MARKER)) {
    const reason = marker.slice(marker.indexOf(ALLOW_MARKER) + ALLOW_MARKER.length).trim();
    if (reason !== '') {
      report.exemptions.push({ file: context.file, line: context.line, reason });
      return;
    }
  }
  const invocation = `vp run ${argv.join(' ')}`;
  for (const violation of violations) {
    report.violations.push({ ...violation, file: context.file, line: context.line, invocation });
  }
}

/** Scan one file's text. YAML gets the AST walk; everything else is linewise. */
export function scanFileText(
  file: string,
  text: string,
  facts: SelectorFacts,
  report: ScanReport,
): void {
  report.filesScanned += 1;
  if (/\.ya?ml$/.test(file)) {
    const runs = yamlRuns(text);
    if (runs.length === 0) {
      // Fail closed on unreadable YAML rather than on invocations the AST walk
      // could not see: a workflow that does not parse is actionlint's finding,
      // but this check must still not miss a `vp run` inside it.
      collectFromLines(text, { file, markerScope: text }, facts, report);
      return;
    }
    for (const run of runs) {
      collectFromLines(
        run.command,
        { file, markerScope: run.command, lineOffset: run.line - 1 },
        facts,
        report,
      );
    }
    return;
  }
  collectFromLines(text, { file, markerScope: text }, facts, report);
}

/** Every file under `rootDir/.github`, recursively. */
function githubFiles(rootDir: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.isFile()) out.push(path);
    }
  };
  walk(join(rootDir, '.github'));
  return out.sort();
}

/**
 * The gate surfaces a hand-written `vp run` can live in: the CI tree, the
 * local hooks (`.githooks/pre-push` dispatches a release task the same way CI
 * does), and `package.json` scripts (covered through the workspace scan).
 * Test files and docs are deliberately not scanned: a file that *quotes* a
 * command as prose or as a fixture is not a dispatch, and flagging prose would
 * make the check lie about what it proves.
 */
function gateSurfaceFiles(rootDir: string): string[] {
  const files = githubFiles(rootDir);
  let hooks: string[];
  try {
    hooks = readdirSync(join(rootDir, '.githooks'), { withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => join(rootDir, '.githooks', entry.name));
  } catch {
    hooks = [];
  }
  return [...files, ...hooks].sort();
}

export async function scanRepository(repoRoot: string): Promise<ScanReport> {
  const report: ScanReport = {
    violations: [],
    protectedCount: 0,
    exemptions: [],
    qualifiedCount: 0,
    filesScanned: 0,
  };
  const workspaces = await readWorkspaces(repoRoot);
  const facts: SelectorFacts = { packages: new Map() };
  for (const workspace of workspaces) {
    if (workspace.name === undefined) continue;
    facts.packages.set(workspace.name, new Set(Object.keys(workspace.tasks)));
  }
  // The scripts are read from the canonical workspace discovery (the same
  // source the selector facts come from), so a manifest that is a workspace
  // member cannot be audited against a different package inventory.
  for (const workspace of workspaces) {
    const shown = relative(repoRoot, join(workspace.dir, 'package.json'));
    report.filesScanned += 1;
    for (const command of Object.values(workspace.tasks)) {
      if (!mentionsVpRun(command)) continue;
      // The exemption marker may live anywhere in the script value, which is
      // the JSON analogue of "the same YAML step".
      collectFromLines(command, { file: shown, markerScope: command }, facts, report);
    }
  }
  // The ROOT manifest is a hand-written `vp run` surface too (its `prepare`
  // and `pages:build` scripts), and it is not a workspace member, so the loop
  // above cannot see it. A guard that reports clean over an unexamined site is
  // worse than no guard. Skipped when the root is itself a member: the loop
  // above already read that manifest.
  const rootManifest = join(repoRoot, 'package.json');
  if (!workspaces.some((workspace) => resolve(workspace.dir) === resolve(repoRoot))) {
    const parsed = JSON.parse(readFileSync(rootManifest, 'utf8')) as {
      scripts?: Record<string, string>;
    };
    report.filesScanned += 1;
    for (const command of Object.values(parsed.scripts ?? {})) {
      if (!mentionsVpRun(command)) continue;
      collectFromLines(command, { file: 'package.json', markerScope: command }, facts, report);
    }
  }
  for (const file of gateSurfaceFiles(repoRoot)) {
    let text: string;
    try {
      if (!statSync(file).isFile()) continue;
      text = readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    scanFileText(relative(repoRoot, file), text, facts, report);
  }
  return report;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function formatViolation(violation: Violation): string {
  const where = violation.line > 0 ? `${violation.file}:${violation.line}` : violation.file;
  return `${where}: ${violation.kind}: ${violation.detail}\n    ${violation.invocation}`;
}

async function main(): Promise<void> {
  const arg = process.argv.slice(2).find((token) => token.startsWith('--root='));
  const repoRoot =
    arg !== undefined
      ? arg.slice('--root='.length)
      : fileURLToPath(new URL('../..', import.meta.url));
  const report = await scanRepository(repoRoot);
  for (const exemption of report.exemptions) {
    console.log(`exempt ${exemption.file}:${exemption.line}: ${exemption.reason}`);
  }
  if (report.violations.length > 0) {
    console.error(
      `vp-selector-flags: ${report.violations.length} package-qualified invocation(s) cannot report a no-match:`,
    );
    for (const violation of report.violations) console.error(formatViolation(violation));
    console.error(
      `vp-selector-flags: use '${EFFECTIVE_FORM}', or exempt with '# ${ALLOW_MARKER} <reason>'.`,
    );
    process.exit(1);
  }
  if (report.qualifiedCount === 0) {
    console.error(
      'vp-selector-flags: found no package-qualified vp run invocation at all — refusing to ' +
        'report a vacuous pass on a scan that read nothing.',
    );
    process.exit(1);
  }
  console.log(
    `vp-selector-flags: ${report.protectedCount}/${report.qualifiedCount} package-qualified ` +
      `invocation(s) use the fail-closed --filter form, ${report.exemptions.length} exemption(s), ` +
      `${report.filesScanned} file(s) scanned.`,
  );
}

if (import.meta.main) await main();
