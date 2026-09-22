import { assertEquals, assertInstanceOf } from '@std/assert';
import { OpenElementError } from '../src/internal/core/errors.ts';
import {
  escapeAttr,
  escapeAttrValue,
  escapeHtml,
  wrapInDocument,
} from '../src/internal/core/html-escape.ts';

Deno.test('escapeHtml and escapeAttr share one ESCAPE_MAP and identical output', () => {
  const samples = ['', 'a', '&<>"\'', '<script>alert(1)</script>', 'a&b<c>d"e\'f'];
  for (const s of samples) {
    assertEquals(
      escapeAttr(s),
      escapeHtml(s),
      `escapeAttr must equal escapeHtml for ${JSON.stringify(s)}`,
    );
  }
});

Deno.test('escapeHtml escapes all five special characters in one pass', () => {
  assertEquals(escapeHtml('&<>"\''), '&amp;&lt;&gt;&quot;&#39;');
});

Deno.test('escapeAttr escapes the ampersand before quoting (no double escape)', () => {
  assertEquals(escapeAttr('a&b'), 'a&amp;b');
});

Deno.test('escapeAttrValue coerces non-string via String() while escapeHtml returns empty for non-string', () => {
  assertEquals(escapeAttrValue(null), '');
  assertEquals(escapeAttrValue(undefined), '');
  assertEquals(escapeAttrValue(42), '42');
  assertEquals(escapeHtml(null as unknown as string), '');
  assertEquals(escapeHtml(42 as unknown as string), '');
});

Deno.test('wrapInDocument: strips unclosed script tags from headExtras', () => {
  const out = wrapInDocument('x', { headExtras: '<script src="https://evil.example/x.js">' });
  assertEquals(out.includes('<script'), false);
  assertEquals(out.includes('evil.example'), false);
});

Deno.test('wrapInDocument: strips slash-delimited script tags from headExtras', () => {
  const out = wrapInDocument('x', {
    headExtras: '<script/src="https://evil.example/x.js"></script><meta name="ok" content="1">',
  });
  assertEquals(out.includes('<script'), false);
  assertEquals(out.includes('evil.example'), false);
  assertEquals(out.includes('<meta name="ok" content="1">'), true);
});

Deno.test('wrapInDocument: script end tags with attributes close the strip precisely (#1281, CodeQL bad-tag-filter)', () => {
  // Browsers accept `</script\t\n bar>` as a script end tag (attributes on end
  // tags are ignored), so the stripper must match it — and must stop there
  // instead of falling back to the strip-to-EOF pass that eats later markup.
  const out = wrapInDocument('x', {
    headExtras: '<script>alert(1)</script\t\n bar><meta name="ok" content="1">',
  });
  assertEquals(out.includes('alert(1)'), false);
  assertEquals(out.includes('<meta name="ok" content="1">'), true);
});

Deno.test('wrapInDocument: strips re-formed script tags to a fixed point (#1281, CodeQL incomplete sanitization)', () => {
  // Removing the inner pair of a nested fragment re-forms a live outer
  // `<script>...</script>`; the strip must consume it precisely instead of
  // falling back to strip-to-EOF, which would eat the trailing <meta>.
  const out = wrapInDocument('x', {
    headExtras: '<scri<script></script>pt>alert(1)</scri</script>pt><meta name="ok" content="1">',
  });
  assertEquals(out.includes('<script'), false);
  assertEquals(out.includes('alert(1)'), false);
  assertEquals(out.includes('<meta name="ok" content="1">'), true);
});

Deno.test('wrapInDocument: strips on* handlers exposed by an earlier strip (#1281, CodeQL incomplete sanitization)', () => {
  // Removing ` onx='y'` concatenates the leftover ` o` prefix with the
  // `nclick=...` suffix, re-forming a live `onclick` handler that a
  // single-pass strip emits into the document. The strip must repeat until
  // no handler pattern remains.
  const out = wrapInDocument('x', {
    headExtras: `<a o onx='y'nclick=alert(1)>text</a>`,
  });
  assertEquals(out.includes('onclick'), false);
  assertEquals(out.includes('alert(1)'), false);
  assertEquals(out.includes('text'), true);
});

Deno.test('wrapInDocument: --!> counts as a comment close in the balance check (#1281, CodeQL bad-tag-filter)', () => {
  const warnings: string[] = [];
  const originalWarn = console.warn;
  console.warn = (msg: unknown) => warnings.push(String(msg));
  try {
    wrapInDocument('x', { headExtras: '<!-- ok --!>' });
    wrapInDocument('x', { headExtras: '<!-- unclosed' });
  } finally {
    console.warn = originalWarn;
  }
  const unbalanced = warnings.filter((w) => w.includes('unbalanced HTML comments'));
  assertEquals(unbalanced.length, 1);
});

Deno.test('wrapInDocument: emits link tags (canonical, hreflang alternates) after meta (#1326)', () => {
  const out = wrapInDocument('x', {
    title: 'Notes',
    meta: { description: 'All notes' },
    links: [
      { rel: 'canonical', href: 'https://example.com/notes' },
      { rel: 'alternate', href: 'https://example.com/notes', hreflang: 'en' },
      { rel: 'alternate', href: 'https://example.com/zh/notes', hreflang: 'zh' },
    ],
  });
  const canonical = '  <link rel="canonical" href="https://example.com/notes">';
  const alternateEn = '  <link rel="alternate" href="https://example.com/notes" hreflang="en">';
  const alternateZh = '  <link rel="alternate" href="https://example.com/zh/notes" hreflang="zh">';
  const metaDescription = '  <meta name="description" content="All notes">';
  for (const fragment of [metaDescription, canonical, alternateEn, alternateZh]) {
    if (!out.includes(fragment)) {
      throw new Error(`missing fragment: ${fragment}\n${out}`);
    }
  }
  // Deterministic order: meta description first, then links in author order.
  if (
    !(out.indexOf(metaDescription) < out.indexOf(canonical) &&
      out.indexOf(canonical) < out.indexOf(alternateEn) &&
      out.indexOf(alternateEn) < out.indexOf(alternateZh))
  ) {
    throw new Error(`link/meta order is not deterministic:\n${out}`);
  }
});

Deno.test('wrapInDocument: escapes link attributes and skips entries without rel or href', () => {
  const out = wrapInDocument('x', {
    links: [
      { rel: 'canonical', href: 'https://example.com/?a=1&b=<x>"' },
      { rel: '', href: 'https://example.com/skipped' },
      { rel: 'alternate', href: '' },
    ] as Array<{ rel: string; href: string; hreflang?: string }>,
  });
  if (!out.includes('href="https://example.com/?a=1&amp;b=&lt;x&gt;&quot;"')) {
    throw new Error(`link href was not attribute-escaped:\n${out}`);
  }
  if (out.includes('skipped')) {
    throw new Error(`entry without rel must be skipped:\n${out}`);
  }
  // No links at all must keep the document byte-identical to before.
  assertEquals(
    wrapInDocument('x', { title: 'T' }).includes('<link'),
    false,
  );
});

// ─── Structured script descriptors + CSP nonce (Alpha.1 closure) ────────

Deno.test('wrapInDocument: no scripts and no nonce stays byte-identical', () => {
  const baseline = '<!DOCTYPE html>\n<html lang="en">\n<head>\n  <meta charset="UTF-8">\n' +
    '  <meta name="viewport" content="width=device-width, initial-scale=1.0">\n' +
    '  <title>T</title>\n  \n</head>\n<body>\n  x\n  \n</body>\n</html>';
  assertEquals(wrapInDocument('x', { title: 'T' }), baseline);
  // An explicitly empty descriptor list changes nothing either.
  assertEquals(wrapInDocument('x', { title: 'T', scripts: [] }), baseline);
});

Deno.test('wrapInDocument: script descriptors serialize byte-identically to the retired injectors when no nonce is present', () => {
  const out = wrapInDocument('x', {
    scripts: [{ type: 'module', src: '/client/islands/client.js' }],
  });
  assertEquals(
    out.includes('<script type="module" src="/client/islands/client.js"></script>'),
    true,
  );
  assertEquals(out.includes('nonce'), false);
});

Deno.test('wrapInDocument: a valid CSP nonce reaches EVERY generated script tag', () => {
  const out = wrapInDocument('x', {
    cspNonce: 'abc123+/=_-',
    scripts: [
      { type: 'module', src: '/client/islands/client.js' },
      { code: 'window.__x = 1;' },
    ],
  });
  assertEquals(
    out.includes(
      '<script type="module" src="/client/islands/client.js" nonce="abc123+/=_-"></script>',
    ),
    true,
  );
  assertEquals(out.includes('<script nonce="abc123+/=_-">window.__x = 1;</script>'), true);
  // Every <script ...> in the body carries the nonce.
  const tags = out.match(/<script\b[^>]*>[\s\S]*?<\/script(?:\s+[^>]*)?>/gi) ?? [];
  assertEquals(tags.length, 2);
  for (const tag of tags) assertEquals(tag.includes('nonce="abc123+/=_-"'), true, tag);
});

Deno.test('wrapInDocument: an invalid nonce still warns and emits no nonce attribute', () => {
  const warnings: string[] = [];
  const originalWarn = console.warn;
  console.warn = (msg: unknown) => warnings.push(String(msg));
  let out = '';
  try {
    out = wrapInDocument('x', {
      cspNonce: 'not a "valid" nonce',
      scripts: [{ type: 'module', src: '/client/islands/client.js' }],
    });
  } finally {
    console.warn = originalWarn;
  }
  assertEquals(warnings.some((w) => w.includes('Invalid CSP nonce format')), true);
  assertEquals(out.includes('nonce='), false);
  assertEquals(
    out.includes('<script type="module" src="/client/islands/client.js"></script>'),
    true,
  );
});

Deno.test('wrapInDocument: script descriptor attributes are escaped; inline </script is guarded', () => {
  const out = wrapInDocument('x', {
    cspNonce: 'nonce-1_ok=',
    scripts: [
      { type: 'module', src: '/client/a.js?x=1&y=<2>"' },
      { code: 'const s = "</script><script>alert(1)</script>";' },
    ],
  });
  assertEquals(out.includes('src="/client/a.js?x=1&amp;y=&lt;2&gt;&quot;"'), true);
  // A literal end tag inside an inline body must not close the element early.
  assertEquals(out.includes('"</script><script>alert(1)</script>"'), false);
  assertEquals(out.includes('"<\\/script><script>alert(1)<\\/script>"'), true);
});

Deno.test('wrapInDocument: descriptors without src or code are skipped', () => {
  const out = wrapInDocument('x', { scripts: [{ type: 'module' }] });
  assertEquals(out.includes('<script'), false);
});

// ─── Structured data channel (JSON-LD) ─────────────────────────────────

Deno.test('wrapInDocument: structured data serializes into <head> as application/ld+json', () => {
  const out = wrapInDocument('x', {
    title: 'Notes',
    meta: { description: 'All notes' },
    links: [{ rel: 'canonical', href: 'https://example.com/notes' }],
    structuredData: [
      { '@context': 'https://schema.org', '@type': 'WebSite', name: 'Example' },
    ],
  });
  const tag = '  <script type="application/ld+json">' +
    '{"@context":"https://schema.org","@type":"WebSite","name":"Example"}</script>';
  assertEquals(out.includes(tag), true);
  // Inside <head>, after the link collection, before any raw head extras.
  const head = out.slice(out.indexOf('<head>'), out.indexOf('</head>'));
  const tagIndex = head.indexOf(tag);
  assertEquals(tagIndex > head.indexOf('<link rel="canonical"'), true);
  assertEquals(head.includes(tag), true);
  // The payload is data, not markup: nothing is HTML-escaped or re-encoded.
  assertEquals(tag.includes('&quot;'), false);
  // No structured data (or an empty list) changes nothing.
  assertEquals(
    wrapInDocument('x', { title: 'T' }),
    wrapInDocument('x', { title: 'T', structuredData: [] }),
  );
});

Deno.test('wrapInDocument: structured data cannot close its script element or open a comment', () => {
  const payload = 'Notes</script><img src=x onerror=alert(1)><!--<script>alert(2)</script>';
  const open = '<script type="application/ld+json">';
  const out = wrapInDocument('x', {
    structuredData: [{ '@type': 'Article', headline: payload }],
  });
  // Exactly one end tag: the framework's own. Nothing in the payload can
  // close the element, open a comment or start a nested script.
  assertEquals((out.match(/<\/script>/g) ?? []).length, 1);
  for (const forbidden of ['<!--', '<img', '<script>alert(2)']) {
    assertEquals(out.includes(forbidden), false, `${forbidden} must not survive in the document`);
  }
  assertEquals(out.includes('\\u003C/script>\\u003Cimg'), true);
  // The JSON still round-trips to the original text: escaping is a markup
  // constraint, not a change of meaning.
  assertEquals(
    JSON.parse(out.slice(out.indexOf(open) + open.length, out.indexOf('</script>'))),
    { '@type': 'Article', headline: payload },
  );
});

Deno.test('wrapInDocument: a valid CSP nonce also reaches the structured data tag', () => {
  const out = wrapInDocument('x', {
    cspNonce: 'nonce-1_ok=',
    structuredData: [{ '@type': 'WebSite' }],
  });
  assertEquals(
    out.includes(
      '<script type="application/ld+json" nonce="nonce-1_ok=">{"@type":"WebSite"}</script>',
    ),
    true,
  );
});

Deno.test('wrapInDocument: non-JSON structured data entries fail closed', () => {
  // Values JSON itself cannot represent (a function- or undefined-valued
  // property is silently DROPPED by JSON.stringify) are rejected a layer up,
  // by the structured-data channel in @openelement/router/document; this
  // serializer throws for every input it cannot faithfully serialize.
  //
  // #1386 item 3: the rejection is an OpenElementError carrying
  // OE_INVALID_STRUCTURED_DATA, not a bare TypeError — an argument-shape
  // failure is classifiable by code like every other failure this package
  // raises, so a caller correlates it with telemetry instead of testing the
  // JavaScript error class.
  const circular: Record<string, unknown> = {};
  circular.self = circular;
  const cases: Array<[string, unknown[]]> = [
    ['a string entry', ['<script type="application/ld+json">{}</script>']],
    ['an array entry', [[{ '@type': 'WebSite' }]]],
    ['a null entry', [null]],
    ['a bigint value', [{ '@type': 'WebSite', count: 1n }]],
    ['a circular value', [circular]],
  ];
  for (const [name, structuredData] of cases) {
    let thrown: unknown;
    try {
      wrapInDocument('x', {
        structuredData: structuredData as Array<Record<string, unknown>>,
      });
    } catch (error) {
      thrown = error;
    }
    assertInstanceOf(thrown, OpenElementError, name);
    assertEquals(thrown.code, 'OE_INVALID_STRUCTURED_DATA', name);
    assertEquals(thrown.phase, 'build', name);
    assertEquals(thrown.message.includes('structuredData'), true, name);
  }
});

// ─── meta.tags attribute names fail closed (#1373, P4) ─────────────────

Deno.test('wrapInDocument: well-formed meta.tags keys still serialize unchanged (#1373)', () => {
  // Safe-input parity: the name validation only adds rejections; keys that
  // were safe before emit the same bytes as before.
  const out = wrapInDocument('x', {
    meta: {
      tags: [
        { name: 'robots', content: 'index, follow' },
        { 'http-equiv': 'refresh', 'data:x-tra': 1, flag: true },
      ],
    },
  });
  assertEquals(out.includes('<meta name="robots" content="index, follow">'), true);
  assertEquals(
    out.includes('<meta http-equiv="refresh" data:x-tra="1" flag="true">'),
    true,
  );
});

Deno.test('wrapInDocument: unsafe meta.tags keys throw with a structured code (#1373)', () => {
  // `escapeAttr` escapes value characters but not NAME grammar, so a key
  // carrying a space or `=` would inject attributes into the emitted <meta>
  // element. The canonical isSafeAttributeName predicate rejects those keys
  // and the violation fails the render (no skip-and-warn): a valid document
  // is never produced for an unsafe key.
  const cases: Array<[string, Record<string, string | number | boolean>]> = [
    ['a space in the key', { 'foo onload=alert(1)': 'x' }],
    ['an equals sign in the key', { 'name=description': 'x' }],
    ['a double quote in the key', { 'na"me': 'x' }],
    ['a single quote in the key', { "na'me": 'x' }],
    ['an on* event-handler prefix', { onclick: 'alert(1)' }],
    ['a case-insensitive ON* prefix', { ONLOAD: 'x' }],
    ['an empty key', { '': 'x' }],
  ];
  for (const [name, tags] of cases) {
    let thrown: unknown;
    try {
      wrapInDocument('x', { meta: { tags: [tags] } });
    } catch (e) {
      thrown = e;
    }
    assertInstanceOf(thrown, OpenElementError, name);
    assertEquals(thrown.code, 'OE_UNSAFE_META_ATTRIBUTE', name);
    assertEquals(thrown.message.includes('unsafe meta attribute name'), true, name);
    assertEquals(thrown.recoverable, false, name);
  }
});
