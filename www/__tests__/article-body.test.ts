import { expect, test } from 'vitest';
import { prepareArticle } from '../app/site-ui/article-body.ts';

test('prepareArticle: outline label drops a partial tag fragment (#1281, CodeQL incomplete sanitization)', () => {
  // A heading body can contain `<script` with no closing `>`; the tag
  // pattern `<[^>]+>` cannot match it, so the label must not carry the
  // leftover fragment into the rail outline.
  const { outline } = prepareArticle('<h2>configure <script</h2>');
  expect(outline.length).toEqual(1);
  expect(outline[0].label.includes('<')).toEqual(false);
  expect(outline[0].label.includes('script')).toEqual(true);
});

test('prepareArticle: outline label cannot retain angle brackets from nested fragments', () => {
  const { outline } = prepareArticle('<h2>a <<script>script> b</h2>');
  expect(outline.length).toEqual(1);
  expect(outline[0].label.includes('<')).toEqual(false);
  expect(outline[0].label.includes('>')).toEqual(false);
  expect(outline[0].label).toEqual('a script b');
});

test('prepareArticle: ordinary heading labels keep their text', () => {
  const { outline, html } = prepareArticle('<h2 id="old">Getting <em>started</em> now</h2>');
  expect(outline.length).toEqual(1);
  expect(outline[0].label).toEqual('Getting started now');
  expect(outline[0].id).toEqual('getting-started-now');
  expect(html.includes('id="getting-started-now"')).toEqual(true);
  expect(
    html.includes(
      '<a class="heading-anchor" href="#getting-started-now" aria-label="Link to this section"></a>',
    ),
  ).toEqual(true);
  const { html: zhHtml } = prepareArticle('<h2>开始</h2>', 'zh');
  expect(zhHtml.includes('aria-label="链接到本节"')).toEqual(true);
});

test('prepareArticle: headings inside pre stay literal', () => {
  const { outline, html } = prepareArticle('<h2>Real</h2><pre><h2>Fake</h2></pre>');
  expect(outline.map((item) => item.id)).toEqual(['real']);
  expect(html.includes('href="#fake"')).toEqual(false);
});

test('prepareArticle: reserved and existing ids are never re-issued', () => {
  const { outline } = prepareArticle('<h2>Start</h2><p id="kept">x</p><h2>Kept</h2>', 'en', [
    'start',
  ]);
  expect(outline.map((item) => item.id)).toEqual(['start-2', 'kept-2']);
});

/** Every id attribute in the prepared document, for uniqueness assertions. */
function allIds(html: string): string[] {
  return [...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);
}

function assertIdsUnique(html: string): void {
  const ids = allIds(html);
  const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
  expect(duplicates, `duplicate DOM ids: ${duplicates.join(', ')}`).toEqual([]);
}

test('prepareArticle: suffixed ids already in the document are never re-issued', () => {
  const { html, outline } = prepareArticle('<h2>Foo</h2><p id="foo-2">existing</p><h2>Foo</h2>');
  expect(outline.map((item) => item.id)).toEqual(['foo', 'foo-3']);
  assertIdsUnique(html);
});

test('prepareArticle: a taken stem still advances past its occupied suffix', () => {
  const { html, outline } = prepareArticle('<p id="foo">a</p><h2>Foo</h2>');
  expect(outline.map((item) => item.id)).toEqual(['foo-2']);
  assertIdsUnique(html);

  const run = prepareArticle('<p id="foo">a</p><p id="foo-2">b</p><p id="foo-3">c</p><h2>Foo</h2>');
  expect(run.outline.map((item) => item.id)).toEqual(['foo-4']);
  assertIdsUnique(run.html);
});

test('prepareArticle: reserved ids participate in suffix collision checks', () => {
  const { html, outline } = prepareArticle('<h2>Foo</h2><h2>Foo</h2>', 'en', ['foo-2']);
  expect(outline.map((item) => item.id)).toEqual(['foo', 'foo-3']);
  assertIdsUnique(html);
});

test('prepareArticle: authored heading ids are stripped and never collide', () => {
  const { html, outline } = prepareArticle('<h2 id="foo-2">Other</h2><h2>Foo</h2><h2>Foo</h2>');
  expect(outline.map((item) => item.id)).toEqual(['other', 'foo', 'foo-3']);
  assertIdsUnique(html);
});

test('prepareArticle: repeated and empty headings allocate unique ids', () => {
  const repeated = prepareArticle('<h2>Foo</h2><h2>Foo</h2><h2>Foo</h2>');
  expect(repeated.outline.map((item) => item.id)).toEqual(['foo', 'foo-2', 'foo-3']);
  assertIdsUnique(repeated.html);

  const empty = prepareArticle('<h2></h2><p id="section-2">x</p><h2></h2>');
  expect(empty.outline.map((item) => item.id)).toEqual(['section', 'section-3']);
  assertIdsUnique(empty.html);
});

test('prepareArticle: existing ids are seeded in every HTML quote style', () => {
  const single = prepareArticle("<h2>Foo</h2><p id='foo'>x</p><p id='foo-2'>y</p>");
  expect(single.outline.map((item) => item.id)).toEqual(['foo-3']);
  assertIdsUnique(single.html);

  const unquoted = prepareArticle('<h2>Foo</h2><p id=foo>x</p><p id=foo-2>y</p>');
  expect(unquoted.outline.map((item) => item.id)).toEqual(['foo-3']);
  assertIdsUnique(unquoted.html);

  const mixed = prepareArticle('<h2>Foo</h2><p id="foo">a</p><p id=foo-2>b</p><h2>Foo</h2>');
  expect(mixed.outline.map((item) => item.id)).toEqual(
    ['foo-3', 'foo-4'].slice(0, 1).concat(['foo-4']),
  );
  assertIdsUnique(mixed.html);
});

test('prepareArticle: authored heading ids of every quote style are replaced, never duplicated', () => {
  for (const [label, html, expectedId] of [
    ['double', '<h2 id="foo">Bar</h2>', 'bar'],
    ['single', "<h2 id='foo'>Bar</h2>", 'bar'],
    ['unquoted', '<h2 id=foo>Bar</h2>', 'bar'],
    // Authored id colliding with the heading stem: the seed must push the
    // replacement past it, and removal must clear the original attribute.
    ['double collision', '<h2 id="bar">Bar</h2>', 'bar-2'],
    ['single collision', "<h2 id='bar'>Bar</h2>", 'bar-2'],
    ['unquoted collision', '<h2 id=bar>Bar</h2>', 'bar-2'],
  ] as const) {
    const { html: out, outline } = prepareArticle(html);
    const heading = /<h2[^>]*>/.exec(out)?.[0] ?? '';
    const ids = [...heading.matchAll(/\sid=(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g)].map(
      (match) => match[1] ?? match[2] ?? match[3],
    );
    expect(ids, `${label}: the heading must carry exactly one id`).toEqual([expectedId]);
    expect(
      outline.map((item) => item.id),
      `${label}: outline must match`,
    ).toEqual([expectedId]);
    assertIdsUnique(out);
  }
});

test('prepareArticle: unquoted element ids participate in collision checks', () => {
  const { html, outline } = prepareArticle('<h2>Foo</h2><p id=foo-2>x</p><h2>Foo</h2>');
  expect(outline.map((item) => item.id)).toEqual(['foo', 'foo-3']);
  assertIdsUnique(html);
});

test('prepareArticle: id-like text inside quoted attribute values is not an id', () => {
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
    expect(authored, `${label}: authored attribute must be preserved`).toEqual(original);
    expect(
      outline.map((item) => item.id),
      `${label}: outline must be the heading stem`,
    ).toEqual(['bar']);
    assertIdsUnique(out);
  }
  // The fake id must not occupy the stem either: a later Foo heading still
  // receives plain 'foo'.
  const later = prepareArticle('<h2 data-note="x id=foo">Bar</h2><h2>Foo</h2>');
  expect(later.outline.map((item) => item.id)).toEqual(['bar', 'foo']);
});

test('prepareArticle: heading-like text inside raw-text elements is not a heading', () => {
  const style = prepareArticle(
    '<style>.x::before { content: "<h2 id=foo>Fake</h2>" }</style><h2>Bar</h2>',
  );
  expect(style.outline.map((item) => item.id)).toEqual(['bar']);
  expect(style.html.includes('id="bar"')).toEqual(true);
  expect(style.html.includes('id="foo"')).toEqual(false);
  expect(style.html.includes('content: "<h2 id=foo>Fake</h2>"')).toEqual(true);

  const script = prepareArticle('<script>const tpl = "<h2 id=foo>Fake</h2>";</script><h2>Bar</h2>');
  expect(script.outline.map((item) => item.id)).toEqual(['bar']);
  expect(script.html.includes('id="foo"')).toEqual(false);
  expect(script.html.includes('const tpl = "<h2 id=foo>Fake</h2>";')).toEqual(true);

  // A real id inside raw text must not seed the document allocator.
  const seeded = prepareArticle('<style>.a { content: "<p id=foo></p>" }</style><h2>Foo</h2>');
  expect(seeded.outline.map((item) => item.id)).toEqual(['foo']);
});

test('prepareArticle: adversarial quote runs cannot cause regex blowup', () => {
  // The heading matcher's attribute part keeps its alternatives disjoint
  // (`"..."` / `'...'` / `[^>"']`), so a partial tag followed by thousands of
  // quotes stays linear (CodeQL js/redos). The budget is loose on purpose:
  // the fixed scanner needs single-digit milliseconds for this input.
  for (const evil of ['<h2' + '""'.repeat(5000), '<h2' + "''".repeat(5000)]) {
    const started = performance.now();
    prepareArticle(evil);
    const elapsed = performance.now() - started;
    expect(elapsed < 1000, `adversarial input took ${Math.round(elapsed)}ms`).toEqual(true);
  }
});

test('prepareArticle: duplicate authored ids are all removed', () => {
  const { html: out, outline } = prepareArticle('<h2 id="a" id="b">Title</h2>');
  const heading = /<h2[^>]*>/.exec(out)?.[0] ?? '';
  expect((heading.match(/\bid=/g) ?? []).length, heading).toEqual(1);
  const generated = outline[0].id;
  expect(generated === 'a' || generated === 'b').toEqual(false);
  expect(heading.includes(`id="${generated}"`)).toEqual(true);
});
