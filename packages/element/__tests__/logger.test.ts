import { expect, test } from 'vitest';
import {
  createLogger,
  createWarnScope,
  resetWarnOnceForTests,
  warnOnce,
} from '../src/internal/core/logger.ts';
import * as publicElement from '../src/index.ts';

test('warnOnce test reset is internal and restores test isolation', () => {
  const messages: string[] = [];
  const logger = {
    debug: () => {},
    info: () => {},
    warn: (message: string) => messages.push(message),
    error: () => {},
  };

  resetWarnOnceForTests();
  warnOnce('same-key', logger, 'first');
  warnOnce('same-key', logger, 'duplicate');
  resetWarnOnceForTests();
  warnOnce('same-key', logger, 'after reset');

  expect(messages).toEqual(['first', 'after reset']);
  expect('resetWarnOnceForTests' in publicElement).toEqual(false);
});

test('warnOnce with a render scope is isolated to that scope, not process-global', () => {
  const messages: string[] = [];
  const original = console.warn;
  console.warn = (...args: unknown[]) => messages.push(args.join(' '));
  try {
    const logger = createLogger('t');
    const scopeA = createWarnScope();
    warnOnce('k', logger, 'a', scopeA);
    warnOnce('k', logger, 'a-dup', scopeA);
    const scopeB = createWarnScope();
    warnOnce('k', logger, 'b', scopeB);
    expect(messages).toEqual(['[t] a', '[t] b']);
  } finally {
    console.warn = original;
  }
});

test('warnOnce without a scope uses the global fallback and resetWarnOnceForTests clears it', () => {
  const messages: string[] = [];
  const original = console.warn;
  console.warn = (...args: unknown[]) => messages.push(args.join(' '));
  try {
    const logger = createLogger('t2');
    resetWarnOnceForTests();
    warnOnce('gk', logger, 'one');
    warnOnce('gk', logger, 'two');
    expect(messages).toEqual(['[t2] one']);
    resetWarnOnceForTests();
    warnOnce('gk', logger, 'three');
    expect(messages).toEqual(['[t2] one', '[t2] three']);
  } finally {
    console.warn = original;
  }
});

test('createWarnScope returns an independent scope per render', () => {
  expect(createWarnScope().warned.size).toEqual(0);
  expect(createWarnScope() !== createWarnScope()).toEqual(true);
});
