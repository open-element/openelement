import { assert, assertEquals } from '@std/assert';
import { dirname, join } from '@std/path';
import {
  readProductDocs,
  REQUIRED_PRODUCT_DOCS,
  scanProductClassification,
  stripParentheticals,
} from './check-product-classification.ts';

const repoRoot = join(dirname(new URL(import.meta.url).pathname), '..', '..');

Deno.test('product classification: the repository public docs pass', async () => {
  const { sources, failures: readFailures } = await readProductDocs(repoRoot);
  assertEquals(readFailures, []);
  assertEquals(scanProductClassification(sources), []);
});

Deno.test('product classification: required docs fail closed when unreadable', async () => {
  const empty = await Deno.makeTempDir({ prefix: 'classification-empty-' });
  try {
    const { sources, failures } = await readProductDocs(empty);
    assertEquals(sources, []);
    assertEquals(failures.length, REQUIRED_PRODUCT_DOCS.length);
    for (const relative of REQUIRED_PRODUCT_DOCS) {
      assert(failures.some((failure) => failure.includes(relative)), relative);
    }
  } finally {
    await Deno.remove(empty, { recursive: true });
  }
});

Deno.test('product classification: SaaS-core clauses fail in English and Chinese', () => {
  const falseStatements = [
    'SaaS 是核心产品。',
    '核心产品包括 SaaS。',
    'SaaS 属于框架核心。',
    '框架核心包含 SaaS。',
    'SaaS 是核心概念。',
    'SaaS 提供标准消费形态。',
    'SaaS 是第一方核心消费者。',
    'SaaS is a core product.',
    'The framework core includes SaaS.',
    'SaaS is a core consumer.',
    'SaaS is the standard consumption shape.',
    'apps/saas is the core concept of the platform.',
    'The core product of this repository is SaaS.',
    'SaaS is not outside the framework core.',
    'SaaS is not independent; it is a core product.',
    'SaaS is not independent and is a core product.',
    'SaaS 不是独立应用，而是框架核心。',
    'SaaS 不属于独立产品，它是核心产品。',
    'SaaS is not merely a core product.',
    'SaaS is not a public package, but the standard consumption shape.',
  ];
  for (const phrase of falseStatements) {
    const failures = scanProductClassification([{ path: 'probe.md', text: phrase }]);
    assert(failures.length > 0, `expected rejection for: ${phrase}`);
  }
});

Deno.test('product classification: legal statements pass', () => {
  const legal = [
    'Element and Router are the framework core.',
    'Element 与 Router 是核心产品。',
    'Element and Router are the two core products; UI is experimental.',
    'Create is the supported creation entry for the two core products.',
    'UI is an experimental product.',
    'Site is the official product surface.',
    'SaaS is an independent first-party application outside the Alpha candidate.',
    'SaaS 是独立治理的第一方应用，不属于框架核心。',
    'SaaS is not framework core.',
    'SaaS is not a core product.',
    'SaaS 不是核心产品，也不属于框架核心。',
    'SaaS 非核心产品。',
    'SaaS is excluded from the framework core.',
    'SaaS is outside the framework core and governed separately.',
    'The framework core (Element and Router) does not include SaaS.',
    'SaaS is not part of the framework core.',
    'SaaS is independent of the framework core.',
    'SaaS is no longer a core product.',
    'SaaS is not a core product or a standard consumption shape.',
    'SaaS is excluded from the framework core and from the stable API promise.',
  ];
  for (const phrase of legal) {
    const failures = scanProductClassification([{ path: 'probe.md', text: phrase }]);
    assertEquals(failures, [], `unexpected rejection for: ${phrase}`);
  }
});

Deno.test('product classification: parenthetical masking keeps positions and stray brackets', () => {
  const collapsed = (text: string) => text.replace(/\s+/g, ' ').trim();
  // Balanced groups (nested included) are masked out, positions preserved.
  assertEquals(collapsed(stripParentheticals('((a))')), '');
  assertEquals(collapsed(stripParentheticals('a (b (c) d) e')), 'a e');
  assertEquals(collapsed(stripParentheticals('SaaS （独立治理） 是核心产品')), 'SaaS 是核心产品');
  assertEquals(stripParentheticals('a (b) c').length, 'a (b) c'.length);
  // Unbalanced brackets are prose, not a group boundary.
  assertEquals(stripParentheticals('a (b'), 'a (b');
  assertEquals(stripParentheticals('a b) c'), 'a b) c');
});

Deno.test('product classification: clauses are evaluated independently', () => {
  const paragraph = [
    'SaaS is an independent first-party application.',
    'Element and Router are the framework core.',
  ].join(' ');
  assertEquals(scanProductClassification([{ path: 'probe.md', text: paragraph }]), []);
  const contradiction = [
    'Element and Router are the framework core.',
    'SaaS is a core product.',
  ].join(' ');
  assert(scanProductClassification([{ path: 'probe.md', text: contradiction }]).length > 0);
});
