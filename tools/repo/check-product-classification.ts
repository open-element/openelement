/**
 * Product-classification guard.
 *
 * The public product model is: Element and Router are the framework core;
 * Create is the supported creation entry; UI is an experimental product; Site
 * is the official product surface; SaaS is an independent first-party consumer
 * application, maintained in this repository but governed separately — not
 * framework core and not part of the Alpha repository candidate.
 *
 * This guard is relation-aware: for every core-term occurrence in a clause that
 * mentions SaaS, the negation must actually attach to that occurrence (for
 * example "not a core product" or "not part of the framework core"). A negation
 * of some other object ("not independent; it is a core product"), a double
 * negation ("not outside the framework core"), or a turncoat continuation
 * after a negation ("不属于独立产品，它是核心产品") fails. It does not ban the
 * word "core" (Element/Router statements are legal) and it never infers
 * ownership from filename or directory names.
 */
import { walk } from '@std/fs/walk';

/** Documents that must exist and carry the product contract. */
export const REQUIRED_PRODUCT_DOCS: readonly string[] = [
  'README.md',
  'README.zh.md',
  'docs/architecture/product-model.md',
];

/** SaaS markers inside a clause. */
const SAAS = /\bsaas\b|apps\/saas/iu;

/** Core relation terms (English and Chinese). */
const CORE_TERMS: readonly RegExp[] = [
  /framework\s+core/iu,
  /\bcore\s+(?:consumer|product|concept)\b/iu,
  /standard\s+consumption\s+shape/iu,
  /框架核心/u,
  /核心(?:产品|消费者|概念)/u,
  /标准消费形态/u,
];

/**
 * Negation tokens. `independent` only counts with `of`/`from` so that
 * "an independent core product" is not mistaken for a negation.
 */
const EN_NEGATION =
  /(?:cannot|can't|isn't|aren't|wasn't|weren't|didn't|doesn't|don't|won't|wouldn't|shouldn't|mustn't|hasn't|haven't|hadn't|\bnot\b|\bnever\b|\bno\b|\bnor\b|\bneither\b|\boutside\b|\bwithout\b|\bexclud(?:e|ed|ing)\b|\bindependent\s+(?:of|from)\b|\bnon[- ])/giu;

const ZH_NEGATION = /(?:不属于|不是|不在|不包含|不构成|排除|独立于|非|无|不)/gu;

/** "not only X" asserts X positively; it must not count as a negation. */
const POSITIVE_NOT_ONLY = /\bnot\s+(?:only|merely|just)\b/giu;
const ZH_POSITIVE_NOT_ONLY = /不仅|不但/gu;

/**
 * Clause boundaries that stop a negation window: a negation on the far side
 * of one of these does not govern the core term any more. `and` is a boundary
 * so that "not independent and is a core product" fails.
 */
const BOUNDARY =
  /[,，;；:：]|\b(?:but|and|however|yet|instead|rather|although|though|despite|whereas|while)\b|但是|而是|而|却|然而|不过|但/u;

/** Characters scanned backward/forward from a core term for a negation. */
const NEGATION_WINDOW = 96;

/** Split prose into clauses on sentence, semicolon, and line boundaries. */
export function classifyClauses(text: string): string[] {
  return text
    .split(/[.!?。！？;；\n]+/u)
    .map((clause) => clause.trim())
    .filter((clause) => clause.length > 0);
}

/** Parentheticals do not change the relation; drop them before scanning. */
function stripParentheticals(clause: string): string {
  return clause.replace(/\([^)]*\)|（[^）]*）/gu, ' ');
}

function countNegations(segment: string): number {
  const cleaned = segment
    .replace(POSITIVE_NOT_ONLY, '')
    .replace(ZH_POSITIVE_NOT_ONLY, '');
  return (cleaned.match(EN_NEGATION)?.length ?? 0) +
    (cleaned.match(ZH_NEGATION)?.length ?? 0);
}

/** Segment before `index` up to the last boundary (or the window start). */
function backwardSegment(clause: string, index: number): string {
  const window = clause.slice(Math.max(0, index - NEGATION_WINDOW), index);
  let cut = -1;
  for (const match of window.matchAll(new RegExp(BOUNDARY.source, 'gu'))) {
    cut = match.index + match[0].length;
  }
  return cut < 0 ? window : window.slice(cut);
}

/** Segment after `index` up to the first boundary (or the window end). */
function forwardSegment(clause: string, index: number): string {
  const window = clause.slice(index, Math.min(clause.length, index + NEGATION_WINDOW));
  const match = new RegExp(BOUNDARY.source, 'u').exec(window);
  return match ? window.slice(0, match.index) : window;
}

/**
 * True when a negation governs this core-term occurrence: an odd number of
 * negation tokens in the window behind or ahead of it (double negation is
 * positive).
 */
function isNegated(clause: string, termIndex: number, termLength: number): boolean {
  const behind = countNegations(backwardSegment(clause, termIndex));
  const ahead = countNegations(forwardSegment(clause, termIndex + termLength));
  return behind % 2 === 1 || ahead % 2 === 1;
}

function coreTermMatches(clause: string): Array<{ index: number; length: number }> {
  const matches: Array<{ index: number; length: number }> = [];
  for (const pattern of CORE_TERMS) {
    const flags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`;
    for (const match of clause.matchAll(new RegExp(pattern.source, flags))) {
      matches.push({ index: match.index, length: match[0].length });
    }
  }
  return matches.sort((a, b) => a.index - b.index);
}

export interface ClassificationSource {
  path: string;
  text: string;
}

/**
 * Pure scan over already-read documents. Each core-term occurrence in a clause
 * that mentions SaaS must be governed by a negation; otherwise the clause
 * classifies SaaS as framework core. A clause without the SaaS marker is only
 * flagged when it continues a `;`-joined statement whose previous clause
 * negated something other than a core term ("SaaS is not independent; it is a
 * core product").
 */
export function scanProductClassification(
  sources: readonly ClassificationSource[],
): string[] {
  const failures: string[] = [];
  for (const { path, text } of sources) {
    for (const sentence of text.split(/[.!?。！？\n]+/u)) {
      let previousSaasNegatedOther = false;
      for (const clause of sentence.split(/[;；]+/u)) {
        const cleaned = stripParentheticals(clause);
        const hasSaas = SAAS.test(cleaned);
        const terms = coreTermMatches(cleaned);
        if (!hasSaas) {
          if (terms.length > 0 && previousSaasNegatedOther) {
            failures.push(
              `${path}: classifies SaaS as framework core (clause: ${JSON.stringify(clause)})`,
            );
          }
          previousSaasNegatedOther = false;
          continue;
        }
        if (terms.length === 0) {
          previousSaasNegatedOther = countNegations(cleaned) % 2 === 1;
          continue;
        }
        const unnegated = terms.filter((term) => !isNegated(cleaned, term.index, term.length));
        if (unnegated.length > 0) {
          failures.push(
            `${path}: classifies SaaS as framework core (clause: ${JSON.stringify(clause)})`,
          );
        }
        previousSaasNegatedOther = false;
      }
    }
  }
  return failures;
}

export interface ClassificationReadResult {
  sources: ClassificationSource[];
  failures: string[];
}

/** Read required docs fail-closed, then discover optional markdown docs. */
export async function readProductDocs(repoRoot: string): Promise<ClassificationReadResult> {
  const failures: string[] = [];
  const sources: ClassificationSource[] = [];
  for (const relative of REQUIRED_PRODUCT_DOCS) {
    try {
      sources.push({ path: relative, text: await Deno.readTextFile(`${repoRoot}/${relative}`) });
    } catch {
      failures.push(`${relative}: required product-contract document is unreadable`);
    }
  }
  const optional = new Set<string>([
    `${repoRoot}/CHANGELOG.md`,
    `${repoRoot}/apps/saas/README.md`,
  ]);
  for (
    const root of [
      `${repoRoot}/docs`,
      `${repoRoot}/packages`,
      `${repoRoot}/apps/site/content`,
    ]
  ) {
    try {
      for await (const entry of walk(root, { exts: ['.md'], includeDirs: false })) {
        optional.add(entry.path);
      }
    } catch {
      // Optional discovery roots may be absent (e.g. a trimmed checkout).
    }
  }
  for (const path of [...optional].sort()) {
    try {
      sources.push({ path: path.replace(`${repoRoot}/`, ''), text: await Deno.readTextFile(path) });
    } catch {
      // A discovered doc that vanishes mid-walk is not a classification defect.
    }
  }
  return { sources, failures };
}

if (import.meta.main) {
  const repoRoot = new URL('../..', import.meta.url).pathname.replace(/\/$/u, '');
  const { sources, failures: readFailures } = await readProductDocs(repoRoot);
  const failures = [...readFailures, ...scanProductClassification(sources)];
  if (failures.length > 0) {
    console.error('Product classification check failed:');
    for (const failure of failures) console.error(`- ${failure}`);
    Deno.exit(1);
  }
  console.log('Product classification check passed: SaaS is not described as framework core.');
}
