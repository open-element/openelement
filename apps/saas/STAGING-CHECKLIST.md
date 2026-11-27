# SaaS staging qualification

This is an operator checklist, not evidence that staging has passed. Run it
against the exact candidate commit and record the commit, deployment revision,
project identifier, date, operator, and pass/fail/blocked result for each item.
Store logs and screenshots without tokens, secrets, signed URLs, payment data,
invitation codes, or email contents. Use isolated test accounts and test-mode payments. Follow
[the migration runbook](../../docs/runbooks/supabase-migrations.md) and
[payment runbook](../../docs/runbooks/payment-events.md) for provisioning,
recovery and rollback. Do not use production customer data.

## Setup and identities

- [ ] Apply the ordered migrations to an isolated hosted Supabase project;
      verify the migration history and Data API grants. Record failures.
- [ ] Configure the deployed application origin, Auth redirect allowlist,
      confirmation and recovery URLs, and verified SMTP sender. Verify delivery
      to a controlled mailbox and record provider and delivery result.
- [ ] Configure server-only bindings from `.env.example`, the scanner's
      provider bindings, Queue/DLQ/Cron bindings and the Cloudflare auth rate
      limiter. Record binding names and deployment revision, never values.
- [ ] Prepare distinct test accounts for two workspace admins and at least
      two invitees, including a member who will own an A record.

## Auth, isolation and Realtime

- [ ] Sign up with confirmation enabled, follow the real email callback, log
      in, sign out, and verify a protected route redirects when signed out.
      Request password recovery, follow the real callback, reset the password,
      and verify the new password works. Test configured OAuth separately.
- [ ] Use `/workspaces` to create A and B from separate signed-in sessions.
      Verify each creator appears as that workspace's admin. Generate
      separate A and B codes and redeem them as different signed-in users.
      Confirm each invitee receives member access to the intended workspace.
      Verify members and admins of unrelated workspaces cannot issue codes
      for A. Verify a redeemed code cannot be reused, expired codes are
      rejected, and simultaneous redemption by two accounts permits one join.
      Check the issuing response is private and uncached and that reloading
      the page cannot reveal the code again. Record outcomes without codes.
- [ ] With each user session, query workspace records through the application
      and Data API. A members see A, B sees B, and neither sees the other
      workspace, including when directly requesting its ID. Anonymous access
      is denied. A member cannot mutate another creator's record; an A admin
      can; B cannot. Verify membership and role cannot be changed by ordinary
      authenticated users. Record response status and affected-row counts.
- [ ] Subscribe to notes with two separate sessions. Insert a note for each
      user and verify only its owner receives it. Disconnect and reconnect,
      verify reconciliation restores missed notes without duplicates, and
      verify signed-out access fails. Notes are user-scoped, not workspace
      Realtime; this does not establish a workspace subscription feature.

## Attachments and scanning

- [ ] Upload allowed and disallowed MIME types, an empty file, and files at and
      above the configured size limit; record the actual responses. Confirm
      quota exhaustion and simultaneous reservations cannot exceed quota.
- [ ] Verify another user and an anonymous session cannot list, download,
      overwrite or delete the object, including by guessed key. Confirm a
      pending or rejected scan cannot produce a download; confirm a clean scan
      permits only the owner to obtain a short-lived signed URL.
- [ ] Exercise the configured real scanner with safe clean and recognized test
      samples, plus an unavailable scanner. Verify fail-closed behavior,
      retries and eventual verdicts. Delete an object and verify quota release;
      exercise a failed deletion and verify Cron reconciliation.

## Payment and lifecycle

- [ ] Create a one-time Checkout Session from the server-owned catalog in
      Stripe test mode. Complete payment and verify amount, currency and order
      identity against the persisted state. Visiting the success URL alone must
      not mark an order paid.
- [ ] Deliver a signed event using its original raw bytes. Verify altered bytes,
      invalid signature, stale timestamp and wrong mode are rejected. Deliver
      the same event twice and later deliver older events; verify a single
      durable event and no state regression. Record event IDs and state changes.
- [ ] Cause a controlled Queue processing failure and verify retry, exhaustion,
      durable DLQ persistence before acknowledgement, authorized replay and
      eventual processing. Verify Cron recovers received events and requested
      replays after a failed handoff. Repeat the applicable retry/DLQ path for
      attachment scans. Record provider delivery IDs and timestamps.
- [ ] Inspect deployed Worker logs and browser assets for accidental secret or
      payload disclosure; check the actual Cloudflare rate-limit rule with a
      controlled burst. Record results and clean up test records and objects.

Subscriptions and entitlements are a separate follow-on and are not qualified
by this one-time payment checklist. Hosted email, Supabase, Cloudflare and real
scanner results remain external pending until recorded for the exact candidate.
