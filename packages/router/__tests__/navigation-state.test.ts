/**
 * Navigation state machine invariants (#1385).
 *
 * The client router's cross-flow invariants — latest-wins tickets, ownership
 * of pending cancellation (#1343 review), browser-landing dedup and the
 * one-shot guard-veto restore marker (#1036) — are pinned here directly on
 * the machine, plus interaction cases driven through createRouter(). The
 * point of the extraction is that these transitions are asserted in one
 * place: a future change that breaks the interaction between
 * ownership-point cancellation and Navigation-API interception fails a named
 * test instead of a scenario assertion several layers away.
 */
import { assert, assertEquals } from '@std/assert';
import { NavigationState } from '../src/internal/router/navigation-state.ts';

Deno.test('navigation state: the newest ticket owns intent, older tickets never do (#1023)', () => {
  const state = new NavigationState();
  const first = state.issue('programmatic');
  assertEquals(state.owns(first), true, 'a fresh ticket owns intent');
  const second = state.issue('programmatic');
  assertEquals(state.owns(first), false, 'issuing supersedes the previous holder');
  assertEquals(state.owns(second), true);
  assertEquals(state.latestTicketId, second.id);
  // Kinds are descriptive only: crossing from programmatic to browser and
  // back does not change any decision.
  const third = state.issue('browser');
  assertEquals(state.owns(second), false);
  assertEquals(state.owns(third), true);
  assertEquals(third.kind, 'browser');
});

Deno.test('navigation state: supersede retires the holder without issuing a successor', () => {
  const state = new NavigationState();
  const ticket = state.issue('native');
  state.supersede();
  assertEquals(
    state.owns(ticket),
    false,
    'an aborted traversal must not commit even though nobody replaced it',
  );
  // The sequence strictly increases, so an id is never handed out twice.
  const next = state.issue('programmatic');
  assert(next.id > ticket.id, 'ticket ids are monotonic');
  assertEquals(state.owns(next), true);
});

Deno.test('navigation state: disposal supersedes every outstanding ticket and disarms restore', () => {
  const state = new NavigationState();
  const browser = state.issue('browser');
  state.armRestore('https://router.test/current');
  state.dispose();
  assertEquals(state.disposed, true);
  assertEquals(state.owns(browser), false, 'disposal retires pending tickets');
  assertEquals(state.restoreHref, null, 'disposal clears the restore marker');
  // Idempotent: a second dispose is a no-op, and no ticket can be issued into
  // ownership afterwards.
  state.dispose();
  assertEquals(state.owns(state.issue('programmatic')), false);
});

Deno.test('navigation state: landing dedup is per-recorded-URL, and null invalidates it', () => {
  const state = new NavigationState();
  assertEquals(state.landedUrl, null);
  assertEquals(state.isDuplicateLanding('/a'), false, 'nothing recorded yet');
  state.recordLanding('/a');
  assertEquals(state.isDuplicateLanding('/a'), true, 'a burst on the same URL is a duplicate');
  assertEquals(state.isDuplicateLanding('/b'), false, 'a different landing is genuine');
  // A programmatic commit takes over the address bar: whatever the browser
  // last landed on no longer describes the entry, so a genuine back onto that
  // URL must not be deduped away.
  state.recordLanding(null);
  assertEquals(state.isDuplicateLanding('/a'), false);
});

Deno.test("navigation state: the restore marker is consumed exactly once and only by the router's own event", () => {
  const state = new NavigationState();
  state.armRestore('https://router.test/current');
  assertEquals(state.restoreHref, 'https://router.test/current');
  // Own event: replace-shaped, no info payload, landing on the armed href.
  assertEquals(
    state.consumeRestore({
      destinationHref: 'https://router.test/current',
      navigationType: 'replace',
      info: undefined,
    }),
    true,
  );
  assertEquals(state.restoreHref, null, 'the marker is one-shot');
  assertEquals(
    state.consumeRestore({
      destinationHref: 'https://router.test/current',
      navigationType: 'replace',
      info: undefined,
    }),
    false,
    'a second consume cannot re-match after the marker was used',
  );
});

Deno.test('navigation state: a genuine navigation clears a stale restore marker and does not match', () => {
  // A wrong destination never matches: the guard-veto restore landed somewhere
  // else, so the marker must not swallow an unrelated traversal.
  const wrongTarget = new NavigationState();
  wrongTarget.armRestore('https://router.test/current');
  assertEquals(
    wrongTarget.consumeRestore({
      destinationHref: 'https://router.test/other',
      navigationType: 'replace',
      info: undefined,
    }),
    false,
  );
  assertEquals(wrongTarget.restoreHref, null, 'stale markers are cleared, not kept');

  // A different navigationType is not our restore either.
  const wrongType = new NavigationState();
  wrongType.armRestore('https://router.test/current');
  assertEquals(
    wrongType.consumeRestore({
      destinationHref: 'https://router.test/current',
      navigationType: 'push',
      info: undefined,
    }),
    false,
  );

  // An event carrying info is an app-initiated navigation: it can never be
  // the router's own bare replaceState.
  const withInfo = new NavigationState();
  withInfo.armRestore('https://router.test/current');
  assertEquals(
    withInfo.consumeRestore({
      destinationHref: 'https://router.test/current',
      navigationType: 'replace',
      info: {},
    }),
    false,
  );
});

Deno.test('navigation state: owning intent is the only path to a pending-cancellation decision (#1343 review)', () => {
  // The invariant the router relies on: `onPending` may fire exactly when
  // owns() answers true for the current ticket. Modelling the four states a
  // navigation can be in at its commit point.
  const state = new NavigationState();
  const vetoed = state.issue('programmatic');
  const winner = state.issue('programmatic');
  // A vetoed navigation still holds its ticket (nothing superseded it), yet a
  // newer navigation exists: the commit point must ask owns(), not presence.
  const outcomes = {
    vetoedHeldTicket: state.owns(vetoed),
    newerTicket: state.owns(winner),
    aborted: (() => {
      state.supersede();
      return state.owns(winner);
    })(),
    disposed: (() => {
      state.dispose();
      return state.owns(state.issue('programmatic'));
    })(),
  };
  assertEquals(outcomes, {
    vetoedHeldTicket: false,
    newerTicket: true,
    aborted: false,
    disposed: false,
  });
});

Deno.test('navigation state: an aborted native traversal cannot commit after the queue drains', async () => {
  // Integration shape of the machine's supersede-on-abort path, exercised
  // through the same sequence onNativeNavigate uses.
  const state = new NavigationState();
  const ticket = state.issue('native');
  let committed = false;
  const queue = Promise.resolve().then(() => {
    if (!state.owns(ticket)) return;
    committed = true;
  });
  state.supersede();
  await queue;
  assertEquals(committed, false, 'the aborted traversal commits nothing');

  // And a disposal racing the same drain is equivalent.
  const disposedState = new NavigationState();
  const pending = disposedState.issue('native');
  let committedAfterDispose = false;
  const pendingQueue = Promise.resolve().then(() => {
    if (!disposedState.owns(pending)) return;
    committedAfterDispose = true;
  });
  disposedState.dispose();
  await pendingQueue;
  assertEquals(committedAfterDispose, false);
});
