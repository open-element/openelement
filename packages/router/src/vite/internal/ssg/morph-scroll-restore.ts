/**
 * morph-scroll-restore.ts - viewport continuity for the morph client
 * (#603): a morph is not a navigation, so the scroll position must not jump.
 * Split from enhance-client.ts (#908).
 */

interface ScrollRestoreDeps {
  win: Window & typeof globalThis;
}

interface ScrollPosition {
  x: number;
  y: number;
}

export interface MorphScrollRestore {
  captureScroll: () => ScrollPosition;
  restoreScroll: (pos: ScrollPosition) => void;
}

export function createMorphScrollRestore(deps: ScrollRestoreDeps): MorphScrollRestore {
  function captureScroll(): ScrollPosition {
    return { x: deps.win.pageXOffset, y: deps.win.pageYOffset };
  }

  function restoreScroll(pos: ScrollPosition): void {
    deps.win.scrollTo(pos.x, pos.y);
  }

  return {
    captureScroll: captureScroll,
    restoreScroll: restoreScroll,
  };
}
