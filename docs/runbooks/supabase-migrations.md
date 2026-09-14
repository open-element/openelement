# Runbook: SaaS Supabase migrations

Scope: apply the ordered SQL migrations in
`apps/saas/supabase/migrations/` to a local emulator or a hosted Supabase
project, and verify the result. This runbook contains no credentials and no
project references; every operator supplies those out of band.

## Boundaries

- Migration credentials are not runtime credentials. Do not use
  `SUPABASE_SERVICE_ROLE_KEY` for `supabase link` or `supabase db push`; the
  service-role key is a Worker runtime binding (see
  [`payment-events.md`](./payment-events.md)).
- `SUPABASE_ACCESS_TOKEN` comes from the operator environment and is never
  committed, printed, or pasted into an issue. `supabase login` stores it in
  the operator's own config, not in this repository.
- Migration files are append-only once applied. Never edit an applied
  migration; ship a new forward migration instead.
- Hosted migration and deployment qualification is external pending. This
  runbook defines the procedure; it does not claim a hosted run happened.

## 1. Integrity check (before anything is applied)

The reviewed bytes of every migration are recorded in
`apps/saas/supabase/migration-manifest.json`. Recompute and compare:

```sh
cd apps/saas
shasum -a 256 supabase/migrations/*.sql   # Linux: sha256sum
```

Any mismatch means a tracked migration was modified after review: stop and
investigate before applying. Never "fix" the manifest by hand.

## 2. Local emulator

```sh
cd apps/saas
supabase start            # Docker-backed local stack
supabase migration up     # apply pending migrations in order
```

Reset a disposable local database (destroys local data only):

```sh
supabase db reset
```

Local route/unit tests (`deno task test`) run against stubs and do not require
a hosted project.

## 3. Hosted project (operator, external pending)

```sh
supabase link --project-ref <project-ref>
supabase migration list          # confirm remote history before pushing
supabase db push --dry-run       # show the pending set
supabase db push                 # apply, in order
```

Rules:

- Apply only from a clean checkout of the reviewed candidate SHA.
- Read every pending migration before `db push`; call out destructive
  statements (`drop`, `truncate`, data rewrites) and require a reviewed
  forward migration as the rollback path. There are no automatic down
  migrations.
- One operator applies; a second operator verifies. Do not run two pushes
  concurrently.

## 4. Verification (read-only)

Run against the target database after apply:

```sql
select version, name, inserted_at
from supabase_migrations.schema_migrations
order by version desc
limit 10;

select relname, relrowsecurity
from pg_class
where relnamespace = 'public'::regnamespace
  and relkind = 'r'
order by relname;
```

Expected: the newest applied version matches the candidate's newest migration
file, and every application table reports `relrowsecurity = true`.

## 5. Failure handling

- Stop on the first failed migration; do not re-run the whole set blindly.
- Record the exact version and error text (never secrets or row contents).
- If a migration applied partially, add a forward repair migration reviewed
  like any other; do not edit the applied file.
- Re-run the integrity check and `supabase migration list` before retrying.
