/**
 * Shared helpers for the ui-dogfood e2e specs.
 *
 * Page shells are shadow-open DSD elements, so every ui component sits inside
 * the page's shadow root: plain document.querySelector cannot reach them from
 * page.evaluate. The walker functions come from tools/lib/shadow-walker.ts
 * (single-sourced with the www e2e suite) and serialize into page context.
 */
import {
  deepQueryAllInPage,
  deepQueryFirstInPage,
} from '../../../tools/lib/shadow-walker.ts';

/** Raw source of the shadow-piercing first-match walker, for embedding. */
export const deepQueryFirstFn = deepQueryFirstInPage.toString();

/** Playwright expression: first match for selector, piercing open shadow roots. */
export function deepFirstExpr(selector: string): string {
  return `(${deepQueryFirstFn})(document, ${JSON.stringify(selector)})`;
}

/** Playwright expression: all matches for selector, piercing open shadow roots. */
export function deepAllExpr(selector: string): string {
  return `(${deepQueryAllInPage.toString()})(document, ${JSON.stringify(selector)})`;
}
