/**
 * docs-index.ts — the current-view generator and drift guard for the docs tree.
 *
 * P6 (design constitution): "the repository must not grow a second source of
 * truth beside [a standard artifact] … Unavoidable copies ship with a drift
 * guard." The hand-maintained `docs/TRUTH.md` was such a copy and drifted on the
 * day it landed; this tool replaces it with the P6 shape the repository already
 * uses for `interface:snapshot` and the agent-contract derived blocks:
 *
 *   - the authority is the record itself: a YAML-ish front-matter block at the
 *     top of every governing document (`status:` `topic:` `summary:`, and
 *     `translation_of:` for the zh twin), plus the ADRs' own `- Status:` lines
 *     (read by check-adr-index.ts) and `docs/history.json` for documents that
 *     left the tree;
 *   - the view is generated: the blocks between the `gen:begin` / `gen:end`
 *     HTML comments in `docs/architecture/README.md` and
 *     `docs/legacy/README.md`;
 *   - the drift guard is this file's `--check` mode: it renders the expected
 *     blocks and byte-compares them, validates every front matter, validates the
 *     history register against the tree (and against the deletions since its
 *     baseline commit), and resolves every relative link in `docs/**` outside
 *     the read-only archive.
 *
 * `--write` regenerates the blocks; a hand edit then fails the check. Wiring:
 * `@openelement/tools-repo#docs-index:check` in `gate:source`, in the CI lint
 * governance step, and in `.githooks/pre-push`.
 *
 * Usage: node tools/repo/docs-index.ts [--root=<dir>] [--write]
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, normalize, relative, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

export const ARCH_DIR = 'docs/architecture';
export const ARCH_INDEX_PATH = 'docs/architecture/README.md';
export const ARCH_INDEX_BLOCK = 'docs-architecture-index';
export const GOVERNING_ENTRY_PATH = 'docs/agent-contract.md';
export const LEGACY_DIR = 'docs/legacy';
export const LEGACY_ADR_DIR = 'docs/legacy/adr';
export const LEGACY_README_PATH = 'docs/legacy/README.md';
export const LEGACY_BLOCK = 'docs-legacy-register';
export const HISTORY_PATH = 'docs/history.json';

/** The closed front-matter vocabulary. Unknown keys fail closed (typos). */
export const FRONT_MATTER_KEYS = ['status', 'topic', 'summary', 'translation_of'] as const;
export const DOC_STATUSES = ['active', 'historical'] as const;
export type DocStatus = (typeof DOC_STATUSES)[number];

/** Entry points outside `docs/architecture/` that belong to the current view. */
export const EXTERNAL_ENTRIES = [
  { path: 'docs/adr/README.md', label: 'Active decision records' },
  { path: 'docs/legacy/README.md', label: 'Archive and removal register' },
  { path: 'docs/release/release-state.json', label: 'Release state' },
] as const;

export interface DocMeta {
  path: string;
  status: DocStatus;
  topic: string;
  summary: string;
  title: string;
  translationOf?: string;
}

export interface HistoryRecovery {
  commit: string;
  path: string;
}

export interface HistoryEntry {
  kind: 'removed' | 'archived';
  path: string;
  date: string;
  title: string;
  carried: string;
  nowLivesIn: string[];
  noSuccessor?: boolean;
  status?: string;
  recovery: HistoryRecovery;
}

export interface HistoryFile {
  schemaVersion: 1;
  baselineCommit: string;
  entries: HistoryEntry[];
}

export interface DocsIndexViolation {
  kind: string;
  file: string;
  detail: string;
}

export interface DocsIndexReport {
  docs: DocMeta[];
  history: HistoryFile | undefined;
  violations: DocsIndexViolation[];
  architectureIndex: string;
  legacyRegister: string;
}

/** Injectable git port so the tests never shell out. */
export interface DocsIndexDeps {
  listDeletedSince?: (root: string, baselineCommit: string) => string[] | undefined;
  existedAtBaseline?: (root: string, baselineCommit: string, path: string) => boolean;
}

const COMMIT_PATTERN = /^[0-9a-f]{40}$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MARKER = (name: string, edge: 'begin' | 'end'): string => `<!-- gen:${edge} ${name} -->`;

function report(
  violations: DocsIndexViolation[],
  kind: string,
  file: string,
  detail: string,
): void {
  violations.push({ kind, file, detail });
}

export interface FrontMatter {
  data: Record<string, string>;
  body: string;
}

/**
 * Parse the leading `---` fenced metadata block. Only flat `key: value` scalars
 * are accepted: a nested or malformed block fails closed rather than guessing.
 */
export function parseFrontMatter(text: string): FrontMatter | undefined {
  if (!text.startsWith('---\n')) return undefined;
  const close = text.indexOf('\n---\n', 4);
  if (close === -1) return undefined;
  const raw = text.slice(4, close);
  const data: Record<string, string> = {};
  for (const line of raw.split('\n')) {
    if (line.trim() === '') continue;
    const match = /^([a-z_]+):\s*(.*)$/.exec(line);
    if (match === null) return undefined;
    const key = match[1]!;
    let value = match[2]!.trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (Object.hasOwn(data, key)) return undefined;
    data[key] = value;
  }
  return { data, body: text.slice(close + 5) };
}

/** The document's H1, used as the link label. */
export function extractTitle(body: string): string | undefined {
  const match = /^#\s+(.+)$/m.exec(body);
  return match?.[1]?.trim();
}

/** Render one generated block with its stable markers. */
export function renderBlock(name: string, body: string): string {
  return [MARKER(name, 'begin'), '', body.trimEnd(), '', MARKER(name, 'end')].join('\n');
}

/** Replace the generated block in `text`; a missing marker pair is a violation. */
export function upsertBlock(
  text: string,
  name: string,
  body: string,
): { text: string; changed: boolean } | undefined {
  const begin = MARKER(name, 'begin');
  const end = MARKER(name, 'end');
  const beginAt = text.indexOf(begin);
  const endAt = text.indexOf(end);
  if (beginAt === -1 || endAt === -1 || endAt < beginAt) return undefined;
  const next = `${text.slice(0, beginAt)}${renderBlock(name, body)}${text.slice(endAt + end.length)}`;
  return { text: next, changed: next !== text };
}

/** Read every document that carries front matter. */
function loadDoc(
  root: string,
  path: string,
  violations: DocsIndexViolation[],
): DocMeta | undefined {
  const absolute = join(root, path);
  if (!existsSync(absolute)) {
    report(violations, 'missing-document', path, 'document does not exist in the tree');
    return undefined;
  }
  const text = readFileSync(absolute, 'utf8');
  const frontMatter = parseFrontMatter(text);
  if (frontMatter === undefined) {
    report(
      violations,
      'missing-front-matter',
      path,
      'document has no parseable `---` front matter block (status/topic/summary)',
    );
    return undefined;
  }
  const title = extractTitle(frontMatter.body);
  if (title === undefined) {
    report(violations, 'missing-title', path, 'document has no `# ` heading');
    return undefined;
  }
  for (const key of Object.keys(frontMatter.data)) {
    if (!(FRONT_MATTER_KEYS as readonly string[]).includes(key)) {
      report(
        violations,
        'unknown-front-matter-key',
        path,
        `unknown front-matter key ${JSON.stringify(key)}; allowed: ${FRONT_MATTER_KEYS.join(', ')}`,
      );
    }
  }
  const status = frontMatter.data['status'];
  if (status === undefined || !(DOC_STATUSES as readonly string[]).includes(status)) {
    report(
      violations,
      'invalid-status',
      path,
      `front matter status must be one of ${DOC_STATUSES.join(' | ')} (got ${JSON.stringify(status)})`,
    );
    return undefined;
  }
  const translationOf = frontMatter.data['translation_of'];
  if (translationOf !== undefined) {
    // Accept both a sibling-relative filename and a repo-relative path.
    const target = normalize(
      translationOf.startsWith('docs/') ? translationOf : join(dirname(path), translationOf),
    )
      .split('\\')
      .join('/');
    return {
      path,
      status: status as DocStatus,
      topic: '',
      summary: '',
      title,
      translationOf: target,
    };
  }
  const topic = frontMatter.data['topic'];
  const summary = frontMatter.data['summary'];
  if (topic === undefined || topic.trim() === '') {
    report(violations, 'missing-topic', path, 'front matter `topic` is required');
    return undefined;
  }
  if (summary === undefined || summary.trim() === '') {
    report(violations, 'missing-summary', path, 'front matter `summary` is required');
    return undefined;
  }
  if (topic.length > 100) {
    report(violations, 'topic-too-long', path, 'topic must be at most 100 characters');
    return undefined;
  }
  if (summary.length > 300) {
    report(violations, 'summary-too-long', path, 'summary must be at most 300 characters');
    return undefined;
  }
  return { path, status: status as DocStatus, topic, summary, title };
}

function loadDocs(root: string, violations: DocsIndexViolation[]): DocMeta[] {
  const dir = join(root, ARCH_DIR);
  if (!existsSync(dir)) {
    report(violations, 'missing-directory', ARCH_DIR, 'the architecture directory does not exist');
    return [];
  }
  const files = readdirSync(dir)
    .filter((name) => name.endsWith('.md') && name !== 'README.md')
    .sort()
    .map((name) => `${ARCH_DIR}/${name}`);
  const paths = [...files, GOVERNING_ENTRY_PATH];
  const docs = paths
    .map((path) => loadDoc(root, path, violations))
    .filter((doc): doc is DocMeta => doc !== undefined);

  // Translations inherit topic/summary from their target and are rendered with it.
  for (const doc of docs) {
    if (doc.translationOf === undefined) continue;
    const target = docs.find((candidate) => candidate.path === doc.translationOf);
    if (target === undefined) {
      report(
        violations,
        'translation-target-missing',
        doc.path,
        `translation_of points at ${JSON.stringify(doc.translationOf)}, which is not a listed document`,
      );
      continue;
    }
    if (target.translationOf !== undefined || target.status !== doc.status) {
      report(
        violations,
        'translation-target-invalid',
        doc.path,
        'a translation must point at a non-translation document with the same status',
      );
      continue;
    }
    doc.topic = target.topic;
    doc.summary = target.summary;
  }

  // One active document per topic (P6/ governance rule): translations excluded.
  const seen = new Map<string, string>();
  for (const doc of docs) {
    if (doc.status !== 'active' || doc.translationOf !== undefined) continue;
    const previous = seen.get(doc.topic);
    if (previous !== undefined) {
      report(
        violations,
        'duplicate-active-topic',
        doc.path,
        `topic ${JSON.stringify(doc.topic)} is already active at ${previous}`,
      );
    } else {
      seen.set(doc.topic, doc.path);
    }
  }
  return docs;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}

function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out: string[] = [];
  for (const item of value) {
    const text = asString(item);
    if (text === undefined) return undefined;
    out.push(text);
  }
  return out;
}

function loadHistory(
  root: string,
  violations: DocsIndexViolation[],
  deps: DocsIndexDeps,
): HistoryFile | undefined {
  const absolute = join(root, HISTORY_PATH);
  if (!existsSync(absolute)) {
    report(
      violations,
      'missing-history',
      HISTORY_PATH,
      'the removal/archive register does not exist',
    );
    return undefined;
  }
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(absolute, 'utf8'));
  } catch (error) {
    report(violations, 'invalid-history-json', HISTORY_PATH, `cannot parse JSON: ${String(error)}`);
    return undefined;
  }
  if (raw === null || typeof raw !== 'object') {
    report(violations, 'invalid-history-json', HISTORY_PATH, 'register must be a JSON object');
    return undefined;
  }
  const object = raw as Record<string, unknown>;
  if (object['schemaVersion'] !== 1) {
    report(violations, 'invalid-history-schema', HISTORY_PATH, 'schemaVersion must be 1');
  }
  const baselineCommit = asString(object['baselineCommit']);
  if (baselineCommit === undefined || !COMMIT_PATTERN.test(baselineCommit)) {
    report(
      violations,
      'invalid-history-baseline',
      HISTORY_PATH,
      'baselineCommit must be the full 40-hex commit the register was opened at',
    );
    return undefined;
  }
  const rawEntries = object['entries'];
  if (!Array.isArray(rawEntries)) {
    report(violations, 'invalid-history-entries', HISTORY_PATH, 'entries must be an array');
    return undefined;
  }
  const entries: HistoryEntry[] = [];
  const seenPaths = new RecoveredPathSet();
  for (const [index, value] of rawEntries.entries()) {
    const where = `entries[${index}]`;
    if (value === null || typeof value !== 'object') {
      report(violations, 'invalid-history-entry', HISTORY_PATH, `${where} must be an object`);
      continue;
    }
    const entry = value as Record<string, unknown>;
    const kind = asString(entry['kind']);
    if (kind !== 'removed' && kind !== 'archived') {
      report(
        violations,
        'invalid-history-entry',
        HISTORY_PATH,
        `${where}.kind must be removed | archived`,
      );
      continue;
    }
    const path = asString(entry['path']);
    const date = asString(entry['date']);
    const title = asString(entry['title']);
    const carried = asString(entry['carried']);
    const nowLivesIn = asStringArray(entry['nowLivesIn']);
    const recoveryRaw = entry['recovery'];
    const recovery =
      recoveryRaw !== null && typeof recoveryRaw === 'object'
        ? (recoveryRaw as Record<string, unknown>)
        : undefined;
    const recoveryCommit = recovery === undefined ? undefined : asString(recovery['commit']);
    const recoveryPath = recovery === undefined ? undefined : asString(recovery['path']);
    if (
      path === undefined ||
      date === undefined ||
      title === undefined ||
      carried === undefined ||
      nowLivesIn === undefined ||
      recoveryCommit === undefined ||
      recoveryPath === undefined
    ) {
      report(
        violations,
        'invalid-history-entry',
        HISTORY_PATH,
        `${where} requires path, date, title, carried, nowLivesIn[], recovery.commit, recovery.path`,
      );
      continue;
    }
    if (!DATE_PATTERN.test(date)) {
      report(violations, 'invalid-history-entry', HISTORY_PATH, `${where}.date must be YYYY-MM-DD`);
    }
    if (!COMMIT_PATTERN.test(recoveryCommit)) {
      report(
        violations,
        'invalid-history-entry',
        HISTORY_PATH,
        `${where}.recovery.commit must be the full 40-hex commit`,
      );
    }
    for (const candidate of nowLivesIn) {
      if (!existsSync(join(root, candidate))) {
        report(
          violations,
          'history-successor-missing',
          HISTORY_PATH,
          `${where}.nowLivesIn names ${candidate}, which does not exist in the tree`,
        );
      }
    }
    const exists = existsSync(join(root, path));
    if (kind === 'removed') {
      if (recoveryPath !== path) {
        report(
          violations,
          'history-recovery-mismatch',
          HISTORY_PATH,
          `${where}: a removed document's recovery.path must equal its path`,
        );
      }
      if (exists) {
        report(
          violations,
          'history-removed-path-exists',
          HISTORY_PATH,
          `${where}: ${path} is registered as removed but still exists in the tree`,
        );
      }
      if (entry['noSuccessor'] !== true && entry['noSuccessor'] !== false) {
        report(
          violations,
          'invalid-history-entry',
          HISTORY_PATH,
          `${where}.noSuccessor is required for a removed document (true | false)`,
        );
      }
    } else {
      if (!path.startsWith(`${LEGACY_DIR}/`)) {
        report(
          violations,
          'history-archived-outside-legacy',
          HISTORY_PATH,
          `${where}: an archived entry must live under ${LEGACY_DIR}/`,
        );
      }
      if (!exists) {
        report(
          violations,
          'history-archived-path-missing',
          HISTORY_PATH,
          `${where}: ${path} is registered as archived but does not exist`,
        );
      }
      if (existsSync(join(root, recoveryPath))) {
        report(
          violations,
          'history-recovery-path-exists',
          HISTORY_PATH,
          `${where}: recovery.path ${recoveryPath} still exists in the tree; it should be the pre-move path`,
        );
      }
      const status = asString(entry['status']);
      if (status === undefined) {
        report(
          violations,
          'invalid-history-entry',
          HISTORY_PATH,
          `${where}.status is required for an archived record`,
        );
      }
    }
    if (seenPaths.has(path)) {
      report(
        violations,
        'duplicate-history-path',
        HISTORY_PATH,
        `${where}: ${path} is registered twice`,
      );
    }
    seenPaths.add(path);
    if (recoveryPath !== undefined) seenPaths.addRecovery(recoveryPath);
    entries.push({
      kind,
      path,
      date,
      title,
      carried,
      nowLivesIn,
      noSuccessor: entry['noSuccessor'] === true,
      status: asString(entry['status']),
      recovery: { commit: recoveryCommit, path: recoveryPath },
    });
  }

  // Every file in the archive must be registered (tree -> register direction).
  if (existsSync(join(root, LEGACY_ADR_DIR))) {
    for (const name of readdirSync(join(root, LEGACY_ADR_DIR)).sort()) {
      if (!name.endsWith('.md')) continue;
      const path = `${LEGACY_ADR_DIR}/${name}`;
      if (!seenPaths.has(path)) {
        report(
          violations,
          'unregistered-archive',
          HISTORY_PATH,
          `${path} exists in the archive but has no history entry`,
        );
      }
    }
  }

  const deleted = listDeletedSince(root, baselineCommit, deps);
  if (deleted === undefined) {
    report(
      violations,
      'history-baseline-unreadable',
      HISTORY_PATH,
      `cannot read deletions since baseline ${baselineCommit}; the drift guard is blind without it`,
    );
  } else {
    for (const path of deleted) {
      // A path that is deleted only relative to the working branch, but never
      // existed at the baseline, is not a project-history removal (e.g. a file
      // added and removed inside the same unmerged change).
      if (!existedAtBaseline(root, baselineCommit, path, deps)) continue;
      if (!seenPaths.has(path) && !seenPaths.hasRecovery(path)) {
        report(
          violations,
          'unregistered-removal',
          HISTORY_PATH,
          `${path} was deleted since the baseline commit but has no history entry`,
        );
      }
    }
  }
  return { schemaVersion: 1, baselineCommit, entries };
}

class RecoveredPathSet {
  private readonly paths = new Set<string>();
  private readonly recovery = new Set<string>();

  has(path: string): boolean {
    return this.paths.has(path);
  }

  hasRecovery(path: string): boolean {
    return this.recovery.has(path);
  }

  add(path: string): void {
    this.paths.add(path);
  }

  addRecovery(path: string): void {
    this.recovery.add(path);
  }
}

/** The repo-relative link target from `file` to `target`. */
export function relativeLink(file: string, target: string): string {
  const from = dirname(file);
  const link = relative(from, target).split('\\').join('/');
  return link.startsWith('.') ? link : `./${link}`;
}

function linkOrCode(root: string, file: string, target: string, label: string): string {
  return existsSync(join(root, target))
    ? `[${label}](${relativeLink(file, target)})`
    : `\`${target}\``;
}

/** Render the generated block for `docs/architecture/README.md`. */
export function renderArchitectureIndex(docs: DocMeta[], root = '.'): string {
  const file = ARCH_INDEX_PATH;
  const translations = new Map<string, DocMeta[]>();
  for (const doc of docs) {
    if (doc.translationOf === undefined) continue;
    const list = translations.get(doc.translationOf) ?? [];
    list.push(doc);
    translations.set(doc.translationOf, list);
  }
  const rows = (status: DocStatus): string[] =>
    docs
      .filter((doc) => doc.status === status && doc.translationOf === undefined)
      .sort((a, b) => a.topic.localeCompare(b.topic) || a.path.localeCompare(b.path))
      .map((doc) => {
        const twins = translations.get(doc.path) ?? [];
        const label = twins
          .map((twin) => `[${twin.title}](${relativeLink(file, twin.path)})`)
          .join(' · ');
        const name = `${linkOrCode(root, file, doc.path, doc.title)}${label === '' ? '' : ` (${label})`}`;
        return `| ${doc.topic} | ${name} | ${doc.summary} |`;
      });
  const active = rows('active');
  const historical = rows('historical');
  const external = EXTERNAL_ENTRIES.map((entry) => {
    if (!existsSync(join(root, entry.path))) {
      return `- ${entry.label} — \`${entry.path}\` is missing`;
    }
    return `- [${entry.label}](${relativeLink(file, entry.path)})`;
  });
  const lines: string[] = [
    '## In force',
    '',
    'Every active document in this directory and the governing entry point outside it. The',
    "authority is each document's `status:` / `topic:` / `summary:` front matter; this table is",
    'generated by `@openelement/tools-repo#docs-index:write` and a hand edit fails `docs-index:check`.',
    '',
    '| Topic | Document | Summary |',
    '| --- | --- | --- |',
    ...active,
    '',
    '## Historical / evidence records (read-only)',
    '',
    'Design, spike and evidence records that do not govern current work. They stay in the tree so',
    'the ledger and the matrix can cite them; they are never cited as an active requirement.',
    '',
    '| Topic | Document | Summary |',
    '| --- | --- | --- |',
    ...historical,
    '',
    '## Governing entry points outside this directory',
    '',
    ...external,
    '',
    'A second active statement of the same topic is a defect. A change that alters which document is',
    'active updates the document front matter and runs `docs-index:write` in the same commit.',
  ];
  return lines.join('\n');
}

/** Render the generated block for `docs/legacy/README.md`. */
export function renderLegacyRegister(history: HistoryFile, root = '.'): string {
  const file = LEGACY_README_PATH;
  const archived = history.entries
    .filter((entry) => entry.kind === 'archived')
    .sort((a, b) => a.path.localeCompare(b.path));
  const removed = history.entries
    .filter((entry) => entry.kind === 'removed')
    .sort((a, b) => a.path.localeCompare(b.path));
  const lines: string[] = [
    '## Archived decision records',
    '',
    `| Record | Status | Carried | Recover at \`${history.baselineCommit.slice(0, 7)}\` |`,
    '| --- | --- | --- | --- |',
    ...archived.map((entry) => {
      const name = existsSync(join(root, entry.path))
        ? `[${entry.title}](${relativeLink(file, entry.path)})`
        : `\`${entry.path}\``;
      return `| ${name} | ${entry.status ?? ''} | ${entry.carried} | \`${entry.recovery.path}\` |`;
    }),
    '',
    '## Removed process documents',
    '',
    `| Document | Removed | What it carried | Where that responsibility lives now | Recover at \`${history.baselineCommit.slice(0, 7)}\` |`,
    '| --- | --- | --- | --- | --- |',
    ...removed.map((entry) => {
      const successors = entry.nowLivesIn.map((path) => {
        const doc = historySuccessorLabel(root, path);
        return existsSync(join(root, path))
          ? `[${doc}](${relativeLink(file, path)})`
          : `\`${path}\``;
      });
      const where =
        successors.length === 0
          ? entry.noSuccessor === true
            ? '**No in-tree successor**; recover from Git history'
            : '**No successor recorded**'
          : `${successors.join(', ')}${entry.noSuccessor === true ? ' (partial: no successor carries the full responsibility)' : ''}`;
      return `| \`${entry.path}\` | ${entry.date} | ${entry.carried} | ${where} | \`${entry.recovery.path}\` |`;
    }),
    '',
    'Recovery is the pre-change path at the baseline commit: `git show <baseline>:<path>` for both',
    'the archived records and the removed documents. The register is machine-checked by',
    '`@openelement/tools-repo#docs-index:check`; a deletion that is not registered here fails the gate.',
  ];
  return lines.join('\n');
}

/** Human label for a successor path: its topic, else its H1, else the path. */
function historySuccessorLabel(root: string, path: string): string {
  const absolute = join(root, path);
  if (!existsSync(absolute)) return path;
  const text = readFileSync(absolute, 'utf8');
  const frontMatter = parseFrontMatter(text);
  if (frontMatter !== undefined) {
    const topic = frontMatter.data['topic'];
    if (topic !== undefined && topic.trim() !== '') return topic;
  }
  return extractTitle(text) ?? path;
}

function defaultListDeletedSince(root: string, baselineCommit: string): string[] | undefined {
  try {
    const output = execFileSync(
      'git',
      [
        '-C',
        root,
        'log',
        '--diff-filter=D',
        '--name-only',
        '--format=',
        `${baselineCommit}..HEAD`,
        '--',
        'docs',
      ],
      { encoding: 'utf8' },
    );
    return output
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line !== '' && line.startsWith('docs/'))
      .sort();
  } catch {
    return undefined;
  }
}

function listDeletedSince(
  root: string,
  baselineCommit: string,
  deps: DocsIndexDeps,
): string[] | undefined {
  return deps.listDeletedSince
    ? deps.listDeletedSince(root, baselineCommit)
    : defaultListDeletedSince(root, baselineCommit);
}

function defaultExistedAtBaseline(root: string, baselineCommit: string, path: string): boolean {
  try {
    execFileSync('git', ['-C', root, 'cat-file', '-e', `${baselineCommit}:${path}`], {
      stdio: 'ignore',
    });
    return true;
  } catch {
    return false;
  }
}

function existedAtBaseline(
  root: string,
  baselineCommit: string,
  path: string,
  deps: DocsIndexDeps,
): boolean {
  return deps.existedAtBaseline
    ? deps.existedAtBaseline(root, baselineCommit, path)
    : defaultExistedAtBaseline(root, baselineCommit, path);
}

/** Resolve every relative link in `docs/**` outside the read-only archive. */
export function checkDocsLinks(root: string): DocsIndexViolation[] {
  const violations: DocsIndexViolation[] = [];
  const walk = (dir: string): void => {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const absolute = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (absolute.endsWith(LEGACY_DIR) || absolute.endsWith('node_modules')) continue;
        walk(absolute);
        continue;
      }
      if (!entry.name.endsWith('.md')) continue;
      const path = relative(root, absolute).split('\\').join('/');
      const text = readFileSync(absolute, 'utf8');
      for (const match of text.matchAll(/\[[^\]]*\]\(([^)\s]+)\)/g)) {
        const target = match[1]!;
        if (
          target.startsWith('https://') ||
          target.startsWith('http://') ||
          target.startsWith('mailto:') ||
          target.startsWith('#')
        ) {
          continue;
        }
        const file = target.split('#')[0]!;
        if (file === '') continue;
        const resolved = resolve(dirname(absolute), file);
        if (!existsSync(resolved)) {
          report(
            violations,
            'broken-doc-link',
            path,
            `link target ${JSON.stringify(target)} does not resolve (from ${path})`,
          );
        }
      }
    }
  };
  walk(join(root, 'docs'));
  return violations;
}

/** Check the current view against its authorities. */
export function checkDocsIndex(root = '.', deps: DocsIndexDeps = {}): DocsIndexReport {
  const violations: DocsIndexViolation[] = [];
  const docs = loadDocs(root, violations);
  const history = loadHistory(root, violations, deps);
  const architectureIndex = history === undefined ? '' : renderArchitectureIndex(docs, root);
  const legacyRegister = history === undefined ? '' : renderLegacyRegister(history, root);

  const checkBlock = (path: string, name: string, body: string): void => {
    const absolute = join(root, path);
    if (!existsSync(absolute)) {
      report(violations, 'missing-index-file', path, 'generated index file does not exist');
      return;
    }
    const text = readFileSync(absolute, 'utf8');
    const updated = upsertBlock(text, name, body);
    if (updated === undefined) {
      report(
        violations,
        'missing-generated-block',
        path,
        `file is missing the gen:begin/gen:end ${name} marker pair`,
      );
      return;
    }
    if (updated.changed) {
      report(
        violations,
        'index-drift',
        path,
        'generated block does not match its authorities; run `vp run --filter @openelement/tools-repo docs-index:write`',
      );
    }
  };
  if (history !== undefined) {
    checkBlock(ARCH_INDEX_PATH, ARCH_INDEX_BLOCK, architectureIndex);
    checkBlock(LEGACY_README_PATH, LEGACY_BLOCK, legacyRegister);
  }
  violations.push(...checkDocsLinks(root));
  return { docs, history, violations, architectureIndex, legacyRegister };
}

/** Regenerate the generated blocks in place. */
export function writeDocsIndex(root = '.', deps: DocsIndexDeps = {}): DocsIndexReport {
  const reportResult = checkDocsIndex(root, deps);
  if (reportResult.history === undefined) return reportResult;
  const blocks: Array<[string, string]> = [
    [ARCH_INDEX_PATH, 'architecture'],
    [LEGACY_README_PATH, 'legacy'],
  ];
  for (const [path] of blocks) {
    const absolute = join(root, path);
    if (!existsSync(absolute)) continue;
    const name = path === ARCH_INDEX_PATH ? ARCH_INDEX_BLOCK : LEGACY_BLOCK;
    const body =
      path === ARCH_INDEX_PATH ? reportResult.architectureIndex : reportResult.legacyRegister;
    const text = readFileSync(absolute, 'utf8');
    const updated = upsertBlock(text, name, body);
    if (updated !== undefined && updated.changed) writeFileSync(absolute, updated.text);
  }
  // Re-run the check after writing so the exit status reflects the written tree.
  return checkDocsIndex(root, deps);
}

function main(): number {
  const write = process.argv.includes('--write');
  let root = '.';
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith('--root=')) root = arg.slice('--root='.length);
  }
  const absoluteRoot = resolve(root);
  const result = write ? writeDocsIndex(absoluteRoot) : checkDocsIndex(absoluteRoot);
  if (result.violations.length > 0) {
    if (write) {
      console.error(
        `docs-index:write: regenerated the generated blocks but ${result.violations.length} violation(s) remain:`,
      );
    } else {
      console.error(`docs-index:check: ${result.violations.length} violation(s):`);
    }
    for (const violation of result.violations) {
      console.error(`  ${violation.kind}: ${violation.file}: ${violation.detail}`);
    }
    return 1;
  }
  const entries = result.history?.entries.length ?? 0;
  const active = result.docs.filter((doc) => doc.status === 'active').length;
  const historical = result.docs.length - active;
  if (write) {
    console.log(
      `docs-index:write: regenerated the current view (${active} active, ${historical} historical, ${entries} history entries).`,
    );
  } else {
    console.log(
      `docs-index:check: current view is generated, links resolve (${active} active document(s), ${historical} historical record(s), ${entries} archive/removal entr(ies)).`,
    );
  }
  return 0;
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  process.exitCode = main();
}
