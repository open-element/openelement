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

Deno.test('prepareArticle: authored heading ids of every quote style are replaced, never duplicated', () => {
  for (
    const [label, html, expectedId] of [
      ['double', '<h2 id="foo">Bar</h2>', 'bar'],
      ['single', "<h2 id='foo'>Bar</h2>", 'bar'],
      ['unquoted', '<h2 id=foo>Bar</h2>', 'bar'],
      // Authored id colliding with the heading stem: the seed must push the
      // replacement past it, and removal must clear the original attribute.
      ['double collision', '<h2 id="bar">Bar</h2>', 'bar-2'],
      ['single collision', "<h2 id='bar'>Bar</h2>", 'bar-2'],
      ['unquoted collision', '<h2 id=bar>Bar</h2>', 'bar-2'],
    ] as const
  ) {
    const { html: out, outline } = prepareArticle(html);
    const heading = /<h2[^>]*>/.exec(out)?.[0] ?? '';
    const ids = [...heading.matchAll(/\sid=(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g)]
      .map((match) => match[1] ?? match[2] ?? match[3]);
    assertEquals(ids, [expectedId], `${label}: the heading must carry exactly one id`);
    assertEquals(outline.map((item) => item.id), [expectedId], `${label}: outline must match`);
    assertIdsUnique(out);
  }
});

Deno.test('prepareArticle: unquoted element ids participate in collision checks', () => {
  const { html, outline } = prepareArticle('<h2>Foo</h2><p id=foo-2>x</p><h2>Foo</h2>');
  assertEquals(outline.map((item) => item.id), ['foo', 'foo-3']);
  assertIdsUnique(html);
});

Deno.test('prepareArticle: id-like text inside quoted attribute values is not an id', () => {
  const cases: Array<[string, string]> = [
    ['double', '<h2 data-note="x id=foo">Bar</h2>'],
    ['single', "<h2 title='x id=foo'>Bar</h2>"],
    ['nested double', `<h2 data-note="id='foo'">Bar</h2>`],
    ['nested single', `<h2 data-note='id="foo"'>Bar</h2>`],
    ['unquoted value', '<h2 data-note=id=foo>Bar</h2>'],
  ];
  for (const [label, html] of cases) {
    const { html: out, outline } = prepareArticle(html);
    // The authored attribute survives byte-intact.
    const authored = /\s(data-note|title)=("[^"]*"|'[^']*'|[^\s>]+)/.exec(out)?.[0] ?? '';
    const original = /\s(data-note|title)=("[^"]*"|'[^']*'|[^\s>]+)/.exec(html)?.[0] ?? '';
    assertEquals(authored, original, `${label}: authored attribute must be preserved`);
    assertEquals(
      outline.map((item) => item.id),
      ['bar'],
      `${label}: outline must be the heading stem`,
    );
    assertIdsUnique(out);
  }
  // The fake id must not occupy the stem either: a later Foo heading still
  // receives plain 'foo'.
  const later = prepareArticle('<h2 data-note="x id=foo">Bar</h2><h2>Foo</h2>');
  assertEquals(later.outline.map((item) => item.id), ['bar', 'foo']);
});

Deno.test('prepareArticle: heading-like text inside raw-text elements is not a heading', () => {
  const style = prepareArticle(
    '<style>.x::before { content: "<h2 id=foo>Fake</h2>" }</style><h2>Bar</h2>',
  );
  assertEquals(style.outline.map((item) => item.id), ['bar']);
  assertEquals(style.html.includes('id="bar"'), true);
  assertEquals(style.html.includes('id="foo"'), false);
  assertEquals(style.html.includes('content: "<h2 id=foo>Fake</h2>"'), true);

  const script = prepareArticle(
    '<script>const tpl = "<h2 id=foo>Fake</h2>";</script><h2>Bar</h2>',
  );
  assertEquals(script.outline.map((item) => item.id), ['bar']);
  assertEquals(script.html.includes('id="foo"'), false);
  assertEquals(script.html.includes('const tpl = "<h2 id=foo>Fake</h2>";'), true);

  // A real id inside raw text must not seed the document allocator.
  const seeded = prepareArticle('<style>.a { content: "<p id=foo></p>" }</style><h2>Foo</h2>');
  assertEquals(seeded.outline.map((item) => item.id), ['foo']);
});
