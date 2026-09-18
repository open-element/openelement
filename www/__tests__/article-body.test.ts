import { assertEquals } from '@std/assert';
import { prepareArticle } from '../app/site-ui/article-body.ts';

Deno.test('prepareArticle: outline label drops a partial tag fragment (#1281, CodeQL incomplete sanitization)', () => {
  // A heading body can contain `<script` with no closing `>`; the tag
  // pattern `<[^>]+>` cannot match it, so the label must not carry the
  // leftover fragment into the rail outline.
  const { outline } = prepareArticle('<h2>configure <script</h2>');
  assertEquals(outline.length, 1);
  assertEquals(outline[0].label.includes('<'), false);
  assertEquals(outline[0].label.includes('script'), true);
});

Deno.test('prepareArticle: outline label cannot retain angle brackets from nested fragments', () => {
  const { outline } = prepareArticle('<h2>a <<script>script> b</h2>');
  assertEquals(outline.length, 1);
  assertEquals(outline[0].label.includes('<'), false);
  assertEquals(outline[0].label.includes('>'), false);
  assertEquals(outline[0].label, 'a script b');
});

Deno.test('prepareArticle: ordinary heading labels keep their text', () => {
  const { outline, html } = prepareArticle('<h2 id="old">Getting <em>started</em> now</h2>');
  assertEquals(outline.length, 1);
  assertEquals(outline[0].label, 'Getting started now');
  assertEquals(outline[0].id, 'getting-started-now');
  assertEquals(html.includes('id="getting-started-now"'), true);
  assertEquals(
    html.includes(
      '<a class="heading-anchor" href="#getting-started-now" aria-label="Link to this section"></a>',
    ),
    true,
  );
  const { html: zhHtml } = prepareArticle('<h2>开始</h2>', 'zh');
  assertEquals(zhHtml.includes('aria-label="链接到本节"'), true);
});

Deno.test('prepareArticle: headings inside pre stay literal', () => {
  const { outline, html } = prepareArticle('<h2>Real</h2><pre><h2>Fake</h2></pre>');
  assertEquals(outline.map((item) => item.id), ['real']);
  assertEquals(html.includes('href="#fake"'), false);
});

Deno.test('prepareArticle: reserved and existing ids are never re-issued', () => {
  const { outline } = prepareArticle('<h2>Start</h2><p id="kept">x</p><h2>Kept</h2>', 'en', ['start']);
  assertEquals(outline.map((item) => item.id), ['start-2', 'kept-2']);
});
