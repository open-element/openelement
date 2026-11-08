import { expect, test } from 'vitest';
import { assertThrowsIncludes } from '../../../tests/lib/vitest-asserts.ts';
import type { RouteEntry } from '@openelement/protocol/framework';
import {
  generateClientEntry,
  ELEMENT_SERVICES_RUNTIME_SPECIFIERS,
} from '../src/vite/internal/ssg/entry-client-codegen.ts';
import { buildEntryDescriptor } from '../src/vite/internal/ssg/entry-descriptor.ts';
import { renderEntry } from '../src/vite/internal/ssg/entry-orchestrator.ts';
import { selectRendererAdapter } from '../src/vite/internal/ssg/renderer-adapter.ts';

const routes: RouteEntry[] = [
  {
    path: '/',
    filePath: 'index.ts',
    type: 'page',
    varName: 'pageIndex',
  },
];

// Pins verified byte-exact. A pin bump is deliberate: each admitted output
// change re-baselines the value and records why at the constant.
//
// alpha15 security lane S3: the route/renderer/middleware module imports are
// emitted through quoteGeneratedJavaScriptValue (a generated-entry
// code-injection fix), so the server entry's specifiers are double-quoted —
// same byte COUNT, new hashes.
//
// FRM-01/ADR-0172 re-baseline (PR #1611 review): the request-time page context
// derives a locale only when the project declared i18n — `locale:
// __locales.length > 0 ? __localeFromPath(__locales, c.req.path,
// __getDefaultLocale()) : undefined` — so a single-locale site leaves
// ResolvedDocument.lang undefined and the configured head.lang wins the
// document wrap instead of being shadowed by a synthetic default 'en'. The
// probe's single page route emits the context at four sites (GET success +
// error-boundary re-render, POST success + error-boundary re-render), +35
// bytes each = +140; replacing the new expression with the old one
// reconstructs exactly the previous server pin (16773). Client bytes are
// untouched (the derivation is request-time server wiring only): 2862/e962….
// Server: 16773→16913.
//
// The client pin is machine-independent since the B2 CI re-baseline (alpha15
// red A): the entry's lazy surface specifier was the wrapper's ABSOLUTE
// filesystem path, so the pin measured a 58-char checkout root while CI's
// 41-char root produced 2914 (a 17-byte delta, exactly the root-length
// difference). The specifier is now the stable virtual id
// `virtual:open-client-runtime/element-services-full.ts`, resolved to the
// wrapper by the two client-entry hosts (cli/build-client.ts,
// vite/dev-island-client.ts), so the entry text is identical in every
// checkout: 2931 (58-char root) → 2862.
const expected = {
  native: {
    server: [16913, '9d12d9ca03948eb33a2a65403ab60c50029a26cf8c5cc50aa7ffa9ffb05a17cc'],
    client: [2862, 'e9629cded31adcb2237afa612acd50c1bd9cd8a17dbd889ab1ae46066616e5ed'],
  },
} as const;

test('internal native selection preserves the generated server/client bytes', async () => {
  const adapter = selectRendererAdapter('native');
  expect(adapter.mode).toEqual('native');
  expect(adapter.supportsCompiledStream).toEqual(true);
  expect(adapter.hydration).toEqual('compiled-hydration');
  const descriptor = buildEntryDescriptor(routes, { renderer: 'native' });
  const server = renderEntry(descriptor);
  const client = generateClientEntry(
    [
      {
        tagName: 'x-probe',
        modulePath: '/app/islands/x.ts',
        strategy: 'load',
        ssr: true,
        dsd: true,
      },
    ],
    { renderer: 'native' },
  );
  for (const [kind, text] of [
    ['server', server],
    ['client', client],
  ] as const) {
    const bytes = new TextEncoder().encode(text);
    const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('');
    expect(bytes.length).toEqual(expected.native[kind][0]);
    expect(hash).toEqual(expected.native[kind][1]);
  }
  // Red A witness: the lazy surface specifier is the stable virtual id and
  // no checkout root can appear in the entry text, which is what makes the
  // native client pin machine-independent (see the re-baseline note above).
  expect(client).toContain(`import('${ELEMENT_SERVICES_RUNTIME_SPECIFIERS.full}')`);
  expect(client).not.toContain(process.cwd());
  expect(descriptor.imports.some((entry) => entry.from === '@openelement/element')).toEqual(true);
  expect(selectRendererAdapter(undefined).mode).toEqual('native');
  assertThrowsIncludes(() => selectRendererAdapter('future'), Error, "renderer must be 'native'");
});

test('the retired lit renderer fails with an explicit migration error', () => {
  assertThrowsIncludes(() => selectRendererAdapter('lit'), Error, 'retired');
});
