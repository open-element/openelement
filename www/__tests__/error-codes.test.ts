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
});

test('runtime error-code collection follows map declarations and rejects dynamic entries', () => {
  const failures: string[] = [];
  const runtime = collectRuntimeCodes(
    `export const RouteScanErrorCode = { TAG_SHADOW: 'OE_ROUTE_SCAN_TAG_SHADOW' } as const;
const unrelated = { LABEL: 'not an error code' };
export const BadErrorCode = { VALUE: makeCode() } as const;`,
    'fixture/error-codes.ts',
    failures,
  );

  expect(runtime.map((record) => record.value)).toEqual(['OE_ROUTE_SCAN_TAG_SHADOW']);
  expect(failures).toContain('fixture/error-codes.ts: BadErrorCode.VALUE has no static value');
  expect(failures).toContain(
    'fixture/error-codes.ts: BadErrorCode declares no recognized error-code values',
  );
});
