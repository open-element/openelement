/**
 * Page props projection guard tests (#1214).
 *
 * The generated entry binds the typed projection runtime through the
 * generated-app factory; since #1470 block e the factory imports the
 * canonical dangerous-key set from the kernel-free /authoring leaf
 * (@openelement/element/authoring re-exporting
 * packages/element/src/internal/core/security.ts) and the generated entry
 * carries NO serialized copy of it. The projection seams (`defaultPageProps`
 * / `pageProps` / `pageErrorProps`) must filter the canonical dangerous keys
 * so hostile route params, loader data, or author projector records can
 * never pollute the props record that flows into the compiled serializer.
 */
import { assert, assertEquals } from '@std/assert';
import { DANGEROUS_KEYS as CANONICAL_DANGEROUS_KEYS } from '../../element/src/internal/core/security.ts';
import { DANGEROUS_KEYS } from '../src/vite/internal/server-runtime/security.ts';
import { buildEntryDescriptor, renderEntry } from '../src/vite/internal/ssg/index.ts';
import { createPagePropsRuntime } from '../src/vite/internal/server-runtime/page-render.ts';

const HOSTILE_JSON =
  '{"__proto__": {"polluted": true}, "constructor": {"evil": true}, "prototype": {"evil": true}, "title": "legit"}';

const basicRoutes = [
  { path: '/', filePath: 'index.tsx', type: 'page', varName: 'pageIndex', definePage: true },
] as const;

Deno.test('the security module binds the canonical security.ts set, and generated entries carry no copy', () => {
  // The factory-side binding is the canonical set itself (one import edge,
  // no serialization to drift).
  assertEquals(DANGEROUS_KEYS, CANONICAL_DANGEROUS_KEYS);
  // #1470 block e: the serialized __DANGEROUS_KEYS copy is retired from the
  // generated entry in every consumer setup (the repo's string-eval harnesses
  // bind implementations through their evaluation context, so they never
  // needed the copy either).
  const code = renderEntry(buildEntryDescriptor([...basicRoutes]));
  assert(!code.includes('__DANGEROUS_KEYS'), 'no serialized dangerous-key copy');
  for (const key of DANGEROUS_KEYS) {
    assert(!code.includes(`"${key}"`), `generated entries must not serialize the key ${key}`);
  }
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
