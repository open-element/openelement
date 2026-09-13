/**
 * island-lifecycle.ts - island preservation (data-open-preserve, islandIntact)
 * and the island scheduler re-observe hook for the morph client
 * (ADR-0120/0121). Split from enhance-client.ts (#908).
 */

interface IslandLifecycleDeps {
  /**
   * Island scheduler hook: re-observe client:visible islands after a morph
   * (a replaced island is a new element and gets a fresh observer, #562).
   */
  observeVisible: () => void;
}

export interface IslandLifecycle {
  islandIntact: (oldEl: Element, newEl: Element) => boolean;
  observeVisible: () => void;
}

export function createIslandLifecycle(deps: IslandLifecycleDeps): IslandLifecycle {
  function islandIntact(oldEl: Element, newEl: Element): boolean {
    // A hydrated island (live shadow root) survives when its light-DOM surface
    // serializes identically in the incoming document. The DSD template child
    // is skipped on both sides: the browser already consumed it into the live
    // shadow root, and DOMParser does not consume it here.
    if (!(oldEl as HTMLElement).shadowRoot) return false;
    if (oldEl.attributes.length !== newEl.attributes.length) return false;
    for (let i = 0; i < newEl.attributes.length; i++) {
      const attr = newEl.attributes[i];
      if (oldEl.getAttribute(attr.name) !== attr.value) return false;
    }
    const significantKids = (el: Node, skipTemplate: boolean): Node[] => {
      const out: Node[] = [];
      for (let k = 0; k < el.childNodes.length; k++) {
        const n = el.childNodes[k] as Element;
        if (
          skipTemplate && n.nodeType === 1 && n.tagName === 'TEMPLATE' &&
          n.hasAttribute('shadowrootmode')
        ) continue;
        // Whitespace-only text nodes carry no meaning: hydration normalizes the
        // live tree (merged text), the fresh parse keeps them split.
        if (n.nodeType === 3 && (n as unknown as Text).data.trim() === '') continue;
        out.push(n);
      }
      return out;
    };
    const kidsEqual = (o: Node, nn: Node): boolean => {
      // #582: nested DSD compares normalized on both sides — the live subtree
      // already consumed its template, the fresh parse still carries it, so a
      // raw outerHTML comparison would always judge the island 'changed'.
      if (o.nodeType !== nn.nodeType) return false;
      if (o.nodeType === 3) return (o as unknown as Text).data === (nn as unknown as Text).data;
      if (o.nodeType !== 1) return true;
      const oe = o as Element;
      const ne = nn as Element;
      if (oe.tagName !== ne.tagName) return false;
      if (oe.attributes.length !== ne.attributes.length) return false;
      for (let a = 0; a < ne.attributes.length; a++) {
        const attr = ne.attributes[a];
        if (oe.getAttribute(attr.name) !== attr.value) return false;
      }
      const oks = significantKids(oe, true);
      const nks = significantKids(ne, true);
      if (oks.length !== nks.length) return false;
      for (let i = 0; i < oks.length; i++) {
        if (!kidsEqual(oks[i], nks[i])) return false;
      }
      return true;
    };
    const newKids = significantKids(newEl, true);
    const oldKids = significantKids(oldEl, true);
    if (oldKids.length !== newKids.length) return false;
    for (let m = 0; m < newKids.length; m++) {
      if (!kidsEqual(oldKids[m], newKids[m])) return false;
    }
    return true;
  }

  return {
    islandIntact: islandIntact,
    observeVisible: deps.observeVisible,
  };
}
