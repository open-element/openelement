import { expect, test, vi } from 'vitest';
import { isOpenElementRedirect } from '@openelement/router';
import {
  createAttachmentDownloadHandler,
  createDeleteAction,
  createUploadAction,
  createUploadLoader,
  MAX_FILE_BYTES,
  objectKeyFor,
  sanitizeFilename,
  uploadPageProps,
} from '../route-logic/upload.ts';
import { compileFunctionPage } from './compile-page.ts';

const ID = '20000000-0000-4000-8000-000000000001';
const USER = { id: '30000000-0000-4000-8000-000000000001', email: 'owner@example.test' };
const KEY = `${USER.id}/20000000-0000-4000-8000-000000000002-report.txt`;

function fixture({
  user = USER as typeof USER | null,
  row = null as { object_key: string; display_name: string } | null,
  error = null as { message: string } | null,
  key = KEY as string | null,
} = {}) {
  const rpc = vi.fn(() => Promise.resolve({ error }));
  const query = {
    select: vi.fn(() => query),
    eq: vi.fn(() => query),
    order: vi.fn(() => query),
    limit: vi.fn(() => query),
    maybeSingle: vi.fn(() => Promise.resolve({ data: row, error })),
    overrideTypes: vi.fn(() =>
      Promise.resolve({
        data: [{ id: ID, display_name: 'Report', state: 'pending_scan' }],
        error,
      }),
    ),
  };
  const factory = (() => ({
    auth: { getUser: () => Promise.resolve({ data: { user } }) },
    rpc,
    from: vi.fn(() => query),
  })) as unknown as NonNullable<Parameters<typeof createUploadAction>[0]>;
  const serviceRpc = vi.fn((_env: unknown, method: string, _body: unknown) =>
    Promise.resolve(method === 'begin_attachment_delete' ? key : undefined),
  );
  const services = {
    uploadAttachment: vi.fn(() => Promise.resolve()),
    removeAttachment: vi.fn(() => Promise.resolve()),
    downloadAttachment: vi.fn(() =>
      Promise.resolve(
        new Response('clean bytes', {
          headers: { 'content-type': 'text/html', 'set-cookie': 'do-not-copy' },
        }),
      ),
    ),
    serviceRoleRpc: serviceRpc as unknown as NonNullable<
      Parameters<typeof createUploadAction>[1]
    >['serviceRoleRpc'],
  };
  return { services, factory, rpc, query, serviceRpc };
}

function context(file?: File) {
  const formData = new FormData();
  if (file) formData.set('file', file);
  return {
    request: new Request('https://app.example/upload'),
    params: {},
    env: {} as Record<string, unknown>,
    platform: undefined,
    responseHeaders: new Headers(),
    route: { path: '/upload', filePath: 'app/routes/upload.tsx' },
    formData,
  };
}
const report = () => new File(['attachment data'], 'report.txt', { type: 'text/plain' });

test('attachment keys are unpredictable, flat, and scoped to the owner', () => {
  expect(sanitizeFilename('../../etc/passwd')).toBe('passwd');
  expect(sanitizeFilename('C:\\tmp\\my file!.txt')).toBe('my_file_.txt');
  const key = objectKeyFor(USER.id, '../report.txt');
  expect(key).toMatch(new RegExp(`^${USER.id}/[a-f0-9-]{36}-report\\.txt$`));
  expect(key).not.toBe(objectKeyFor(USER.id, 'report.txt'));
});

test('the list requires authentication and fetches only owner display fields', async () => {
  const signedOut = fixture({ user: null });
  await expect(createUploadLoader(signedOut.factory)(context())).rejects.toMatchObject({
    location: '/login',
  });
  const { factory, query } = fixture();
  const ctx = context();
  await expect(createUploadLoader(factory)(ctx)).resolves.toEqual({
    email: USER.email,
    files: [{ id: ID, display_name: 'Report', state: 'pending_scan' }],
  });
  expect(query.select).toHaveBeenCalledWith('id, display_name, state');
  expect(query.eq).toHaveBeenCalledWith('user_id', USER.id);
});

test.each([
  [null, report(), 401],
  [USER, undefined, 422],
  [USER, new File([], 'empty.txt', { type: 'text/plain' }), 422],
  [USER, new File(['x'], 'script.js', { type: 'text/javascript' }), 422],
  [USER, new File([new Uint8Array(MAX_FILE_BYTES + 1)], 'huge.txt', { type: 'text/plain' }), 422],
])('upload rejects invalid requests before reservation or Storage', async (user, file, status) => {
  const { factory, services, rpc } = fixture({ user });
  const result = await createUploadAction(factory, services)(context(file));
  expect(result.status).toBe(status);
  expect(rpc).not.toHaveBeenCalled();
  expect(services.uploadAttachment).not.toHaveBeenCalled();
});

test('upload reserves quota under the user session before writing server-side, then queues the finalized row', async () => {
  const { factory, services, rpc, serviceRpc } = fixture();
  const ctx = context(report());
  const send = vi.fn(() => Promise.resolve());
  ctx.env.ATTACHMENT_SCAN_QUEUE = { send };
  await expect(createUploadAction(factory, services)(ctx)).rejects.toSatisfy(isOpenElementRedirect);
  const args = rpc.mock.calls.at(0) as unknown as [
    string,
    { reservation_id: string; object_key: string },
  ];
  expect(args[0]).toBe('reserve_attachment');
  const { reservation_id, object_key } = args[1];
  expect(object_key.startsWith(`${USER.id}/`)).toBe(true);
  expect(rpc).toHaveBeenCalledBefore(services.uploadAttachment);
  expect(services.uploadAttachment).toHaveBeenCalledBefore(serviceRpc);
  expect(serviceRpc).toHaveBeenCalledWith(ctx.env, 'finish_attachment_upload', {
    reservation_id,
    target_owner: USER.id,
    target_key: object_key,
  });
  expect(send).toHaveBeenCalledWith({
    type: 'attachment.scan',
    reservationId: reservation_id,
    objectKey: object_key,
  });
});

test('failed reservation never touches the provider or discloses its error', async () => {
  const { factory, services } = fixture({ error: { message: 'private database details' } });
  const result = await createUploadAction(factory, services)(context(report()));
  expect(result.data?.error).toBe('Could not reserve space for the attachment.');
  expect(services.uploadAttachment).not.toHaveBeenCalled();
});

test.each(['upload', 'finalize'])(
  '%s failure schedules the same durable delete without releasing quota',
  async (stage) => {
    const { factory, services, serviceRpc } = fixture();
    if (stage === 'upload')
      services.uploadAttachment.mockRejectedValueOnce(new Error('private provider details'));
    else serviceRpc.mockRejectedValueOnce(new Error('private provider details'));
    const result = await createUploadAction(factory, services)(context(report()));
    expect(result.data?.error).toMatch(/^Could not complete .* Cleanup is pending\.$/);
    expect(serviceRpc).toHaveBeenLastCalledWith({}, 'begin_attachment_delete', {
      reservation_id: expect.any(String),
      target_owner: USER.id,
      upload_failed: true,
    });
    expect(services.removeAttachment).not.toHaveBeenCalled();
  },
);

function deletion() {
  const ctx = context();
  ctx.formData.set('id', ID);
  return ctx;
}

test('delete starts through an owner-bound reservation and releases quota after trusted removal', async () => {
  const { factory, services, serviceRpc } = fixture();
  const ctx = deletion();
  await expect(createDeleteAction(factory, services)(ctx)).rejects.toSatisfy(isOpenElementRedirect);
  expect(serviceRpc).toHaveBeenNthCalledWith(1, ctx.env, 'begin_attachment_delete', {
    reservation_id: ID,
    target_owner: USER.id,
    upload_failed: false,
  });
  expect(services.removeAttachment).toHaveBeenCalledWith(ctx.env, KEY);
  expect(serviceRpc).toHaveBeenNthCalledWith(2, ctx.env, 'complete_pending_attachment_delete', {
    reservation_id: ID,
  });
});

test('delete of a missing, foreign, or already completed reservation does not reach Storage', async () => {
  const { factory, services, serviceRpc } = fixture({ key: null });
  await expect(createDeleteAction(factory, services)(deletion())).rejects.toSatisfy(
    isOpenElementRedirect,
  );
  expect(serviceRpc).toHaveBeenCalledTimes(1);
  expect(services.removeAttachment).not.toHaveBeenCalled();
});

test('provider delete failures leave the durable tombstone and hide provider details', async () => {
  const { factory, services, serviceRpc } = fixture();
  services.removeAttachment.mockRejectedValueOnce(new Error('provider secret'));
  const result = await createDeleteAction(factory, services)(deletion());
  expect(result.data?.error).toBe('Attachment deletion is pending and will be retried.');
  expect(serviceRpc).toHaveBeenCalledTimes(1);
});

const downloadRequest = () => new Request(`https://app.example/api/attachment-download?id=${ID}`);
test.each([
  { user: null },
  { row: null },
  { row: { object_key: 'other/foreign.txt', display_name: 'Report' } },
])(
  'download never calls Storage for absent authentication or an unauthorized row',
  async (options) => {
    const { factory, services } = fixture(options);
    const response = await createAttachmentDownloadHandler(
      factory,
      services,
    )({ request: downloadRequest(), env: {} });
    expect(response.status).toBe(404);
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(services.downloadAttachment).not.toHaveBeenCalled();
  },
);

test('a clean attachment streams bytes with an inert same-origin download response', async () => {
  const { factory, services, query } = fixture({
    row: { object_key: KEY, display_name: 'bad"\r\n.txt' },
  });
  const response = await createAttachmentDownloadHandler(
    factory,
    services,
  )({ request: downloadRequest(), env: {} });
  expect(query.eq.mock.calls).toEqual([
    ['id', ID],
    ['user_id', USER.id],
    ['state', 'clean'],
  ]);
  expect(services.downloadAttachment).toHaveBeenCalledWith({}, KEY);
  expect(response.status).toBe(200);
  expect(response.headers.get('content-type')).toBe('application/octet-stream');
  expect(response.headers.get('content-disposition')).toBe('attachment; filename="bad___.txt"');
  expect(response.headers.get('x-content-type-options')).toBe('nosniff');
  expect(response.headers.get('cache-control')).toContain('no-store');
  expect(response.headers.has('location')).toBe(false);
  expect(response.headers.has('set-cookie')).toBe(false);
  expect(await response.text()).toBe('clean bytes');
});

test('the compiled page makes only clean download links visible and carries reservation ids', async () => {
  const render = await compileFunctionPage('../routes/upload.tsx', 'UploadPage');
  const data = {
    files: [
      { id: ID, state: 'clean', display_name: '<script>report</script>' },
      { id: 'held', state: 'quarantined', display_name: 'held.txt' },
    ],
  };
  const html = await render(
    uploadPageProps({
      data,
      params: {},
      request: undefined,
      route: { path: '/upload' },
      meta: {},
    }),
  );
  expect(html).toContain(`href="/api/attachment-download?id=${ID}">Download</a>`);
  expect(html).toContain('href="/api/attachment-download?id=held" hidden');
  expect(html).toContain(`name="id" value="${ID}"`);
  expect(html).not.toContain('<script>');
  expect(html).not.toContain(KEY);
});
