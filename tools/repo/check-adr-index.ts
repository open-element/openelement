/**
 * check-adr-index.ts — the mechanical reader for the ADR index (P7/P5/P8).
 *
 * `docs/adr/README.md` is the decision-record registry. The prose policy it
 * carries is only a policy while someone re-derives it by hand: a link can rot,
 * a new record can land unindexed, and a retained non-active record can be
 * listed as if it still governed. This check makes the three machine-checkable
 * rules of that policy fail closed:
 *
 *   1. **Every record is listed exactly once.** Every `docs/adr/ADR-NNNN-*.md`
 *      file must be the target of exactly one index entry; a link that resolves
 *      to no file is a violation, a record no entry names is a violation, and a
 *      record two entries name is a violation.
 *   2. **A record that no longer governs says so in the index.** The entry may
 *      carry one annotation from the closed vocabulary
 *      `SUPERSEDED` / `RETIRED` / `EXECUTED` / `AMENDED` after an em dash; any
 *      other leading token is a violation.
 *   3. **The annotation agrees with the record.** The record's own `Status:`
 *      line is the authority. A record that declares itself superseded /
 *      retired / executed MUST be annotated with that same token, and an entry
 *      carrying one of those tokens MUST have a record that declares it. An
 *      `AMENDED` entry must point at a record with an amendment (an `AMENDED`
 *      status token or an amendment section) — an amended record stays active,
 *      which is why `AMENDED` is the one optional annotation.
 *
 * A scan that reads no entries fails closed instead of reporting a vacuous
 * pass, and the CLI prints the record/annotation counts so a shrinking index is
 * visible.
 *
 * CLI:
 *   node tools/repo/check-adr-index.ts [--root=<dir>]
 * Exit 0 = every record is indexed once, every link resolves, and every
 * annotation agrees with its record; 1 = at least one violation (printed with
 * file:line).
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

export const ADR_DIR = 'docs/adr';
export const ADR_INDEX_PATH = 'docs/adr/README.md';
/** Closed records are archived here; they remain in the index but not in ADR_DIR. */
export const LEGACY_ADR_DIR = 'docs/legacy/adr';

/** The record-file spelling the index is required to cover. */
export const RECORD_FILE_PATTERN = /^ADR-\d{4}-[A-Za-z0-9-]+\.md$/;

/**
 * The closed annotation vocabulary. `SUPERSEDED` / `RETIRED` / `EXECUTED` are
 * non-active statuses and are REQUIRED on the entry; `AMENDED` is optional
 * (an amended record stays active).
 */
export const ANNOTATION_VOCABULARY = ['SUPERSEDED', 'RETIRED', 'EXECUTED', 'AMENDED'] as const;

/** The annotations that must be mirrored from the record's own status. */
export const REQUIRED_ANNOTATIONS = ['SUPERSEDED', 'RETIRED', 'EXECUTED'] as const;

export type AdrAnnotation = (typeof ANNOTATION_VOCABULARY)[number];

export type AdrIndexViolationKind =
  | 'index-missing'
  | 'entry-malformed'
  | 'link-unresolved'
  | 'record-not-indexed'
  | 'record-indexed-twice'
  | 'record-status-missing'
  | 'unknown-annotation'
  | 'annotation-missing'
  | 'annotation-mismatch'
  | 'amendment-unbacked'
  | 'vacuous';

export interface AdrIndexViolation {
  kind: AdrIndexViolationKind;
  /** 1-based line in the index; 0 for whole-index violations. */
  line: number;
  detail: string;
}

export interface AdrIndexEntry {
  /** 1-based line in `docs/adr/README.md`. */
  line: number;
  /** Link label as written. */
  label: string;
  /** Record file name (the `./`-relative link target). */
  file: string;
  /** The closed-vocabulary annotation, or undefined for an active entry. */
  annotation?: AdrAnnotation;
  /** Raw annotation text after the em dash, when present. */
  annotationText?: string;
}

export interface AdrIndexReport {
  entryCount: number;
  /** Entries whose link resolved to a record file. */
  resolvedCount: number;
  /** Entries carrying a closed-vocabulary annotation. */
  annotatedCount: number;
  recordCount: number;
  violations: AdrIndexViolation[];
}

/** One `- [label](./ADR-….md) — ANNOTATION …` index line. */
const ENTRY_PATTERN = /^-\s+\[([^\]]+)\]\(([^)\s]+)\)\s*(?:—\s*(.*))?$/;

/** The leading uppercase token of an annotation text, e.g. `RETIRED: x`. */
const TOKEN_PATTERN = /^([A-Z]+)/;

/** A record's status banner, wherever it sits in the head of the file. */
const STATUS_LINE_PATTERN = /^-\s+\*{0,2}Status\*{0,2}:\s*(.*)$/im;

/** An amendment section heading or mention (ADR-0166's `## Amended status`). */
const AMENDMENT_MARKER_PATTERN = /^##\s+Amend(?:ed|ment)\b/m;

/**
 * Parse the index. Only entry lines are structural; prose is ignored. A line
 * that looks like an entry but does not match the link shape is reported, so a
 * typo cannot silently drop a record from the registry's view.
 */
export function parseAdrIndex(markdown: string): {
  entries: AdrIndexEntry[];
  violations: AdrIndexViolation[];
} {
  const entries: AdrIndexEntry[] = [];
  const violations: AdrIndexViolation[] = [];
  markdown.split(/\r?\n/).forEach((text, index) => {
    const line = index + 1;
    if (!/^-\s+\[/.test(text)) return;
    const match = ENTRY_PATTERN.exec(text);
    if (match === null) {
      violations.push({
        kind: 'entry-malformed',
        line,
        detail: `index entry does not match '- [label](./ADR-….md)': ${text.trim()}`,
      });
      return;
    }
    const label = match[1]!.trim();
    const target = match[2]!.trim();
    const file = basename(target);
    if (!RECORD_FILE_PATTERN.test(file)) {
      violations.push({
        kind: 'entry-malformed',
        line,
        detail: `entry ${JSON.stringify(label)} does not link a record file (${JSON.stringify(target)})`,
      });
      return;
    }
    const annotationText = match[3]?.trim();
    const entry: AdrIndexEntry = { line, label, file };
    if (annotationText !== undefined && annotationText !== '') {
      const token = TOKEN_PATTERN.exec(annotationText)?.[1];
      if (token === undefined || !isAnnotation(token)) {
        violations.push({
          kind: 'unknown-annotation',
          line,
          detail:
            `entry ${JSON.stringify(label)}: annotation ${JSON.stringify(annotationText)} is not one of ` +
            ANNOTATION_VOCABULARY.join(' / '),
        });
      } else {
        entry.annotation = token;
        entry.annotationText = annotationText;
      }
    }
    entries.push(entry);
  });
  return { entries, violations };
}

function isAnnotation(token: string): token is AdrAnnotation {
  return (ANNOTATION_VOCABULARY as readonly string[]).includes(token);
}

/**
 * The status a record declares about itself: the first closed-vocabulary token
 * in its status banner (which may wrap onto the following lines for the
 * `AMENDED` half of an amended record), or undefined for a plain ACCEPTED
 * record.
 */
export function declaredRecordStatus(markdown: string): AdrAnnotation | undefined {
  const match = STATUS_LINE_PATTERN.exec(markdown);
  if (match === null) return undefined;
  const start = match.index;
  const banner = markdown
    .slice(start, start + 600)
    .split(/\r?\n/)
    .slice(0, 6)
    .join('\n');
  for (const token of ANNOTATION_VOCABULARY) {
    if (new RegExp(`\\b${token}\\b`).test(banner)) return token;
  }
  return undefined;
}

/** Whether the record carries an amendment at all (status token or section). */
export function hasAmendment(markdown: string): boolean {
  return declaredRecordStatus(markdown) === 'AMENDED' || AMENDMENT_MARKER_PATTERN.test(markdown);
}

/**
 * Check one index against the records it is supposed to cover.
 *
 * `listRecords` returns the record file names on disk (undefined when the
 * directory is unreadable — that fails closed); `readRecord` returns a record's
 * text, or undefined when the entry's link resolves to nothing.
 */
export function checkAdrIndexMarkdown(
  markdown: string,
  listRecords: () => string[] | undefined,
  readRecord: (file: string) => string | undefined,
): AdrIndexReport {
  const { entries, violations } = parseAdrIndex(markdown);
  const recordFiles = listRecords();
  if (recordFiles === undefined) {
    violations.push({
      kind: 'index-missing',
      line: 0,
      detail: `${ADR_DIR} is unreadable — refusing to report a vacuous pass`,
    });
    return { entryCount: 0, resolvedCount: 0, annotatedCount: 0, recordCount: 0, violations };
  }
  const records = recordFiles.filter((file) => RECORD_FILE_PATTERN.test(file));
  const seen = new Map<string, number>();
  let resolvedCount = 0;
  let annotatedCount = 0;

  for (const entry of entries) {
    const previous = seen.get(entry.file);
    if (previous !== undefined) {
      violations.push({
        kind: 'record-indexed-twice',
        line: entry.line,
        detail: `record ${entry.file} is already listed on line ${previous}`,
      });
      continue;
    }
    seen.set(entry.file, entry.line);
    const record = readRecord(entry.file);
    if (record === undefined) {
      violations.push({
        kind: 'link-unresolved',
        line: entry.line,
        detail: `entry ${JSON.stringify(entry.label)}: ${entry.file} does not exist`,
      });
      continue;
    }
    resolvedCount++;
    const declared = declaredRecordStatus(record);
    if (declared === undefined && !/^-\s+\*{0,2}Status\*{0,2}:/im.test(record)) {
      violations.push({
        kind: 'record-status-missing',
        line: entry.line,
        detail: `record ${entry.file} carries no '- Status:' line to agree with`,
      });
      continue;
    }
    const requiresAnnotation =
      declared !== undefined && (REQUIRED_ANNOTATIONS as readonly string[]).includes(declared);
    if (requiresAnnotation && entry.annotation !== declared) {
      violations.push({
        kind: entry.annotation === undefined ? 'annotation-missing' : 'annotation-mismatch',
        line: entry.line,
        detail:
          `record ${entry.file} declares ${declared}, but the entry ` +
          (entry.annotation === undefined
            ? 'carries no annotation'
            : `is annotated ${entry.annotation}`),
      });
      continue;
    }
    if (
      entry.annotation !== undefined &&
      (REQUIRED_ANNOTATIONS as readonly string[]).includes(entry.annotation) &&
      entry.annotation !== declared
    ) {
      violations.push({
        kind: 'annotation-mismatch',
        line: entry.line,
        detail: `entry ${entry.file} is annotated ${entry.annotation}, but the record declares ${declared ?? 'no non-active status'}`,
      });
      continue;
    }
    if (entry.annotation === 'AMENDED' && !hasAmendment(record)) {
      violations.push({
        kind: 'amendment-unbacked',
        line: entry.line,
        detail: `entry ${entry.file} is annotated AMENDED, but the record carries no amendment`,
      });
      continue;
    }
    if (entry.annotation !== undefined) annotatedCount++;
  }

  for (const file of records) {
    if (!seen.has(file)) {
      violations.push({
        kind: 'record-not-indexed',
        line: 0,
        detail: `record ${file} exists but no index entry links it`,
      });
    }
  }
  if (entries.length === 0) {
    violations.push({
      kind: 'vacuous',
      line: 0,
      detail: 'the index lists no records — refusing a vacuous pass',
    });
  }
  return {
    entryCount: entries.length,
    resolvedCount,
    annotatedCount,
    recordCount: records.length,
    violations,
  };
}

/** Read and check `<root>/docs/adr/README.md` against `<root>/docs/adr`. */
export function checkAdrIndex(root: string): AdrIndexReport {
  const indexFile = join(root, ADR_INDEX_PATH);
  if (!existsSync(indexFile)) {
    return {
      entryCount: 0,
      resolvedCount: 0,
      annotatedCount: 0,
      recordCount: 0,
      violations: [{ kind: 'index-missing', line: 0, detail: `${ADR_INDEX_PATH} does not exist` }],
    };
  }
  const markdown = readFileSync(indexFile, 'utf8');
  const readRecord = (file: string): string | undefined => {
    for (const dir of [ADR_DIR, LEGACY_ADR_DIR]) {
      const path = join(root, dir, file);
      if (!existsSync(path)) continue;
      try {
        return readFileSync(path, 'utf8');
      } catch {
        return undefined;
      }
    }
    return undefined;
  };
  return checkAdrIndexMarkdown(
    markdown,
    () => {
      let files: string[];
      try {
        files = readdirSync(join(root, ADR_DIR));
      } catch {
        return undefined;
      }
      try {
        files = files.concat(readdirSync(join(root, LEGACY_ADR_DIR)));
      } catch {
        // The archive is optional; an absent legacy directory is not a failure.
      }
      return [...new Set(files)];
    },
    readRecord,
  );
}

function formatViolation(violation: AdrIndexViolation): string {
  const where = violation.line > 0 ? `${ADR_INDEX_PATH}:${violation.line}` : ADR_INDEX_PATH;
  return `${where}: ${violation.kind}: ${violation.detail}`;
}

function main(): void {
  const arg = process.argv.slice(2).find((token) => token.startsWith('--root='));
  const root = resolve(
    arg !== undefined
      ? arg.slice('--root='.length)
      : fileURLToPath(new URL('../..', import.meta.url)),
  );
  const report = checkAdrIndex(root);
  if (report.violations.length > 0) {
    console.error(
      `adr-index:check: ${report.violations.length} violation(s) in ${ADR_INDEX_PATH}:`,
    );
    for (const violation of report.violations) console.error(formatViolation(violation));
    process.exit(1);
  }
  if (report.entryCount === 0 || report.recordCount === 0) {
    console.error('adr-index:check: no records found — refusing a vacuous pass.');
    process.exit(1);
  }
  console.log(
    `adr-index:check: ${report.recordCount} record(s), ${report.resolvedCount}/${report.entryCount} ` +
      `entr(ies) resolved, ${report.annotatedCount} annotated — every record listed once and every ` +
      'annotation agrees with its record.',
  );
}

if (import.meta.main) main();
