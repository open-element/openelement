import { assertEquals } from '@std/assert';
import { NavigationState } from '../src/internal/router/navigation-state.ts';

Deno.test('stream FSM retires only a live pending token at the ownership point', () => {
  const state = new NavigationState();
  state.observeStream('request-1');
  assertEquals(state.streamStatus, 'pending');
  const vetoed = state.issue('programmatic');
  assertEquals(state.streamStatus, 'pending', 'an attempted navigation has no side effect');
  const winning = state.issue('browser');
  assertEquals(state.retireStream(vetoed, 'request-1'), false);
  assertEquals(state.retireStream(winning, 'wrong-request'), false);
  assertEquals(state.retireStream(winning, 'request-1'), true);
  assertEquals(state.streamStatus, 'retired');
  assertEquals(state.retireStream(winning, 'request-1'), false, 'idempotent retirement');
  state.observeStream('request-2');
  assertEquals(state.streamStatus, 'pending', 'new network request has a fresh identity');
  state.settleStream('request-1');
  assertEquals(state.streamStatus, 'pending', 'stale terminal cannot settle a new request');
  state.settleStream('request-2');
  assertEquals(state.streamStatus, 'idle');
  assertEquals(state.retireStream(winning, 'request-2'), false);
});

Deno.test('stream FSM leaves guards, aborted traversal, duplicate and BFCache state alone', () => {
  const state = new NavigationState();
  state.observeStream('request-1');
  const guarded = state.issue('browser');
  assertEquals(state.streamStatus, 'pending');
  state.armRestore('https://router.test/current');
  assertEquals(
    state.consumeRestore({
      destinationHref: 'https://router.test/current',
      navigationType: 'replace',
      info: undefined,
    }),
    true,
  );
  assertEquals(state.streamStatus, 'pending', 'guard restore does not retire a stream');
  state.recordLanding('/current');
  assertEquals(state.isDuplicateLanding('/current'), true);
  assertEquals(state.streamStatus, 'pending', 'duplicate landing does not retire a stream');
  state.supersede();
  assertEquals(state.retireStream(guarded, 'request-1'), false);
  assertEquals(state.streamStatus, 'pending');
  // BFCache restoration reuses the saved document and seed; observing it
  // again never resets a terminal or retired state or replays a frame.
  state.settleStream('request-1');
  state.observeStream('request-1');
  assertEquals(state.streamStatus, 'idle');
  state.dispose();
  assertEquals(state.streamStatus, 'idle');
  state.observeStream('request-2');
  assertEquals(state.streamStatus, 'idle');
});
