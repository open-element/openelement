/**
 * The hero cursor's runtime-injected light-scope sheet (open-hero-polish).
 * The cursor tracks across the hero in the light parent scope, so this
 * sheet cannot be a component's static styles (those scope to the shadow
 * root); it is a JS runtime payload injected with a <style> element at
 * hydration — not a static-styles channel (#1558 keeps static styles as
 * .css file imports; this constant is runtime data like any other string).
 */
export const HERO_CURSOR_CSS = `
  .hero-main, .hero-main * { cursor: none !important; }
  .hero-cursor { position: fixed; inset: 0 auto auto 0; z-index: 60; pointer-events: none; opacity: 0; transition: opacity .25s ease; }
  .hero-cursor.on { opacity: 1; }
  .hero-cursor i { position: fixed; top: 0; left: 0; border-radius: 50%; pointer-events: none; }
  .hero-cursor .dot { width: 6px; height: 6px; background: var(--hero-gold); transform: translate3d(var(--dx, -100px), var(--dy, -100px), 0) translate(-50%, -50%); }
  .hero-cursor .ring { width: 34px; height: 34px; border: 1px solid rgba(227, 207, 159, .55); transform: translate3d(var(--rx, -100px), var(--ry, -100px), 0) translate(-50%, -50%) scale(var(--ring, 1)); transition: border-color .3s ease; }
  .hero-cursor.hover .ring { --ring: 1.7; border-color: rgba(227, 207, 159, .95); }
`;
