/**
 * The router's structured error catalog (src/internal/error-codes.ts).
 *
 * Mirrors the element package's error-dialect checks: every table carries
 * stable, unique, `OE_`-namespaced values; the factories raise
 * `OpenElementError` with the phase their surface implies; and one raiser per
 * converged surface is proven to report its catalogue code through the real
 * public/internal entry a consumer would drive.
 */

import { assert, assertEquals, assertRejects, assertThrows } from '@std/assert';
import { OpenElementError } from '@openelement/element';
import { resolvePageDocument } from '../src/document.ts';
import type { PagePropsContext } from '../src/index.ts';
import {
  authoringError,
  buildError,
  DeliveryErrorCode,
  DescriptorErrorCode,
  DocumentErrorCode,
  IslandEntryErrorCode,
  IslandErrorCode,
  PageErrorCode,
  ServeErrorCode,
  SsgRenderErrorCode,
} from '../src/internal/error-codes.ts';
import { validateIslandMediaQuery } from '../src/vite/internal/ssg/delivery.ts';
import { validateIslandModuleSpecifier } from '../src/vite/internal/ssg/entry-generators.ts';
import { buildEntryDescriptor } from '../src/vite/internal/ssg/entry-descriptor.ts';
import { ssgRender } from '../src/vite/internal/ssg/ssg-render.ts';
import type { SsgRenderOptions, SsrBundle } from '../src/vite/internal/protocol/ssg.ts';

const TABLES = {
  PageErrorCode,
  IslandErrorCode,
  ServeErrorCode,
  DeliveryErrorCode,
  IslandEntryErrorCode,
  DescriptorErrorCode,
  SsgRenderErrorCode,
  DocumentErrorCode,
};

Deno.test('error codes: every table value is a stable, unique, namespaced string', () => {
  const seen = new Map<string, string>();
  for (const [table, codes] of Object.entries(TABLES)) {
    assert(Object.keys(codes).length > 0, `${table} must declare at least one code`);
    for (const [name, value] of Object.entries(codes)) {
      assert(
        typeof value === 'string' && value.startsWith('OE_'),
        `${table}.${name} must use the OE_ namespace`,
      );
      assert(
        !seen.has(value),
        `${table}.${name} reuses code ${value}, already declared by ${seen.get(value)}`,
      );
      seen.set(value, `${table}.${name}`);
    }
  }
  assertEquals(seen.get('OE_DOCUMENT_HEAD_INVALID'), 'DocumentErrorCode.HEAD_INVALID');
});

Deno.test('error codes: the factories carry the phase their surface implies', () => {
  const validation = authoringError(PageErrorCode.PROJECTOR, 'boom');
  assertThrows(() => {
    throw validation;
  }, OpenElementError);
  assertEquals([validation.phase, validation.severity, validation.recoverable], [
    'validation',
    'error',
    false,
  ]);
  const build = buildError(DescriptorErrorCode.CORS, 'boom');
  assertEquals([build.phase, build.severity, build.recoverable], ['build', 'error', false]);
  // buildError preserves the wrapped cause for diagnostics.
  const cause = new Error('inner');
  assertEquals(buildError(DeliveryErrorCode.TAGS, 'boom', { cause }).cause, cause);
});

function ctx(): PagePropsContext {
  return {
    data: undefined,
    actionData: undefined,
    params: {},
    route: { path: '/notes' },
    meta: {},
  };
}

Deno.test('error codes: the Document seam reports HEAD_INVALID as a validation failure', () => {
  const error = assertThrows(
    () => resolvePageDocument('not-an-object' as never, ctx()),
    OpenElementError,
    '[openElement] resolvePageDocument:',
  );
  assertEquals(error.code, DocumentErrorCode.HEAD_INVALID);
  assertEquals(error.phase, 'validation');
});

Deno.test('error codes: island delivery and entry admission report build-phase codes', () => {
  const media = assertThrows(
    () => validateIslandMediaQuery(42, 'island'),
    OpenElementError,
    'Invalid island media query',
  );
  assertEquals(media.code, DeliveryErrorCode.MEDIA_QUERY);
  assertEquals(media.phase, 'build');

  const modulePath = assertThrows(
    () => validateIslandModuleSpecifier('https://evil.example/island.js'),
    OpenElementError,
    'Invalid island modulePath',
  );
  assertEquals(modulePath.code, IslandEntryErrorCode.MODULE_PATH);
  assertEquals(modulePath.phase, 'build');

  const cors = assertThrows(
    () =>
      buildEntryDescriptor([], {
        middleware: { corsOrigin: (() => 'https://x') as never },
      }),
    OpenElementError,
    'middleware.corsOrigin',
  );
  assertEquals(cors.code, DescriptorErrorCode.CORS);
});

Deno.test('error codes: the SSG render pipeline reports build-phase codes', async () => {
  const error = await assertRejects(
    () => ssgRender({} as unknown as SsrBundle, {} as SsgRenderOptions),
    OpenElementError,
    'does not export routeInfo',
  );
  assertEquals(error.code, SsgRenderErrorCode.ROUTE_INFO_MISSING);
  assertEquals(error.phase, 'build');
});
