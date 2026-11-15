/**
 * check-constitution-parity.ts — the en/zh structural parity guard for the
 * design constitution: docs/architecture/design-principles.md and its zh twin
 * docs/architecture/design-principles.zh.md.
 *
 * MECHANISM BOUNDARY. Everything is derived from the two files themselves —
 * there is no name list of section titles here. Three structural levels are
 * compared:
 *   1. the total set of `^## ` section headings (the counts must be equal),
 *   2. the ordered sequence of `^## P<n>` principle headings (equal length and
 *      positionally equal P numbers — P3 pairs with P3, never P4),
 *   3. each P section's litmus marker, held to positional symmetry: a P
 *      section whose en body carries `Litmus:` must carry `判别问句：` in its
 *      zh twin, and vice versa — an asymmetric marker is red. (P7's body is
 *      itself the four-question list and carries no marker on either side
 *      today; the guard flags a marker added to or removed from one side
 *      only, which is the en/zh drift this file exists for.)
 * Front-matter identity anchors must exist on both sides: `status:` in both
 * files, and the topic identity declared by the pair — the en file's `topic:`
 * and the zh twin's `translation_of:` resolving back to the en file (the
 * docs-index zh-twin convention; zh twins declare `translation_of`, not
 * `topic:`).
 *
 * Sentence-level prose drift INSIDE a section is not mechanically decidable
 * and is deliberately out of scope: the section skeleton, the P numbering and
 * the litmus markers are what a machine can hold both languages to. Anything
 * finer stays a review fact.
 *
 * Fail closed: a missing file, a missing front-matter anchor, or an empty
 * heading/P set refuses to pass — parity over an empty corpus is not a green
 * fact. Every failure names the file, the line, and the expectation.
 *
 * RETIRE constitution-parity:check WHEN design-principles.zh.md is deleted or
 * becomes a mechanically generated translation (single writer).
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { emitSummary } from './checker-io.ts';

export const EN_PATH = 'docs/architecture/design-principles.md';
export const ZH_PATH = 'docs/architecture/design-principles.zh.md';

/** The en litmus marker. */
export const EN_LITMUS = 'Litmus:';
/** The zh twin's litmus marker (fullwidth colon, as authored). */
export const ZH_LITMUS = '判别问句：';

const H2_PREFIX = '## ';
const P_HEADING_RE = /^## P(\d+)\b/;

export interface Heading {
  /** 1-based source line. */
  line: number;
  text: string;
}

export interface PrincipleSection {
  number: number;
  /** 1-based line of the `## P<n>` heading. */
  headingLine: number;
  /** Inclusive 1-based body range (the heading line itself excluded). */
  bodyStart: number;
  bodyEnd: number;
}

export interface ConstitutionDoc {
  path: string;
  frontMatter: Map<string, string>;
  headings: Heading[];
  principles: PrincipleSection[];
  lines: string[];
}

export interface ParityFailure {
  /** Named file the failure is anchored to. */
  file: string;
  /** 1-based line, when the failure is line-addressable. */
  line?: number;
  message: string;
}

/**
 * Parse a `---`-delimited front-matter block. Returns an empty map when the
 * file has no front matter; a missing block is itself a parity failure
 * downstream, never a silent pass.
 */
export function parseFrontMatter(text: string): Map<string, string> {
  const data = new Map<string, string>();
  if (!text.startsWith('---\n')) return data;
  const end = text.indexOf('\n---', 4);
  if (end === -1) return data;
  for (const line of text.slice(4, end).split('\n')) {
    const match = line.match(/^([A-Za-z_]+):\s*(.*)$/);
    if (match) data.set(match[1]!, match[2]!.trim());
  }
  return data;
}

/** Parse the section skeleton: every `^## ` heading and every P section body. */
export function parseConstitution(path: string, text: string): ConstitutionDoc {
  const lines = text.split('\n');
  const headings: Heading[] = [];
  for (let index = 0; index < lines.length; index++) {
    if (lines[index]!.startsWith(H2_PREFIX)) {
      headings.push({ line: index + 1, text: lines[index]! });
    }
  }
  const principles: PrincipleSection[] = [];
  for (let index = 0; index < headings.length; index++) {
    const match = headings[index]!.text.match(P_HEADING_RE);
    if (!match) continue;
    const headingLine = headings[index]!.line;
    const nextHeadingLine =
      index + 1 < headings.length ? headings[index + 1]!.line : lines.length + 1;
    principles.push({
      number: Number(match[1]),
      headingLine,
      bodyStart: headingLine + 1,
      bodyEnd: nextHeadingLine - 1,
    });
  }
  return { path, frontMatter: parseFrontMatter(text), headings, principles, lines };
}

/** Body text of one P section (1-based inclusive range). */
function bodyText(doc: ConstitutionDoc, section: PrincipleSection): string {
  return doc.lines.slice(section.bodyStart - 1, section.bodyEnd).join('\n');
}

/**
 * Structural parity failures between the two constitutions, in
 * file+line+expectation form. An empty corpus (no headings, no P sections) is
 * itself a failure — parity must never pass vacuously.
 */
export function evaluateParity(en: ConstitutionDoc, zh: ConstitutionDoc): ParityFailure[] {
  const failures: ParityFailure[] = [];

  if (en.headings.length === 0 || zh.headings.length === 0) {
    const empty = en.headings.length === 0 ? en : zh;
    failures.push({
      file: empty.path,
      message: `no '^## ' section headings found — refusing to assert parity over an empty corpus`,
    });
    return failures;
  }
  if (en.principles.length === 0 || zh.principles.length === 0) {
    const empty = en.principles.length === 0 ? en : zh;
    failures.push({
      file: empty.path,
      message: `no '^## P<n>' principle sections found — refusing to assert parity over an empty corpus`,
    });
    return failures;
  }
  if (en.headings.length !== zh.headings.length) {
    failures.push({
      file: zh.path,
      line: zh.headings[zh.headings.length - 1]?.line,
      message:
        `heading count mismatch: ${en.path} has ${en.headings.length} '^## ' headings, ` +
        `${zh.path} has ${zh.headings.length} — the section skeletons must match 1:1`,
    });
  }

  // Positional P pairing: the sequences must be the same length and agree
  // number-for-number, so section i on one side IS section i on the other.
  const length = Math.min(en.principles.length, zh.principles.length);
  if (en.principles.length !== zh.principles.length) {
    failures.push({
      file: zh.path,
      line: zh.principles[zh.principles.length - 1]?.headingLine,
      message:
        `principle count mismatch: ${en.path} has ${en.principles.length} P-sections, ` +
        `${zh.path} has ${zh.principles.length}`,
    });
  }
  for (let index = 0; index < length; index++) {
    const enSection = en.principles[index]!;
    const zhSection = zh.principles[index]!;
    if (enSection.number !== zhSection.number) {
      failures.push({
        file: zh.path,
        line: zhSection.headingLine,
        message:
          `P-number sequence divergence at pair ${index + 1}: ${en.path}:${enSection.headingLine} ` +
          `is P${enSection.number} but ${zh.path}:${zhSection.headingLine} is P${zhSection.number} ` +
          `— the P sequences must agree positionally`,
      });
      continue;
    }
    // Litmus symmetry: the pair must agree on carrying the marker. P7's body
    // is itself the four-question list, so neither side carries a marker
    // there today; adding or removing one on a single side is the drift.
    const enHasLitmus = bodyText(en, enSection).includes(EN_LITMUS);
    const zhHasLitmus = bodyText(zh, zhSection).includes(ZH_LITMUS);
    if (enHasLitmus && !zhHasLitmus) {
      failures.push({
        file: zh.path,
        line: zhSection.headingLine,
        message:
          `P${zhSection.number} 节体缺少 '${ZH_LITMUS}' 标记 — ` +
          `${en.path}:${enSection.headingLine} 的对应节含 '${EN_LITMUS}'`,
      });
    }
    if (!enHasLitmus && zhHasLitmus) {
      failures.push({
        file: en.path,
        line: enSection.headingLine,
        message:
          `P${enSection.number} section body contains no '${EN_LITMUS}' marker — ` +
          `${zh.path}:${zhSection.headingLine} carries '${ZH_LITMUS}' in the paired section`,
      });
    }
  }
  return failures;
}

/**
 * Front-matter identity-anchor failures. Both files must declare `status:`;
 * the topic identity is declared by the pair (en `topic:`, zh
 * `translation_of:` pointing back at the en file).
 */
export function evaluateFrontMatter(en: ConstitutionDoc, zh: ConstitutionDoc): ParityFailure[] {
  const failures: ParityFailure[] = [];
  for (const doc of [en, zh]) {
    if (doc.frontMatter.size === 0) {
      failures.push({
        file: doc.path,
        line: 1,
        message: `no front-matter block found — the identity anchors cannot exist`,
      });
      continue;
    }
    if (!doc.frontMatter.has('status')) {
      failures.push({ file: doc.path, line: 1, message: `front matter has no 'status:' anchor` });
    }
  }
  if (en.frontMatter.size > 0 && !en.frontMatter.has('topic')) {
    failures.push({ file: en.path, line: 1, message: `front matter has no 'topic:' anchor` });
  }
  if (zh.frontMatter.size > 0) {
    const translationOf = zh.frontMatter.get('translation_of');
    if (translationOf === undefined) {
      failures.push({
        file: zh.path,
        line: 1,
        message: `front matter has no 'translation_of:' anchor (the zh twin declares its topic identity by pointing back at the en file)`,
      });
    } else if (translationOf !== en.path.split('/').pop()) {
      failures.push({
        file: zh.path,
        line: 1,
        message: `front matter 'translation_of:' is '${translationOf}', expected the en file name '${en.path.split('/').pop()}'`,
      });
    }
  }
  return failures;
}

async function main(): Promise<void> {
  const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
  let en: ConstitutionDoc;
  let zh: ConstitutionDoc;
  try {
    en = parseConstitution(EN_PATH, await readFile(join(repoRoot, EN_PATH), 'utf8'));
    zh = parseConstitution(ZH_PATH, await readFile(join(repoRoot, ZH_PATH), 'utf8'));
  } catch (error) {
    console.error(
      `constitution-parity: cannot read the constitution pair (${EN_PATH}, ${ZH_PATH}): ` +
        `${error instanceof Error ? error.message : String(error)} — refusing to pass on a missing or unreadable file.`,
    );
    process.exit(1);
  }

  const failures = [...evaluateFrontMatter(en, zh), ...evaluateParity(en, zh)];
  if (failures.length > 0) {
    console.error(`constitution-parity: ${failures.length} drift finding(s):`);
    for (const failure of failures) {
      const where = failure.line === undefined ? failure.file : `${failure.file}:${failure.line}`;
      console.error(`  ${where}: ${failure.message}`);
    }
    process.exit(1);
  }
  const numbers = en.principles.map((section) => section.number);
  emitSummary(
    `constitution-parity: ${en.headings.length} '^## ' sections and ` +
      `${en.principles.length} P-principles (P${numbers[0]}–P${numbers[numbers.length - 1]}) ` +
      'paired en<->zh, litmus markers and front-matter anchors present.',
  );
}

if (import.meta.main) await main();
