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
});
