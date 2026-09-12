#!/usr/bin/env -S deno run --allow-net --allow-env
/**
 * quota-race-proof — Alpha 5 (#1000): prove the 10 MiB per-owner attachment
 * quota holds under concurrent reservations against the REAL Supabase project.
 *
 * reserve_attachment (supabase/migrations/20260817000001_attachment_quota.sql)
 * serializes per-owner accounting with pg_advisory_xact_lock, so N concurrent
 * 1 MiB reservations for one owner must yield exactly 10 successes and N-10
 * "attachment quota exceeded" failures, with sum(byte_size) never exceeding
 * the cap. A unit test can only stub that serialization; this script is the
 * empirical evidence.
 *
 * The script creates a throwaway user with the service role, races N=12
 * reservations with the owner's JWT, asserts the exact outcome, then ALWAYS
 * cleans up (reservation rows + throwaway user). Output is counts and
 * timestamps only — never credentials, emails, or user ids.
 *
 * Provider-gated: it runs only when the three provider secrets are present in
 * the environment. It is intentionally NOT part of `deno task test`, which
 * grants --allow-env only and must stay hermetic (same pattern as
 * tools/smoke-supabase-browser.ts).
 *
 * Usage:
 *   SUPABASE_URL=... SUPABASE_ANON_KEY=... SUPABASE_SERVICE_ROLE_KEY=... \
 *     deno run --allow-net --allow-env \
 *     examples/supabase-cloudflare-starter/scripts/quota-race-proof.ts
 */

const QUOTA_BYTES = 10 * 1024 * 1024; // 10 MiB, from the migration
const RACE_SIZE_BYTES = 1024 * 1024; // 1 MiB per reservation
const CONCURRENCY = 12;
const EXPECTED_SUCCESSES = QUOTA_BYTES / RACE_SIZE_BYTES; // 10

function required(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`${name} is required`);
  return value;
}

const supabaseUrl = required('SUPABASE_URL');
const anonKey = required('SUPABASE_ANON_KEY');
const serviceRoleKey = required('SUPABASE_SERVICE_ROLE_KEY');

const serviceHeaders = {
  apikey: serviceRoleKey,
  authorization: `Bearer ${serviceRoleKey}`,
};

interface RaceResult {
  ok: boolean;
  message: string;
}

async function raceOnce(jwt: string, userId: string): Promise<RaceResult> {
  const response = await fetch(`${supabaseUrl}/rest/v1/rpc/reserve_attachment`, {
    method: 'POST',
    headers: {
      apikey: anonKey,
      authorization: `Bearer ${jwt}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      reservation_id: crypto.randomUUID(),
      object_key: `${userId}/${crypto.randomUUID()}-race.bin`,
      display_name: 'race.bin',
      byte_size: RACE_SIZE_BYTES,
      content_type: 'text/plain',
    }),
  });
  if (response.ok) {
    await response.body?.cancel();
    return { ok: true, message: '' };
  }
  const body = await response.json().catch(() => ({} as { message?: string }));
  return { ok: false, message: String(body.message ?? `http ${response.status}`) };
}

function assert(condition: boolean, detail: string): void {
  if (!condition) throw new Error(`assertion failed: ${detail}`);
}

let userId = '';
const startedAt = new Date();
try {
  const runId = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
  const password = `oe-Quota1!-${crypto.randomUUID()}`;
  const created = await fetch(`${supabaseUrl}/auth/v1/admin/users`, {
    method: 'POST',
    headers: { ...serviceHeaders, 'content-type': 'application/json' },
    body: JSON.stringify({
      email: `oe-quota-race-${runId}@example.com`,
      password,
      email_confirm: true,
    }),
  }).then((r) => r.json());
  userId = created.id;
  if (!userId) throw new Error('throwaway user creation failed');

  const session = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: anonKey, 'content-type': 'application/json' },
    body: JSON.stringify({ email: `oe-quota-race-${runId}@example.com`, password }),
  }).then((r) => r.json());
  const jwt = session.access_token;
  if (!jwt) throw new Error('owner token grant failed');

  const results = await Promise.all(
    Array.from({ length: CONCURRENCY }, () => raceOnce(jwt, userId)),
  );
  const succeeded = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok);
  const nonQuotaFailures = failed.filter((r) => !r.message.includes('attachment quota exceeded'));

  const rowsResponse = await fetch(
    `${supabaseUrl}/rest/v1/attachment_reservations?user_id=eq.${userId}&select=byte_size`,
    { headers: serviceHeaders },
  );
  const rows: unknown = await rowsResponse.json();
  assert(
    Array.isArray(rows),
    `reservation sum query returned http ${rowsResponse.status} (is migration 20260817000001 applied?)`,
  );
  const finalBytes = (rows as { byte_size: number }[]).reduce((sum, r) => sum + r.byte_size, 0);

  assert(succeeded === EXPECTED_SUCCESSES, `successes ${succeeded} != ${EXPECTED_SUCCESSES}`);
  assert(failed.length === CONCURRENCY - EXPECTED_SUCCESSES, `failures ${failed.length} != 2`);
  assert(nonQuotaFailures.length === 0, `non-quota failures: ${nonQuotaFailures[0]?.message}`);
  assert(finalBytes <= QUOTA_BYTES, `final bytes ${finalBytes} exceed quota`);
  assert(finalBytes === succeeded * RACE_SIZE_BYTES, 'final bytes do not match successes');

  console.log(JSON.stringify({
    check: 'attachment-quota-race',
    result: 'pass',
    concurrency: CONCURRENCY,
    succeeded,
    failed: failed.length,
    failureSemantics: 'attachment quota exceeded',
    finalBytes,
    quotaBytes: QUOTA_BYTES,
    startedAt: startedAt.toISOString(),
    finishedAt: new Date().toISOString(),
  }));
} finally {
  // Always-run cleanup: reservation rows first, then the throwaway user (its
  // ON DELETE CASCADE would take the rows, but explicit order keeps the real
  // project clean even if the schema changes).
  if (userId) {
    const rowsCleanup = await fetch(
      `${supabaseUrl}/rest/v1/attachment_reservations?user_id=eq.${userId}`,
      { method: 'DELETE', headers: serviceHeaders },
    );
    await rowsCleanup.body?.cancel();
    console.log(`cleanup reservation rows -> ${rowsCleanup.status}`);
    const userCleanup = await fetch(`${supabaseUrl}/auth/v1/admin/users/${userId}`, {
      method: 'DELETE',
      headers: serviceHeaders,
    });
    await userCleanup.body?.cancel();
    console.log(`cleanup throwaway user -> ${userCleanup.status}`);
  }
}
