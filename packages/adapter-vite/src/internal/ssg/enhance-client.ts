/**
 * enhance-client.ts - data-open-enhance browser runtime (ADR-0120/0121).
 *
 * Single source of truth for the form-enhancement and morph client (#610):
 * the generated client entry imports this module through the
 * virtual:open-client-runtime specifier (resolved by build-client.ts) and the
 * bundler wires it in — there is no string copy to drift, and the logic
 * carries normal unit tests (__tests__/enhance-client.test.ts). The module
 * stays import-free and touches browser globals only through the injected
 * deps, so it bundles into any consumer build unchanged.
 *
 * Forms marked data-open-enhance submit via fetch and the returned document
 * is morphed into the live tree — INSIDE the page element's shadow root,
 * which is where page content lives under DSD. Two structural facts drive
 * this implementation:
 *   1. The submit event is not composed in every engine, so a document-level
 *      listener never sees forms inside page DSD — listeners attach to every
 *      shadow root instead (a composed submit still reaches the root listener
 *      first; the document listener only handles light-DOM forms).
 *   2. The page's real content is the page host's shadow tree; the incoming
 *      document carries it in the host's <template shadowrootmode> child, so
 *      the morph descends into shadow roots and treats DSD templates as the
 *      incoming shadow content.
 * Without JavaScript the same form is a native POST (303/422 HTML), so
 * behavior degrades to the browser by construction.
 *
 * The wire/attribute surface is enforced by the adjacent browser and unit tests.
 *
 * The implementation is split by concern (#908): tree alignment and morph
 * orchestration live in morph-align.ts, the WebKit/DSD workarounds in
 * morph-webkit-fix.ts, focus/scroll continuity in morph-focus-restore.ts and
 * morph-scroll-restore.ts, island preservation in island-lifecycle.ts, and
 * submit interception in form-enhance.ts. This module only composes them.
 */

import { createFormEnhance } from './form-enhance.ts';
import { createIslandLifecycle } from './island-lifecycle.ts';
import { createMorphAlign } from './morph-align.ts';
import { createMorphFocusRestore } from './morph-focus-restore.ts';
import { createMorphScrollRestore } from './morph-scroll-restore.ts';
import { createMorphWebkitFix } from './morph-webkit-fix.ts';

/** Minimal logger surface shared with the generated client entry. */
interface EnhanceLogger {
  warn: (...args: unknown[]) => void;
}

interface EnhanceClientDeps {
  log: EnhanceLogger;
  /** Island tag names (lowercase) — survival checks treat them specially. */
  tags: readonly string[];
  /** Header marking an enhanced submit (ACTION_FETCH_HEADER). */
  actionHeader: string;
  win: Window & typeof globalThis;
  doc: Document;
  /**
   * Island scheduler hook: re-observe client:visible islands after a morph
   * (a replaced island is a new element and gets a fresh observer, #562).
   */
  observeVisible: () => void;
}

interface EnhanceClient {
  /**
   * Attach the submit interceptor to every current shadow root. Idempotent;
   * runs at ready time, after every morph (new hosts may appear), and after
   * late island hydration via the scheduler's onIslandLoaded hook (#584).
   */
  scanSubmitRoots: (root: Document | ShadowRoot) => void;
}

export function createEnhanceClient(deps: EnhanceClientDeps): EnhanceClient {
  const webkit = createMorphWebkitFix({ win: deps.win });
  const islands = createIslandLifecycle({ observeVisible: deps.observeVisible });
  const focus = createMorphFocusRestore({ doc: deps.doc });
  const scroll = createMorphScrollRestore({ win: deps.win });
  const align = createMorphAlign({
    log: deps.log,
    win: deps.win,
    doc: deps.doc,
    tags: deps.tags,
    webkit: webkit,
    islands: islands,
    focus: focus,
    scroll: scroll,
  });
  const form = createFormEnhance({
    log: deps.log,
    win: deps.win,
    doc: deps.doc,
    actionHeader: deps.actionHeader,
    morph: align,
    islands: islands,
  });
  return { scanSubmitRoots: form.scanSubmitRoots };
}
