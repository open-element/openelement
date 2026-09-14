/**
 * Product-classification guard.
 *
 * The public product model is: Element and Router are the framework core;
 * Create is the supported creation entry; UI is an experimental product; Site
 * is the official product surface; SaaS is an independent first-party consumer
 * application, maintained in this repository but governed separately — not
 * framework core and not part of the Alpha repository candidate.
 *
 * This guard fails closed when a public document classifies SaaS as framework
 * core / a core consumer / the standard consumption shape. It targets those
 * specific product facts instead of banning the word "core" (which legitimately
 * describes Element and Router).
 */
import { walk } from '@std/fs/walk';

/** Phrases that only ever describe SaaS being framework core. */
export const FORBIDDEN_SAAS_CORE_PHRASES: readonly RegExp[] = [
  /core consumer/iu,
  /standard consumption shape/iu,
  /第一方核心消费者/u,
  /核心消费者/u,
  /标准消费形态/u,
];

/** SaaS named in the same clause as "core product". */
const SAAS_CORE_PRODUCT = [
  /(?:apps\/saas|saas)[^\n]{0,60}\bcore product\b/iu,
  /\bcore product\b[^\n]{0,60}(?:apps\/saas|saas)/iu,
];

/** Public documents that carry the product model. */
export async function publicProductDocs(repoRoot: string): Promise<string[]> {
  const files = new Set<string>([
    `${repoRoot}/README.md`,
    `${repoRoot}/README.zh.md`,
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
    for await (const entry of walk(root, { exts: ['.md'], includeDirs: false })) {
      files.add(entry.path);
    }
  }
  return [...files].sort();
}

export interface ClassificationSource {
  path: string;
  text: string;
}

/** Pure scan over already-read documents. */
export function scanProductClassification(
  sources: readonly ClassificationSource[],
): string[] {
  const failures: string[] = [];
  for (const { path, text } of sources) {
    for (const pattern of [...FORBIDDEN_SAAS_CORE_PHRASES, ...SAAS_CORE_PRODUCT]) {
      if (pattern.test(text)) {
        failures.push(`${path}: classifies SaaS as framework core (matched ${pattern})`);
      }
    }
  }
  return failures;
}

async function readSources(paths: readonly string[]): Promise<ClassificationSource[]> {
  const sources: ClassificationSource[] = [];
  for (const path of paths) {
    try {
      sources.push({ path, text: await Deno.readTextFile(path) });
    } catch {
      // A missing optional doc is not a classification defect.
    }
  }
  return sources;
}

if (import.meta.main) {
  const repoRoot = new URL('../..', import.meta.url).pathname.replace(/\/$/u, '');
  const failures = scanProductClassification(await readSources(await publicProductDocs(repoRoot)));
  if (failures.length > 0) {
    console.error('Product classification check failed:');
    for (const failure of failures) console.error(`- ${failure}`);
    Deno.exit(1);
  }
  console.log('Product classification check passed: SaaS is not described as framework core.');
}
