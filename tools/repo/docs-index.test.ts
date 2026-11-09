/**
 * docs-index.test.ts — positive and negative proof for the docs-index generator
 * and drift guard.
 *
 * The tool replaces a hand-maintained current-view document with a generated
 * one: the authority is each document's front matter plus `docs/history.json`,
 * and the view is the marker-fenced block in the two READMEs. A check that only
 * reports "0 violations on today's tree" proves nothing about whether it would
 * catch a bad tree, so every rule below is pinned in the failure direction
 * against a throwaway fixture root — never the live docs tree, which is being
 * migrated concurrently with this suite. The deterministic git port
 * (`listDeletedSince` / `existedAtBaseline`) keeps deletion-drift proof off the
 * real repository and its history.
 *
 * Coverage mirrors check-adr-index.test.ts: one assertion direction per rule,
 * with the clean round trip as the only positive case.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, expect, test } from 'vitest';
import {
  ARCH_DIR,
  ARCH_INDEX_PATH,
  checkDocsIndex,
  GOVERNING_ENTRY_PATH,
  HISTORY_PATH,
  LEGACY_ADR_DIR,
  LEGACY_README_PATH,
  parseFrontMatter,
  writeDocsIndex,
  type DocsIndexDeps,
  type DocsIndexReport,
  type DocsIndexViolation,
  type HistoryEntry,
  type HistoryFile,
} from './docs-index.ts';

const COMMIT = 'a'.repeat(40);
const BASELINE_DATE = '2026-11-10';

/** Hand text plus the marker pair the writer fills, never touching the prose. */
const ARCH_README = [
  '# Architecture',
  '',
  'A hand-written preamble the generator must leave alone.',
  '',
  '<!-- gen:begin docs-architecture-index -->',
  '<!-- gen:end docs-architecture-index -->',
  '',
  'A hand-written coda the generator must leave alone.',
  '',
].join('\n');

const LEGACY_README = [
  '# Archive and removal register',
  '',
  '<!-- gen:begin docs-legacy-register -->',
  '<!-- gen:end docs-legacy-register -->',
  '',
].join('\n');

const ACTIVE_ALPHA_PATH = `${ARCH_DIR}/z-active.md`;
const ACTIVE_ZETA_PATH = `${ARCH_DIR}/a-active.md`;
const HISTORICAL_PATH = `${ARCH_DIR}/historical.md`;
const ARCHIVED_ADR_PATH = `${LEGACY_ADR_DIR}/ADR-0001-example.md`;
const REMOVED_PATH = `${ARCH_DIR}/old-process.md`;
const ADR_INDEX_PATH = 'docs/adr/README.md';
const RELEASE_STATE_PATH = 'docs/release/release-state.json';

function metadataDoc(lines: readonly string[], title: string): string {
  return ['---', ...lines, '---', '', `# ${title}`, '', 'Fixture body.', ''].join('\n');
}

function document(status: string, topic: string, summary: string, title: string): string {
  return metadataDoc([`status: ${status}`, `topic: ${topic}`, `summary: ${summary}`], title);
}

function translationDoc(target: string, title: string): string {
  return metadataDoc(['status: active', `translation_of: ${target}`], title);
}

function archivedEntry(): HistoryEntry {
  return {
    kind: 'archived',
    path: ARCHIVED_ADR_PATH,
    date: BASELINE_DATE,
    title: 'ADR-0001: Example decision',
    carried: 'the example decision',
    status: 'SUPERSEDED by ADR-0009',
    nowLivesIn: [],
    recovery: { commit: COMMIT, path: 'docs/adr/ADR-0001-example.md' },
  };
}

function removedEntry(): HistoryEntry {
  return {
    kind: 'removed',
    path: REMOVED_PATH,
    date: BASELINE_DATE,
    title: 'Old process',
    carried: 'the old process',
    nowLivesIn: [],
    noSuccessor: true,
    recovery: { commit: COMMIT, path: REMOVED_PATH },
  };
}

function baseEntries(): HistoryEntry[] {
  return [archivedEntry(), removedEntry()];
}

function historyJson(entries: HistoryEntry[]): string {
  const history: HistoryFile = { schemaVersion: 1, baselineCommit: COMMIT, entries };
  return `${JSON.stringify(history, null, 2)}\n`;
}

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function writeRoot(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'openelement-docs-index-'));
  roots.push(root);
  for (const [path, content] of Object.entries(files)) {
    const absolute = join(root, path);
    mkdirSync(dirname(absolute), { recursive: true });
    writeFileSync(absolute, content);
  }
  return root;
}

/** A complete, clean tree; `overrides` adds/replaces a file (null removes it). */
function fixture(
  overrides: Record<string, string | null> = {},
  entries: HistoryEntry[] = baseEntries(),
): string {
  const files: Record<string, string> = {
    [ARCH_INDEX_PATH]: ARCH_README,
    [ACTIVE_ALPHA_PATH]: document('active', 'Alpha topic', 'First summary.', 'Alpha doc'),
    [ACTIVE_ZETA_PATH]: document('active', 'Zeta topic', 'Second summary.', 'Zeta doc'),
    [HISTORICAL_PATH]: document(
      'historical',
      'Historical record',
      'The old record.',
      'Historical doc',
    ),
    [GOVERNING_ENTRY_PATH]: document(
      'active',
      'Agent contract',
      'The governing entry point.',
      'Agent contract',
    ),
    [LEGACY_README_PATH]: LEGACY_README,
    [ARCHIVED_ADR_PATH]: '# ADR-0001: Example decision\n\nArchived record.\n',
    [ADR_INDEX_PATH]: '# Decision records\n',
    [RELEASE_STATE_PATH]: '{}\n',
    [HISTORY_PATH]: historyJson(entries),
  };
  for (const [path, content] of Object.entries(overrides)) {
    if (content === null) delete files[path];
    else files[path] = content;
  }
  return writeRoot(files);
}

/** Deterministic git port: the suite never shells out to a real repository. */
function gitPorts(deleted: readonly string[] = [], atBaseline = true): DocsIndexDeps {
  return {
    listDeletedSince: () => [...deleted],
    existedAtBaseline: () => atBaseline,
  };
}

/** Settle the generated blocks around a mutation, then check the settled tree. */
function settled(root: string, deps: DocsIndexDeps = gitPorts()): DocsIndexReport {
  writeDocsIndex(root, deps);
  return checkDocsIndex(root, deps);
}

function kinds(violations: DocsIndexViolation[]): string[] {
  return violations.map((violation) => violation.kind);
}

function expectViolation(report: DocsIndexReport, kind: string, file: string): DocsIndexViolation {
  const hit = report.violations.find(
    (violation) => violation.kind === kind && violation.file === file,
  );
  expect(
    hit,
    `expected ${kind} on ${file}; got ${
      report.violations.map((violation) => `${violation.kind} on ${violation.file}`).join('; ') ||
      'no violations'
    }`,
  ).toBeDefined();
  return hit!;
}

function read(root: string, path: string): string {
  return readFileSync(join(root, path), 'utf8');
}

function write(root: string, path: string, text: string): void {
  writeFileSync(join(root, path), text);
}

test('parseFrontMatter reads a flat scalar block and strips quoted values', () => {
  const parsed = parseFrontMatter(
    [
      '---',
      'status: "active"',
      "topic: 'quoted topic'",
      'summary: plain summary',
      '---',
      '',
      '# Title',
      '',
      'Body',
      '',
    ].join('\n'),
  );
  expect(parsed?.data).toEqual({
    status: 'active',
    topic: 'quoted topic',
    summary: 'plain summary',
  });
  expect(parsed?.body).toBe('\n# Title\n\nBody\n');
});

test('parseFrontMatter rejects a missing or unterminated block', () => {
  expect(parseFrontMatter('# Title\n\nBody\n')).toBeUndefined();
  expect(parseFrontMatter('---\nstatus: active\n# Unterminated\n')).toBeUndefined();
});

test('parseFrontMatter rejects malformed, nested and duplicate keys instead of guessing', () => {
  for (const text of [
    '---\nstatus active\n---\n',
    '---\nstatus: active\nmetadata:\n  owner: someone\n---\n',
    '---\nstatus: active\nstatus: historical\n---\n',
    '---\nStatus: active\n---\n',
  ]) {
    expect(parseFrontMatter(text), text).toBeUndefined();
  }
});

test('a valid tree round-trips: writeDocsIndex then checkDocsIndex is clean', () => {
  const root = fixture();
  const deps = gitPorts();
  const written = writeDocsIndex(root, deps);
  expect(written.violations).toEqual([]);
  const report = checkDocsIndex(root, deps);
  expect(report.violations).toEqual([]);
  expect(report.history?.baselineCommit).toBe(COMMIT);
  expect(report.history?.entries).toHaveLength(2);
  expect(report.docs.map((doc) => `${doc.status}:${doc.topic}`).sort()).toEqual([
    'active:Agent contract',
    'active:Alpha topic',
    'active:Zeta topic',
    'historical:Historical record',
  ]);
  const readme = read(root, ARCH_INDEX_PATH);
  expect(readme).toContain('A hand-written preamble the generator must leave alone.');
  expect(readme).toContain('A hand-written coda the generator must leave alone.');
  expect(readme).toContain(report.architectureIndex);
  expect(read(root, LEGACY_README_PATH)).toContain(report.legacyRegister);
});

test('the generated blocks sort active rows by topic and link the external entry points', () => {
  const root = fixture();
  const written = writeDocsIndex(root, gitPorts());
  const index = written.architectureIndex;
  const position = (marker: string): number => {
    const at = index.indexOf(marker);
    expect(at, `missing ${JSON.stringify(marker)} from the generated block`).toBeGreaterThanOrEqual(
      0,
    );
    return at;
  };
  // z-active.md carries "Alpha topic" and a-active.md carries "Zeta topic": a
  // path-ordered table would invert this pair, so the shown order is topic order.
  expect(position('| Agent contract |')).toBeLessThan(position('| Alpha topic |'));
  expect(position('| Alpha topic |')).toBeLessThan(position('| Zeta topic |'));
  const historicalSection = position('## Historical / evidence records (read-only)');
  expect(position('| Alpha topic |')).toBeLessThan(historicalSection);
  expect(position('| Historical record |')).toBeGreaterThan(historicalSection);
  expect(index).toContain('| Alpha topic | [Alpha doc](./z-active.md) | First summary. |');
  expect(index).toContain(
    '| Historical record | [Historical doc](./historical.md) | The old record. |',
  );
  expect(index).toContain('- [Active decision records](../adr/README.md)');
  expect(index).toContain('- [Archive and removal register](../legacy/README.md)');
  expect(index).toContain('- [Release state](../release/release-state.json)');
  for (const path of [ADR_INDEX_PATH, LEGACY_README_PATH, RELEASE_STATE_PATH]) {
    expect(existsSync(join(root, path)), `${path} must exist for its link to resolve`).toBe(true);
  }
  expect(written.legacyRegister).toContain(
    '| [ADR-0001: Example decision](./adr/ADR-0001-example.md)',
  );
  expect(written.legacyRegister).toContain(`\`${REMOVED_PATH}\``);
});

test('a hand edit inside a generated block is index-drift and never becomes the authority', () => {
  const root = fixture();
  const deps = gitPorts();
  const settledReport = writeDocsIndex(root, deps);
  expect(settledReport.violations).toEqual([]);
  const before = settledReport.docs.map((doc) => [doc.path, doc.topic, doc.summary]);
  const readmePath = join(root, ARCH_INDEX_PATH);
  const original = readFileSync(readmePath, 'utf8');
  const handEdited = original.replace('| Alpha topic |', '| Tampered topic |');
  expect(handEdited).not.toBe(original);
  writeFileSync(readmePath, handEdited);
  const report = checkDocsIndex(root, deps);
  expect(kinds(report.violations)).toEqual(['index-drift']);
  expect(report.violations[0]!.file).toBe(ARCH_INDEX_PATH);
  expect(report.architectureIndex).not.toContain('Tampered topic');
  // The README is a rendered view: the hand edit changes no document's authority.
  expect(report.docs.map((doc) => [doc.path, doc.topic, doc.summary])).toEqual(before);
});

test('a document without a front-matter block is missing-front-matter', () => {
  const report = settled(
    fixture({ [ACTIVE_ALPHA_PATH]: '# Alpha doc\n\nA governing document with no metadata.\n' }),
  );
  expect(kinds(report.violations)).toEqual(['missing-front-matter']);
  expectViolation(report, 'missing-front-matter', ACTIVE_ALPHA_PATH);
});

test('a status outside the closed vocabulary is invalid-status', () => {
  const report = settled(
    fixture({ [ACTIVE_ALPHA_PATH]: document('retired', 'Alpha topic', 'First summary.', 'Alpha') }),
  );
  expect(kinds(report.violations)).toEqual(['invalid-status']);
  expectViolation(report, 'invalid-status', ACTIVE_ALPHA_PATH);
});

test('a document whose front matter has no topic is missing-topic', () => {
  const report = settled(
    fixture({
      [ACTIVE_ALPHA_PATH]: metadataDoc(['status: active', 'summary: First summary.'], 'Alpha doc'),
    }),
  );
  expect(kinds(report.violations)).toEqual(['missing-topic']);
  expectViolation(report, 'missing-topic', ACTIVE_ALPHA_PATH);
});

test('a document whose front matter has no summary is missing-summary', () => {
  const report = settled(
    fixture({
      [ACTIVE_ALPHA_PATH]: metadataDoc(['status: active', 'topic: Alpha topic'], 'Alpha doc'),
    }),
  );
  expect(kinds(report.violations)).toEqual(['missing-summary']);
  expectViolation(report, 'missing-summary', ACTIVE_ALPHA_PATH);
});

test('an unknown front-matter key fails closed', () => {
  const report = settled(
    fixture({
      [ACTIVE_ALPHA_PATH]: metadataDoc(
        ['status: active', 'topic: Alpha topic', 'summary: First summary.', 'owner: someone'],
        'Alpha doc',
      ),
    }),
  );
  expect(kinds(report.violations)).toEqual(['unknown-front-matter-key']);
  const violation = expectViolation(report, 'unknown-front-matter-key', ACTIVE_ALPHA_PATH);
  expect(violation.detail).toContain('"owner"');
});

test('two active documents claiming the same topic are reported', () => {
  const report = settled(
    fixture({
      [`${ARCH_DIR}/dup-a.md`]: document('active', 'Duplicate topic', 'One.', 'Dup A'),
      [`${ARCH_DIR}/dup-b.md`]: document('active', 'Duplicate topic', 'Two.', 'Dup B'),
    }),
  );
  expect(kinds(report.violations)).toEqual(['duplicate-active-topic']);
  const violation = expectViolation(report, 'duplicate-active-topic', `${ARCH_DIR}/dup-b.md`);
  expect(violation.detail).toContain('Duplicate topic');
});

test('a translation twin inherits its target topic and is rendered in the same row', () => {
  const twinPath = `${ARCH_DIR}/z-active.zh.md`;
  const report = settled(
    fixture({ [twinPath]: translationDoc(ACTIVE_ALPHA_PATH, 'Alpha doc (中文)') }),
  );
  expect(report.violations).toEqual([]);
  const twin = report.docs.find((doc) => doc.path === twinPath);
  expect(twin?.topic).toBe('Alpha topic');
  expect(twin?.summary).toBe('First summary.');
  expect(report.architectureIndex).toContain(
    '| Alpha topic | [Alpha doc](./z-active.md) ([Alpha doc (中文)](./z-active.zh.md)) | First summary. |',
  );
  // One row, not two: a translation is not a second active statement of a topic.
  expect(report.architectureIndex.match(/\| Alpha topic \|/g)).toHaveLength(1);
});

test('a translation_of target that is missing or not a listed document is reported', () => {
  const twinPath = `${ARCH_DIR}/orphan.zh.md`;
  const missing = settled(
    fixture({ [twinPath]: translationDoc(`${ARCH_DIR}/does-not-exist.md`, 'Orphan 中文') }),
  );
  expectViolation(missing, 'translation-target-missing', twinPath);
  const unlisted = settled(fixture({ [twinPath]: translationDoc(ARCH_INDEX_PATH, 'Orphan 中文') }));
  const violation = expectViolation(unlisted, 'translation-target-missing', twinPath);
  expect(violation.detail).toContain('not a listed document');
});

test('a removed record whose path still exists in the tree is reported', () => {
  const entries = [
    archivedEntry(),
    {
      ...removedEntry(),
      path: ACTIVE_ALPHA_PATH,
      recovery: { commit: COMMIT, path: ACTIVE_ALPHA_PATH },
    },
  ];
  const report = settled(fixture({}, entries));
  expect(kinds(report.violations)).toEqual(['history-removed-path-exists']);
  const violation = expectViolation(report, 'history-removed-path-exists', HISTORY_PATH);
  expect(violation.detail).toContain(ACTIVE_ALPHA_PATH);
});

test('an archived record whose file is missing from the archive is reported', () => {
  const entries = [
    archivedEntry(),
    removedEntry(),
    {
      ...archivedEntry(),
      path: `${LEGACY_ADR_DIR}/ADR-0002-missing.md`,
      title: 'ADR-0002: Missing record',
      recovery: { commit: COMMIT, path: 'docs/adr/ADR-0002-missing.md' },
    },
  ];
  const report = settled(fixture({}, entries));
  expect(kinds(report.violations)).toEqual(['history-archived-path-missing']);
  expectViolation(report, 'history-archived-path-missing', HISTORY_PATH);
});

test('an archive file with no history entry is unregistered-archive', () => {
  const report = settled(
    fixture({ [`${LEGACY_ADR_DIR}/ADR-0002-unregistered.md`]: '# ADR-0002: Unregistered\n' }),
  );
  expect(kinds(report.violations)).toEqual(['unregistered-archive']);
  const violation = expectViolation(report, 'unregistered-archive', HISTORY_PATH);
  expect(violation.detail).toContain('ADR-0002-unregistered.md');
});

test('a nowLivesIn successor that does not exist in the tree is reported', () => {
  const entries = [archivedEntry(), { ...removedEntry(), nowLivesIn: [`${ARCH_DIR}/gone.md`] }];
  const report = settled(fixture({}, entries));
  expect(kinds(report.violations)).toEqual(['history-successor-missing']);
  const violation = expectViolation(report, 'history-successor-missing', HISTORY_PATH);
  expect(violation.detail).toContain(`${ARCH_DIR}/gone.md`);
});

test('a removed record whose recovery.path differs from its path is reported', () => {
  const entries = [
    archivedEntry(),
    { ...removedEntry(), recovery: { commit: COMMIT, path: `${ARCH_DIR}/elsewhere.md` } },
  ];
  const report = settled(fixture({}, entries));
  expect(kinds(report.violations)).toEqual(['history-recovery-mismatch']);
  expectViolation(report, 'history-recovery-mismatch', HISTORY_PATH);
});

test('a deletion since the baseline with no history entry is unregistered-removal', () => {
  const root = fixture();
  expect(writeDocsIndex(root, gitPorts()).violations).toEqual([]);
  const deleted = `${ARCH_DIR}/deleted.md`;
  const report = checkDocsIndex(root, gitPorts([deleted], true));
  expect(kinds(report.violations)).toEqual(['unregistered-removal']);
  const violation = expectViolation(report, 'unregistered-removal', HISTORY_PATH);
  expect(violation.detail).toContain(deleted);
});

test('a path added and removed inside one unmerged change is not a removal', () => {
  const root = fixture();
  expect(writeDocsIndex(root, gitPorts()).violations).toEqual([]);
  const neverAtBaseline = `${ARCH_DIR}/added-then-removed.md`;
  expect(checkDocsIndex(root, gitPorts([neverAtBaseline], false)).violations).toEqual([]);
});

test('a deletion covered by an archived record recovery.path needs no removed entry', () => {
  const root = fixture();
  expect(writeDocsIndex(root, gitPorts()).violations).toEqual([]);
  const preMovePath = 'docs/adr/ADR-0001-example.md';
  expect(checkDocsIndex(root, gitPorts([preMovePath], true)).violations).toEqual([]);
});

test('a broken relative link in an active document is broken-doc-link', () => {
  const root = fixture();
  expect(writeDocsIndex(root, gitPorts()).violations).toEqual([]);
  const activeDoc = join(root, ACTIVE_ALPHA_PATH);
  writeFileSync(
    activeDoc,
    `${readFileSync(activeDoc, 'utf8')}\n[Missing note](./missing-note.md)\n`,
  );
  const report = checkDocsIndex(root, gitPorts());
  expect(kinds(report.violations)).toEqual(['broken-doc-link']);
  const violation = expectViolation(report, 'broken-doc-link', ACTIVE_ALPHA_PATH);
  expect(violation.detail).toContain('missing-note.md');
});

test('the same broken link inside docs/legacy/ is ignored (read-only archive)', () => {
  const root = fixture();
  expect(writeDocsIndex(root, gitPorts()).violations).toEqual([]);
  const legacyReadme = join(root, LEGACY_README_PATH);
  writeFileSync(
    legacyReadme,
    `${readFileSync(legacyReadme, 'utf8')}\n[Missing note](./missing-note.md)\n`,
  );
  expect(checkDocsIndex(root, gitPorts()).violations).toEqual([]);
});

test('two consecutive writes produce identical bytes', () => {
  const root = fixture();
  writeDocsIndex(root, gitPorts());
  const first = [read(root, ARCH_INDEX_PATH), read(root, LEGACY_README_PATH)];
  writeDocsIndex(root, gitPorts());
  expect([read(root, ARCH_INDEX_PATH), read(root, LEGACY_README_PATH)]).toEqual(first);
});

test('a missing marker pair is missing-generated-block, not silent acceptance', () => {
  const root = fixture();
  expect(writeDocsIndex(root, gitPorts()).violations).toEqual([]);
  write(root, ARCH_INDEX_PATH, '# Architecture\n\nHand text with the generated block removed.\n');
  const report = checkDocsIndex(root, gitPorts());
  expect(kinds(report.violations)).toEqual(['missing-generated-block']);
  expect(report.violations[0]!.file).toBe(ARCH_INDEX_PATH);
  expect(report.violations[0]!.detail).toContain('docs-architecture-index');
});
