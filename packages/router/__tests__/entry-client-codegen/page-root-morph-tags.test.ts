/**
 * The emitted client entry's morph-survival list must not contain a PAGE ROOT.
 *
 * A page root is delivered and claimed so its route renders, but its real
 * content is the DSD shadow tree. In the island-survival list the enhance morph
 * either freezes the page (light DOM only) or replaces it once the claim has
 * consumed the `data-oe-prop-seed` transport attribute — both drop user state on
 * every enhanced submit. The list still has to carry real islands, and an entry
 * with no page root must keep the exact bytes it had before the split.
 */
import { expect, test } from 'vitest';
import type { ClientIslandDeliveryEntry } from '../../src/vite/internal/ssg/delivery.ts';
import { generateClientEntry } from '../../src/vite/internal/ssg/entry-client-codegen.ts';

function island(tagName: string, reason?: string): ClientIslandDeliveryEntry {
  return {
    tagName,
    modulePath: `app/islands/${tagName}.tsx`,
    strategy: 'idle',
    ...(reason === undefined ? {} : { reason }),
  };
}

const PAGE_ROOT_REASON = 'page component (route renders its host producer)';

test('a page root is delivered but excluded from the morph-survival tag list', () => {
  const entry = generateClientEntry(
    [island('notes-index', PAGE_ROOT_REASON), island('x-counter')],
    {
      enhancedForms: true,
    },
  );

  // Delivered: the island map and the idle scheduler still carry the page root.
  expect(entry).toContain(`"notes-index": function ()`);
  expect(entry).toContain(`idle: ["notes-index", "x-counter"]`);

  // Morph survival: only the real island.
  const morphList = /var __morphTags = \[([^\]]*)\];/.exec(entry);
  expect(morphList, 'the page-root entry must emit a separate morph tag list').not.toBeNull();
  expect(morphList![1]).toContain(`"x-counter"`);
  expect(morphList![1]).not.toContain(`"notes-index"`);
  expect(entry).toContain('tags: __morphTags');

  // The pre-hydration capture keeps every delivered tag, page root included.
  expect(entry).toContain('ensurePreHydrationClickCapture(document, __tags)');
});

test('the generated page-root admission reason is excluded too', () => {
  const entry = generateClientEntry(
    [
      island('index-page', 'generated page root (compiler-emitted host producer)'),
      island('x-card'),
    ],
    { enhancedForms: true },
  );
  const morphList = /var __morphTags = \[([^\]]*)\];/.exec(entry);
  expect(morphList).not.toBeNull();
  expect(morphList![1]).toContain(`"x-card"`);
  expect(morphList![1]).not.toContain(`"index-page"`);
});

test('an entry without a page root keeps the previous single-list emission', () => {
  const entry = generateClientEntry([island('x-counter')], { enhancedForms: true });
  expect(entry).not.toContain('__morphTags');
  expect(entry).toContain('tags: __tags');
});
