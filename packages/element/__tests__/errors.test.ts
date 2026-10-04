import { expect, test } from 'vitest';
import {
  OpenElementError,
  reportError,
  resetErrorTelemetryHookForTests,
  setErrorTelemetryHook,
} from '../src/internal/core/errors.ts';

test('setErrorTelemetryHook is reconfigurable (#1099)', () => {
  resetErrorTelemetryHookForTests();
  try {
    let received: string | null = null;
    setErrorTelemetryHook((e) => {
      received = e.message;
    });
    let replacement = '';
    setErrorTelemetryHook((error) => {
      replacement = error.message;
    });
    reportError(new OpenElementError('boom'));
    expect(received).toEqual(null);
    expect(replacement).toEqual('boom');
  } finally {
    resetErrorTelemetryHookForTests();
  }
});

test('reportError falls back to console.error when no hook is set (#644)', () => {
  resetErrorTelemetryHookForTests();
  const original = console.error;
  const messages: string[] = [];
  console.error = (...args: unknown[]) => messages.push(args.join(' '));
  try {
    reportError(new OpenElementError('fallback'));
    expect(messages.length).toEqual(1);
    expect(messages[0].includes('fallback')).toEqual(true);
  } finally {
    console.error = original;
    resetErrorTelemetryHookForTests();
  }
});

// The legacy renderDsd telemetry-routing and control-flow-rethrow tests were
// deleted with the legacy renderer: the 0.44 renderDsd (public-runtime.ts)
// fails closed for uncompiled classes and never invokes component code, so
// there is no render error to route. Fail-closed coverage:
// __tests__/compiled-runtime/facade.test.ts ('renderDsd fails closed').
