/**
 * Generated server runtime page-projection guard tests (#1214).
 *
 * The generated entry module carries its own copy of the default page
 * projector (__defaultPageProps) plus the descriptor projector seams
 * (__pageProps / __pageErrorProps). All three must filter the canonical
 * dangerous keys (packages/element/src/internal/core/security.ts) so hostile
 * route params, loader data, or author projector records can never pollute
 * the props record that flows into renderDsd.
 */
import { assertEquals } from '@std/assert';
import { renderRuntimeHelpers } from '../src/vite/internal/ssg/entry-render-runtime.ts';

const HOSTILE_JSON =
  '{"__proto__": {"polluted": true}, "constructor": {"evil": true}, "prototype": {"evil": true}, "title": "legit"}';

interface ProjectionHarness {
  defaultProps(
    context: { params?: Record<string, string>; data?: unknown },
  ): Record<string, unknown>;
  pageProps(routeModule: unknown, context: Record<string, unknown>): Record<string, unknown>;
  pageErrorProps(
    routeModule: unknown,
    error: unknown,
    context: Record<string, unknown>,
  ): Record<string, unknown>;
}

async function loadHarness(): Promise<ProjectionHarness> {
  const helpers = renderRuntimeHelpers({ default: false, layouts: {} }, []);
  const harness = `
const customElements = { get() { return undefined; } };
const escapeHtml = (value) => String(value);
const __locales = ["en"];
const __getDefaultLocale = () => "en";
const __navSections = [];
const __headerNav = [];
function renderDsd() { return { html: "" }; }
${helpers}
export function defaultProps(context) { return __defaultPageProps(context); }
export function pageProps(routeModule, context) { return __pageProps(routeModule, context); }
export function pageErrorProps(routeModule, error, context) { return __pageErrorProps(routeModule, error, context); }
`;
  const mod = await import('data:text/javascript;charset=utf-8,' + encodeURIComponent(harness));
  return mod as ProjectionHarness;
}

function assertFiltered(record: Record<string, unknown>, expected: Record<string, unknown>): void {
  assertEquals(Object.getPrototypeOf(record), Object.prototype);
  assertEquals(Object.hasOwn(record, '__proto__'), false);
  assertEquals(Object.hasOwn(record, 'constructor'), false);
  assertEquals(Object.hasOwn(record, 'prototype'), false);
  assertEquals(record, expected);
}

Deno.test('__defaultPageProps filters dangerous keys from params and loader data (#1214)', async () => {
  const harness = await loadHarness();
  const params = JSON.parse(
    '{"__proto__": "x", "constructor": "y", "prototype": "z", "id": "42"}',
  ) as Record<string, string>;
  const data = JSON.parse(HOSTILE_JSON) as Record<string, unknown>;
  const projected = harness.defaultProps({ params, data });
  assertFiltered(projected, { id: '42', title: 'legit' });
  assertEquals(({} as { polluted?: unknown }).polluted, undefined);
});

Deno.test('__defaultPageProps keeps full parity for legitimate keys (#1214)', async () => {
  const harness = await loadHarness();
  assertEquals(
    harness.defaultProps({ params: { id: '42' }, data: { title: 'Hello', n: 1 } }),
    { id: '42', title: 'Hello', n: 1 },
  );
  assertEquals(harness.defaultProps({ params: { id: '7' }, data: ['a'] }), { id: '7' });
  assertEquals(harness.defaultProps({}), {});
});

Deno.test('__pageProps filters dangerous keys returned by the descriptor props projector (#1214)', async () => {
  const harness = await loadHarness();
  const routeModule = {
    default: {
      openElementPage: {
        props: () => JSON.parse(HOSTILE_JSON) as Record<string, unknown>,
      },
    },
  };
  assertFiltered(harness.pageProps(routeModule, { data: {}, params: {} }), { title: 'legit' });
});

Deno.test('__pageErrorProps filters dangerous keys returned by the descriptor error projector (#1214)', async () => {
  const harness = await loadHarness();
  const routeModule = {
    default: {
      openElementPage: {
        error: () => JSON.parse(HOSTILE_JSON) as Record<string, unknown>,
      },
    },
  };
  assertFiltered(harness.pageErrorProps(routeModule, new Error('boom'), {}), { title: 'legit' });
});
