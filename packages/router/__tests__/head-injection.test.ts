/**
 * @openelement/router - head-injection.ts tests
 *
 * Tests for HTML head injection safety: script tag validation,
 * URL safety checks, and headExtras serialization.
 */
import { expect, test } from 'vitest';
import { assertThrowsIncludes } from '../../../tests/lib/vitest-asserts.ts';
import { OpenElementError } from '@openelement/element';
import { assertNoScriptTags, assertTrustedHeadHtml } from '../src/internal/head-safety.ts';
import { buildHeadExtras, validateSafeUrl } from '../src/vite/head-injection.ts';
import { buildCriticalHeadExtras } from '../src/vite/internal/ssg/critical-assets.ts';

// ─── assertNoScriptTags ───────────────────────────────────────

test('assertNoScriptTags: allows plain HTML without scripts', () => {
  // Should not throw for safe content
  assertNoScriptTags('<link rel="stylesheet" href="/app.css" />', 'test-input');
  assertNoScriptTags('<meta charset="utf-8">', 'test-input');
  assertNoScriptTags('<div>Hello</div>', 'test-input');
  assertNoScriptTags('', 'test-input');
});

test('assertNoScriptTags: rejects <script> tag in any form', () => {
  assertThrowsIncludes(
    () => assertNoScriptTags('<script src="/x.js"></script>', 'headExtras'),
    Error,
    'must not contain <script> tags',
  );

  assertThrowsIncludes(
    () => assertNoScriptTags('<script>alert(1)</script>', 'headExtras'),
    Error,
    'must not contain <script> tags',
  );

  // Case insensitive
  assertThrowsIncludes(
    () => assertNoScriptTags('<SCRIPT src="/x.js"></SCRIPT>', 'headExtras'),
    Error,
    'must not contain <script> tags',
  );
});

test('assertNoScriptTags: rejects self-closing script tag', () => {
  assertThrowsIncludes(
    () => assertNoScriptTags('<script src="/app.js" />', 'headExtras'),
    Error,
    'must not contain <script> tags',
  );
});

test('assertNoScriptTags: rejects script with attributes before src', () => {
  assertThrowsIncludes(
    () => assertNoScriptTags('<script defer src="/app.js"></script>', 'headExtras'),
    Error,
    'must not contain <script> tags',
  );
});

test('assertNoScriptTags: error message includes context name', () => {
  try {
    assertNoScriptTags('<script></script>', 'inject.headFragments');
    throw new Error('Should have thrown');
  } catch (e) {
    expect((e as Error).message).toContain('inject.headFragments');
    expect((e as Error).message).toContain('Use inject.scripts');
  }
});

// ─── validateSafeUrl ──────────────────────────────────────────

test('validateSafeUrl: allows safe URLs', () => {
  expect(validateSafeUrl('https://cdn.example.com/app.css', 'stylesheets')).toEqual(
    'https://cdn.example.com/app.css',
  );
  expect(validateSafeUrl('http://localhost:3000/app.js', 'scripts')).toEqual(
    'http://localhost:3000/app.js',
  );
  expect(validateSafeUrl('https://example.com/path?q=1&v=2', 'stylesheets')).toEqual(
    'https://example.com/path?q=1&v=2',
  );
  expect(validateSafeUrl('//cdn.example.com/lib.js', 'scripts')).toEqual(
    '//cdn.example.com/lib.js',
  );
});

test('validateSafeUrl: rejects javascript: protocol', () => {
  assertThrowsIncludes(
    () => validateSafeUrl('javascript:alert(1)', 'stylesheets'),
    Error,
    'javascript: protocol is not allowed',
  );
});

test('validateSafeUrl: rejects data: protocol', () => {
  assertThrowsIncludes(
    () => validateSafeUrl('data:text/html,<script>alert(1)</script>', 'stylesheets'),
    Error,
    'data: protocol is not allowed',
  );
});

test('validateSafeUrl: rejects vbscript: protocol', () => {
  assertThrowsIncludes(
    () => validateSafeUrl('vbscript:msgbox(1)', 'scripts'),
    Error,
    'vbscript: protocol is not allowed',
  );
});

test('validateSafeUrl: rejects file: protocol', () => {
  assertThrowsIncludes(
    () => validateSafeUrl('file:///etc/passwd', 'scripts'),
    Error,
    'file: protocol is not allowed',
  );
});

test('validateSafeUrl: case-insensitive protocol check', () => {
  assertThrowsIncludes(
    () => validateSafeUrl('JAVASCRIPT:alert(1)', 'scripts'),
    Error,
    'javascript: protocol is not allowed',
  );

  assertThrowsIncludes(
    () => validateSafeUrl('JavaScript:alert(1)', 'scripts'),
    Error,
    'javascript: protocol is not allowed',
  );
});

test('validateSafeUrl: rejects malformed percent-encoding', () => {
  assertThrowsIncludes(
    () => validateSafeUrl('https://example.com/%ZZ', 'stylesheets'),
    Error,
    'malformed percent-encoding',
  );
});

test('validateSafeUrl: error message includes context name', () => {
  try {
    validateSafeUrl('javascript:void(0)', 'inject.scripts');
    throw new Error('Should have thrown');
  } catch (e) {
    expect((e as Error).message).toContain('inject.scripts');
  }
});

test('validateSafeUrl: trims whitespace', () => {
  expect(validateSafeUrl('  https://example.com/app.css  ', 'stylesheets')).toEqual(
    'https://example.com/app.css',
  );
});

// #761: WHATWG URL parsing strips tab/LF/CR anywhere, so they must not
// bypass the protocol blocklist, and the emitted URL must be normalized.
test('validateSafeUrl: rejects protocols split by tab/newline', () => {
  assertThrowsIncludes(
    () => validateSafeUrl('java\tscript:alert(1)', 'scripts'),
    Error,
    'javascript: protocol is not allowed',
  );
  assertThrowsIncludes(
    () => validateSafeUrl('da\nta:text/html,<script>alert(1)</script>', 'scripts'),
    Error,
    'data: protocol is not allowed',
  );
  assertThrowsIncludes(
    () => validateSafeUrl('java\rscript:alert(1)', 'scripts'),
    Error,
    'javascript: protocol is not allowed',
  );
});

test('validateSafeUrl: strips embedded tab/newline from safe URLs', () => {
  expect(validateSafeUrl('https://example.com/a\tpp\n.js', 'scripts')).toEqual(
    'https://example.com/app.js',
  );
});

test('buildHeadExtras: emits normalized script src (tab/newline stripped)', () => {
  const result = buildHeadExtras({
    inject: { scripts: ['https://cdn.example.com/a\tpp\n.js'] },
  } as Parameters<typeof buildHeadExtras>[0]);
  expect(result.headExtras!).toContain('src="https://cdn.example.com/app.js"');
});

test('buildHeadExtras: rejects tab-split javascript: script src', () => {
  assertThrowsIncludes(
    () =>
      buildHeadExtras({
        inject: { scripts: ['java\tscript:alert(1)'] },
      } as Parameters<typeof buildHeadExtras>[0]),
    Error,
    'javascript: protocol is not allowed',
  );
});

// ─── buildHeadExtras ──────────────────────────────────────────

test('buildHeadExtras: returns headExtras directly when provided', () => {
  const result = buildHeadExtras({ headExtras: '<link rel="stylesheet" href="/app.css" />' });
  expect(result.headExtras).toEqual('<link rel="stylesheet" href="/app.css" />');
  expect(result.allowHeadExtrasScripts).toEqual(false);
});

test('buildHeadExtras: passes trusted headExtras markup through verbatim', () => {
  // Raw head markup is developer-trusted input (trustedHtml trust level): the
  // framework does not sanitize it. Untrusted data must be sanitized at the
  // consumer system boundary before it reaches the framework.
  const result = buildHeadExtras({
    headExtras: '<meta name="x" content="ok"><link rel="stylesheet" href="/app.css">',
  });
  expect(result.headExtras).toEqual(
    '<meta name="x" content="ok"><link rel="stylesheet" href="/app.css">',
  );
});

test('buildHeadExtras: preserves style through restricted style path', () => {
  const result = buildHeadExtras({
    headExtras: '<style media="screen">:root { color: red; }</style>',
  });
  expect(result.headExtras).toEqual('<style media="screen">:root { color: red; }</style>');
});

test('buildHeadExtras: rejects dangerous style content and attributes', () => {
  assertThrowsIncludes(
    () =>
      buildHeadExtras({ headExtras: '<style>body{background:url(javascript:alert(1))}</style>' }),
    Error,
    'Unsafe CSS',
  );
  assertThrowsIncludes(
    () => buildHeadExtras({ headExtras: '<style onclick="evil()">body{color:red}</style>' }),
    Error,
    'Unsafe style attribute',
  );
});

test('buildHeadExtras: rejects script in headExtras', () => {
  assertThrowsIncludes(
    () => buildHeadExtras({ headExtras: '<script src="/x.js"></script>' }),
    Error,
    'headExtras must not contain <script> tags',
  );
});

test('buildHeadExtras: returns undefined when no inject config', () => {
  const result = buildHeadExtras({});
  expect(result.headExtras).toEqual(undefined);
  expect(result.allowHeadExtrasScripts).toEqual(false);
});

test('buildHeadExtras: empty inject produces undefined', () => {
  const result = buildHeadExtras({ inject: {} });
  expect(result.headExtras).toEqual('');
  expect(result.allowHeadExtrasScripts).toEqual(true);
});

test('buildHeadExtras: stylesheets generate link tags', () => {
  const result = buildHeadExtras({
    inject: {
      stylesheets: ['https://cdn.example.com/app.css'],
    },
  });
  expect(result.headExtras!).toContain('<link rel="stylesheet"');
  expect(result.headExtras!).toContain('href="https://cdn.example.com/app.css"');
  expect(result.allowHeadExtrasScripts).toEqual(true);
});

test('buildHeadExtras: multiple stylesheets in order', () => {
  const result = buildHeadExtras({
    inject: {
      stylesheets: ['https://cdn.example.com/base.css', 'https://cdn.example.com/theme.css'],
    },
  });
  const lines = result.headExtras!.split('\n');
  expect(lines[0]).toContain('base.css');
  expect(lines[1]).toContain('theme.css');
});

test('buildHeadExtras: stylesheets with integrity and crossorigin', () => {
  const result = buildHeadExtras({
    inject: {
      stylesheets: [
        {
          href: 'https://cdn.example.com/app.css',
          integrity: 'sha384-abc123',
          crossorigin: 'anonymous',
        },
      ],
    },
  });
  expect(result.headExtras!).toContain('integrity="sha384-abc123"');
  expect(result.headExtras!).toContain('crossorigin="anonymous"');
});

test('buildHeadExtras: stylesheets with integrity auto-adds crossorigin', () => {
  const result = buildHeadExtras({
    inject: {
      stylesheets: [
        {
          href: 'https://cdn.example.com/app.css',
          integrity: 'sha384-abc123',
        },
      ],
    },
  });
  expect(result.headExtras!).toContain('integrity="sha384-abc123"');
  expect(result.headExtras!).toContain('crossorigin="anonymous"');
});

test('buildHeadExtras: stylesheets with custom attrs', () => {
  const result = buildHeadExtras({
    inject: {
      stylesheets: [
        {
          href: 'https://cdn.example.com/print.css',
          attrs: { media: 'print', 'data-theme': 'dark' },
        },
      ],
    },
  });
  expect(result.headExtras!).toContain('media="print"');
  expect(result.headExtras!).toContain('data-theme="dark"');
});

test('buildHeadExtras: rejects event handler attrs on structured stylesheet entries', () => {
  assertThrowsIncludes(
    () =>
      buildHeadExtras({
        inject: {
          stylesheets: [
            {
              href: 'https://cdn.example.com/print.css',
              attrs: { onload: 'alert(1)' },
            },
          ],
        },
      }),
    Error,
    'Unsafe attribute',
  );
});

test('buildHeadExtras: stylesheets with boolean attr', () => {
  const result = buildHeadExtras({
    inject: {
      stylesheets: [
        {
          href: 'https://cdn.example.com/app.css',
          attrs: { disabled: true },
        },
      ],
    },
  });
  expect(result.headExtras!).toContain('disabled');
  // Boolean attrs should not have ="true"
  expect(result.headExtras!.includes('disabled="true"')).toEqual(false);
});

test('buildHeadExtras: scripts generate script tags', () => {
  const result = buildHeadExtras({
    inject: {
      scripts: ['https://cdn.example.com/app.js'],
    },
  });
  expect(result.headExtras!).toContain('<script');
  expect(result.headExtras!).toContain('src="https://cdn.example.com/app.js"');
  expect(result.headExtras!).toContain('type="module"');
  expect(result.allowHeadExtrasScripts).toEqual(true);
});

test('buildHeadExtras: scripts with defer', () => {
  const result = buildHeadExtras({
    inject: {
      scripts: [{ src: 'https://cdn.example.com/app.js', defer: true }],
    },
  });
  expect(result.headExtras!).toContain('defer');
});

test('buildHeadExtras: scripts with async', () => {
  const result = buildHeadExtras({
    inject: {
      scripts: [{ src: 'https://cdn.example.com/app.js', async: true }],
    },
  });
  expect(result.headExtras!).toContain('async');
});

test('buildHeadExtras: scripts with integrity', () => {
  const result = buildHeadExtras({
    inject: {
      scripts: [
        {
          src: 'https://cdn.example.com/app.js',
          integrity: 'sha384-xyz789',
        },
      ],
    },
  });
  expect(result.headExtras!).toContain('integrity="sha384-xyz789"');
  expect(result.headExtras!).toContain('crossorigin="anonymous"');
});

test('buildHeadExtras: scripts with custom type', () => {
  const result = buildHeadExtras({
    inject: {
      scripts: [{ src: 'https://cdn.example.com/app.js', type: 'text/javascript' }],
    },
  });
  expect(result.headExtras!).toContain('type="text/javascript"');
});

test('buildHeadExtras: scripts with custom attrs', () => {
  const result = buildHeadExtras({
    inject: {
      scripts: [
        {
          src: 'https://cdn.example.com/worker.js',
          attrs: { 'data-worker': 'main' },
        },
      ],
    },
  });
  expect(result.headExtras!).toContain('data-worker="main"');
});

test('buildHeadExtras: rejects event handler attrs on structured script entries', () => {
  assertThrowsIncludes(
    () =>
      buildHeadExtras({
        inject: {
          scripts: [
            {
              src: 'https://cdn.example.com/worker.js',
              attrs: { onerror: 'alert(1)' },
            },
          ],
        },
      }),
    Error,
    'Unsafe attribute',
  );
});

test('buildHeadExtras: headFragments are included verbatim', () => {
  const result = buildHeadExtras({
    inject: {
      headFragments: ['<meta name="theme-color" content="#000">'],
    },
  });
  expect(result.headExtras).toEqual('<meta name="theme-color" content="#000">');
});

test('buildHeadExtras: headFragments reject script tags', () => {
  assertThrowsIncludes(
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

test('buildHeadExtras: passes trusted headFragments through verbatim', () => {
  const result = buildHeadExtras({
    inject: {
      headFragments: ['<meta name="x" content="ok">'],
    },
  });
  expect(result.headExtras).toEqual('<meta name="x" content="ok">');
});

test('buildHeadExtras: order is headFragments → stylesheets → scripts', () => {
  const result = buildHeadExtras({
    inject: {
      headFragments: ['<meta charset="utf-8">'],
      stylesheets: ['https://cdn.example.com/app.css'],
      scripts: ['https://cdn.example.com/app.js'],
    },
  });
  const lines = result
    .headExtras!.split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  expect(lines[0]).toContain('<meta');
  expect(lines[1]).toContain('<link');
  expect(lines[2]).toContain('<script');
});

test('buildHeadExtras: full inject with all three types', () => {
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
      scripts: [{ src: 'https://cdn.example.com/app.js', defer: true }],
    },
  });
  expect(result.headExtras!).toContain('<meta charset="utf-8">');
  expect(result.headExtras!).toContain('<meta name="viewport"');
  expect(result.headExtras!).toContain('base.css');
  expect(result.headExtras!).toContain('theme.css');
  expect(result.headExtras!).toContain('app.js');
  expect(result.allowHeadExtrasScripts).toEqual(true);
});

test('buildHeadExtras: rejects unsafe URL in stylesheets', () => {
  assertThrowsIncludes(
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

test('buildHeadExtras: rejects unsafe URL in scripts', () => {
  assertThrowsIncludes(
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

test('buildHeadExtras: returns empty string for inject with no items', () => {
  const result = buildHeadExtras({
    inject: {
      headFragments: [],
      stylesheets: [],
      scripts: [],
    },
  });
  expect(result.headExtras).toEqual('');
});

test('buildHeadExtras: trusted headExtras are not rewritten (no implicit sanitizer)', () => {
  // http-equiv/base handling is the fragment author's responsibility: raw head
  // markup is trusted developer input, not an untrusted-HTML sanitization
  // boundary. A refresh redirect here can only come from the app's own config.
  const result = buildHeadExtras({
    headExtras: '<meta http-equiv="refresh" content="0;url=https://example.com/home">',
  });
  expect(result.headExtras).toEqual(
    '<meta http-equiv="refresh" content="0;url=https://example.com/home">',
  );
});

test('buildHeadExtras: trusted headExtras keep author-controlled base tags', () => {
  const result = buildHeadExtras({
    headExtras: '<base href="/docs/"><meta charset="utf-8">',
  });
  expect(result.headExtras).toEqual('<base href="/docs/"><meta charset="utf-8">');
});

test('buildHeadExtras: keeps charset and viewport metas', () => {
  const result = buildHeadExtras({
    inject: {
      headFragments: [
        '<meta charset="utf-8">',
        '<meta name="viewport" content="width=device-width, initial-scale=1.0">',
      ],
    },
  });
  expect(result.headExtras!).toContain('<meta charset="utf-8">');
  expect(result.headExtras!).toContain('name="viewport"');
});

test('buildHeadExtras: rejects CSS escape and comment blacklist bypasses', () => {
  assertThrowsIncludes(
    () =>
      buildHeadExtras({ headExtras: '<style>@\\69mport url(https://evil.example/x.css)</style>' }),
    Error,
    'Unsafe CSS',
  );
  assertThrowsIncludes(
    () =>
      buildHeadExtras({ headExtras: '<style>@im/**/port url(https://evil.example/x.css)</style>' }),
    Error,
    'Unsafe CSS',
  );
  assertThrowsIncludes(
    () =>
      buildHeadExtras({
        headExtras: '<style>body{background:u\\72l(javascript:alert(1))}</style>',
      }),
    Error,
    'Unsafe CSS',
  );
});

test('buildHeadExtras: keeps benign CSS escapes in style content', () => {
  const result = buildHeadExtras({
    headExtras: '<style>.a::before{content:"\\201C"}</style>',
  });
  expect(result.headExtras).toEqual('<style>.a::before{content:"\\201C"}</style>');
});

// F-2 parity: the style guard and the critical-assets inline-CSS guard share
// one quote-aware preprocessing implementation, so the same corpus must draw
// the same verdict on both paths (each keeps its own error code).
test('buildHeadExtras: rejects unsafe CSS smuggled inside quoted strings', () => {
  assertThrowsIncludes(
    () =>
      buildHeadExtras({
        headExtras: '<style>.a::after{content:"/* @import url(evil); */"}</style>',
      }),
    Error,
    'Unsafe CSS',
  );
});

test('buildHeadExtras: rejects unterminated CSS comments', () => {
  const error = assertThrowsIncludes(
    () => buildHeadExtras({ headExtras: '<style>.a { color: red; } /* unterminated</style>' }),
    Error,
    'unterminated CSS comment',
  );
  expect((error as OpenElementError).code).toEqual('UNSAFE_HEAD_INJECTION');
});

test('CSS guard parity: style tags and critical inline CSS reach the same verdict', () => {
  const headVerdict = (css: string): { verdict: string; code?: string; message?: string } => {
    try {
      buildHeadExtras({ headExtras: `<style>${css}</style>` });
      return { verdict: 'PASS' };
    } catch (e) {
      return {
        verdict: 'THROW',
        code: (e as OpenElementError).code,
        message: (e as Error).message,
      };
    }
  };
  const criticalVerdict = (css: string): { verdict: string; code?: string; message?: string } => {
    try {
      buildCriticalHeadExtras({ criticalAssets: { styles: [{ css }] } });
      return { verdict: 'PASS' };
    } catch (e) {
      return {
        verdict: 'THROW',
        code: (e as OpenElementError).code,
        message: (e as Error).message,
      };
    }
  };
  const rejections: Array<[string, string]> = [
    ['@import url(https://evil.example/x.css);', 'Unsafe CSS'],
    ['.a::after{content:"/* @import url(evil); */"}', 'Unsafe CSS'],
    ['@im/**/port url(https://evil.example/x.css);', 'Unsafe CSS'],
    ['.a { color: red; } /* unterminated', 'unterminated CSS comment'],
  ];
  for (const [css, message] of rejections) {
    const head = headVerdict(css);
    const critical = criticalVerdict(css);
    expect(head.verdict, `head path must reject: ${css}`).toEqual('THROW');
    expect(critical.verdict, `critical path must reject: ${css}`).toEqual('THROW');
    expect(head.message!).toContain(message);
    expect(critical.message!).toContain(message);
    // Error codes stay per-path: the head guard only knows
    // UNSAFE_HEAD_INJECTION; unterminated comments on the critical path keep
    // INVALID_CRITICAL_ASSETS.
    expect(head.code).toEqual('UNSAFE_HEAD_INJECTION');
    if (message === 'Unsafe CSS') expect(critical.code).toEqual('UNSAFE_HEAD_INJECTION');
    else expect(critical.code).toEqual('INVALID_CRITICAL_ASSETS');
  }
  const benign = '.icon::before{content:"/*keep*/";color:red}';
  expect(headVerdict(benign).verdict).toEqual('PASS');
  expect(criticalVerdict(benign).verdict).toEqual('PASS');
});

// ─── Regression: headExtras takes precedence ──────────────────

test('buildHeadExtras: headExtras takes precedence over inject', () => {
  const result = buildHeadExtras({
    headExtras: '<meta name="override" />',
    inject: { stylesheets: ['https://example.com/style.css'] },
  });
  expect(result.headExtras).toEqual('<meta name="override" />');
  expect(result.allowHeadExtrasScripts).toEqual(false);
});

// ─── assertTrustedHeadHtml: structural fail-closed ──────────────

test('assertTrustedHeadHtml: accepts complete safe style elements', () => {
  assertTrustedHeadHtml('<style>body { color: red; }</style>', 'test-input');
  assertTrustedHeadHtml('<style nonce="abc">body { color: red; }</style>', 'test-input');
  assertTrustedHeadHtml('<STYLE>body { color: red; }</STYLE>', 'test-input');
  assertTrustedHeadHtml('<style media="print" title="x">p { margin: 0 }</style>', 'test-input');
});

test('assertTrustedHeadHtml: rejects an unterminated style element', () => {
  // The unclosed element would otherwise escape the CSS blacklist entirely:
  // the old complete-tag regex never matched, so @import passed unchecked.
  for (const input of [
    '<style>@import url("https://evil.example/x.css");',
    '<style>body { color: red }',
    '<style>safe</style><style>unsafe',
    '<STYLE>body { color: red }',
  ]) {
    assertThrowsIncludes(() => assertTrustedHeadHtml(input, 'test-input'), Error, '', input);
  }
});

test('assertTrustedHeadHtml: rejects unterminated or malformed opening tags', () => {
  for (const input of [
    '<style',
    '<style nonce="',
    // A quoted '>' inside the opening tag still ends at the real close
    // bracket; without a closing tag the element is rejected.
    '<style nonce=">">body { color: red }',
  ]) {
    assertThrowsIncludes(() => assertTrustedHeadHtml(input, 'test-input'), Error, '', input);
  }
});

test('assertTrustedHeadHtml: still enforces the CSS blacklist on complete tags', () => {
  assertThrowsIncludes(
    () => assertTrustedHeadHtml('<style>@import url("x.css");</style>', 'test-input'),
    OpenElementError,
    'Unsafe CSS',
  );
  assertThrowsIncludes(
    () =>
      assertTrustedHeadHtml(
        '<style>body { background: url(javascript:alert(1)) }</style>',
        'test-input',
      ),
    OpenElementError,
    'Unsafe CSS',
  );
  assertThrowsIncludes(
    () => assertTrustedHeadHtml('<style onclick="x">body {}</style>', 'test-input'),
    OpenElementError,
    'Unsafe style attribute',
  );
});

test('assertTrustedHeadHtml: rejects self-closing style syntax', () => {
  // <style/> is not a void element in HTML: the raw-text element still
  // swallows the rest of the fragment, so accepting it would let the
  // payload below run past the CSS blacklist.
  for (const input of [
    '<style/>@import url("https://evil.example/x.css");',
    '<STYLE/>@import url("https://evil.example/x.css");',
    '<style />@import url("https://evil.example/x.css");',
    '<style/>safe',
    '<style />safe',
    '<style/><style>safe</style>',
    '<style>safe</style><style/>',
    '<style title="x"/>safe',
    '<style title="x" />safe',
  ]) {
    assertThrowsIncludes(() => assertTrustedHeadHtml(input, 'test-input'), Error, '', input);
  }
});

test('assertTrustedHeadHtml: quoted and unquoted slashes stay value bytes', () => {
  // Slashes inside quoted values are content, not self-closing markers.
  assertTrustedHeadHtml('<style title="x/y">body { color: red }</style>', 'test-input');
  assertTrustedHeadHtml('<style title=">">body { color: red }</style>', 'test-input');
  // An unquoted value ends at whitespace or '>': foo/bar is one value, so
  // the tag is not self-closing (the attribute policy rejects data-x later,
  // but the failure must not be a self-closing misclassification).
  assertThrowsIncludes(
    () => assertTrustedHeadHtml('<style data-x=foo/bar>body { color: red }</style>', 'test-input'),
    OpenElementError,
    'Unsafe style attribute',
  );
});

test('assertTrustedHeadHtml: unrelated tags around styles are untouched', () => {
  assertTrustedHeadHtml(
    '<meta charset="utf-8"><style>body { color: red }</style><link rel="icon" href="/i.png">',
    'test-input',
  );
  // A tag merely starting with the same letters is not a style element.
  assertTrustedHeadHtml('<stylesheet-import data-x="y">', 'test-input');
});

test('assertTrustedHeadHtml: escaped whitespace cannot split the CSS blacklist', () => {
  // `\9` and `\a` decode to whitespace; the URL validator strips the same
  // set, so the CSS fold must too or `java\9 script:` slips through.
  for (const input of [
    '<style>body { background: url("java\\9 script:alert(1)") }</style>',
    '<style>body { background: url("da\\9 ta:text/html,x") }</style>',
    '<style>body { background: url("java\\a script:alert(1)") }</style>',
    '<style>body { background: url("jav\\61 script:alert(1)") }</style>',
  ]) {
    assertThrowsIncludes(
      () => assertTrustedHeadHtml(input, 'test-input'),
      OpenElementError,
      'Unsafe CSS',
    );
  }
  // Legitimate inline CSS still passes.
  assertTrustedHeadHtml(
    '<style>@font-face { font-family: X; src: url("/assets/fonts/x.woff2") format("woff2") }</style>',
    'test-input',
  );
});
