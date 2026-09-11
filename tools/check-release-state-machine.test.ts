import { assertEquals } from '@std/assert';
import { type ReleaseState, validateReleaseState } from './check-release-state-machine.ts';

const state: ReleaseState = {
  schemaVersion: 1,
  sourceVersion: '1.0.0-alpha.1',
  publishedVersion: '0.44.0-beta.2.2',
  latestLandedTrain: 'v0.44.0-beta.2.2',
  activeTarget: 'v1.0.0-alpha.1',
  nextPlannedTrain: 'not scheduled',
  maturity: 'alpha',
};

Deno.test('release state accepts an empty historical GitHub Release dependency model', () => {
  const versions = new Map([
    ['@openelement/element', state.sourceVersion],
    ['@openelement/router', state.sourceVersion],
    ['@openelement/adapter-vite', state.sourceVersion],
    ['@openelement/create', state.sourceVersion],
  ]);
  assertEquals(validateReleaseState(state, versions), []);
});

Deno.test('release state rejects a pre-1.0 active target', () => {
  const versions = new Map([
    ['@openelement/element', state.sourceVersion],
    ['@openelement/router', state.sourceVersion],
    ['@openelement/adapter-vite', state.sourceVersion],
    ['@openelement/create', state.sourceVersion],
  ]);
  assertEquals(validateReleaseState({ ...state, activeTarget: 'v0.44.0-beta.2.3' }, versions), [
    'activeTarget must be the first public 1.0 prerelease baseline',
  ]);
});
