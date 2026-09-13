# ADR-0133: 2026-08-20 Client-Router Guard Concurrency Fixes Preserve ADR-0122 Contracts

- Status: Accepted
- Date: 2026-08-20
- Amends: ADR-0122 §1
- Related: #1023, #1036, #1063

## Context

Two concurrency defects in
`packages/router/src/internal/router/client-router.ts` were reproduced ahead of
the 0.43.0-alpha.2 release. The client router carries the SPA side of the
ADR-0122 §1 loop contract (navigation, guard veto/redirect, and PRG
revalidation entry points), so per the ADR-0122 Consequences rule (enforced
by `tools/check-frozen-semantics.ts`) this amendment records why the touches
leave the frozen contracts intact.

## Decision

Accept the following maintenance change as contract-preserving:

**`packages/router/src/internal/router/client-router.ts` (§1 loop contract).**
Two holes in the #1023 latest-wins sequencing are closed, both strictly
inside guard concurrency handling:

1. _A nested guard redirect carried no sequencing ticket._ A browser-driven
   guard redirect called `commitNavigation` without the captured
   `seqAtGuardStart`, so while the redirect target's own guard was pending a
   programmatic navigation could commit, and the stale redirect then rewrote
   that navigation's history entry in place. The captured seq now rides
   along as the ticket, extending the existing latest-wins check across the
   nested guard await.
2. _The browser-event dedup key outlived programmatic commits._ The key
   recorded the URL after a guard restore/redirect rewrote the landed entry;
   a later programmatic navigation left the key stale, so a genuine back
   onto the restored entry was deduped away and the address bar diverged
   from router state. Navigation commits now invalidate the key;
   browser-driven processing re-derives it in its `finally` block as before.

Loader/action signatures, the `fail()`/`redirect()` algebra, PRG
revalidation semantics, the no-JavaScript baseline, and the navigation
contract as written (guard veto restores the source entry per #1036,
redirect replaces the landed entry, latest-wins per #1023) are unchanged:
both fixes only suppress state commits the sequencing mechanism was already
meant to skip, in await windows it failed to cover.

## Consequences

- Regression tests pin both interleavings in
  `packages/router/__tests__/client-router.test.ts` (nested guard window;
  back onto a veto-restored entry after a programmatic navigation).
- The frozen-semantics gate passes on this change set via this amendment
  (option 1 in `tools/check-frozen-semantics.ts`).
