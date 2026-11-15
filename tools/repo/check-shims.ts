/**
 * check-shims.ts — the mechanical reader for the P5 shim registry.
 *
 * `docs/architecture/shim-inventory.md` is the registry P5 requires: every
 * compatibility layer, adapter and polyfill in the tree names an owner, a
 * retirement condition and a disposition, and the "platform catch-up review"
 * re-reads it every release cycle. A hand-maintained registry with no reader
 * rots in three ways that are invisible to every other gate: a location path
 * moves and the row keeps pointing at the old one, a `path:line` citation
 * drifts out of the file, and a new shim lands with no owner or no retirement
 * condition — the exact defect the registry exists to prevent.
 *
 * This check makes the registry fail closed:
 *
 *   - The summary table must exist with the exact four-column header
 *     (`#`, `垫片 / 适配层`, `位置`, `处置`) and a separator row; every row
 *     must have four cells, a unique number and a non-empty name.
 *   - Every disposition starts with one token of the closed vocabulary
 *     `已删` / `现在删` / `条件到即删` / `保留为平台边缘`. A location is a
 *     backticked repo path: for a live row it must exist on disk AND be
 *     Git-tracked; for an `已删` row the path is struck through (`~~…~~`) and
 *     must NOT exist (an executed retirement whose file is still there is a
 *     contradiction).
 *   - Every row number must have a `### N.` detail section carrying a
 *     non-empty owner (`所有者`) and a non-empty retirement condition
 *     (`退役条件…：`); a deleted row's condition must say the retirement
 *     executed. A detail section with no table row is an orphan and is
 *     reported.
 *   - Every `path:line` / `path:line-line` citation anywhere in the document
 *     must resolve (repo-relative, or a unique basename among tracked files)
 *     and stay inside that file's length, so a moved block cannot leave a
 *     stale line citation behind.
 *   - A scan that reads no rows fails closed instead of reporting a vacuous
 *     pass, and an unreadable `git ls-files` fails the tracking rule closed.
 *
 * CLI:
 *   node tools/repo/check-shims.ts [--root=<dir>]
 * Exit 0 = the registry is parseable, every row is owned and has a retirement
 * condition, every location is tracked (or properly struck through) and every
 * line citation is in range; 1 = at least one violation (printed with
 * file:line).
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import process from 'node:process';
import { emitSummary } from './checker-io.ts';
import { fileURLToPath } from 'node:url';
import { gitTrackedPaths, isTrackedPath } from './check-seams.ts';

export const SHIM_INVENTORY_PATH = 'docs/architecture/shim-inventory.md';

/** The registry's one supported table shape. */
export const EXPECTED_HEADER = ['#', '垫片 / 适配层', '位置', '处置'];

/** The closed disposition vocabulary; `已删` records an executed retirement. */
export const DISPOSITIONS = ['已删', '现在删', '条件到即删', '保留为平台边缘'] as const;

export type ShimDisposition = (typeof DISPOSITIONS)[number];

/** A path spelling worth resolving: repo-relative or a code file name. */
const PATH_SPELLING = /\.(?:ts|tsx|mts|js|mjs|cjs|css|json|md|mdx|html|yml|yaml)$/;

/** One `path`, `path:line` or `path:line-line` citation. */
const CITATION_PATTERN = /^(.+?):(\d+)(?:-(\d+))?$/;

export type ShimViolationKind =
  | 'inventory-missing'
  | 'table-missing'
  | 'malformed-row'
  | 'empty-cell'
  | 'duplicate-number'
  | 'unknown-disposition'
  | 'location-missing'
  | 'location-not-tracked'
  | 'deleted-location-present'
  | 'section-missing'
  | 'owner-missing'
  | 'retirement-missing'
  | 'retirement-not-executed'
  | 'orphan-section'
  | 'citation-unresolved'
  | 'citation-out-of-range'
  | 'tracking-unavailable'
  | 'vacuous';

export interface ShimViolation {
  kind: ShimViolationKind;
  /** 1-based line in the inventory; 0 for whole-registry violations. */
  line: number;
  detail: string;
}

export interface ShimRow {
  /** 1-based line in the inventory. */
  line: number;
  number: number;
  name: string;
  /** The location path with the strike-through wrapper removed. */
  location: string;
  /** True when the location is written `~~…~~` (an executed retirement). */
  struckThrough: boolean;
  disposition: ShimDisposition;
  /** The disposition cell's raw text. */
  dispositionText: string;
}

export interface ShimSection {
  /** 1-based line of the `### N.` heading. */
  line: number;
  number: number;
  title: string;
  hasOwner: boolean;
  hasRetirement: boolean;
  /** True when the retirement text says the condition already executed. */
  retirementExecuted: boolean;
}

export interface ShimReport {
  rowCount: number;
  /** Rows whose disposition is `已删`. */
  deletedRows: number;
  sectionCount: number;
  citationCount: number;
  violations: ShimViolation[];
}

/** Split one markdown table line into cells, honoring GFM `\|` escapes. */
function splitTableCells(line: string): string[] {
  const cells: string[] = [];
  let current = '';
  for (let index = 0; index < line.length; index++) {
    const char = line[index];
    const next = line[index + 1];
    if (char === '\\' && (next === '|' || next === '\\')) {
      current += next;
      index++;
      continue;
    }
    if (char === '|') {
      cells.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  cells.push(current);
  if (cells.length > 0 && cells[0]!.trim() === '') cells.shift();
  if (cells.length > 0 && cells[cells.length - 1]!.trim() === '') cells.pop();
  return cells.map((cell) => cell.trim());
}

/** Every backticked span in a cell, in order. */
function backtickedTokens(text: string): string[] {
  const tokens: string[] = [];
  for (const match of text.matchAll(/`([^`\n]+)`/g)) {
    const token = match[1]!.trim();
    if (token !== '') tokens.push(token);
  }
  return tokens;
}

/** The first closed-vocabulary disposition token in a cell, if any. */
export function dispositionOf(cell: string): ShimDisposition | undefined {
  const plain = cell.replace(/\*/g, '');
  for (const token of DISPOSITIONS) {
    if (plain.includes(token)) return token;
  }
  return undefined;
}

/** Parse the summary table and the detail sections of one inventory. */
export function parseShimInventory(markdown: string): {
  rows: ShimRow[];
  sections: ShimSection[];
  tableStart: number;
  violations: ShimViolation[];
} {
  const violations: ShimViolation[] = [];
  const lines = markdown.split(/\r?\n/);
  const tableStart = lines.findIndex((line) => line.startsWith('|'));
  if (tableStart === -1) {
    violations.push({ kind: 'table-missing', line: 0, detail: 'no summary table found' });
    return { rows: [], sections: [], tableStart: -1, violations };
  }
  const tableLines: Array<{ line: number; text: string }> = [];
  for (let index = tableStart; index < lines.length; index++) {
    if (!lines[index]!.startsWith('|')) break;
    tableLines.push({ line: index + 1, text: lines[index]! });
  }
  if (tableLines.length < 3) {
    violations.push({
      kind: 'table-missing',
      line: tableStart + 1,
      detail: `table needs a header, a separator and at least one data row; found ${tableLines.length} line(s)`,
    });
    return { rows: [], sections: [], tableStart, violations };
  }
  const header = splitTableCells(tableLines[0]!.text);
  if (
    header.length !== EXPECTED_HEADER.length ||
    header.some((cell, index) => cell !== EXPECTED_HEADER[index])
  ) {
    violations.push({
      kind: 'malformed-row',
      line: tableLines[0]!.line,
      detail: `header must be exactly ${EXPECTED_HEADER.join(' | ')}; found ${header.join(' | ')}`,
    });
  }
  const separator = splitTableCells(tableLines[1]!.text);
  if (
    separator.length !== EXPECTED_HEADER.length ||
    !separator.every((cell) => /^:?-{3,}:?$/.test(cell))
  ) {
    violations.push({
      kind: 'malformed-row',
      line: tableLines[1]!.line,
      detail: `separator row must carry ${EXPECTED_HEADER.length} dash cells; found ${separator.length}`,
    });
  }

  const rows: ShimRow[] = [];
  const seenNumbers = new Map<number, number>();
  for (const { line, text } of tableLines.slice(2)) {
    const cells = splitTableCells(text);
    if (cells.length !== EXPECTED_HEADER.length) {
      violations.push({
        kind: 'malformed-row',
        line,
        detail: `expected ${EXPECTED_HEADER.length} cells, found ${cells.length}`,
      });
      continue;
    }
    const [rawNumber, name, rawLocation, dispositionCell] = cells as [
      string,
      string,
      string,
      string,
    ];
    const number = /^\d+$/.test(rawNumber) ? Number(rawNumber) : Number.NaN;
    if (Number.isNaN(number)) {
      violations.push({
        kind: 'malformed-row',
        line,
        detail: `row number ${JSON.stringify(rawNumber)} is not an integer`,
      });
      continue;
    }
    const previous = seenNumbers.get(number);
    if (previous !== undefined) {
      violations.push({
        kind: 'duplicate-number',
        line,
        detail: `row number ${number} is already used on line ${previous}`,
      });
    }
    seenNumbers.set(number, line);
    if (name === '') {
      violations.push({ kind: 'empty-cell', line, detail: `row ${number}: name cell is empty` });
    }
    for (const [cell, label] of [
      [dispositionCell, '处置'],
      [rawLocation, '位置'],
    ] as const) {
      if (cell === '') {
        violations.push({
          kind: 'empty-cell',
          line,
          detail: `row ${number}: '${label}' cell is empty`,
        });
      }
    }
    const disposition = dispositionOf(dispositionCell);
    if (disposition === undefined) {
      violations.push({
        kind: 'unknown-disposition',
        line,
        detail:
          `row ${number}: disposition ${JSON.stringify(dispositionCell)} is not one of ` +
          DISPOSITIONS.join(' / '),
      });
      continue;
    }
    const struckThrough = /~~[^~]+~~/.test(rawLocation);
    const location =
      backtickedTokens(rawLocation.replace(/~~([^~]+)~~/g, '`$1`'))[0] ??
      rawLocation.replace(/[~`]/g, '').trim();
    if (location === '') {
      violations.push({
        kind: 'empty-cell',
        line,
        detail: `row ${number}: no location path in ${JSON.stringify(rawLocation)}`,
      });
      continue;
    }
    rows.push({
      line,
      number,
      name,
      location,
      // Only the strike-through wrapper claims the path is gone; a row may
      // record an executed deletion of a SHAPE while its module stays as a
      // first-class helper (entry 12), which is why the marker is explicit.
      struckThrough,
      disposition,
      dispositionText: dispositionCell,
    });
  }

  const sections: ShimSection[] = [];
  for (let index = 0; index < lines.length; index++) {
    const heading = /^###\s+(\d+)\.\s*(.*)$/.exec(lines[index]!);
    if (heading === null) continue;
    const body: string[] = [];
    for (let cursor = index + 1; cursor < lines.length; cursor++) {
      if (/^###\s/.test(lines[cursor]!) || /^##\s/.test(lines[cursor]!)) break;
      body.push(lines[cursor]!);
    }
    const text = body.join('\n');
    // A bullet's text may wrap; read it as a block up to the next top-level
    // bullet or heading so a wrapped `：` still counts as the label's colon.
    const bulletBlock = (label: string): string =>
      new RegExp(`(?:^|\\n)-\\s*${label}([\\s\\S]*?)(?=\\n-\\s|\\n#|$)`).exec(text)?.[1] ?? '';
    const retirementBlock = bulletBlock('退役条件');
    sections.push({
      line: index + 1,
      number: Number(heading[1]),
      title: heading[2]!.trim(),
      hasOwner: /[：:]\s*\S/.test(bulletBlock('所有者')),
      hasRetirement: /[：:]\s*\S/.test(retirementBlock),
      retirementExecuted: /已满足|已执行|已兑现/.test(retirementBlock),
    });
  }
  return { rows, sections, tableStart, violations };
}

export interface ShimCheckOptions {
  /** Git-tracked path set; omitted = read `git ls-files` under the root. */
  tracked?: ReadonlySet<string>;
}

/** Structural + semantic check of one inventory document. */
export function checkShimsMarkdown(
  markdown: string,
  root: string,
  options: ShimCheckOptions = {},
): ShimReport {
  const { rows, sections, violations } = parseShimInventory(markdown);
  const tracked = options.tracked ?? gitTrackedPaths(root);
  if (tracked === undefined) {
    violations.push({
      kind: 'tracking-unavailable',
      line: 0,
      detail:
        'git ls-files could not be read under the root — shim locations cannot be proven ' +
        'tracked; refusing to pass on an unverifiable tree',
    });
  }
  const trackedFiles = tracked === undefined ? [] : [...tracked];
  const exists = (repoRelative: string): boolean => existsSync(join(root, repoRelative));
  const isFile = (repoRelative: string): boolean => {
    try {
      return statSync(join(root, repoRelative)).isFile();
    } catch {
      return false;
    }
  };
  const uniqueBasename = (name: string): string | undefined => {
    const matches = trackedFiles.filter(
      (candidate) => candidate === name || candidate.endsWith(`/${name}`),
    );
    return matches.length === 1 ? matches[0] : undefined;
  };

  for (const row of rows) {
    if (row.struckThrough) {
      if (exists(row.location)) {
        violations.push({
          kind: 'deleted-location-present',
          line: row.line,
          detail: `row ${row.number}: disposition records a deletion, but ${row.location} still exists`,
        });
      }
      continue;
    }
    if (!exists(row.location)) {
      violations.push({
        kind: 'location-missing',
        line: row.line,
        detail: `row ${row.number}: location ${row.location} does not exist`,
      });
      continue;
    }
    if (
      tracked !== undefined &&
      !isTrackedPath(tracked, row.location, isFile(row.location) ? 'file' : 'dir')
    ) {
      violations.push({
        kind: 'location-not-tracked',
        line: row.line,
        detail: `row ${row.number}: location ${row.location} exists but is not tracked by Git`,
      });
    }
  }

  const byNumber = new Map(rows.map((row) => [row.number, row]));
  for (const row of rows) {
    const section = sections.find((candidate) => candidate.number === row.number);
    if (section === undefined) {
      violations.push({
        kind: 'section-missing',
        line: row.line,
        detail: `row ${row.number} (${row.name}) has no '### ${row.number}.' detail section`,
      });
      continue;
    }
    if (!section.hasOwner) {
      violations.push({
        kind: 'owner-missing',
        line: section.line,
        detail: `section ${row.number}: no non-empty '所有者' bullet`,
      });
    }
    if (!section.hasRetirement) {
      violations.push({
        kind: 'retirement-missing',
        line: section.line,
        detail: `section ${row.number}: no non-empty '退役条件…：' bullet`,
      });
    } else if (row.struckThrough && !section.retirementExecuted) {
      violations.push({
        kind: 'retirement-not-executed',
        line: section.line,
        detail:
          `section ${row.number}: the row records an executed deletion, but its retirement ` +
          'condition does not say the condition was met',
      });
    }
  }
  for (const section of sections) {
    if (!byNumber.has(section.number)) {
      violations.push({
        kind: 'orphan-section',
        line: section.line,
        detail: `detail section ${section.number} (${section.title}) has no summary-table row`,
      });
    }
  }

  let citationCount = 0;
  markdown.split(/\r?\n/).forEach((text, index) => {
    const line = index + 1;
    for (const token of backtickedTokens(text)) {
      const match = CITATION_PATTERN.exec(token);
      if (match === null) continue;
      const [, rawPath, rawStart, rawEnd] = match;
      if (!PATH_SPELLING.test(rawPath!) || rawPath!.includes(' ')) continue;
      const path = rawPath!.replace(/^\.\//, '');
      const resolved = isFile(path) ? path : uniqueBasename(path);
      if (resolved === undefined) continue;
      citationCount++;
      const total = readFileSync(join(root, resolved), 'utf8').split(/\r?\n/).length;
      const start = Number(rawStart);
      const end = rawEnd === undefined ? start : Number(rawEnd);
      if (start < 1 || end < start || end > total) {
        violations.push({
          kind: 'citation-out-of-range',
          line,
          detail: `${token}: ${resolved} has ${total} line(s); citation ${start}-${end} is out of range`,
        });
      }
    }
  });

  if (rows.length === 0) {
    violations.push({
      kind: 'vacuous',
      line: 0,
      detail: 'the inventory lists no shims — refusing a vacuous pass',
    });
  }
  return {
    rowCount: rows.length,
    deletedRows: rows.filter((row) => row.disposition === '已删').length,
    sectionCount: sections.length,
    citationCount,
    violations,
  };
}

/** Read and check the inventory at `<root>/docs/architecture/shim-inventory.md`. */
export function checkShims(root: string, options: ShimCheckOptions = {}): ShimReport {
  const file = join(root, SHIM_INVENTORY_PATH);
  if (!existsSync(file)) {
    return {
      rowCount: 0,
      deletedRows: 0,
      sectionCount: 0,
      citationCount: 0,
      violations: [
        { kind: 'inventory-missing', line: 0, detail: `${SHIM_INVENTORY_PATH} does not exist` },
      ],
    };
  }
  return checkShimsMarkdown(readFileSync(file, 'utf8'), root, options);
}

function formatViolation(violation: ShimViolation): string {
  const where =
    violation.line > 0 ? `${SHIM_INVENTORY_PATH}:${violation.line}` : SHIM_INVENTORY_PATH;
  return `${where}: ${violation.kind}: ${violation.detail}`;
}

function main(): void {
  const arg = process.argv.slice(2).find((token) => token.startsWith('--root='));
  const root = resolve(
    arg !== undefined
      ? arg.slice('--root='.length)
      : fileURLToPath(new URL('../..', import.meta.url)),
  );
  const report = checkShims(root);
  if (report.violations.length > 0) {
    console.error(
      `shims:check: ${report.violations.length} violation(s) in ${SHIM_INVENTORY_PATH}:`,
    );
    for (const violation of report.violations) console.error(formatViolation(violation));
    process.exit(1);
  }
  if (report.rowCount === 0) {
    console.error('shims:check: no shim rows found — refusing a vacuous pass.');
    process.exit(1);
  }
  emitSummary(
    `shims:check: ${report.rowCount} shim(s) / ${report.deletedRows} retired — every location ` +
      `tracked, every row owned with a retirement condition, ${report.citationCount} line ` +
      'citation(s) in range.',
  );
}

if (import.meta.main) main();
