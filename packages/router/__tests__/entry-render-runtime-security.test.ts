/**
 * Page props projection guard tests (#1214).
 *
 * The generated entry binds the typed projection runtime
 * (@openelement/router/server-runtime `createPagePropsRuntime`) to its
 * serialized `__DANGEROUS_KEYS` copy; the projection seams (`defaultPageProps`
 * / `pageProps` / `pageErrorProps`) must filter the canonical dangerous keys
 * (packages/element/src/internal/core/security.ts) so hostile route params,
 * loader data, or author projector records can never pollute the props record
 * that flows into the compiled serializer.
 */
import { assert, assertEquals } from '@std/assert';
import { DANGEROUS_KEYS } from '../../element/src/internal/core/security.ts';
import { buildEntryDescriptor, renderEntry } from '../src/vite/internal/ssg/index.ts';
import { createPagePropsRuntime } from '../src/vite/internal/server-runtime/page-render.ts';

const HOSTILE_JSON =
  '{"__proto__": {"polluted": true}, "constructor": {"evil": true}, "prototype": {"evil": true}, "title": "legit"}';

const basicRoutes = [
  { path: '/', filePath: 'index.tsx', type: 'page', varName: 'pageIndex', definePage: true },
] as const;

Deno.test('the generated __DANGEROUS_KEYS copy equals the canonical security.ts set (drift guard)', () => {
  const code = renderEntry(buildEntryDescriptor([...basicRoutes]));
  const match = code.match(/const __DANGEROUS_KEYS = new Set\((\[.*\])\);/);
  assert(match, 'generated entries must serialize a __DANGEROUS_KEYS copy');
  const serialized = JSON.parse(match[1]) as string[];
  assertEquals(serialized.length, DANGEROUS_KEYS.size);
  assertEquals(new Set(serialized), new Set(DANGEROUS_KEYS));
});

function assertFiltered(record: Record<string, unknown>, expected: Record<string, unknown>): void {
  assertEquals(Object.getPrototypeOf(record), Object.prototype);
  assertEquals(Object.hasOwn(record, '__proto__'), false);
  assertEquals(Object.hasOwn(record, 'constructor'), false);
  assertEquals(Object.hasOwn(record, 'prototype'), false);
  assertEquals(record, expected);
}

Deno.test('defaultPageProps filters dangerous keys from params and loader data (#1214)', () => {
  const runtime = createPagePropsRuntime({ dangerousKeys: DANGEROUS_KEYS });
  const params = JSON.parse(
    '{"__proto__": "x", "constructor": "y", "prototype": "z", "id": "42"}',
  ) as Record<string, string>;
  const data = JSON.parse(HOSTILE_JSON) as Record<string, unknown>;
  const projected = runtime.defaultPageProps({ params, data });
  assertFiltered(projected, { id: '42', title: 'legit' });
  assertEquals(({} as { polluted?: unknown }).polluted, undefined);
});

Deno.test('defaultPageProps keeps full parity for legitimate keys (#1214)', () => {
  const runtime = createPagePropsRuntime({ dangerousKeys: DANGEROUS_KEYS });
  assertEquals(
    runtime.defaultPageProps({ params: { id: '42' }, data: { title: 'Hello', n: 1 } }),
    { id: '42', title: 'Hello', n: 1 },
  );
  assertEquals(runtime.defaultPageProps({ params: { id: '7' }, data: ['a'] }), { id: '7' });
  assertEquals(runtime.defaultPageProps({}), {});
});

Deno.test('pageProps filters dangerous keys returned by the descriptor props projector (#1214)', () => {
  const runtime = createPagePropsRuntime({ dangerousKeys: DANGEROUS_KEYS });
  const routeModule = {
    default: {
      openElementPage: {
        props: () => JSON.parse(HOSTILE_JSON) as Record<string, unknown>,
      },
    },
  };
  assertFiltered(runtime.pageProps(routeModule, { data: {}, params: {} }), { title: 'legit' });
});

Deno.test('pageErrorProps filters dangerous keys returned by the descriptor error projector (#1214)', () => {
  const runtime = createPagePropsRuntime({ dangerousKeys: DANGEROUS_KEYS });
  const routeModule = {
    default: {
      openElementPage: {
        error: () => JSON.parse(HOSTILE_JSON) as Record<string, unknown>,
      },
    },
  };
  assertFiltered(runtime.pageErrorProps(routeModule, new Error('boom'), {}), { title: 'legit' });
});
