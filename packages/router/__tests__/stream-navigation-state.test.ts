import { expect, test } from 'vitest';
import { NavigationState } from '../src/internal/router/navigation-state.ts';

test('stream FSM retires only a live pending token at the ownership point', () => {
  const state = new NavigationState();
  state.observeStream('request-1');
  expect(state.streamStatus).toEqual('pending');
  const vetoed = state.issue('programmatic');
  expect(state.streamStatus, 'an attempted navigation has no side effect').toEqual('pending');
  const winning = state.issue('browser');
  expect(state.retireStream(vetoed, 'request-1')).toEqual(false);
  expect(state.retireStream(winning, 'wrong-request')).toEqual(false);
  expect(state.retireStream(winning, 'request-1')).toEqual(true);
  expect(state.streamStatus).toEqual('retired');
  expect(state.retireStream(winning, 'request-1'), 'idempotent retirement').toEqual(false);
  state.observeStream('request-2');
  expect(state.streamStatus, 'new network request has a fresh identity').toEqual('pending');
  state.settleStream('request-1');
  expect(state.streamStatus, 'stale terminal cannot settle a new request').toEqual('pending');
  state.settleStream('request-2');
  expect(state.streamStatus).toEqual('idle');
  expect(state.retireStream(winning, 'request-2')).toEqual(false);
});

test('stream FSM leaves guards, aborted traversal, duplicate and BFCache state alone', () => {
  const state = new NavigationState();
  state.observeStream('request-1');
  const guarded = state.issue('browser');
  expect(state.streamStatus).toEqual('pending');
  state.armRestore('https://router.test/current');
  expect(
    state.consumeRestore({
      destinationHref: 'https://router.test/current',
      navigationType: 'replace',
      info: undefined,
    }),
  ).toEqual(true);
  expect(state.streamStatus, 'guard restore does not retire a stream').toEqual('pending');
  state.recordLanding('/current');
  expect(state.isDuplicateLanding('/current')).toEqual(true);
  expect(state.streamStatus, 'duplicate landing does not retire a stream').toEqual('pending');
  state.supersede();
  expect(state.retireStream(guarded, 'request-1')).toEqual(false);
  expect(state.streamStatus).toEqual('pending');
  // BFCache restoration reuses the saved document and seed; observing it
  // again never resets a terminal or retired state or replays a frame.
  state.settleStream('request-1');
  state.observeStream('request-1');
  expect(state.streamStatus).toEqual('idle');
  state.dispose();
  expect(state.streamStatus).toEqual('idle');
  state.observeStream('request-2');
  expect(state.streamStatus).toEqual('idle');
});
