/**
 * morph-focus-restore.ts - focus snapshot/restore for the morph client
 * (#603): a morph is not a navigation, so the focused control must survive
 * it. Split from enhance-client.ts (#908).
 */

interface FocusRestoreDeps {
  doc: Document;
}

interface FocusSnapshot {
  el: Element;
  id: string;
  selStart: number;
  selEnd: number;
}

export interface MorphFocusRestore {
  captureFocus: () => FocusSnapshot | null;
  restoreFocus: (snap: FocusSnapshot | null) => void;
}

export function createMorphFocusRestore(deps: FocusRestoreDeps): MorphFocusRestore {
  const doc = deps.doc;

  // --- #603: morph continuity (focus, scroll) -----------------------------

  function deepActiveElement(): Element | null {
    let active = doc.activeElement;
    while (active && (active as HTMLElement).shadowRoot) {
      const deeper = (active as HTMLElement).shadowRoot?.activeElement;
      if (!deeper) break;
      active = deeper;
    }
    return active;
  }

  function captureFocus(): FocusSnapshot | null {
    const active = deepActiveElement();
    if (!active || active === doc.body) return null;
    const snap: FocusSnapshot = {
      el: active,
      id: (active as HTMLElement).id || '',
      selStart: -1,
      selEnd: -1,
    };
    const input = active as HTMLInputElement;
    if (typeof input.selectionStart === 'number') {
      snap.selStart = input.selectionStart ?? -1;
      snap.selEnd = input.selectionEnd ?? -1;
    }
    return snap;
  }

  function findByIdDeep(root: ParentNode, id: string): Element | null {
    // Live-tree counterpart of findDeep: descends into attached shadow roots
    // (the incoming side descends into templates instead).
    const all = root.querySelectorAll('*');
    for (let i = 0; i < all.length; i++) {
      if (all[i].id === id) return all[i];
    }
    for (let j = 0; j < all.length; j++) {
      const shadow = (all[j] as HTMLElement).shadowRoot;
      if (shadow) {
        const found = findByIdDeep(shadow, id);
        if (found) return found;
      }
    }
    return null;
  }

  function restoreFocus(snap: FocusSnapshot | null): void {
    if (!snap) return;
    if (deepActiveElement() === snap.el) return; // the control survived the morph
    let target: Element | null = null;
    if (snap.el.isConnected) {
      // Still in the tree but focus was lost (e.g. it was moved).
      target = snap.el;
    } else if (snap.id) {
      // Replaced by the morph: refocus the same-id successor (#603).
      target = findByIdDeep(doc, snap.id);
    }
    if (!target) return;
    (target as HTMLElement).focus();
    if (
      snap.selStart >= 0 &&
      typeof (target as HTMLInputElement).setSelectionRange === 'function'
    ) {
      try {
        (target as HTMLInputElement).setSelectionRange(snap.selStart, snap.selEnd);
      } catch {
        // Input types without text selection (checkbox, number, ...) throw.
      }
    }
  }

  return {
    captureFocus: captureFocus,
    restoreFocus: restoreFocus,
  };
}
