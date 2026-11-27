import { expect, test } from 'vitest';
import { buildErrorCodes, collectRuntimeCodes } from '../tools/generate-error-codes.ts';

test('/errors discovers every exported runtime error-code family', async () => {
  const build = await buildErrorCodes();
  expect(build.failures).toEqual([]);

  const runtimeValues = new Set(build.runtime.map((record) => record.value));
  for (const code of [
    'OE_ROUTE_SCAN_TAG_SHADOW',
    'OE_ADAPTER_HONO_MISSING',
    'OE_PRESET_UNOCSS_CONFIG_UNRESOLVED',
    'OE_SSG_PARAM_MISSING',
    'OE_CLIENT_ASSET_MANIFEST_READ',
    'OE_PACKAGE_ADMISSION_MODULE_UNREADABLE',
    'OE_PROGRAM_INVALID',
    'SSR_RENDER_ERROR',
  ]) {
    expect(runtimeValues.has(code), `${code} must be projected onto /errors`).toBeTruthy();
  }
  expect(build.runtime.find(({ value }) => value === 'OE_COMPILER_INVALID_SOURCE')).toMatchObject({
    family: 'CompilerErrorCode',
    summary: 'A compile step was handed source it cannot analyse.',
    path: 'packages/protocol/src/errors.ts',
  });
  for (const code of [
    'OE_CLIENT_BUILD_BROWSER_ENTRY_NODE_BUILTIN',
    'OE_CLIENT_BUILD_BROWSER_ENTRY_SERVER_ONLY',
  ]) {
    expect(build.runtime.find(({ value }) => value === code)).toMatchObject({
      family: 'BrowserEntryBoundaryErrorCode',
      path: 'packages/router/src/internal/error-codes.ts',
    });
  }
});

test('runtime error-code collection follows map declarations and rejects dynamic entries', () => {
  const failures: string[] = [];
  const runtime = collectRuntimeCodes(
    `export const RouteScanErrorCode = {
  /** A declared tag shadows an earlier entry. */
  TAG_SHADOW: 'OE_ROUTE_SCAN_TAG_SHADOW'
} as const;
const unrelated = { LABEL: 'not an error code' };
export const BadErrorCode = { VALUE: makeCode() } as const;`,
    'fixture/error-codes.ts',
    failures,
  );

  expect(runtime).toEqual([
    {
      family: 'RouteScanErrorCode',
      name: 'TAG_SHADOW',
      value: 'OE_ROUTE_SCAN_TAG_SHADOW',
      summary: 'A declared tag shadows an earlier entry.',
      path: 'fixture/error-codes.ts',
      line: 3,
    },
  ]);
  expect(failures).toContain('fixture/error-codes.ts: BadErrorCode.VALUE has no static value');
  expect(failures).toContain(
    'fixture/error-codes.ts: BadErrorCode declares no recognized error-code values',
  );
});
