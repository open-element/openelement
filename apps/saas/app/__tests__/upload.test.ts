/**
 * Smoke tests for the /upload route (#983): loader and action factories
 * run against a stubbed Supabase client (the real client stays behind
 * lib/supabase-server.ts, composition boundary #981).
 */
import { expect, test } from 'vitest';
import { assertRejectsIncludes } from '../../../../tests/lib/vitest-asserts.ts';
import { isActionFailure, isOpenElementRedirect } from '@openelement/router';

// v0.44: route logic lives in app/route-logic/ so tests never evaluate the
// compiled page class (decorators are compile-time-only input).
const {
  ALLOWED_CONTENT_TYPES,
  BUCKET,
  createDeleteAction,
  createUploadAction,
  createUploadLoader,
  MAX_FILE_BYTES,
  objectKeyFor,
  ownsObjectKey,
  sanitizeFilename,
} = await import('../route-logic/upload.ts');
type UploadSupabaseClient = import('../route-logic/upload.ts').UploadSupabaseClient;

const USER = { id: 'user-123', email: 'tester@example.com' };

function stubClient(overrides: {
  user?: { id: string; email?: string } | null;
  listData?: { object_key: string; display_name: string }[] | null;
  listError?: { message: string } | null;
  uploadError?: { message: string } | null;
  removeError?: { message: string } | null;
  rpcErrors?: Record<string, { message: string }>;
  onUpload?: (path: string, file: File) => void;
  onRemove?: (paths: string[]) => void;
  onRpc?: (name: string, args: Record<string, unknown>) => void;
}): () => UploadSupabaseClient {
  const {
    user = USER,
    listData = [],
    listError = null,
    uploadError = null,
    removeError = null,
    rpcErrors = {},
    onUpload,
    onRemove,
    onRpc,
  } = overrides;
  return () => ({
    auth: { getUser: () => Promise.resolve({ data: { user } }) },
    storage: {
      from: (bucket: string) => {
        expect(bucket).toEqual(BUCKET);
        return {
          upload: (path: string, file: File) => {
            onUpload?.(path, file);
            return Promise.resolve({ error: uploadError });
          },
          createSignedUrl: (path: string, expiresIn: number) =>
            Promise.resolve({
              data: { signedUrl: `https://storage.test/${path}?expires=${expiresIn}` },
              error: null,
            }),
          remove: (paths: string[]) => {
            onRemove?.(paths);
            return Promise.resolve({ error: removeError });
          },
        };
      },
    },
    rpc: (name: string, args: Record<string, unknown>) => {
      onRpc?.(name, args);
      return Promise.resolve({
        data: name === 'list_downloadable_attachments' ? listData : undefined,
        error: name === 'list_downloadable_attachments' ? listError : (rpcErrors[name] ?? null),
      });
    },
  });
}

const ctx = () => ({
  request: new Request('http://localhost/upload'),
  params: {},
  env: {} as Record<string, unknown>,
  platform: undefined,
  responseHeaders: new Headers(),
  route: { path: '/upload', filePath: 'app/routes/upload.tsx' },
});

test('sanitizeFilename strips path traversal and unsafe characters', () => {
  expect(sanitizeFilename('../../etc/passwd')).toEqual('passwd');
  expect(sanitizeFilename('C:\\tmp\\my file!.txt')).toEqual('my_file_.txt');
  expect(sanitizeFilename('plain.md')).toEqual('plain.md');
});

test('objectKeyFor scopes the object to the owner folder', () => {
  const first = objectKeyFor('user-123', 'a.txt');
  const second = objectKeyFor('user-123', 'a.txt');
  expect(first.startsWith('user-123/')).toBeTruthy();
  expect(first.endsWith('-a.txt')).toBeTruthy();
  expect(first !== second).toBeTruthy();
  expect(ownsObjectKey('user-123', first)).toBeTruthy();
  expect(!ownsObjectKey('other-user', first)).toBeTruthy();
  expect(!ownsObjectKey('user-123', 'user-123/nested/a.txt')).toBeTruthy();
});

test('loader redirects anonymous requests to sign-in (v0.44)', async () => {
  // 0.43 rendered a denied branch; grammar v1 cannot pair a static denied
  // variant with a dynamic authenticated one, so the loader redirects.
  const loader = createUploadLoader(stubClient({ user: null }));
  const error = await assertRejectsIncludes(() => loader(ctx()));
  expect(isOpenElementRedirect(error)).toBeTruthy();
  expect((error as { location?: string }).location).toEqual('/login');
});

test('loader lists the owner folder for signed-in requests', async () => {
  const loader = createUploadLoader(
    stubClient({ listData: [{ object_key: 'user-123/uuid-a.txt', display_name: 'a.txt' }] }),
  );
  expect(await loader(ctx())).toEqual({
    denied: false,
    email: USER.email,
    files: [
      {
        name: 'a.txt',
        key: 'user-123/uuid-a.txt',
        downloadUrl: 'https://storage.test/user-123/uuid-a.txt?expires=60',
      },
    ],
  });
});

test('action rejects anonymous uploads with 401', async () => {
  const action = createUploadAction(stubClient({ user: null }));
  const formData = new FormData();
  formData.set('file', new File(['x'], 'a.txt', { type: 'text/plain' }));
  const result = await action({ ...ctx(), formData });
  expect(isActionFailure(result)).toBeTruthy();
  expect(result.status).toEqual(401);
});

test('action rejects a missing file with 422', async () => {
  const action = createUploadAction(stubClient({}));
  const result = await action({ ...ctx(), formData: new FormData() });
  expect(isActionFailure(result)).toBeTruthy();
  expect(result.status).toEqual(422);
});

test('action rejects files over the reference cap with 422', async () => {
  const action = createUploadAction(stubClient({}));
  const formData = new FormData();
  formData.set('file', new File([new Uint8Array(MAX_FILE_BYTES + 1)], 'big.bin'));
  const result = await action({ ...ctx(), formData });
  expect(isActionFailure(result)).toBeTruthy();
  expect(result.status).toEqual(422);
});

test('action rejects content types outside the allowlist', async () => {
  expect(ALLOWED_CONTENT_TYPES.has('text/plain')).toBeTruthy();
  const action = createUploadAction(stubClient({}));
  const formData = new FormData();
  formData.set('file', new File(['x'], 'script.js', { type: 'text/javascript' }));
  const result = await action({ ...ctx(), formData });
  expect(isActionFailure(result)).toBeTruthy();
  expect(result.status).toEqual(422);
});

test('action uploads under the owner key and redirects (PRG)', async () => {
  let uploadedPath = '';
  const action = createUploadAction(stubClient({ onUpload: (path) => (uploadedPath = path) }));
  const formData = new FormData();
  formData.set('file', new File(['hello'], 'hello.txt', { type: 'text/plain' }));
  const error = await assertRejectsIncludes(() => action({ ...ctx(), formData }));
  expect(isOpenElementRedirect(error)).toBeTruthy();
  expect(uploadedPath.startsWith('user-123/')).toBeTruthy();
  expect(uploadedPath.endsWith('-hello.txt')).toBeTruthy();
});

test('successful upload enqueues the pending scan message', async () => {
  const queued: unknown[] = [];
  const action = createUploadAction(stubClient({}));
  const formData = new FormData();
  formData.set('file', new File(['hello'], 'hello.txt', { type: 'text/plain' }));
  const requestContext = ctx();
  requestContext.env.ATTACHMENT_SCAN_QUEUE = {
    send: (message: unknown) => {
      queued.push(message);
      return Promise.resolve();
    },
  };
  const error = await assertRejectsIncludes(() => action({ ...requestContext, formData }));
  expect(isOpenElementRedirect(error)).toBeTruthy();
  expect(queued.length).toEqual(1);
  expect((queued[0] as { type: string }).type).toEqual('attachment.scan');
});

test('action surfaces storage errors as 422', async () => {
  const action = createUploadAction(stubClient({ uploadError: { message: 'row level security' } }));
  const formData = new FormData();
  formData.set('file', new File(['x'], 'a.txt', { type: 'text/plain' }));
  const result = await action({ ...ctx(), formData });
  expect(isActionFailure(result)).toBeTruthy();
  expect(result.status).toEqual(422);
  expect(result.data).toEqual({ error: 'row level security' });
});

test('action atomically reserves and releases quota when upload fails', async () => {
  const calls: string[] = [];
  const action = createUploadAction(
    stubClient({
      uploadError: { message: 'storage unavailable' },
      onRpc: (name) => calls.push(name),
    }),
  );
  const formData = new FormData();
  formData.set('file', new File(['x'], 'a.txt', { type: 'text/plain' }));
  const result = await action({ ...ctx(), formData });
  expect(isActionFailure(result)).toBeTruthy();
  expect(result.status).toEqual(422);
  expect(calls).toEqual(['reserve_attachment', 'release_attachment']);
});

test('finalize failure records durable deletion before removing Storage', async () => {
  const calls: string[] = [];
  const removed: string[][] = [];
  const action = createUploadAction(
    stubClient({
      rpcErrors: { finalize_attachment: { message: 'database unavailable' } },
      onRpc: (name) => calls.push(name),
      onRemove: (paths) => removed.push(paths),
    }),
  );
  const formData = new FormData();
  formData.set('file', new File(['x'], 'a.txt', { type: 'text/plain' }));
  const error = await assertRejectsIncludes(() => action({ ...ctx(), formData }), Error);
  expect(error.message).toEqual('upload could not be finalized');
  expect(calls).toEqual([
    'reserve_attachment',
    'finalize_attachment',
    'request_attachment_delete',
    'complete_attachment_delete',
  ]);
  expect(removed.length).toEqual(1);
});

test('finalize compensation Storage failure leaves the durable deletion intent', async () => {
  const calls: string[] = [];
  const action = createUploadAction(
    stubClient({
      rpcErrors: { finalize_attachment: { message: 'database unavailable' } },
      removeError: { message: 'storage unavailable' },
      onRpc: (name) => calls.push(name),
    }),
  );
  const formData = new FormData();
  formData.set('file', new File(['x'], 'a.txt', { type: 'text/plain' }));
  const error = await assertRejectsIncludes(() => action({ ...ctx(), formData }), Error);
  expect(error.message).toEqual('upload finalization failed; object deletion is queued for retry');
  expect(calls).toEqual(['reserve_attachment', 'finalize_attachment', 'request_attachment_delete']);
});

test('finalize compensation never deletes Storage before durable intent', async () => {
  const calls: string[] = [];
  const removed: string[][] = [];
  const action = createUploadAction(
    stubClient({
      rpcErrors: {
        finalize_attachment: { message: 'database unavailable' },
        request_attachment_delete: { message: 'intent unavailable' },
      },
      onRpc: (name) => calls.push(name),
      onRemove: (paths) => removed.push(paths),
    }),
  );
  const formData = new FormData();
  formData.set('file', new File(['x'], 'a.txt', { type: 'text/plain' }));
  const error = await assertRejectsIncludes(() => action({ ...ctx(), formData }), Error);
  expect(error.message).toEqual('upload finalization is uncertain; cleanup is pending');
  expect(calls).toEqual(['reserve_attachment', 'finalize_attachment', 'request_attachment_delete']);
  expect(removed).toEqual([]);
});

test('delete rejects a cross-user object key before Storage', async () => {
  const action = createDeleteAction(stubClient({}));
  const formData = new FormData();
  formData.set('key', 'other-user/secret.txt');
  const result = await action({ ...ctx(), formData });
  expect(isActionFailure(result)).toBeTruthy();
  expect(result.status).toEqual(403);
});

test('delete removes the owner object and releases quota', async () => {
  const removed: string[][] = [];
  const calls: string[] = [];
  const action = createDeleteAction(
    stubClient({
      onRemove: (paths) => removed.push(paths),
      onRpc: (name) => calls.push(name),
    }),
  );
  const formData = new FormData();
  formData.set('key', 'user-123/opaque-a.txt');
  const error = await assertRejectsIncludes(() => action({ ...ctx(), formData }));
  expect(isOpenElementRedirect(error)).toBeTruthy();
  expect(removed).toEqual([['user-123/opaque-a.txt']]);
  expect(calls).toEqual(['request_attachment_delete', 'complete_attachment_delete']);
});

test('duplicate owner deletes remain idempotent across intent and completion RPCs', async () => {
  const calls: string[] = [];
  const removed: string[][] = [];
  const action = createDeleteAction(
    stubClient({
      onRemove: (paths) => removed.push(paths),
      onRpc: (name) => calls.push(name),
    }),
  );
  const formData = new FormData();
  formData.set('key', 'user-123/opaque-a.txt');

  for (let attempt = 0; attempt < 2; attempt++) {
    const error = await assertRejectsIncludes(() => action({ ...ctx(), formData }));
    expect(isOpenElementRedirect(error)).toBeTruthy();
  }

  expect(removed).toEqual([['user-123/opaque-a.txt'], ['user-123/opaque-a.txt']]);
  expect(calls).toEqual([
    'request_attachment_delete',
    'complete_attachment_delete',
    'request_attachment_delete',
    'complete_attachment_delete',
  ]);
});

test('delete finalization failure leaves a recoverable tombstone', async () => {
  const calls: string[] = [];
  const action = createDeleteAction(
    stubClient({
      rpcErrors: { complete_attachment_delete: { message: 'database unavailable' } },
      onRpc: (name) => calls.push(name),
    }),
  );
  const formData = new FormData();
  formData.set('key', 'user-123/opaque-a.txt');
  const error = await assertRejectsIncludes(() => action({ ...ctx(), formData }), Error);
  expect(error.message).toEqual('object deleted; quota reconciliation is pending');
  expect(calls).toEqual(['request_attachment_delete', 'complete_attachment_delete']);
});

test('delete Storage failure keeps the durable intent for Cron retry', async () => {
  const calls: string[] = [];
  const action = createDeleteAction(
    stubClient({
      removeError: { message: 'storage unavailable' },
      onRpc: (name) => calls.push(name),
    }),
  );
  const formData = new FormData();
  formData.set('key', 'user-123/opaque-a.txt');
  const result = await action({ ...ctx(), formData });
  expect(isActionFailure(result)).toBeTruthy();
  expect(result.status).toEqual(422);
  expect(result.data?.error).toEqual('storage unavailable; deletion queued for retry');
  expect(calls).toEqual(['request_attachment_delete']);
});

/**
 * Stateful reservation fake encoding the migration contract
 * (supabase/migrations/20260817000001 + 20260817000002 + 20260823110200):
 * reserve inserts a 'reserved' row; finalize moves reserved -> pending_scan
 * exactly once (the guarded update raises on any second finalize of the same
 * reservation); delete intent moves any state to 'deleting' with a coalesced
 * timestamp; delete completion removes only 'deleting' rows.
 */
function statefulReservationClient(
  overrides: {
    uploadGate?: Promise<void>;
    removeError?: { message: string } | null;
  } = {},
) {
  interface Row {
    id: string;
    objectKey: string;
    byteSize: number;
    state: 'reserved' | 'pending_scan' | 'deleting';
    deleteRequestedAt: number | null;
  }
  const rows = new Map<string, Row>();
  const audit: string[] = [];
  const uploads: string[] = [];
  const removals: string[][] = [];
  const factory = (): UploadSupabaseClient => ({
    auth: { getUser: () => Promise.resolve({ data: { user: USER } }) },
    storage: {
      from: (bucket: string) => {
        expect(bucket).toEqual(BUCKET);
        return {
          upload: async (path: string, _file: File) => {
            uploads.push(path);
            await overrides.uploadGate;
            return { error: null as { message: string } | null };
          },
          createSignedUrl: (path: string, expiresIn: number) =>
            Promise.resolve({
              data: { signedUrl: `https://storage.test/${path}?expires=${expiresIn}` },
              error: null,
            }),
          remove: (paths: string[]) => {
            removals.push(paths);
            return Promise.resolve({ error: overrides.removeError ?? null });
          },
        };
      },
    },
    rpc: (name: string, args: Record<string, unknown>) => {
      switch (name) {
        case 'reserve_attachment': {
          rows.set(String(args.reservation_id), {
            id: String(args.reservation_id),
            objectKey: String(args.object_key),
            byteSize: Number(args.byte_size),
            state: 'reserved',
            deleteRequestedAt: null,
          });
          audit.push('upload_reserved');
          return Promise.resolve({ error: null });
        }
        case 'finalize_attachment': {
          const row = rows.get(String(args.reservation_id));
          if (!row || row.state !== 'reserved') {
            return Promise.resolve({ error: { message: 'attachment reservation not found' } });
          }
          row.state = 'pending_scan';
          audit.push('upload_pending_scan');
          return Promise.resolve({ error: null });
        }
        case 'release_attachment': {
          const row = rows.get(String(args.reservation_id));
          if (row) {
            rows.delete(row.id);
            audit.push('upload_failed');
          }
          return Promise.resolve({ error: null });
        }
        case 'request_attachment_delete': {
          const row = [...rows.values()].find((entry) => entry.objectKey === args.target_key);
          if (row) {
            row.state = 'deleting';
            row.deleteRequestedAt ??= Date.now();
            audit.push('delete_requested');
          }
          return Promise.resolve({ error: null });
        }
        case 'complete_attachment_delete': {
          const row = [...rows.values()].find((entry) => entry.objectKey === args.target_key);
          if (row && row.state === 'deleting') {
            rows.delete(row.id);
            audit.push('deleted');
          }
          return Promise.resolve({ error: null });
        }
        default:
          return Promise.resolve({ error: { message: `unexpected rpc ${name}` } });
      }
    },
  });
  return { factory, rows, audit, uploads, removals };
}

test('upload finalize is single-completion: a duplicate finalize on the same reservation loses', async () => {
  const db = statefulReservationClient();
  const queued: unknown[] = [];
  const action = createUploadAction(db.factory);
  const formData = new FormData();
  formData.set('file', new File(['hello'], 'hello.txt', { type: 'text/plain' }));
  const requestContext = ctx();
  requestContext.env.ATTACHMENT_SCAN_QUEUE = {
    send: (message: unknown) => {
      queued.push(message);
      return Promise.resolve();
    },
  };
  const error = await assertRejectsIncludes(() => action({ ...requestContext, formData }));
  expect(isOpenElementRedirect(error)).toBeTruthy();
  // The reservation id is server-generated per request (upload.tsx:151) and
  // never exposed before finalize, so a duplicate can only arrive at the
  // database contract level — e.g. a retried finalize after a lost response.
  // The migration guard must reject it without a second state transition.
  const reservationId = [...db.rows.keys()][0];
  const duplicate = await db.factory().rpc('finalize_attachment', {
    reservation_id: reservationId,
  });
  expect(duplicate.error?.message).toEqual('attachment reservation not found');
  expect(db.audit).toEqual(['upload_reserved', 'upload_pending_scan']);
  expect([...db.rows.values()][0]?.state).toEqual('pending_scan');
  expect(queued.length).toEqual(1);
});

test('upload finalize race won by a duplicate converges to one durable deletion', async () => {
  // Hold the Storage upload so a racing duplicate finalize commits first; the
  // route's own finalize then observes the migration's not-found error and
  // must treat the outcome as uncertain (upload.tsx:174-192): durable delete
  // intent, Storage removal, row completion — exactly once, no scan handoff.
  let releaseUpload: () => void = () => {};
  const uploadGate = new Promise<void>((resolve) => (releaseUpload = resolve));
  const db = statefulReservationClient({ uploadGate });
  const queued: unknown[] = [];
  const action = createUploadAction(db.factory);
  const formData = new FormData();
  formData.set('file', new File(['hello'], 'hello.txt', { type: 'text/plain' }));
  const requestContext = ctx();
  requestContext.env.ATTACHMENT_SCAN_QUEUE = {
    send: (message: unknown) => {
      queued.push(message);
      return Promise.resolve();
    },
  };
  const actionPromise = action({ ...requestContext, formData });
  for (let i = 0; i < 100 && db.uploads.length === 0; i++) await Promise.resolve();
  expect(db.uploads.length).toEqual(1);
  const reservationId = [...db.rows.keys()][0];
  const racer = await db.factory().rpc('finalize_attachment', {
    reservation_id: reservationId,
  });
  expect(racer.error).toEqual(null); // the racing finalize takes the single transition
  releaseUpload();
  const error = await assertRejectsIncludes(() => actionPromise, Error);
  expect(error.message).toEqual('upload could not be finalized');
  expect(db.audit).toEqual([
    'upload_reserved',
    'upload_pending_scan',
    'delete_requested',
    'deleted',
  ]);
  expect(db.removals).toEqual([[db.uploads[0]]]);
  expect(db.rows.size).toEqual(0);
  expect(queued.length).toEqual(0);

  // The completed deletion is idempotent: repeating the intent/completion RPCs
  // for the converged key is a no-op, so Cron retries stay safe.
  const client = db.factory();
  const retryIntent = await client.rpc('request_attachment_delete', {
    target_key: db.uploads[0],
  });
  const retryComplete = await client.rpc('complete_attachment_delete', {
    target_key: db.uploads[0],
  });
  expect(retryIntent.error).toEqual(null);
  expect(retryComplete.error).toEqual(null);
  expect(db.audit).toEqual([
    'upload_reserved',
    'upload_pending_scan',
    'delete_requested',
    'deleted',
  ]);
});
