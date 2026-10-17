/**
 * WCAG 2.x colour maths for the site's browser specs.
 *
 * Scope: relative luminance and contrast ratio exactly as WCAG 2.x defines
 * them (https://www.w3.org/WAI/WCAG22/Understanding/relative-luminance.html),
 * over the colour forms a browser's `getComputedStyle` serialises.
 *
 * Why this module exists rather than living inside the spec: the maths is the
 * thing that decides a pass or a fail, so it is proven numerically — against
 * the published WCAG worked values and the canonical black/white and
 * same-colour anchors — in `www/__tests__/wcag-contrast.test.ts`. A spec that
 * carries its own unverified trigonometry cannot be reviewed.
 *
 * Every function here is deliberately import-free and self-contained: the
 * browser spec serialises them with `Function.prototype.toString` and runs the
 * result inside the page (see `MATRIX_HELPERS_SOURCE`). Reaching for a module
 * binding anywhere in this file would break that, so the helpers call each
 * other by name and the unit test proves the serialised copy is the same code.
 */

/** Non-linear (gamma-encoded) sRGB channels in 0..1, plus alpha in 0..1. */
export type Rgba = [number, number, number, number];

/**
 * One channel of sRGB → linear light. This is the step the shipped helper was
 * missing, and its absence is not a rounding difference: it moved
 * rgb(100,100,100) on black from 3.55:1 (below AA) to 8.84:1 (above it).
 */
export const linearizeChannel = (channel: number): number =>
  channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;

/** WCAG 2.x relative luminance of an opaque or composited sRGB colour. */
export const relativeLuminance = ([red, green, blue]: Rgba): number =>
  0.2126 * linearizeChannel(red) +
  0.7152 * linearizeChannel(green) +
  0.0722 * linearizeChannel(blue);

/** WCAG 2.x contrast ratio: (L1 + 0.05) / (L2 + 0.05), lighter first. */
export const contrastRatio = (a: Rgba, b: Rgba): number => {
  const first = relativeLuminance(a);
  const second = relativeLuminance(b);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
};

/**
 * Parse a computed colour value into sRGB + alpha, or `null` when the form is
 * not one this module can be trusted to read.
 *
 * `null` is a real answer, not a cue to guess: a silent fallback to black or
 * white is how a measurement turns into an assertion that passes for the wrong
 * reason. Callers surface the raw string instead.
 */
export const parseColor = (value: string): Rgba | null => {
  // One parser for every colour form the engines serialise computed values in
  // (rgb(), oklch(), oklab(), color(srgb …), the `none` keyword). A canvas
  // round-trip was tried first and dropped: its colour-space support differs
  // per engine, so the same pair measured 15:1 in one and 1.09:1 in another.
  const text = value.trim().replaceAll('none', '0');
  if (text === 'transparent' || text === 'rgba(0, 0, 0, 0)') return [0, 0, 0, 0];
  const alpha = (raw: string | undefined) =>
    raw === undefined ? 1 : raw.endsWith('%') ? Number(raw.slice(0, -1)) / 100 : Number(raw);
  const linearToSrgb = (channel: number) =>
    channel <= 0.0031308 ? channel * 12.92 : 1.055 * channel ** (1 / 2.4) - 0.055;
  const rgbMatch = /^rgba?\(([^)]+)\)$/.exec(text);
  if (rgbMatch) {
    const parts = rgbMatch[1]!.split(/[,\s/]+/).filter(Boolean);
    const scale = parts[0]?.endsWith('%') ? 2.55 : 1;
    const channel = (raw: string) => Math.min(255, Number.parseFloat(raw) * scale) / 255;
    return [
      channel(parts[0] ?? '0'),
      channel(parts[1] ?? '0'),
      channel(parts[2] ?? '0'),
      alpha(parts[3]),
    ];
  }
  const srgbMatch = /^color\(srgb ([^)]+)\)$/.exec(text);
  if (srgbMatch) {
    const parts = srgbMatch[1]!.split(/[\s/]+/).filter(Boolean);
    return [Number(parts[0]), Number(parts[1]), Number(parts[2]), alpha(parts[3])];
  }
  const oklabMatch = /^oklab\(([^)]+)\)$/.exec(text);
  const oklchMatch = /^oklch\(([^)]+)\)$/.exec(text);
  if (oklabMatch || oklchMatch) {
    const parts = (oklabMatch ?? oklchMatch)![1]!.split(/[\s/]+/).filter(Boolean);
    const lightness = Number.parseFloat(parts[0] ?? '0');
    let a = 0;
    let b = 0;
    if (oklabMatch) {
      a = Number.parseFloat(parts[1] ?? '0');
      b = Number.parseFloat(parts[2] ?? '0');
    } else {
      const chroma = Number.parseFloat(parts[1] ?? '0');
      const hue = (Number.parseFloat(parts[2] ?? '0') * Math.PI) / 180;
      a = chroma * Math.cos(hue);
      b = chroma * Math.sin(hue);
    }
    const l = lightness + 0.3963377774 * a + 0.2158037573 * b;
    const m = lightness - 0.1055613458 * a - 0.0638541728 * b;
    const s = lightness - 0.0894841775 * a - 1.291485548 * b;
    const l3 = l ** 3;
    const m3 = m ** 3;
    const s3 = s ** 3;
    const clamp = (channel: number) => Math.min(1, Math.max(0, linearToSrgb(channel)));
    return [
      clamp(4.0767416621 * l3 - 3.3077115913 * m3 + 0.2309699292 * s3),
      clamp(-1.2684380046 * l3 + 2.6097574011 * m3 - 0.3413193965 * s3),
      clamp(-0.0041960863 * l3 - 0.7034186147 * m3 + 1.707614701 * s3),
      alpha(parts[3]),
    ];
  }
  return null;
};

/**
 * Source-over compositing in gamma-encoded sRGB, which is what the engines do
 * by default (the compositor blends in sRGB unless the page opts into a linear
 * space). Doing it in linear light here would disagree with the screen.
 */
export const compositeOver = (front: Rgba, back: Rgba): Rgba => {
  const a = front[3] + back[3] * (1 - front[3]);
  if (a === 0) return [0, 0, 0, 0];
  const channel = (index: number) =>
    (front[index]! * front[3] + back[index]! * back[3] * (1 - front[3])) / a;
  return [channel(0), channel(1), channel(2), a];
};

/** What a measurement says, and what it could not say. */
export type ContrastMeasurement = {
  /** WCAG contrast ratio, or `NaN` when a colour could not be read. */
  ratio: number;
  /**
   * Did the walk find a surface the page itself paints opaquely? `false` means
   * the page painted nothing opaque behind the ink and the user agent's
   * default canvas was assumed — which is white on most engines, but is the
   * user's choice, so a row that needs a certain surface must assert this.
   */
  opaque: boolean;
  /** Computed colour strings this module declined to interpret. */
  unresolved: string[];
};

/**
 * Contrast of an element's own colour over the surface it is painted on, plus
 * the two caveats an honest number needs to carry: whether the backdrop was a
 * surface the page actually paints, and which colours were not understood.
 */
export const measuredContrast = (element: Element): ContrastMeasurement => {
  const unresolved: string[] = [];
  const read = (node: Element, property: 'color' | 'backgroundColor'): Rgba | null => {
    const raw = getComputedStyle(node)[property];
    const parsed = parseColor(raw);
    if (parsed === null) unresolved.push(`${node.tagName.toLowerCase()}.${property}: ${raw}`);
    return parsed;
  };
  // The walk crosses shadow boundaries: a component's control has no
  // `parentElement` above its shadow root, and stopping there assumes an
  // unpainted white page behind a surface the host itself paints.
  const parentOf = (node: Element): Element | null => {
    if (node.parentElement) return node.parentElement;
    const root = node.getRootNode();
    return root instanceof ShadowRoot ? root.host : null;
  };
  /**
   * `Element.closest` stops at a shadow root, so it cannot see the host a
   * component's control lives under — a lookup written with it returns null
   * for every control inside a shadow tree, however the selector is spelled.
   * This walks the shadow-including ancestry, which is what "the nearest
   * enclosing X" means to a user looking at the rendered page.
   */
  const closestAcrossShadow = (start: Element, selector: string): Element | null => {
    let node: Element | null = start;
    while (node) {
      if (node.matches(selector)) return node;
      node = parentOf(node);
    }
    return null;
  };
  /**
   * The surface painted BEHIND `start` — the walk begins at its parent, because
   * a caller that composites `start`'s own background on top of this result
   * would otherwise count that background twice and darken the surface it is
   * measured against.
   */
  const backdrop = (start: Element): { rgba: Rgba; painted: boolean } => {
    const stack: Rgba[] = [];
    let node: Element | null = parentOf(start);
    while (node) {
      const rgba = read(node, 'backgroundColor');
      if (rgba && rgba[3] > 0) {
        stack.push(rgba);
        if (rgba[3] >= 1) break;
      }
      node = parentOf(node);
    }
    const opaqueTop = stack.at(-1);
    const painted = opaqueTop !== undefined && opaqueTop[3] >= 1;
    // Nothing the page paints is opaque, so what is behind the ink is the
    // canvas the user agent draws — the one assumption this walk makes.
    if (!painted) stack.push([1, 1, 1, 1]);
    let layer: Rgba = stack.pop()!;
    for (const rgba of stack.reverse()) layer = compositeOver(rgba, layer);
    return { rgba: layer, painted };
  };

  const front = read(element, 'color');
  const own = read(element, 'backgroundColor') ?? [0, 0, 0, 0];
  // An absolutely positioned control is painted over a SIBLING surface, not
  // over its ancestors: the code block's copy button sits on the `<pre>` its
  // component positions it against, and the site slots that `<pre>` as light
  // DOM into the block. When such a surface exists and is opaque, its own
  // background is the base — a walk from the control would read the page paper
  // behind the block instead, which in the dark theme is white ink on the
  // white page (1.09:1) against a label that is really on the dark code
  // surface (17:1). The lookup has to cross the shadow root, or it finds
  // nothing and this case silently stops applying.
  const owner = closestAcrossShadow(element, 'open-code-block');
  const painted = owner?.querySelector('pre');
  const paintedBase = painted ? read(painted, 'backgroundColor') : null;
  let base: Rgba;
  let opaque: boolean;
  if (paintedBase && paintedBase[3] >= 1) {
    base = paintedBase;
    opaque = true;
  } else if (painted) {
    const behind = backdrop(painted);
    base = compositeOver(paintedBase ?? [0, 0, 0, 0], behind.rgba);
    opaque = behind.painted;
  } else {
    const behind = backdrop(element);
    base = behind.rgba;
    opaque = behind.painted;
  }
  const composited = compositeOver(own, base);
  if (front === null) return { ratio: Number.NaN, opaque, unresolved };
  return { ratio: contrastRatio(front, composited), opaque, unresolved };
};

/**
 * The page-side bundle: one expression that evaluates to the helpers above.
 *
 * The spec runs it inside the browser with `eval`, because `page.evaluate`
 * cannot carry a closure across the process boundary. Building it from the
 * very functions the unit test proves keeps the measured maths and the
 * reviewed maths the same code rather than two copies that drift — and the
 * unit test evaluates this same string, so a bundle that does not parse or
 * does not bind its names fails there rather than silently mis-measuring in
 * one engine.
 *
 * Two things the construction has to get right:
 *   - Each source is bound to its own name. A function's `toString` is the
 *     bare `(…) => …` with no declaration around it, so the helpers' calls to
 *     each other would otherwise be unbound references.
 *   - The statements are `;`-terminated. A function's source carries no
 *     trailing semicolon, so two bodies joined by a newline alone make the
 *     second one an argument list for the first.
 */
export const MATRIX_HELPERS_SOURCE: string = (() => {
  const helpers: [string, unknown][] = [
    ['linearizeChannel', linearizeChannel],
    ['relativeLuminance', relativeLuminance],
    ['contrastRatio', contrastRatio],
    ['parseColor', parseColor],
    ['compositeOver', compositeOver],
    ['measuredContrast', measuredContrast],
  ];
  const declarations = helpers
    .map(([name, fn]) => `const ${name} = ${(fn as () => unknown).toString()};`)
    .join('\n');
  const exports = helpers.map(([name]) => name).join(', ');
  return `(() => {\n${declarations}\nreturn { ${exports} };\n})()`;
})();
