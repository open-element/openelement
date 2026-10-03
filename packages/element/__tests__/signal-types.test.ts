import { expect, test } from 'vitest';
import type { Signal } from '../src/internal/protocol/signal.ts';
import { signal } from '../src/internal/signal/framework.ts';
import { isSignalLike } from '../src/internal/signal/types.ts';

test('isSignalLike rejects unbranded value/subscribe impostors (#1092)', () => {
  const fake = { value: 1, subscribe: () => () => {} };
  expect(isSignalLike(fake)).toEqual(false);
  expect(isSignalLike(signal(1))).toEqual(true);
});

// Compile-time fixture: structural lookalikes cannot silently enter renderer
// APIs as reactive signals because they lack the engine-owned brand.
const fake = { value: 1, subscribe: (_fn: (value: number) => void) => () => {} };
// @ts-expect-error fake has no engine-owned SIGNAL_BRAND
const _notASignal: Signal<number> = fake;
