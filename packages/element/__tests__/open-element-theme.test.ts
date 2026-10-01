import { assertEquals } from '@std/assert';
import { OpenElementThemeManager } from '../src/open-element-theme.ts';

Deno.test('theme manager disconnects its observer with the last host (#1099)', () => {
  const previousDocument = globalThis.document;
  const previousObserver = globalThis.MutationObserver;
  let created = 0;
  let disconnected = 0;
  class Observer {
    constructor(_callback: MutationCallback) {
      created++;
    }
    observe(): void {}
    disconnect(): void {
      disconnected++;
    }
  }
  const documentStub = { documentElement: { dataset: {} } };
  Object.defineProperty(globalThis, 'document', { configurable: true, value: documentStub });
  Object.defineProperty(globalThis, 'MutationObserver', { configurable: true, value: Observer });
  try {
    const manager = new OpenElementThemeManager();
    const host = {
      isConnected: true,
      hasAttribute: () => false,
      setAttribute: () => {},
      removeAttribute: () => {},
    } as unknown as HTMLElement;
    manager.connect(host);
    assertEquals(created, 1);
    manager.disconnect(host);
    assertEquals(disconnected, 1);
    manager.connect(host);
    assertEquals(created, 2);
    manager.disconnect(host);
    assertEquals(disconnected, 2);
  } finally {
    if (previousDocument === undefined) delete (globalThis as { document?: unknown }).document;
    else {
      Object.defineProperty(globalThis, 'document', {
        configurable: true,
        value: previousDocument,
      });
    }
    if (previousObserver === undefined) {
      delete (globalThis as { MutationObserver?: unknown }).MutationObserver;
    } else {
      Object.defineProperty(globalThis, 'MutationObserver', {
        configurable: true,
        value: previousObserver,
      });
    }
  }
});
