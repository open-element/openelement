/**
 * The one internal stylesheet-readiness contract (KR-2 late style handoff).
 *
 * The generated client adapter creates its sheet synchronously and records the
 * promise that fills it under `STYLE_SHEET_READY`; these tests pin the runtime
 * half of that contract without a DOM: a sheet without the key is ready by
 * definition (dev's inline adapter, the SSR shim, plain sheets), the aggregate
 * the hydration gate consumes waits for *every* pending sheet, and a rejected
 * readiness stays rejected — observing it must never convert it into a signal
 * that reads as "styles installed".
 */

import { expect, test } from 'vitest';
import { STYLE_SHEET_READY, type StyleSheetLike } from '@openelement/protocol/style-sheet';
import { pendingSheetReadiness, staticStyleReadiness } from '../src/open-element-styles.ts';

type SheetWithReadiness = StyleSheetLike & { [STYLE_SHEET_READY]?: Promise<unknown> };

function sheet(ready?: Promise<unknown>): SheetWithReadiness {
  return { replaceSync() {}, cssRules: [], [STYLE_SHEET_READY]: ready };
}

test('a sheet without the readiness key is ready by definition', () => {
  expect(pendingSheetReadiness(sheet())).toEqual([]);
  expect(staticStyleReadiness(sheet())).toBeUndefined();
  expect(staticStyleReadiness([sheet(), sheet()])).toBeUndefined();
  expect(staticStyleReadiness(undefined)).toBeUndefined();
});

test('the aggregate waits for every pending sheet, not the first settlement', async () => {
  let settleSecond!: () => void;
  const second = new Promise<void>((resolve) => {
    settleSecond = resolve;
  });
  const aggregate = staticStyleReadiness([sheet(Promise.resolve()), sheet(second)])!;

  let settled = false;
  void aggregate.then(() => {
    settled = true;
  });
  await Promise.resolve();
  await Promise.resolve();
  // The first sheet is ready; the second is not — the aggregate must hold.
  expect(settled).toBe(false);

  settleSecond();
  await aggregate;
  expect(settled).toBe(true);
});

test('a rejected readiness stays rejected: observing it is not success', async () => {
  const failure = new Error('island style asset request failed with 500: /assets/x.css');
  const pending = Promise.reject(failure);
  // The adapter's own observer: prevents an unhandled rejection without
  // converting the stored promise.
  void pending.catch(() => {});
  const ready = sheet(pending);

  const aggregate = staticStyleReadiness(ready)!;
  await expect(aggregate).rejects.toThrow('island style asset request failed with 500');
  // The recorded promise is still rejected for any later consumer.
  await expect(ready[STYLE_SHEET_READY]!).rejects.toThrow(
    'island style asset request failed with 500',
  );
});
