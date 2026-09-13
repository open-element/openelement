/**
 * @openelement/router - head-injection.ts tests (Deno)
 *
 * Tests for HTML head injection safety: script tag validation,
 * URL safety checks, and headExtras serialization.
 */
import { assertEquals, assertStringIncludes, assertThrows } from '@std/assert';
import {
  assertNoScriptTags,
  buildHeadExtras,
  validateSafeUrl,
} from '../src/vite/head-injection.ts';

// ─── assertNoScriptTags ───────────────────────────────────────

Deno.test('assertNoScriptTags: allows plain HTML without scripts', () => {
  // Should not throw for safe content
  assertNoScriptTags('<link rel="stylesheet" href="/app.css" />', 'test-input');
  assertNoScriptTags('<meta charset="utf-8">', 'test-input');
  assertNoScriptTags('<div>Hello</div>', 'test-input');
  assertNoScriptTags('', 'test-input');
});

Deno.test('assertNoScriptTags: rejects <script> tag in any form', () => {
  assertThrows(
    () => assertNoScriptTags('<script src="/x.js"></script>', 'headExtras'),
    Error,
    'must not contain <script> tags',
  );

  assertThrows(
    () => assertNoScriptTags('<script>alert(1)</script>', 'headExtras'),
    Error,
    'must not contain <script> tags',
  );

  // Case insensitive
  assertThrows(
    () => assertNoScriptTags('<SCRIPT src="/x.js"></SCRIPT>', 'headExtras'),
    Error,
    'must not contain <script> tags',
  );
});

Deno.test('assertNoScriptTags: rejects self-closing script tag', () => {
  assertThrows(
    () => assertNoScriptTags('<script src="/app.js" />', 'headExtras'),
    Error,
    'must not contain <script> tags',
  );
});

Deno.test('assertNoScriptTags: rejects script with attributes before src', () => {
  assertThrows(
    () => assertNoScriptTags('<script defer src="/app.js"></script>', 'headExtras'),
    Error,
    'must not contain <script> tags',
  );
});

Deno.test('assertNoScriptTags: error message includes context name', () => {
  try {
    assertNoScriptTags('<script></script>', 'inject.headFragments');
    throw new Error('Should have thrown');
  } catch (e) {
    assertStringIncludes((e as Error).message, 'inject.headFragments');
    assertStringIncludes((e as Error).message, 'Use inject.scripts');
  }
});

// ─── validateSafeUrl ──────────────────────────────────────────

Deno.test('validateSafeUrl: allows safe URLs', () => {
  assertEquals(
    validateSafeUrl('https://cdn.example.com/app.css', 'stylesheets'),
    'https://cdn.example.com/app.css',
  );
  assertEquals(
    validateSafeUrl('http://localhost:3000/app.js', 'scripts'),
    'http://localhost:3000/app.js',
  );
  assertEquals(
    validateSafeUrl('https://example.com/path?q=1&v=2', 'stylesheets'),
    'https://example.com/path?q=1&v=2',
  );
  assertEquals(validateSafeUrl('//cdn.example.com/lib.js', 'scripts'), '//cdn.example.com/lib.js');
});

Deno.test('validateSafeUrl: rejects javascript: protocol', () => {
  assertThrows(
    () => validateSafeUrl('javascript:alert(1)', 'stylesheets'),
    Error,
    'javascript: protocol is not allowed',
  );
});

Deno.test('validateSafeUrl: rejects data: protocol', () => {
  assertThrows(
    () => validateSafeUrl('data:text/html,<script>alert(1)</script>', 'stylesheets'),
    Error,
    'data: protocol is not allowed',
  );
});

Deno.test('validateSafeUrl: rejects vbscript: protocol', () => {
  assertThrows(
    () => validateSafeUrl('vbscript:msgbox(1)', 'scripts'),
    Error,
    'vbscript: protocol is not allowed',
  );
});

Deno.test('validateSafeUrl: rejects file: protocol', () => {
  assertThrows(
    () => validateSafeUrl('file:///etc/passwd', 'scripts'),
    Error,
    'file: protocol is not allowed',
  );
});

Deno.test('validateSafeUrl: case-insensitive protocol check', () => {
  assertThrows(
    () => validateSafeUrl('JAVASCRIPT:alert(1)', 'scripts'),
    Error,
    'javascript: protocol is not allowed',
  );

  assertThrows(
    () => validateSafeUrl('JavaScript:alert(1)', 'scripts'),
    Error,
    'javascript: protocol is not allowed',
  );
});

Deno.test('validateSafeUrl: rejects malformed percent-encoding', () => {
  assertThrows(
    () => validateSafeUrl('https://example.com/%ZZ', 'stylesheets'),
    Error,
    'malformed percent-encoding',
  );
});

Deno.test('validateSafeUrl: error message includes context name', () => {
  try {
    validateSafeUrl('javascript:void(0)', 'inject.scripts');
    throw new Error('Should have thrown');
  } catch (e) {
    assertStringIncludes((e as Error).message, 'inject.scripts');
  }
});

Deno.test('validateSafeUrl: trims whitespace', () => {
  assertEquals(
    validateSafeUrl('  https://example.com/app.css  ', 'stylesheets'),
    'https://example.com/app.css',
  );
});

// #761: WHATWG URL parsing strips tab/LF/CR anywhere, so they must not
// bypass the protocol blocklist, and the emitted URL must be normalized.
Deno.test('validateSafeUrl: rejects protocols split by tab/newline', () => {
  assertThrows(
    () => validateSafeUrl('java\tscript:alert(1)', 'scripts'),
    Error,
    'javascript: protocol is not allowed',
  );
  assertThrows(
    () => validateSafeUrl('da\nta:text/html,<script>alert(1)</script>', 'scripts'),
    Error,
    'data: protocol is not allowed',
  );
  assertThrows(
    () => validateSafeUrl('java\rscript:alert(1)', 'scripts'),
    Error,
    'javascript: protocol is not allowed',
  );
});

Deno.test('validateSafeUrl: strips embedded tab/newline from safe URLs', () => {
  assertEquals(
    validateSafeUrl('https://example.com/a\tpp\n.js', 'scripts'),
    'https://example.com/app.js',
  );
});

Deno.test('buildHeadExtras: emits normalized script src (tab/newline stripped)', () => {
  const result = buildHeadExtras(
    {
      inject: { scripts: ['https://cdn.example.com/a\tpp\n.js'] },
    } as Parameters<typeof buildHeadExtras>[0],
  );
  assertStringIncludes(result.headExtras!, 'src="https://cdn.example.com/app.js"');
});

Deno.test('buildHeadExtras: rejects tab-split javascript: script src', () => {
  assertThrows(
    () =>
      buildHeadExtras(
        {
          inject: { scripts: ['java\tscript:alert(1)'] },
        } as Parameters<typeof buildHeadExtras>[0],
      ),
    Error,
    'javascript: protocol is not allowed',
  );
});

// ─── buildHeadExtras ──────────────────────────────────────────

Deno.test('buildHeadExtras: returns headExtras directly when provided', () => {
  const result = buildHeadExtras({ headExtras: '<link rel="stylesheet" href="/app.css" />' });
  assertEquals(result.headExtras, '<link rel="stylesheet" href="/app.css" />');
  assertEquals(result.allowHeadExtrasScripts, false);
});

Deno.test('buildHeadExtras: sanitizes unsafe direct headExtras markup', () => {
  const result = buildHeadExtras({
    headExtras: '<meta name="x" content="ok"><link rel="stylesheet" href="javascript:bad">',
  });
  assertStringIncludes(result.headExtras!, '<meta name="x" content="ok" />');
  assertEquals(result.headExtras!.includes('javascript:'), false);
});

Deno.test('buildHeadExtras: preserves style through restricted style path', () => {
  const result = buildHeadExtras({
    headExtras: '<style media="screen">:root { color: red; }</style>',
  });
  assertEquals(result.headExtras, '<style media="screen">:root { color: red; }</style>');
});

Deno.test('buildHeadExtras: rejects dangerous style content and attributes', () => {
  assertThrows(
    () =>
      buildHeadExtras({ headExtras: '<style>body{background:url(javascript:alert(1))}</style>' }),
    Error,
    'Unsafe CSS',
  );
  assertThrows(
    () => buildHeadExtras({ headExtras: '<style onclick="evil()">body{color:red}</style>' }),
    Error,
    'Unsafe style attribute',
  );
});

Deno.test('buildHeadExtras: rejects script in headExtras', () => {
  assertThrows(
    () => buildHeadExtras({ headExtras: '<script src="/x.js"></script>' }),
    Error,
    'headExtras must not contain <script> tags',
  );
});

Deno.test('buildHeadExtras: returns undefined when no inject config', () => {
  const result = buildHeadExtras({});
  assertEquals(result.headExtras, undefined);
  assertEquals(result.allowHeadExtrasScripts, false);
});

Deno.test('buildHeadExtras: empty inject produces undefined', () => {
  const result = buildHeadExtras({ inject: {} });
  assertEquals(result.headExtras, '');
  assertEquals(result.allowHeadExtrasScripts, true);
});

Deno.test('buildHeadExtras: stylesheets generate link tags', () => {
  const result = buildHeadExtras({
    inject: {
      stylesheets: ['https://cdn.example.com/app.css'],
    },
  });
  assertStringIncludes(result.headExtras!, '<link rel="stylesheet"');
  assertStringIncludes(result.headExtras!, 'href="https://cdn.example.com/app.css"');
  assertEquals(result.allowHeadExtrasScripts, true);
});

Deno.test('buildHeadExtras: multiple stylesheets in order', () => {
  const result = buildHeadExtras({
    inject: {
      stylesheets: [
        'https://cdn.example.com/base.css',
        'https://cdn.example.com/theme.css',
      ],
    },
  });
  const lines = result.headExtras!.split('\n');
  assertStringIncludes(lines[0], 'base.css');
  assertStringIncludes(lines[1], 'theme.css');
});

Deno.test('buildHeadExtras: stylesheets with integrity and crossorigin', () => {
  const result = buildHeadExtras({
    inject: {
      stylesheets: [{
        href: 'https://cdn.example.com/app.css',
        integrity: 'sha384-abc123',
        crossorigin: 'anonymous',
      }],
    },
  });
  assertStringIncludes(result.headExtras!, 'integrity="sha384-abc123"');
  assertStringIncludes(result.headExtras!, 'crossorigin="anonymous"');
});

Deno.test('buildHeadExtras: stylesheets with integrity auto-adds crossorigin', () => {
  const result = buildHeadExtras({
    inject: {
      stylesheets: [{
        href: 'https://cdn.example.com/app.css',
        integrity: 'sha384-abc123',
      }],
    },
  });
  assertStringIncludes(result.headExtras!, 'integrity="sha384-abc123"');
  assertStringIncludes(result.headExtras!, 'crossorigin="anonymous"');
});

Deno.test('buildHeadExtras: stylesheets with custom attrs', () => {
  const result = buildHeadExtras({
    inject: {
      stylesheets: [{
        href: 'https://cdn.example.com/print.css',
        attrs: { media: 'print', 'data-theme': 'dark' },
      }],
    },
  });
  assertStringIncludes(result.headExtras!, 'media="print"');
  assertStringIncludes(result.headExtras!, 'data-theme="dark"');
});

Deno.test('buildHeadExtras: rejects event handler attrs on structured stylesheet entries', () => {
  assertThrows(
    () =>
      buildHeadExtras({
        inject: {
          stylesheets: [{
            href: 'https://cdn.example.com/print.css',
            attrs: { onload: 'alert(1)' },
          }],
        },
      }),
    Error,
    'Unsafe attribute',
  );
});

Deno.test('buildHeadExtras: stylesheets with boolean attr', () => {
  const result = buildHeadExtras({
    inject: {
      stylesheets: [{
        href: 'https://cdn.example.com/app.css',
        attrs: { disabled: true },
      }],
    },
  });
  assertStringIncludes(result.headExtras!, 'disabled');
  // Boolean attrs should not have ="true"
  assertEquals(result.headExtras!.includes('disabled="true"'), false);
});

Deno.test('buildHeadExtras: scripts generate script tags', () => {
  const result = buildHeadExtras({
    inject: {
      scripts: ['https://cdn.example.com/app.js'],
    },
  });
  assertStringIncludes(result.headExtras!, '<script');
  assertStringIncludes(result.headExtras!, 'src="https://cdn.example.com/app.js"');
  assertStringIncludes(result.headExtras!, 'type="module"');
  assertEquals(result.allowHeadExtrasScripts, true);
});

Deno.test('buildHeadExtras: scripts with defer', () => {
  const result = buildHeadExtras({
    inject: {
      scripts: [{ src: 'https://cdn.example.com/app.js', defer: true }],
    },
  });
  assertStringIncludes(result.headExtras!, 'defer');
});

Deno.test('buildHeadExtras: scripts with async', () => {
  const result = buildHeadExtras({
    inject: {
      scripts: [{ src: 'https://cdn.example.com/app.js', async: true }],
    },
  });
  assertStringIncludes(result.headExtras!, 'async');
});

Deno.test('buildHeadExtras: scripts with integrity', () => {
  const result = buildHeadExtras({
    inject: {
      scripts: [{
        src: 'https://cdn.example.com/app.js',
        integrity: 'sha384-xyz789',
      }],
    },
  });
  assertStringIncludes(result.headExtras!, 'integrity="sha384-xyz789"');
  assertStringIncludes(result.headExtras!, 'crossorigin="anonymous"');
});

Deno.test('buildHeadExtras: scripts with custom type', () => {
  const result = buildHeadExtras({
    inject: {
      scripts: [{ src: 'https://cdn.example.com/app.js', type: 'text/javascript' }],
    },
  });
  assertStringIncludes(result.headExtras!, 'type="text/javascript"');
});

Deno.test('buildHeadExtras: scripts with custom attrs', () => {
  const result = buildHeadExtras({
    inject: {
      scripts: [{
        src: 'https://cdn.example.com/worker.js',
        attrs: { 'data-worker': 'main' },
      }],
    },
  });
  assertStringIncludes(result.headExtras!, 'data-worker="main"');
});

Deno.test('buildHeadExtras: rejects event handler attrs on structured script entries', () => {
  assertThrows(
    () =>
      buildHeadExtras({
        inject: {
          scripts: [{
            src: 'https://cdn.example.com/worker.js',
            attrs: { onerror: 'alert(1)' },
          }],
        },
      }),
    Error,
    'Unsafe attribute',
  );
});

Deno.test('buildHeadExtras: headFragments are included verbatim', () => {
  const result = buildHeadExtras({
    inject: {
      headFragments: ['<meta name="theme-color" content="#000">'],
    },
  });
  assertStringIncludes(result.headExtras!, '<meta name="theme-color" content="#000" />');
});

Deno.test('buildHeadExtras: headFragments reject script tags', () => {
  assertThrows(
    () =>
      buildHeadExtras({
        inject: {
          headFragments: ['<script src="/x.js"></script>'],
        },
      }),
    Error,
    'inject.headFragments must not contain <script> tags',
  );
});

Deno.test('buildHeadExtras: sanitizes unsafe headFragments markup', () => {
  const result = buildHeadExtras({
    inject: {
      headFragments: ['<meta name="x" content="ok"><img src=x onerror=alert(1)>'],
    },
  });
  assertStringIncludes(result.headExtras!, '<meta name="x" content="ok" />');
  assertEquals(result.headExtras!.includes('<img'), false);
  assertEquals(result.headExtras!.includes('onerror'), false);
});

Deno.test('buildHeadExtras: order is headFragments → stylesheets → scripts', () => {
  const result = buildHeadExtras({
    inject: {
      headFragments: ['<meta charset="utf-8">'],
      stylesheets: ['https://cdn.example.com/app.css'],
      scripts: ['https://cdn.example.com/app.js'],
    },
  });
  const lines = result.headExtras!.split('\n').map((l) => l.trim()).filter(Boolean);
  assertStringIncludes(lines[0], '<meta');
  assertStringIncludes(lines[1], '<link');
  assertStringIncludes(lines[2], '<script');
});

Deno.test('buildHeadExtras: full inject with all three types', () => {
  const result = buildHeadExtras({
    inject: {
      headFragments: [
        '<meta charset="utf-8">',
        '<meta name="viewport" content="width=device-width">',
      ],
      stylesheets: [
        'https://cdn.example.com/base.css',
        { href: 'https://cdn.example.com/theme.css', attrs: { media: 'screen' } },
      ],
      scripts: [
        { src: 'https://cdn.example.com/app.js', defer: true },
      ],
    },
  });
  assertStringIncludes(result.headExtras!, '<meta charset="utf-8" />');
  assertStringIncludes(result.headExtras!, '<meta name="viewport"');
  assertStringIncludes(result.headExtras!, 'base.css');
  assertStringIncludes(result.headExtras!, 'theme.css');
  assertStringIncludes(result.headExtras!, 'app.js');
  assertEquals(result.allowHeadExtrasScripts, true);
});

Deno.test('buildHeadExtras: rejects unsafe URL in stylesheets', () => {
  assertThrows(
    () =>
      buildHeadExtras({
        inject: {
          stylesheets: ['javascript:alert(1)'],
        },
      }),
    Error,
    'javascript: protocol is not allowed',
  );
});

Deno.test('buildHeadExtras: rejects unsafe URL in scripts', () => {
  assertThrows(
    () =>
      buildHeadExtras({
        inject: {
          scripts: ['data:text/javascript,alert(1)'],
        },
      }),
    Error,
    'data: protocol is not allowed',
  );
});

Deno.test('buildHeadExtras: returns empty string for inject with no items', () => {
  const result = buildHeadExtras({
    inject: {
      headFragments: [],
      stylesheets: [],
      scripts: [],
    },
  });
  assertEquals(result.headExtras, '');
});

Deno.test('buildHeadExtras: strips meta http-equiv (blocks refresh open redirect)', () => {
  const result = buildHeadExtras({
    headExtras: '<meta http-equiv="refresh" content="0;url=https://evil.example/">',
  });
  // The http-equiv attribute must not survive; the leftover meta is inert.
  assertEquals(result.headExtras!.includes('http-equiv'), false);
});

Deno.test('buildHeadExtras: removes <base> tags entirely (relative-URL hijack)', () => {
  const result = buildHeadExtras({
    headExtras: '<base href="https://evil.example/"><meta charset="utf-8">',
  });
  assertEquals(result.headExtras!.includes('<base'), false);
  assertEquals(result.headExtras!.includes('evil.example'), false);
  assertStringIncludes(result.headExtras!, '<meta charset="utf-8" />');
});

Deno.test('buildHeadExtras: keeps charset and viewport metas', () => {
  const result = buildHeadExtras({
    inject: {
      headFragments: [
        '<meta charset="utf-8">',
        '<meta name="viewport" content="width=device-width, initial-scale=1.0">',
      ],
    },
  });
  assertStringIncludes(result.headExtras!, '<meta charset="utf-8" />');
  assertStringIncludes(result.headExtras!, 'name="viewport"');
});

Deno.test('buildHeadExtras: rejects CSS escape and comment blacklist bypasses', () => {
  assertThrows(
    () =>
      buildHeadExtras({ headExtras: '<style>@\\69mport url(https://evil.example/x.css)</style>' }),
    Error,
    'Unsafe CSS',
  );
  assertThrows(
    () =>
      buildHeadExtras({ headExtras: '<style>@im/**/port url(https://evil.example/x.css)</style>' }),
    Error,
    'Unsafe CSS',
  );
  assertThrows(
    () =>
      buildHeadExtras({
        headExtras: '<style>body{background:u\\72l(javascript:alert(1))}</style>',
      }),
    Error,
    'Unsafe CSS',
  );
});

Deno.test('buildHeadExtras: keeps benign CSS escapes in style content', () => {
  const result = buildHeadExtras({
    headExtras: '<style>.a::before{content:"\\201C"}</style>',
  });
  assertEquals(result.headExtras, '<style>.a::before{content:"\\201C"}</style>');
});

// ─── Regression: headExtras takes precedence ──────────────────

Deno.test('buildHeadExtras: headExtras takes precedence over inject', () => {
  const result = buildHeadExtras({
    headExtras: '<meta name="override" />',
    inject: { stylesheets: ['https://example.com/style.css'] },
  });
  assertEquals(result.headExtras, '<meta name="override" />');
  assertEquals(result.allowHeadExtrasScripts, false);
});
