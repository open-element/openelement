/**
 * Browser-context shadow-DOM walker, single-sourced for both the www e2e
 * helpers (www/e2e/helpers.ts) and repo smoke tooling (tools/visual-smoke.ts).
 *
 * Consumers serialize these functions with Function.prototype.toString() and
 * run them inside the page via Playwright string evaluation, so they must
 * stay fully self-contained: no imports, no closure references, no helpers.
 */

/**
 * First element matching `selector`, depth-first in document order, piercing
 * open shadow roots. Returns null when nothing matches.
 */
export function deepQueryFirstInPage(
  root: Document | ShadowRoot,
  selector: string,
): Element | null {
  const visit = (node: Document | ShadowRoot): Element | null => {
    const direct = node.querySelector(selector);
    if (direct) return direct;
    const all = node.querySelectorAll('*');
    for (const el of Array.from(all)) {
      if (el.shadowRoot) {
        const found = visit(el.shadowRoot);
        if (found) return found;
      }
    }
    return null;
  };
  return visit(root);
}

/**
 * All elements matching `selector`, in document order, piercing open shadow
 * roots (a shadow root's content is visited in place of its host).
 */
export function deepQueryAllInPage(
  root: Document | ShadowRoot,
  selector: string,
): Element[] {
  const matches: Element[] = [];
  const visit = (node: Document | ShadowRoot): void => {
    const all = node.querySelectorAll('*');
    for (const el of Array.from(all)) {
      if (el.matches(selector)) matches.push(el);
      if (el.shadowRoot) visit(el.shadowRoot);
    }
  };
  visit(root);
  return matches;
}
