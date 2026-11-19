import { expect, test } from 'vitest';
import {
  installRailScrollspy,
  uninstallRailScrollspy,
} from '../app/site-ui/open-page-rail-controller.ts';

/**
 * Regression for the alpha16 author trap (8d5b48a77): a disconnect keeps the
 * retained generated DOM, so an `aria-current` mark left behind by the previous
 * activation survives into the next claim and fails its static-seed check.
 * Teardown must undo the marks, and the SAME nodes must come back clean.
 *
 * The controller is browser-only and the www project runs in the node
 * environment, so the test supplies the three globals it touches (a rail host
 * with a shadow root, `IntersectionObserver`, and `document.getElementById`);
 * the link nodes are shared across the connect/disconnect cycle, which is the
 * retained-DOM shape the trap describes.
 */

interface FakeLink {
  attrs: Map<string, string>;
  getAttribute(name: string): string | null;
  setAttribute(name: string, value: string): void;
  removeAttribute(name: string): void;
}

function makeLink(href: string): FakeLink {
  const attrs = new Map<string, string>([['href', href]]);
  return {
    attrs,
    getAttribute: (name) => attrs.get(name) ?? null,
    setAttribute: (name, value) => void attrs.set(name, value),
    removeAttribute: (name) => void attrs.delete(name),
  };
}

function withBrowserGlobals(
  links: FakeLink[],
  sections: Map<string, { top: number }>,
  run: (observed: { disconnected: number }) => void,
): void {
  const scope = globalThis as unknown as Record<string, unknown>;
  const previous = {
    IntersectionObserver: scope.IntersectionObserver,
    document: scope.document,
    innerHeight: scope.innerHeight,
  };
  const observed = { disconnected: 0 };
  class FakeIntersectionObserver {
    constructor(_callback: unknown, _options?: unknown) {}
    observe(): void {}
    disconnect(): void {
      observed.disconnected += 1;
    }
  }
  scope.IntersectionObserver = FakeIntersectionObserver;
  scope.document = {
    getElementById: (id: string) => {
      const section = sections.get(id);
      if (!section) return null;
      return { getBoundingClientRect: () => ({ top: section.top }) };
    },
  };
  scope.innerHeight = 1000;
  try {
    run(observed);
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete scope[key];
      else scope[key] = value;
    }
  }
  expect(links.length, 'fake rail has links').toBeGreaterThan(1);
}

test('uninstallRailScrollspy undoes every aria-current mark on the retained DOM', () => {
  const links = [makeLink('#start'), makeLink('#install')];
  const host = { shadowRoot: { querySelectorAll: () => links } };
  const sections = new Map([
    ['start', { top: 0 }],
    ['install', { top: 0 }],
  ]);
  withBrowserGlobals(links, sections, (observed) => {
    installRailScrollspy(host as unknown as HTMLElement);
    // Seed marks exactly one target (the last one at/above the band).
    expect(links.filter((link) => link.getAttribute('aria-current') === 'location')).toHaveLength(
      1,
    );

    uninstallRailScrollspy(host as unknown as HTMLElement);
    expect(observed.disconnected).toBe(1);
    // The retained nodes carry no mark: the next claim starts from the
    // declared static seed, not from the previous activation's leftover.
    expect(links.map((link) => link.getAttribute('aria-current'))).toEqual([null, null]);

    // Re-connect on the SAME nodes: the seed re-applies and only one mark exists.
    installRailScrollspy(host as unknown as HTMLElement);
    expect(links.filter((link) => link.getAttribute('aria-current') === 'location')).toHaveLength(
      1,
    );
    uninstallRailScrollspy(host as unknown as HTMLElement);
    expect(links.map((link) => link.getAttribute('aria-current'))).toEqual([null, null]);
  });
});
