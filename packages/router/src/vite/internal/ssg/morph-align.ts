/**
 * morph-align.ts - id-keyed tree alignment (morphChildren/morphNode), scoped
 * morph (data-open-region-target), and the morphDocument orchestration for
 * the enhance-client runtime (ADR-0120/0121 §8-9). Split from
 * enhance-client.ts (#908).
 */

import type { IslandLifecycle } from './island-lifecycle.ts';
import type { MorphFocusRestore } from './morph-focus-restore.ts';
import type { MorphScrollRestore } from './morph-scroll-restore.ts';
import type { MorphWebkitFix } from './morph-webkit-fix.ts';

interface MorphAlignDeps {
  log: { warn: (...args: unknown[]) => void };
  win: Window & typeof globalThis;
  doc: Document;
  /** Island tag names (lowercase) — survival checks treat them specially. */
  tags: readonly string[];
  webkit: MorphWebkitFix;
  islands: IslandLifecycle;
  focus: MorphFocusRestore;
  scroll: MorphScrollRestore;
}

export interface MorphAlign {
  morphDocument: (
    html: string,
    form: HTMLFormElement | null,
    regionName: string | null,
  ) => boolean;
}

export function createMorphAlign(deps: MorphAlignDeps): MorphAlign {
  const log = deps.log;
  const win = deps.win;
  const doc = deps.doc;
  const tags = deps.tags;
  const instantiateDsd = deps.webkit.instantiateDsd;
  const repairShadowUpgrades = deps.webkit.repairShadowUpgrades;
  const islandIntact = deps.islands.islandIntact;
  const captureFocus = deps.focus.captureFocus;
  const restoreFocus = deps.focus.restoreFocus;
  const captureScroll = deps.scroll.captureScroll;
  const restoreScroll = deps.scroll.restoreScroll;

  // State-mirroring attributes (#567): user-toggled state (an open <details>,
  // a playing media element) wins over the incoming document.
  const STATE_ATTRS: Record<string, Record<string, 1>> = {
    DETAILS: { open: 1 },
    VIDEO: { src: 1 },
    AUDIO: { src: 1 },
  };
  // Form-control state attributes (#603): synced only while the control still
  // shows its last server/default state. Once the user (or page script)
  // touches the control, the live property wins and the attribute is left
  // alone — see controlDirty().
  const CONTROL_ATTRS: Record<string, Record<string, 1>> = {
    INPUT: { checked: 1, value: 1 },
    TEXTAREA: { value: 1 },
    OPTION: { selected: 1 },
  };

  function controlDirty(el: Element, name: string): boolean {
    // #603: a control counts as touched when its live property no longer
    // mirrors the attribute the server last rendered.
    if (name === 'value') {
      return (el as HTMLInputElement).value !== (el.getAttribute('value') ?? '');
    }
    // checked / selected: boolean properties mirror attribute presence until
    // the user (or page script) flips them.
    return Boolean((el as unknown as Record<string, unknown>)[name]) !== el.hasAttribute(name);
  }

  function syncAttrs(oldEl: Element, newEl: Element): void {
    const skip = STATE_ATTRS[oldEl.tagName];
    const control = CONTROL_ATTRS[oldEl.tagName];
    const skipAttr = (name: string): boolean =>
      (skip !== undefined && skip[name] === 1) ||
      (control !== undefined && control[name] === 1 && controlDirty(oldEl, name));
    for (let i = oldEl.attributes.length - 1; i >= 0; i--) {
      const name = oldEl.attributes[i].name;
      if (skipAttr(name)) continue;
      if (!newEl.hasAttribute(name)) oldEl.removeAttribute(name);
    }
    for (let j = 0; j < newEl.attributes.length; j++) {
      const attr = newEl.attributes[j];
      if (skipAttr(attr.name)) continue;
      if (oldEl.getAttribute(attr.name) !== attr.value) {
        oldEl.setAttribute(attr.name, attr.value);
      }
    }
  }

  function isShadowRootTemplate(n: Node): boolean {
    return n.nodeType === 1 && (n as Element).tagName === 'TEMPLATE' &&
      (n as Element).hasAttribute('shadowrootmode');
  }

  function shadowTemplate(el: Element): HTMLTemplateElement | null {
    for (let i = 0; i < el.childNodes.length; i++) {
      const n = el.childNodes[i] as Element;
      if (isShadowRootTemplate(n)) {
        return n as unknown as HTMLTemplateElement;
      }
    }
    return null;
  }

  function containsSlot(node: Node): boolean {
    for (let i = 0; i < node.childNodes.length; i++) {
      const child = node.childNodes[i];
      if (child.nodeType === 1 && (child as Element).tagName === 'SLOT') return true;
      if (containsSlot(child)) return true;
    }
    return false;
  }

  function hasProjectedLightContent(el: Element): boolean {
    for (let i = 0; i < el.childNodes.length; i++) {
      const child = el.childNodes[i];
      if (isShadowRootTemplate(child)) continue;
      if (child.nodeType === 3 && (child as Text).data.trim() === '') continue;
      return true;
    }
    return false;
  }

  function compatible(a: Node, b: Node): boolean {
    return a.nodeType === b.nodeType &&
      (a.nodeType !== 1 || (a as Element).tagName === (b as Element).tagName);
  }

  function morphChildren(oldParent: Node, newParent: Node): void {
    // ADR-0121 §9 (#554, rewritten for #580): an ordered walk. Old children
    // are indexed by id (id'd nodes are consumed ONLY by an id match); each
    // new child in order matches by id else structurally ahead of the
    // reference point; the match is morphed and MOVED into position (moves
    // preserve shadow roots and state); unmatched new nodes are inserted in
    // place (with DSD instantiation); only never-matched old nodes are
    // removed — there is no lookahead window, so deletion is exact.
    const oldKids = Array.prototype.slice.call(oldParent.childNodes) as Node[];
    const newKids = Array.prototype.slice.call(newParent.childNodes) as Node[];
    const oldById: Record<string, Node> = {};
    for (let i = 0; i < oldKids.length; i++) {
      const ok = oldKids[i] as HTMLElement;
      if (ok.nodeType === 1 && ok.id && !oldById[ok.id]) oldById[ok.id] = ok;
    }
    const usedOld: Node[] = [];
    let ref = oldParent.firstChild;
    for (let j = 0; j < newKids.length; j++) {
      const n = newKids[j] as HTMLElement;
      // A <template shadowrootmode> child is never light DOM: it carries the
      // incoming shadow tree and is consumed by morphNode's DSD branch
      // (shadowTemplate). Inserting it as a plain child would leave an inert
      // template in the live host forever — instantiateDsd's querySelectorAll
      // does not match the node itself, so it never upgrades and never gets
      // removed (it also pollutes slot assignment). Skipping it here also
      // lets the deletion pass below collect a stale inert template left by
      // an earlier buggy morph.
      if (isShadowRootTemplate(n)) continue;
      let o: Node | null = null;
      if (
        n.nodeType === 1 && n.id && oldById[n.id] && usedOld.indexOf(oldById[n.id]) === -1 &&
        compatible(oldById[n.id], n)
      ) {
        o = oldById[n.id];
      } else {
        let c = ref;
        while (c) {
          if (
            usedOld.indexOf(c) === -1 && compatible(c, n) &&
            !(
              c.nodeType === 1 && (c as HTMLElement).id &&
              oldById[(c as HTMLElement).id] === c
            )
          ) {
            o = c;
            break;
          }
          c = c.nextSibling;
        }
      }
      if (o) {
        usedOld.push(o);
        morphNode(o, n);
        if (o !== ref) oldParent.insertBefore(o, ref);
        ref = o.nextSibling;
      } else {
        // Instantiate BEFORE insertion: upgrade reactions for a defined custom
        // element fire synchronously with the DOM call, and the hydration path
        // must already find the server-rendered shadow content (#579); the
        // WebKit upgrade repair runs after insertion (#604).
        const created: ShadowRoot[] = [];
        instantiateDsd(n, created);
        oldParent.insertBefore(n, ref);
        repairShadowUpgrades(created);
      }
    }
    for (let k = 0; k < oldKids.length; k++) {
      if (usedOld.indexOf(oldKids[k]) === -1) {
        (oldKids[k] as unknown as { remove(): void }).remove();
      }
    }
  }

  function morphNode(oldEl: Node, newEl: Node): void {
    if (!compatible(oldEl, newEl)) {
      const created: ShadowRoot[] = [];
      instantiateDsd(newEl, created);
      (oldEl as Element).replaceWith(newEl);
      repairShadowUpgrades(created);
      return;
    }
    if (oldEl.nodeType === 3) {
      if ((oldEl as unknown as Text).data !== (newEl as unknown as Text).data) {
        (oldEl as unknown as Text).data = (newEl as unknown as Text).data;
      }
      return;
    }
    if (oldEl.nodeType !== 1) return;
    const oldElement = oldEl as Element;
    const newElement = newEl as Element;
    if (oldElement.tagName === 'SCRIPT') {
      // Keep the live script node (#563): replacing it would re-execute the
      // island client entry and double every listener; a changed src is left
      // stale by design (parsed scripts never execute anyway).
      return;
    }
    if (oldElement.hasAttribute('data-open-preserve')) return;
    const isIsland = tags.indexOf(oldElement.tagName.toLowerCase()) !== -1;
    if (isIsland) {
      const newTemplate = shadowTemplate(newElement);
      if (
        (oldElement as HTMLElement).shadowRoot && newTemplate &&
        !hasProjectedLightContent(oldElement) && !hasProjectedLightContent(newElement) &&
        containsSlot((oldElement as HTMLElement).shadowRoot as ShadowRoot)
      ) {
        // A compiled app shell currently carries its route as <slot>
        // fallback inside the shell DSD. Once the browser consumes the DSD,
        // both hosts have empty light DOM, so the normal island-preservation
        // check cannot see a route/action response change. Morph the live
        // shadow tree from the incoming template while preserving the shell
        // host and its activation state.
        syncAttrs(oldElement, newElement);
        morphChildren(
          (oldElement as HTMLElement).shadowRoot as ShadowRoot,
          newTemplate.content,
        );
        return;
      }
      if (islandIntact(oldElement, newElement)) return;
      if ((oldElement as HTMLElement).shadowRoot) {
        // Hydrated island whose surface changed: replace (state resets by
        // design); the replacement is DSD-instantiated BEFORE the swap so the
        // upgrade hydrates the server's render, not a client-initial one
        // (#579); the WebKit upgrade repair runs after the swap (#604).
        const created: ShadowRoot[] = [];
        instantiateDsd(newElement, created);
        oldElement.replaceWith(newElement);
        repairShadowUpgrades(created);
        return;
      }
      // Unhydrated island: morph it like any other element below.
    }
    syncAttrs(oldElement, newElement);
    if (!isIsland) {
      // Page-level DSD: the element's real content is its shadow tree; the
      // incoming document carries it in the <template shadowrootmode> child.
      const newTemplate = shadowTemplate(newElement);
      if ((oldElement as HTMLElement).shadowRoot && newTemplate) {
        morphChildren((oldElement as HTMLElement).shadowRoot as ShadowRoot, newTemplate.content);
        // #937: a slot-based shell keeps its pages as light-DOM children
        // (e.g. <app-shell><page-x>...</page-x></app-shell>); the shadow morph
        // alone leaves slotted content stale, so descend into non-empty light
        // DOM too. An empty light DOM means the template was the whole story.
        if (oldElement.childNodes.length > 0) morphChildren(oldElement, newElement);
        return;
      }
    }
    morphChildren(oldElement, newElement);
  }

  function findDeep(root: ParentNode, selector: string): Element | null {
    // Region lookup that descends into shadowrootmode templates (#553): the
    // incoming document's regions live inside the page host's template.
    const direct = root.querySelector(selector);
    if (direct) return direct;
    const templates = root.querySelectorAll('template[shadowrootmode]');
    for (let i = 0; i < templates.length; i++) {
      const found = findDeep((templates[i] as HTMLTemplateElement).content, selector);
      if (found) return found;
    }
    return null;
  }

  function applyMorph(
    incoming: Document,
    form: HTMLFormElement | null,
    regionName: string | null,
  ): boolean {
    // ADR-0121 §8 (#553): the form scopes the morph — data-open-region-target
    // (submitter wins over the form), else its nearest ancestor region, else
    // the whole body. A scope missing on either side is a full navigation,
    // never a silent full morph.
    if (form) {
      let name = regionName || form.getAttribute('data-open-region-target');
      if (!name) {
        const host = form.closest('[data-open-region]');
        if (host) name = host.getAttribute('data-open-region');
      }
      if (name) {
        const selector = '[data-open-region="' +
          (win.CSS && win.CSS.escape ? win.CSS.escape(name) : name) + '"]';
        const root = (form.getRootNode ? form.getRootNode() : doc) as ParentNode;
        const oldScope = root.querySelector ? root.querySelector(selector) : null;
        const newScope = findDeep(incoming.body, selector);
        if (oldScope && newScope) {
          morphNode(oldScope, newScope);
          return true;
        }
        // #589: a scoped morph that cannot find its region is a navigation,
        // and it should say so (silent navigations were the round-2 DX finding).
        log.warn(
          'data-open-region "' + name + '" missing on one side; navigating instead of morphing',
        );
        return false;
      }
    }
    morphNode(doc.body, incoming.body);
    return true;
  }

  function morphDocument(
    html: string,
    form: HTMLFormElement | null,
    regionName: string | null,
  ): boolean {
    const incoming = new win.DOMParser().parseFromString(html, 'text/html');
    if (incoming.title) doc.title = incoming.title;
    // #603: a morph is not a navigation — focus and viewport must not jump.
    const focus = captureFocus();
    const scroll = captureScroll();
    const morphed = applyMorph(incoming, form, regionName);
    if (morphed) {
      restoreFocus(focus);
      restoreScroll(scroll);
    }
    return morphed;
  }

  return { morphDocument: morphDocument };
}
