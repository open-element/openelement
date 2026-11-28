/**
 * Shared build-time highlighter consumer-form test (#1552, seams.md
 * "Build-time code highlighting").
 *
 * www/lib/markdown.ts owns the ONE Shiki instance, theme and grammar table.
 * Its two consumer forms — markdown fences (renderSiteMarkdown) and
 * page-component code blocks (highlightSiteCode, via the generated
 * _generated-page-code.ts) — must emit the same contract: the same
 * `shiki css-variables` wrapper and `shiki-token-*` classes the
 * site palette table (site-css.css) resolves. A second highlighter, or a form
 * that drifts off the shared theme variables, fails here.
 */
import { expect, test } from 'vitest';
import { highlightSiteCode, renderSiteMarkdown } from '../lib/markdown.ts';

const SNIPPET = "import { element } from '@openelement/element';\nexport const x = 1;\n";

test('fences and highlightSiteCode emit the same shiki css-variables contract', async () => {
  const fenceHtml = await renderSiteMarkdown('```tsx\n' + SNIPPET + '```\n');
  const blockHtml = await highlightSiteCode(SNIPPET, 'tsx');

  for (const html of [fenceHtml, blockHtml]) {
    expect(html, 'the shared wrapper class').toContain('class="shiki css-variables"');
    expect(html, 'token colors use the shared site classes').toContain(
      'class="shiki-token-keyword"',
    );
    expect(html, 'no inline token CSS leaves the pipeline').not.toMatch(/\sstyle=/);
  }
  // The wrapper prefix is byte-identical: same theme, same renderer options.
  const wrapper = /<pre class="shiki css-variables"[^>]*>/.exec(fenceHtml)?.[0];
  expect(blockHtml.startsWith(wrapper ?? '\u0000never'), 'identical pre wrapper').toBe(true);
});

test('highlightSiteCode fails closed on a language outside the shared grammar table', async () => {
  await expect(highlightSiteCode('x', 'cobol')).rejects.toThrow(/unsupported fenced language/);
  // Plain-text aliases belong to marked's plain fence path; the exported
  // helper has no marked fallback and must refuse rather than guess.
  await expect(highlightSiteCode('x', 'text')).rejects.toThrow(/no plain path/);
});
