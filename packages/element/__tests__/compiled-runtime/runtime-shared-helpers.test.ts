import { expect, test } from 'vitest';
import { SIGNAL_BRAND } from '@openelement/protocol/signal';
import type { SignalLike } from '@openelement/protocol/signal';
import { RuntimeErrorCode, ServerErrorCode } from '@openelement/protocol/errors';
import { trustedHtmlValue as securityTrustedHtmlValue } from '../../src/internal/core/security.ts';
import { LifetimeScope } from '../../src/internal/compiled/lifetime-scope.ts';
import * as leaf from '../../src/internal/compiled/leaf-runtime.ts';
import { bindSignalWrites, guardUpdate } from '../../src/internal/compiled/runtime/bindings.ts';
import { runtimeProbe } from '../../src/internal/compiled/runtime/observability.ts';
import * as values from '../../src/internal/compiled/runtime/values.ts';
import { signal } from '../../src/internal/signal/framework.ts';
import { createTestEngine } from './test-engine.ts';

test('the generated leaf entry exports the canonical value helpers', () => {
  expect(leaf.displayValue).toBe(values.displayValue);
  expect(leaf.assertSafeUrlAttribute).toBe(values.assertSafeUrlAttribute);
  expect(leaf.removeNodes).toBe(values.removeNodes);
});

test('invalid class values carry the coded validation error', () => {
  expect(() => values.classValueOf(Symbol('nope'))).toThrow(
    expect.objectContaining({ code: ServerErrorCode.PROGRAM_INVALID }),
  );
});

test('M04b: the trusted-HTML capability is re-exported from the one trust boundary', () => {
  expect(values.trustedHtmlValue).toBe(securityTrustedHtmlValue);
  const trusted = { html: '<b>ok</b>' };
  expect(() => values.trustedHtmlValue(trusted)).toThrow(/trustedHtml/);
});

test('M04b: bindSignalWrites subscribes to future writes only and releases with the scope', () => {
  runtimeProbe.reset();
  const scope = new LifetimeScope();
  const source = signal(0);
  const seen: number[] = [];
  bindSignalWrites(scope, source, 'value', (value) => seen.push(Number(value)));

  // Preact's adapter delivers a synchronous subscription-time echo; the helper
  // ignores exactly that initial echo (no spurious update at bind time).
  expect(seen).toEqual([]);
  source.value = 1;
  expect(seen).toEqual([1]);

  scope.dispose();
  source.value = 2;
  expect(seen).toEqual([1]);
  expect(runtimeProbe.snapshot().subscriptions).toBe(1);
  expect(runtimeProbe.snapshot().unsubscribed).toBe(1);
});

test('M04b: a lazy engine first real write is never lost', () => {
  const engine = createTestEngine();
  const scope = new LifetimeScope();
  const source = engine.signal(0);
  const seen: number[] = [];
  bindSignalWrites(scope, source, 'value', (value) => seen.push(Number(value)));
  // The lazy test engine delivers no subscription-time callback at all.
  expect(seen).toEqual([]);
  source.value = 5;
  expect(seen).toEqual([5]);
  scope.dispose();
});

test('M04b: an invalid unsubscribe fails closed with the catalogued code', () => {
  const scope = new LifetimeScope();
  const fake = {
    [SIGNAL_BRAND]: true,
    value: 0,
    subscribe: () => undefined,
  } as unknown as SignalLike<number>;

  let thrown: { code?: string; message?: string } | undefined;
  try {
    bindSignalWrites(scope, fake, 'broken', () => {});
  } catch (error) {
    thrown = error as { code?: string; message?: string };
  }
  expect(thrown?.code).toBe(RuntimeErrorCode.SUBSCRIPTION_INVALID);
  expect(thrown?.message).toContain('broken');
  scope.dispose();
});

test('M04b: binding on an already-disposed scope releases immediately', () => {
  runtimeProbe.reset();
  const scope = new LifetimeScope();
  scope.dispose();
  const source = signal(0);
  const seen: number[] = [];
  bindSignalWrites(scope, source, 'value', (value) => seen.push(Number(value)));
  source.value = 1;
  expect(seen).toEqual([]);
  expect(runtimeProbe.snapshot().subscriptions).toBe(1);
  expect(runtimeProbe.snapshot().unsubscribed).toBe(1);
});

test('M04b: guardUpdate routes the update error to the sink without rethrowing', () => {
  const sink: unknown[] = [];
  const guarded = guardUpdate(
    () => {
      throw new Error('block update failed');
    },
    (error) => sink.push(error),
  );
  expect(() => guarded(1)).not.toThrow();
  expect(sink).toHaveLength(1);
  expect((sink[0] as Error).message).toBe('block update failed');
});

test('M04b: guardUpdate without a sink keeps the propagating behaviour', () => {
  const guarded = guardUpdate(() => {
    throw new Error('propagates');
  });
  expect(() => guarded(1)).toThrow('propagates');
});
