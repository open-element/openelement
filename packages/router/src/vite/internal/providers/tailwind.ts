/**
 * The Tailwind style provider — the framework's default engine, and the thin
 * adapter the port was extracted against.
 *
 * It owns nothing of its own: the document sheet is the existing virtual CSS
 * entry compiled by the official `@tailwindcss/vite` plugin inside the Vite
 * graph, the component sheet is the official compiler's own `build(candidates)`
 * (see `../tailwind.ts`), and the delivery of both is the framework's existing
 * asset protocol. This module exists so the build selects an engine through
 * one shape instead of branching on a name in five places.
 */

import {
  COMPONENT_SHEET_SPECIFIER,
  compileComponentStyleSheet,
  tailwindEntryPath,
} from '../../tailwind.ts';
import type { StyleProvider } from '../style-provider.ts';
import type { ResolvedStyleSelection } from '../style-plan.ts';

/**
 * The Tailwind adapter for one build. Constructing it loads nothing: the peer
 * resolves lazily on the first compile, exactly as it always has, so a
 * Tailwind-enabled build with no admitted candidate pays no peer load.
 */
export function createTailwindProvider(root: string, plan: ResolvedStyleSelection): StyleProvider {
  return {
    id: 'tailwind',
    dialects: ['tailwind4'],
    documentDelivery: 'graph-entry',
    componentSheetSpecifier: COMPONENT_SHEET_SPECIFIER,
    documentSheetModule: tailwindEntryPath(root),
    watchFiles: [],
    async compileComponents({ candidates }) {
      if (candidates.length === 0) return '';
      return await compileComponentStyleSheet(root, plan, candidates);
    },
  };
}
