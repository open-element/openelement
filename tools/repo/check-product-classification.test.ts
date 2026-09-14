import { assert, assertEquals } from '@std/assert';
import { dirname, join } from '@std/path';
import { publicProductDocs, scanProductClassification } from './check-product-classification.ts';

const repoRoot = join(dirname(new URL(import.meta.url).pathname), '..', '..');

Deno.test('product classification: public docs do not call SaaS framework core', async () => {
  const sources = await Promise.all(
    (await publicProductDocs(repoRoot)).map(async (path) => ({
      path,
      text: await Deno.readTextFile(path),
    })),
  );
  assertEquals(scanProductClassification(sources), []);
});

Deno.test('product classification: READMEs state SaaS is independent and outside the candidate', async () => {
  const en = await Deno.readTextFile(join(repoRoot, 'README.md'));
  const zh = await Deno.readTextFile(join(repoRoot, 'README.zh.md'));
  assert(
    /SaaS[^.]{0,200}independent first-party/i.test(en) ||
      /independent first-party[^.]{0,200}SaaS/i.test(en),
    'README.md must describe SaaS as an independent first-party application',
  );
  assert(
    /SaaS[^。]{0,200}独立/u.test(zh) || /独立[^。]{0,200}SaaS/u.test(zh),
    'README.zh.md must describe SaaS as independent',
  );
});

Deno.test('product classification: each forbidden SaaS-core phrase fails closed', () => {
  const phrases = [
    'apps/saas is the first-party core consumer product.',
    'SaaS is the standard consumption shape.',
    'SaaS 是第一方核心消费者。',
    'SaaS 是核心消费者。',
    'SaaS 提供标准消费形态。',
    'apps/saas — SaaS core product.',
  ];
  for (const phrase of phrases) {
    const failures = scanProductClassification([{ path: 'doc.md', text: phrase }]);
    assertEquals(failures.length > 0, true, `expected failure for: ${phrase}`);
  }
  // Legitimate Element/Router "core product" copy must not be flagged.
  assertEquals(
    scanProductClassification([
      { path: 'doc.md', text: 'Element and Router are the two core products.' },
      { path: 'doc.md', text: 'Element 核心产品与 Router 核心产品。' },
    ]),
    [],
  );
});
