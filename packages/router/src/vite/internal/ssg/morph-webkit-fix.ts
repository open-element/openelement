/**
 * morph-webkit-fix.ts - WebKit upgrade-repair and DSD-instantiation
 * workarounds for the morph client (ADR-0120/0121). Split from
 * enhance-client.ts (#908).
 *
 * ─── KNOWN-BROWSER-QUIRKS (anti-rot ledger; each entry names a removal
 * condition — delete the entry AND the workaround it documents when the
 * condition is met) ─────────────────────────────────────────────────────────
 * 1. DSD instantiation timing (#579): DSD is only instantiated by the HTML
 *    parser; DOMParser-parsed nodes keep an inert <template shadowrootmode>
 *    child, so instantiateDsd() must run before insertion.
 *    → Delete when all engines instantiate DSD for DOMParser-parsed trees.
 * 2. WebKit upgrade skip (#604): an element moved into a shadow root while
 *    its subtree still belonged to the parser-inert document is permanently
 *    skipped by WebKit's registry; repairShadowUpgrades() re-inserts it after
 *    adoption.
 *    → Delete when WebKit upgrades such elements on adoption.
 */

interface WebkitFixDeps {
  win: Window & typeof globalThis;
}

export interface MorphWebkitFix {
  instantiateDsd: (node: Node, created?: ShadowRoot[]) => void;
  repairShadowUpgrades: (roots: ShadowRoot[]) => void;
}

export function createMorphWebkitFix(deps: WebkitFixDeps): MorphWebkitFix {
  const win = deps.win;

  function instantiateDsd(node: Node, created?: ShadowRoot[]): void {
    // #579: DSD is only instantiated by the HTML parser; a DOMParser-parsed
    // node inserted into the live tree keeps an inert <template> child and
    // the island would render client-initial content instead of the server's.
    // Instantiate declarative shadow roots manually so upgrades hydrate the
    // server-rendered content. Called BEFORE insertion: upgrade reactions for
    // a defined custom element fire when the subtree is adopted into the
    // live document, and the hydration path must already find the
    // server-rendered shadow content.
    //
    // #604: recursion — a template nested inside another template's content
    // is invisible to querySelectorAll (template.content is a separate
    // tree), so each freshly attached shadow root is scanned again. Every
    // created root is collected for repairShadowUpgrades().
    if (node.nodeType !== 1 && node.nodeType !== 11) return;
    const templates = (node as ParentNode).querySelectorAll('template[shadowrootmode]');
    for (let i = 0; i < templates.length; i++) {
      const template = templates[i] as HTMLTemplateElement;
      const host = template.parentNode as HTMLElement | null;
      if (!host || host.shadowRoot) continue;
      const root = host.attachShadow({
        mode: template.getAttribute('shadowrootmode') as ShadowRootMode,
      });
      root.appendChild(template.content);
      template.remove();
      if (created) created.push(root);
      instantiateDsd(root, created);
    }
  }

  function repairShadowUpgrades(roots: ShadowRoot[]): void {
    // #604 (WebKit): an element moved into a shadow root while the subtree
    // still belonged to the parser-inert document is permanently skipped by
    // WebKit's registry — it stays a plain HTMLElement and even
    // customElements.upgrade() cannot reach it. Runs AFTER insertion:
    // re-inserting such an element inside the live tree triggers the
    // natural upgrade path. Chromium/Firefox upgraded eagerly on adoption
    // and are filtered out by the instanceof check.
    for (let i = 0; i < roots.length; i++) {
      const all = roots[i].querySelectorAll('*');
      for (let j = 0; j < all.length; j++) {
        const el = all[j];
        const ctor = el.localName.indexOf('-') !== -1
          ? win.customElements.get(el.localName)
          : undefined;
        if (ctor && !(el instanceof ctor)) {
          const parent = el.parentNode;
          if (!parent) continue;
          const next = el.nextSibling;
          el.remove();
          parent.insertBefore(el, next);
        }
      }
    }
  }

  return {
    instantiateDsd: instantiateDsd,
    repairShadowUpgrades: repairShadowUpgrades,
  };
}
