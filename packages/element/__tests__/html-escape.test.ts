import { expect, test } from 'vitest';
import { OpenElementError } from '../src/internal/core/errors.ts';
import {
  documentStreamParts,
  escapeAttr,
  escapeAttrValue,
  escapeHtml,
  wrapInDocument,
} from '../src/internal/core/html-escape.ts';

test('escapeHtml and escapeAttr share one ESCAPE_MAP and identical output', () => {
  const samples = ['', 'a', '&<>"\'', '<script>alert(1)</script>', 'a&b<c>d"e\'f'];
  for (const s of samples) {
    expect(escapeAttr(s), `escapeAttr must equal escapeHtml for ${JSON.stringify(s)}`).toEqual(
      escapeHtml(s),
    );
  }
});

test('escapeHtml escapes all five special characters in one pass', () => {
  expect(escapeHtml('&<>"\'')).toEqual('&amp;&lt;&gt;&quot;&#39;');
});

test('escapeAttr escapes the ampersand before quoting (no double escape)', () => {
  expect(escapeAttr('a&b')).toEqual('a&amp;b');
});

test('escapeAttrValue coerces non-string via String() while escapeHtml returns empty for non-string', () => {
  expect(escapeAttrValue(null)).toEqual('');
  expect(escapeAttrValue(undefined)).toEqual('');
  expect(escapeAttrValue(42)).toEqual('42');
  expect(escapeHtml(null as unknown as string)).toEqual('');
  expect(escapeHtml(42 as unknown as string)).toEqual('');
});

test('wrapInDocument: strips unclosed script tags from headExtras', () => {
  const out = wrapInDocument('x', { headExtras: '<script src="https://evil.example/x.js">' });
  expect(out.includes('<script')).toEqual(false);
  expect(out.includes('evil.example')).toEqual(false);
});

test('wrapInDocument: strips slash-delimited script tags from headExtras', () => {
  const out = wrapInDocument('x', {
    headExtras: '<script/src="https://evil.example/x.js"></script><meta name="ok" content="1">',
  });
  expect(out.includes('<script')).toEqual(false);
  expect(out.includes('evil.example')).toEqual(false);
  expect(out.includes('<meta name="ok" content="1">')).toEqual(true);
});

test('wrapInDocument: script end tags with attributes close the strip precisely (#1281, CodeQL bad-tag-filter)', () => {
  // Browsers accept `</script\t\n bar>` as a script end tag (attributes on end
  // tags are ignored), so the stripper must match it — and must stop there
  // instead of falling back to the strip-to-EOF pass that eats later markup.
  const out = wrapInDocument('x', {
    headExtras: '<script>alert(1)</script\t\n bar><meta name="ok" content="1">',
  });
  expect(out.includes('alert(1)')).toEqual(false);
  expect(out.includes('<meta name="ok" content="1">')).toEqual(true);
});

test('wrapInDocument: strips re-formed script tags to a fixed point (#1281, CodeQL incomplete sanitization)', () => {
  // Removing the inner pair of a nested fragment re-forms a live outer
  // `<script>...</script>`; the strip must consume it precisely instead of
  // falling back to strip-to-EOF, which would eat the trailing <meta>.
  const out = wrapInDocument('x', {
    headExtras: '<scri<script></script>pt>alert(1)</scri</script>pt><meta name="ok" content="1">',
  });
  expect(out.includes('<script')).toEqual(false);
  expect(out.includes('alert(1)')).toEqual(false);
  expect(out.includes('<meta name="ok" content="1">')).toEqual(true);
});

test('wrapInDocument: strips on* handlers exposed by an earlier strip (#1281, CodeQL incomplete sanitization)', () => {
  // Removing ` onx='y'` concatenates the leftover ` o` prefix with the
  // `nclick=...` suffix, re-forming a live `onclick` handler that a
  // single-pass strip emits into the document. The strip must repeat until
  // no handler pattern remains.
  const out = wrapInDocument('x', {
    headExtras: `<a o onx='y'nclick=alert(1)>text</a>`,
  });
  expect(out.includes('onclick')).toEqual(false);
  expect(out.includes('alert(1)')).toEqual(false);
  expect(out.includes('text')).toEqual(true);
});

test('wrapInDocument: --!> counts as a comment close in the balance check (#1281, CodeQL bad-tag-filter)', () => {
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
  expect(unbalanced.length).toEqual(1);
});

test('wrapInDocument: emits link tags (canonical, hreflang alternates) after meta (#1326)', () => {
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
    !(
      out.indexOf(metaDescription) < out.indexOf(canonical) &&
      out.indexOf(canonical) < out.indexOf(alternateEn) &&
      out.indexOf(alternateEn) < out.indexOf(alternateZh)
    )
  ) {
    throw new Error(`link/meta order is not deterministic:\n${out}`);
  }
});

test('wrapInDocument: escapes link attributes and skips entries without rel or href', () => {
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
  expect(wrapInDocument('x', { title: 'T' }).includes('<link')).toEqual(false);
});

// ─── Structured script descriptors + CSP nonce (Alpha.1 closure) ────────

test('wrapInDocument: no scripts and no nonce stays byte-identical', () => {
  const baseline =
    '<!DOCTYPE html>\n<html lang="en">\n<head>\n  <meta charset="UTF-8">\n' +
    '  <meta name="viewport" content="width=device-width, initial-scale=1.0">\n' +
    '  <title>T</title>\n  \n</head>\n<body>\n  x\n  \n</body>\n</html>';
  expect(wrapInDocument('x', { title: 'T' })).toEqual(baseline);
  // An explicitly empty descriptor list changes nothing either.
  expect(wrapInDocument('x', { title: 'T', scripts: [] })).toEqual(baseline);
});

test('documentStreamParts reuses the exact document boundary and nonce rules', () => {
  const options = {
    title: '<Stream>',
    cspNonce: 'nonce123',
    scripts: [{ src: '/client.js', type: 'module' }],
    meta: { description: 'a & b' },
  };
  const { prefix, suffix } = documentStreamParts(options);
  expect(prefix + '<main>shell</main>' + suffix).toEqual(
    wrapInDocument('<main>shell</main>', options),
  );
  expect(prefix.includes('</body>')).toEqual(false);
  expect(suffix.includes('nonce="nonce123"')).toEqual(true);
});

test('documentStreamParts emits an optional nonce-bearing classic bootstrap in the head', () => {
  const baseline = documentStreamParts({ title: 'T' });
  const streamed = documentStreamParts({
    title: 'T',
    cspNonce: 'nonce123',
    streamBootstrap: 'window.__streamStarted = true;',
  });
  expect(
    streamed.prefix.includes(
      '<script nonce="nonce123">window.__streamStarted = true;</script>\n</head>',
    ),
  ).toEqual(true);
  expect(streamed.suffix).toEqual(baseline.suffix);
  expect(streamed.prefix + 'shell' + streamed.suffix).toEqual(
    wrapInDocument('shell', {
      title: 'T',
      cspNonce: 'nonce123',
      streamBootstrap: 'window.__streamStarted = true;',
    }),
  );
});

test('wrapInDocument: script descriptors serialize byte-identically to the retired injectors when no nonce is present', () => {
  const out = wrapInDocument('x', {
    scripts: [{ type: 'module', src: '/client/islands/client.js' }],
  });
  expect(out.includes('<script type="module" src="/client/islands/client.js"></script>')).toEqual(
    true,
  );
  expect(out.includes('nonce')).toEqual(false);
});

test('wrapInDocument: a valid CSP nonce reaches EVERY generated script tag', () => {
  const out = wrapInDocument('x', {
    cspNonce: 'abc123+/=_-',
    scripts: [{ type: 'module', src: '/client/islands/client.js' }, { code: 'window.__x = 1;' }],
  });
  expect(
    out.includes(
      '<script type="module" src="/client/islands/client.js" nonce="abc123+/=_-"></script>',
    ),
  ).toEqual(true);
  expect(out.includes('<script nonce="abc123+/=_-">window.__x = 1;</script>')).toEqual(true);
  // Every <script ...> in the body carries the nonce.
  const tags = out.match(/<script\b[^>]*>[\s\S]*?<\/script(?:\s+[^>]*)?>/gi) ?? [];
  expect(tags.length).toEqual(2);
  for (const tag of tags) expect(tag.includes('nonce="abc123+/=_-"'), tag).toEqual(true);
});

test('wrapInDocument: an invalid nonce still warns and emits no nonce attribute', () => {
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
  expect(warnings.some((w) => w.includes('Invalid CSP nonce format'))).toEqual(true);
  expect(out.includes('nonce=')).toEqual(false);
  expect(out.includes('<script type="module" src="/client/islands/client.js"></script>')).toEqual(
    true,
  );
});

test('wrapInDocument: script descriptor attributes are escaped; inline </script is guarded', () => {
  const out = wrapInDocument('x', {
    cspNonce: 'nonce-1_ok=',
    scripts: [
      { type: 'module', src: '/client/a.js?x=1&y=<2>"' },
      { code: 'const s = "</script><script>alert(1)</script>";' },
    ],
  });
  expect(out.includes('src="/client/a.js?x=1&amp;y=&lt;2&gt;&quot;"')).toEqual(true);
  // A literal end tag inside an inline body must not close the element early.
  expect(out.includes('"</script><script>alert(1)</script>"')).toEqual(false);
  expect(out.includes('"<\\/script><script>alert(1)<\\/script>"')).toEqual(true);
});

test('wrapInDocument: descriptors without src or code are skipped', () => {
  const out = wrapInDocument('x', { scripts: [{ type: 'module' }] });
  expect(out.includes('<script')).toEqual(false);
});

// ─── Structured data channel (JSON-LD) ─────────────────────────────────

test('wrapInDocument: structured data serializes into <head> as application/ld+json', () => {
  const out = wrapInDocument('x', {
    title: 'Notes',
    meta: { description: 'All notes' },
    links: [{ rel: 'canonical', href: 'https://example.com/notes' }],
    structuredData: [{ '@context': 'https://schema.org', '@type': 'WebSite', name: 'Example' }],
  });
  const tag =
    '  <script type="application/ld+json">' +
    '{"@context":"https://schema.org","@type":"WebSite","name":"Example"}</script>';
  expect(out.includes(tag)).toEqual(true);
  // Inside <head>, after the link collection, before any raw head extras.
  const head = out.slice(out.indexOf('<head>'), out.indexOf('</head>'));
  const tagIndex = head.indexOf(tag);
  expect(tagIndex > head.indexOf('<link rel="canonical"')).toEqual(true);
  expect(head.includes(tag)).toEqual(true);
  // The payload is data, not markup: nothing is HTML-escaped or re-encoded.
  expect(tag.includes('&quot;')).toEqual(false);
  // No structured data (or an empty list) changes nothing.
  expect(wrapInDocument('x', { title: 'T' })).toEqual(
    wrapInDocument('x', { title: 'T', structuredData: [] }),
  );
});

test('wrapInDocument: structured data cannot close its script element or open a comment', () => {
  const payload = 'Notes</script><img src=x onerror=alert(1)><!--<script>alert(2)</script>';
  const open = '<script type="application/ld+json">';
  const out = wrapInDocument('x', {
    structuredData: [{ '@type': 'Article', headline: payload }],
  });
  // Exactly one end tag: the framework's own. Nothing in the payload can
  // close the element, open a comment or start a nested script.
  expect((out.match(/<\/script>/g) ?? []).length).toEqual(1);
  for (const forbidden of ['<!--', '<img', '<script>alert(2)']) {
    expect(out.includes(forbidden), `${forbidden} must not survive in the document`).toEqual(false);
  }
  expect(out.includes('\\u003C/script>\\u003Cimg')).toEqual(true);
  // The JSON still round-trips to the original text: escaping is a markup
  // constraint, not a change of meaning.
  expect(JSON.parse(out.slice(out.indexOf(open) + open.length, out.indexOf('</script>')))).toEqual({
    '@type': 'Article',
    headline: payload,
  });
});

test('wrapInDocument: a valid CSP nonce also reaches the structured data tag', () => {
  const out = wrapInDocument('x', {
    cspNonce: 'nonce-1_ok=',
    structuredData: [{ '@type': 'WebSite' }],
  });
  expect(
    out.includes(
      '<script type="application/ld+json" nonce="nonce-1_ok=">{"@type":"WebSite"}</script>',
    ),
  ).toEqual(true);
});

test('wrapInDocument: non-JSON structured data entries fail closed', () => {
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
    expect(thrown, name).toBeInstanceOf(OpenElementError);
    expect(thrown.code, name).toEqual('OE_INVALID_STRUCTURED_DATA');
    expect(thrown.phase, name).toEqual('build');
    expect(thrown.message.includes('structuredData'), name).toEqual(true);
  }
});

// ─── meta.tags attribute names fail closed (#1373, P4) ─────────────────

test('wrapInDocument: well-formed meta.tags keys still serialize unchanged (#1373)', () => {
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
  expect(out.includes('<meta name="robots" content="index, follow">')).toEqual(true);
  expect(out.includes('<meta http-equiv="refresh" data:x-tra="1" flag="true">')).toEqual(true);
});

test('wrapInDocument: unsafe meta.tags keys throw with a structured code (#1373)', () => {
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
    expect(thrown, name).toBeInstanceOf(OpenElementError);
    expect(thrown.code, name).toEqual('OE_UNSAFE_META_ATTRIBUTE');
    expect(thrown.message.includes('unsafe meta attribute name'), name).toEqual(true);
    expect(thrown.recoverable, name).toEqual(false);
  }
});
