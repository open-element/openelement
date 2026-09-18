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
  const { outline } = prepareArticle('<h2>Start</h2><p id="kept">x</p><h2>Kept</h2>', 'en', [
    'start',
  ]);
  assertEquals(outline.map((item) => item.id), ['start-2', 'kept-2']);
});

/** Every id attribute in the prepared document, for uniqueness assertions. */
function allIds(html: string): string[] {
  return [...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);
}

function assertIdsUnique(html: string): void {
  const ids = allIds(html);
  const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
  assertEquals(duplicates, [], `duplicate DOM ids: ${duplicates.join(', ')}`);
}

Deno.test('prepareArticle: suffixed ids already in the document are never re-issued', () => {
  const { html, outline } = prepareArticle('<h2>Foo</h2><p id="foo-2">existing</p><h2>Foo</h2>');
  assertEquals(outline.map((item) => item.id), ['foo', 'foo-3']);
  assertIdsUnique(html);
});

Deno.test('prepareArticle: a taken stem still advances past its occupied suffix', () => {
  const { html, outline } = prepareArticle('<p id="foo">a</p><h2>Foo</h2>');
  assertEquals(outline.map((item) => item.id), ['foo-2']);
  assertIdsUnique(html);

  const run = prepareArticle('<p id="foo">a</p><p id="foo-2">b</p><p id="foo-3">c</p><h2>Foo</h2>');
  assertEquals(run.outline.map((item) => item.id), ['foo-4']);
  assertIdsUnique(run.html);
});

Deno.test('prepareArticle: reserved ids participate in suffix collision checks', () => {
  const { html, outline } = prepareArticle('<h2>Foo</h2><h2>Foo</h2>', 'en', ['foo-2']);
  assertEquals(outline.map((item) => item.id), ['foo', 'foo-3']);
  assertIdsUnique(html);
});

Deno.test('prepareArticle: authored heading ids are stripped and never collide', () => {
  const { html, outline } = prepareArticle(
    '<h2 id="foo-2">Other</h2><h2>Foo</h2><h2>Foo</h2>',
  );
  assertEquals(outline.map((item) => item.id), ['other', 'foo', 'foo-3']);
  assertIdsUnique(html);
});

Deno.test('prepareArticle: repeated and empty headings allocate unique ids', () => {
  const repeated = prepareArticle('<h2>Foo</h2><h2>Foo</h2><h2>Foo</h2>');
  assertEquals(repeated.outline.map((item) => item.id), ['foo', 'foo-2', 'foo-3']);
  assertIdsUnique(repeated.html);

  const empty = prepareArticle('<h2></h2><p id="section-2">x</p><h2></h2>');
  assertEquals(empty.outline.map((item) => item.id), ['section', 'section-3']);
  assertIdsUnique(empty.html);
});

Deno.test('prepareArticle: existing ids are seeded in every HTML quote style', () => {
  const single = prepareArticle("<h2>Foo</h2><p id='foo'>x</p><p id='foo-2'>y</p>");
  assertEquals(single.outline.map((item) => item.id), ['foo-3']);
  assertIdsUnique(single.html);

  const unquoted = prepareArticle('<h2>Foo</h2><p id=foo>x</p><p id=foo-2>y</p>');
  assertEquals(unquoted.outline.map((item) => item.id), ['foo-3']);
  assertIdsUnique(unquoted.html);

  const mixed = prepareArticle('<h2>Foo</h2><p id="foo">a</p><p id=foo-2>b</p><h2>Foo</h2>');
  assertEquals(
    mixed.outline.map((item) => item.id),
    ['foo-3', 'foo-4'].slice(0, 1).concat(['foo-4']),
  );
  assertIdsUnique(mixed.html);
});
