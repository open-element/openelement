import { assert, assertEquals, assertRejects } from '@std/assert';
import { isActionFailure, isOpenElementNotFound, isOpenElementRedirect } from '@openelement/app';

// v0.44: route logic lives in app/route-logic/ so tests never evaluate the
// compiled page class (decorators are compile-time-only input).
const { createAdminLoader, createPaymentReplayAction, createReplayAction } = await import(
  '../route-logic/admin.ts'
);

const ADMIN = { id: 'admin-1', email: 'admin@example.com', app_metadata: { role: 'admin' } };
const ID = '123e4567-e89b-42d3-a456-426614174000';

function client(options: {
  user?: typeof ADMIN | null;
  deadLetters?: unknown[];
  paymentDeadLetters?: unknown[];
  replayError?: { message: string } | null;
  calls?: { name: string; body?: Record<string, string> }[];
  inserts?: { table: string; row: Record<string, unknown> }[];
} = {}) {
  const {
    user = ADMIN,
    deadLetters = [],
    paymentDeadLetters = [],
    replayError = null,
    calls = [],
    inserts = [],
  } = options;
  return () => ({
    auth: { getUser: () => Promise.resolve({ data: { user } }) },
    from: (name: string) => ({
      select: () => Promise.resolve({ count: 2, error: null }),
      insert: (row: Record<string, unknown>) => {
        inserts.push({ table: name, row });
        return Promise.resolve({ error: null });
      },
    }),
    rpc: (name: string, body?: Record<string, string>) => {
      calls.push({ name, body });
      if (name === 'list_attachment_scan_dead_letters') {
        return Promise.resolve({ data: deadLetters, error: null });
      }
      if (name === 'list_payment_event_dead_letters') {
        return Promise.resolve({ data: paymentDeadLetters, error: null });
      }
      return Promise.resolve({ data: null, error: replayError });
    },
  });
}

const ctx = () => ({
  request: new Request('http://localhost/admin'),
  params: {},
  env: {},
  platform: undefined,
  responseHeaders: new Headers(),
  route: { path: '/admin', filePath: 'app/routes/admin.tsx' },
});

Deno.test('admin loader lists durable scan dead letters', async () => {
  const deadLetters = [{
    id: ID,
    object_key: 'user/object',
    state: 'dead_letter',
    delivery_count: 1,
    first_failed_at: '2026-08-17T00:00:00Z',
  }];
  const data = await createAdminLoader(client({ deadLetters }) as never)(ctx());
  assertEquals(data.noteCount, 2);
  assertEquals(data.deadLetters, deadLetters);
  assertEquals(data.paymentDeadLetters, []);
});

Deno.test('payment replay validates provider id and requests one durable replay', async () => {
  const action = createPaymentReplayAction(client() as never);
  const invalid = new FormData();
  invalid.set('event_id', 'bad');
  const result = await action({ ...ctx(), formData: invalid });
  assert(isActionFailure(result));
  assertEquals(result.status, 422);

  const calls: { name: string; body?: Record<string, string> }[] = [];
  const inserts: { table: string; row: Record<string, unknown> }[] = [];
  const valid = new FormData();
  valid.set('event_id', 'evt_dead_letter_1');
  const error = await assertRejects(() =>
    createPaymentReplayAction(client({ calls, inserts }) as never)({ ...ctx(), formData: valid })
  );
  assert(isOpenElementRedirect(error));
  assertEquals(calls, [{
    name: 'request_payment_event_replay',
    body: { target_event_id: 'evt_dead_letter_1' },
  }]);
  assertEquals(inserts, []);
});

Deno.test('payment replay surfaces the atomic request RPC failure', async () => {
  const valid = new FormData();
  valid.set('event_id', 'evt_dead_letter_1');
  const result = await createPaymentReplayAction(
    client({ replayError: { message: 'atomic request unavailable' } }) as never,
  )({ ...ctx(), formData: valid });
  assert(isActionFailure(result));
  assertEquals(result.status, 422);
  assertEquals((result.data as { error: string }).error, 'atomic request unavailable');
});

Deno.test('admin loader conceals the queue console from non-admin users', async () => {
  const error = await assertRejects(() =>
    createAdminLoader(client({
      user: { ...ADMIN, app_metadata: { role: 'member' } },
    }) as never)(ctx())
  );
  assert(isOpenElementNotFound(error));
});

Deno.test('replay action validates id and requests one durable replay', async () => {
  const action = createReplayAction(client() as never);
  const invalid = new FormData();
  invalid.set('id', 'not-a-uuid');
  const result = await action({ ...ctx(), formData: invalid });
  assert(isActionFailure(result));
  assertEquals(result.status, 422);

  const calls: { name: string; body?: Record<string, string> }[] = [];
  const inserts: { table: string; row: Record<string, unknown> }[] = [];
  const valid = new FormData();
  valid.set('id', ID);
  const error = await assertRejects(() =>
    createReplayAction(client({ calls, inserts }) as never)({ ...ctx(), formData: valid })
  );
  assert(isOpenElementRedirect(error));
  assertEquals(calls, [{
    name: 'request_attachment_scan_replay',
    body: { dead_letter_id: ID },
  }]);
  assertEquals(inserts, []);
});

Deno.test('attachment replay surfaces the atomic request RPC failure', async () => {
  const valid = new FormData();
  valid.set('id', ID);
  const result = await createReplayAction(
    client({ replayError: { message: 'atomic request unavailable' } }) as never,
  )({ ...ctx(), formData: valid });
  assert(isActionFailure(result));
  assertEquals(result.status, 422);
  assertEquals((result.data as { error: string }).error, 'atomic request unavailable');
});
