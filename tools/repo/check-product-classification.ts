/**
 * Product-classification guard.
 *
 * The public product model is: Element and Router are the framework core;
 * Create is the supported creation entry; UI is an experimental product; Site
 * is the official product surface; SaaS is an independent first-party consumer
 * application, maintained in this repository but governed separately — not
 * framework core and not part of the Alpha repository candidate.
 *
 * This guard is clause-aware: a clause that mentions SaaS together with a core
 * term fails unless the clause explicitly negates the core relation. It does
 * not ban the word "core" (Element/Router statements are legal) and it never
 * infers ownership from filename or directory names.
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

/** Explicit negation of a core relation inside the same clause. */
const NEGATED = [
  /\bnot\b(?!\s+only\b)/iu,
  /\bnever\b/iu,
  /\boutside\b/iu,
  /\bexcluded?\b/iu,
  /不属于/u,
  /不是/u,
  /不在/u,
  /不包含/u,
  /不构成/u,
  /排除/u,
  /独立于/u,
  /非核心/u,
];

/** Split prose into clauses on sentence and line boundaries. */
export function classifyClauses(text: string): string[] {
  return text
    .split(/[.!?。！？;；\n]+/u)
    .map((clause) => clause.trim())
    .filter((clause) => clause.length > 0);
}

export interface ClassificationSource {
  path: string;
  text: string;
}

/**
 * Pure scan over already-read documents. A clause fails when it mentions SaaS
 * and a core term and does not explicitly negate the core relation.
 */
export function scanProductClassification(
  sources: readonly ClassificationSource[],
): string[] {
  const failures: string[] = [];
  for (const { path, text } of sources) {
    for (const clause of classifyClauses(text)) {
      if (!SAAS.test(clause)) continue;
      const term = CORE_TERMS.find((pattern) => pattern.test(clause));
      if (!term) continue;
      if (NEGATED.some((pattern) => pattern.test(clause))) continue;
      failures.push(
        `${path}: classifies SaaS as framework core (clause: ${JSON.stringify(clause)})`,
      );
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
