import { expect, test } from 'vitest';
import { createScannerWorker } from '../../scanner-worker.ts';

const reservationId = '123e4567-e89b-42d3-a456-426614174000';
const objectKey = 'owner/private-object.pdf';
const env = {
  SUPABASE_URL: 'https://project.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'service-role-secret',
  METADEFENDER_CORE_URL: 'https://scanner.private.example',
  METADEFENDER_API_KEY: 'metadefender-secret',
};
const request = () =>
  new Request('https://internal/scan', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'attachment.scan', reservationId, objectKey }),
  });

function successfulFetch(code: number) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetchImpl: typeof fetch = (input, init) => {
    const url = String(input);
    calls.push({ url, init });
    if (url.endsWith('/rpc/authorize_attachment_scan')) {
      return Promise.resolve(
        Response.json({
          object_key: objectKey,
          byte_size: 4,
          content_type: 'application/pdf',
        }),
      );
    }
    if (url.includes('/storage/v1/object/authenticated/')) {
      return Promise.resolve(
        new Response(new Uint8Array([1, 2, 3, 4]), {
          headers: { 'content-length': '4' },
        }),
      );
    }
    return Promise.resolve(
      Response.json({
        process_info: { progress_percentage: 100, result: code === 0 ? 'Allowed' : 'Blocked' },
        scan_results: { progress_percentage: 100, scan_all_result_i: code },
      }),
    );
  };
  return { fetchImpl, calls };
}

test('private scanner validates the reservation before downloading and scanning', async () => {
  const { fetchImpl, calls } = successfulFetch(0);
  const response = await createScannerWorker(fetchImpl).fetch(request(), env);
  expect(response.status).toEqual(200);
  expect(await response.json()).toEqual({ verdict: 'clean' });
  expect(calls.map(({ url }) => new URL(url).pathname)).toEqual([
    '/rest/v1/rpc/authorize_attachment_scan',
    '/storage/v1/object/authenticated/notes-attachments/owner/private-object.pdf',
    '/file/sync',
  ]);
  expect(JSON.parse(String(calls[0].init?.body))).toEqual({
    target_reservation_id: reservationId,
    target_object_key: objectKey,
  });
  expect(new Headers(calls[2].init?.headers).get('apikey')).toEqual('metadefender-secret');
});

test('scanner orchestration accepts a provider-neutral adapter without MetaDefender config', async () => {
  const base = successfulFetch(0);
  const scanned: Uint8Array[] = [];
  const response = await createScannerWorker(base.fetchImpl, {
    provider: {
      name: 'test-provider',
      scan(input) {
        scanned.push(input.bytes);
        expect(input.contentType).toEqual('application/pdf');
        return Promise.resolve('clean');
      },
    },
  }).fetch(request(), {
    ...env,
    METADEFENDER_CORE_URL: '',
    METADEFENDER_API_KEY: '',
  });

  expect(response.status).toEqual(200);
  expect(await response.json()).toEqual({ verdict: 'clean' });
  expect(scanned).toEqual([new Uint8Array([1, 2, 3, 4])]);
  expect(base.calls.length).toEqual(2);
});

test('private scanner quarantines infected, suspicious, and blocklisted results', async () => {
  for (const code of [1, 2, 8]) {
    const response = await createScannerWorker(successfulFetch(code).fetchImpl).fetch(
      request(),
      env,
    );
    expect(await response.json()).toEqual({ verdict: 'quarantined' });
  }
});

test('private scanner fails closed without provider configuration', async () => {
  let called = false;
  const response = await createScannerWorker(() => {
    called = true;
    return Promise.reject(new Error('must not call'));
  }).fetch(request(), { ...env, METADEFENDER_API_KEY: '' });
  expect(response.status).toEqual(503);
  expect(called).toEqual(false);
});

test('private scanner rejects cross-object substitution before Storage access', async () => {
  let calls = 0;
  const response = await createScannerWorker((_input, _init) => {
    calls++;
    return Promise.resolve(
      Response.json({
        object_key: 'owner/different.pdf',
        byte_size: 4,
        content_type: 'application/pdf',
      }),
    );
  }).fetch(request(), env);
  expect(response.status).toEqual(503);
  expect(calls).toEqual(1);
});

test('private scanner rejects oversized or mismatched object bytes', async () => {
  for (const declared of [10 * 1024 * 1024 + 1, 5]) {
    let calls = 0;
    const response = await createScannerWorker((input) => {
      calls++;
      const url = String(input);
      if (url.endsWith('/rpc/authorize_attachment_scan')) {
        return Promise.resolve(
          Response.json({
            object_key: objectKey,
            byte_size: declared,
            content_type: 'application/pdf',
          }),
        );
      }
      return Promise.resolve(
        new Response(new Uint8Array([1, 2, 3, 4]), {
          headers: { 'content-length': '4' },
        }),
      );
    }).fetch(request(), env);
    expect(response.status).toEqual(503);
    expect(calls).toEqual(2);
  }
});

test('private scanner treats malformed, incomplete, and provider failures as retryable', async () => {
  for (const provider of [
    new Response('unavailable', { status: 503 }),
    Response.json({ scan_results: { progress_percentage: 50, scan_all_result_i: 0 } }),
    Response.json({
      process_info: { progress_percentage: 100 },
      scan_results: { progress_percentage: 100, scan_all_result_i: 3 },
    }),
    Response.json({
      process_info: { progress_percentage: 100, result: 'Blocked' },
      scan_results: { progress_percentage: 100, scan_all_result_i: 0 },
    }),
  ]) {
    const base = successfulFetch(0);
    const response = await createScannerWorker((input, init) => {
      if (String(input).endsWith('/file/sync')) return Promise.resolve(provider.clone());
      return base.fetchImpl(input, init);
    }).fetch(request(), env);
    expect(response.status).toEqual(503);
    expect(await response.text()).toContain('scan unavailable');
  }
});

test('private scanner converts upstream timeout into retryable failure', async () => {
  const response = await createScannerWorker(
    (_input, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true });
      }),
    { timeoutMs: 1 },
  ).fetch(request(), env);
  expect(response.status).toEqual(503);
});

test('scanner orchestration times out a provider that ignores AbortSignal', async () => {
  const base = successfulFetch(0);
  let aborted = false;
  const startedAt = performance.now();
  const response = await createScannerWorker(base.fetchImpl, {
    timeoutMs: 5,
    provider: {
      name: 'stalled-provider',
      scan(_input, signal) {
        signal.addEventListener('abort', () => (aborted = true), { once: true });
        return new Promise(() => {});
      },
    },
  }).fetch(request(), env);

  expect(response.status).toEqual(503);
  expect(aborted).toEqual(true);
  expect(performance.now() - startedAt < 500).toEqual(true);
});
