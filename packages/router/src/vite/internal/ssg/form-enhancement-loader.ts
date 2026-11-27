import type { EnhanceClient, EnhanceClientDeps } from './enhance-client.ts';
import { installEnhancedHistoryReload } from './enhanced-history.ts';

const ENHANCE_ATTRIBUTE = 'data-open-enhance';
const ENHANCED_FORM_SELECTOR = `form[${ENHANCE_ATTRIBUTE}]`;

/** Keep the document's declared HTML submission until enhancement is ready. */
export function observeFormEnhancement(deps: EnhanceClientDeps): () => void {
  const { doc, log, win } = deps;
  installEnhancedHistoryReload(win);

  let requested = false;
  let enhance: EnhanceClient | undefined;
  const observedRoots = new WeakSet<Document | ShadowRoot>();
  const observer = new win.MutationObserver((records) => {
    if (requested) return;
    for (const record of records) {
      if (
        record.type === 'attributes' &&
        record.target.isConnected &&
        isMarkedForm(record.target)
      ) {
        load();
        return;
      }
      for (const node of record.addedNodes) {
        if (node instanceof win.Element && node.isConnected && containsMarkedForm(node)) {
          load();
          return;
        }
      }
    }
  });

  function isMarkedForm(node: Node): boolean {
    return node instanceof win.HTMLFormElement && node.hasAttribute(ENHANCE_ATTRIBUTE);
  }

  function containsMarkedForm(scope: ParentNode): boolean {
    if (scope instanceof win.Element) {
      if (isMarkedForm(scope)) return true;
      if (scope.shadowRoot && observeRoot(scope.shadowRoot)) return true;
    }
    for (const form of scope.querySelectorAll(ENHANCED_FORM_SELECTOR)) {
      if (form instanceof win.HTMLFormElement) return true;
    }
    for (const host of scope.querySelectorAll('*')) {
      if (host.shadowRoot && observeRoot(host.shadowRoot)) return true;
    }
    return false;
  }

  function observeRoot(root: Document | ShadowRoot): boolean {
    if (!observedRoots.has(root)) {
      observer.observe(root, {
        subtree: true,
        childList: true,
        attributes: true,
        attributeFilter: [ENHANCE_ATTRIBUTE],
      });
      observedRoots.add(root);
    }
    return containsMarkedForm(root);
  }

  function load(): void {
    requested = true;
    observer.disconnect();
    void import('./enhance-client.ts')
      .then(({ createEnhanceClient }) => {
        enhance = createEnhanceClient(deps);
        enhance.repairUpgrades(doc);
      })
      .catch((error: unknown) => log.warn('Form enhancement could not load', error));
  }

  function onIslandLoaded(): void {
    if (enhance) {
      // Morphing can insert a host before its definition lands (#604).
      enhance.repairUpgrades(doc);
      enhance.scanSubmitRoots(doc);
    } else if (!requested && observeRoot(doc)) {
      load();
    }
  }

  onIslandLoaded();
  return onIslandLoaded;
}
