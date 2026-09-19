/**
 * Unified line-art diagram system for the www site (home scenes + the
 * architecture overview).
 *
 * Voice contract — every diagram obeys it, so the set reads as one family:
 * - inline SVG, strokes only (`fill="none" stroke="currentColor"`), round
 *   caps; the figure's CSS `color` sets the ink (adapts to light/dark).
 * - exactly ONE accent: a `<g style="color:var(--brand)">` group. No other
 *   color may appear (currentColor inheritance keeps the CSS at zero).
 * - NO text: no `<text>`, no letters-as-paths. Diagrams stay locale-free —
 *   the same markup ships in en and zh.
 * - static: no SMIL, no CSS animation hooks. Reduced-motion safe by
 *   construction; do not add these classes to scroll-timeline selectors.
 * - each diagram stays well under 4KB (they are ~0.6KB).
 *
 * Home consumes these through route props (like strategies/outputs); the
 * architecture overview inlines the same architecture markup in
 * content/docs/architecture/architecture{,.zh}.md (locale-free, identical).
 */

const open =
  '<svg viewBox="0 0 144 88" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">';
const accentOpen = '<g style="color:var(--brand)">';
const close = '</g></svg>';

const dot = (cx: number, cy: number): string =>
  `<circle cx="${cx}" cy="${cy}" r="3.5" fill="currentColor" stroke="none"/>`;

/** §1 Element — the component contract: one tag, three signals out. */
export const diagramElement: string =
  `${open}<rect x="14" y="18" width="66" height="52" rx="10"/><path d="M34 36l-9 8 9 8"/><path d="M52 36l9 8-9 8"/>${accentOpen}${
    dot(100, 30)
  }${dot(112, 44)}${dot(100, 58)}${close}`;

/** §2 DSD — server HTML across the wire to browser upgrade. */
export const diagramDsd: string =
  `${open}<rect x="8" y="24" width="40" height="40" rx="8"/><rect x="96" y="24" width="40" height="40" rx="8"/>${accentOpen}<path d="M54 44h34"/><path d="M80 36l9 8-9 8"/>${close}`;

/** §3 Islands — a static page with two interactive regions awake. */
export const diagramIslands: string =
  `${open}<rect x="8" y="12" width="128" height="64" rx="10" stroke-dasharray="6 6"/>${accentOpen}<rect x="24" y="28" width="34" height="20" rx="5"/>${
    dot(112, 38)
  }<rect x="78" y="52" width="42" height="12" rx="6"/>${close}`;

/** §4 Output — layered build collapsing to one deployable line. */
export const diagramOutput: string =
  `${open}<rect x="30" y="10" width="84" height="16" rx="8"/><rect x="22" y="32" width="84" height="16" rx="8"/><rect x="38" y="54" width="84" height="16" rx="8"/>${accentOpen}<path d="M14 10v60"/><path d="M8 62l6 8 6-8"/>${close}`;

/** Architecture overview — one hub contract, three consumer surfaces. */
export const diagramArchitecture: string =
  `${open}<circle cx="22" cy="20" r="9"/><circle cx="122" cy="20" r="9"/><circle cx="72" cy="74" r="9"/><path d="M31 26l29 9"/><path d="M113 26l-29 9"/><path d="M72 52v13"/>${accentOpen}<circle cx="72" cy="40" r="12"/>${
    dot(72, 40)
  }${close}`;
