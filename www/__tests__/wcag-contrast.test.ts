/**
 * The colour maths the browser matrix spec decides pass/fail with.
 *
 * These are independent numeric proofs, not a restatement of the
 * implementation: the expected values come from WCAG 2.x's own definitions
 * and from published ratios, and the black/white and same-colour cases are the
 * anchors that pin the scale. `MATRIX_HELPERS_SOURCE` is evaluated here as
 * well, so the copy that runs inside the page is proven to be this code.
 */
import { describe, expect, it } from 'vitest';
import {
  contrastRatio,
  linearizeChannel,
  MATRIX_HELPERS_SOURCE,
  measuredContrast,
  parseColor,
  relativeLuminance,
  type Rgba,
} from '../e2e/wcag-contrast.ts';

const fromBytes = (red: number, green: number, blue: number, alpha = 1): Rgba => [
  red / 255,
  green / 255,
  blue / 255,
  alpha,
];

describe('WCAG 2.x relative luminance', () => {
  it('pins the ends of the scale', () => {
    expect(relativeLuminance([0, 0, 0, 1])).toBe(0);
    expect(relativeLuminance([1, 1, 1, 1])).toBeCloseTo(1, 12);
  });

  it('linearizes before weighting, and the difference is not a rounding one', () => {
    // The shipped helper weighted the gamma-encoded channels directly, which
    // reads grey 100 as 0.392157 instead of 0.127438 — a factor of three.
    const grey = fromBytes(100, 100, 100);
    expect(relativeLuminance(grey)).toBeCloseTo(0.1274377, 7);
    expect(relativeLuminance(grey)).not.toBeCloseTo(grey[0], 3);
  });

  it('follows the sRGB transfer function on both of its branches', () => {
    // Below the 0.04045 knee the curve is linear; above it, a 2.4 power.
    expect(linearizeChannel(0.04)).toBeCloseTo(0.04 / 12.92, 12);
    expect(linearizeChannel(0.5)).toBeCloseTo(0.214041, 6);
    expect(linearizeChannel(1)).toBeCloseTo(1, 12);
  });

  it('uses the WCAG channel weights', () => {
    expect(relativeLuminance([1, 0, 0, 1])).toBeCloseTo(0.2126, 12);
    expect(relativeLuminance([0, 1, 0, 1])).toBeCloseTo(0.7152, 12);
    expect(relativeLuminance([0, 0, 1, 1])).toBeCloseTo(0.0722, 12);
  });
});

describe('WCAG 2.x contrast ratio', () => {
  it('is 21:1 for black against white, in either order', () => {
    expect(contrastRatio([0, 0, 0, 1], [1, 1, 1, 1])).toBeCloseTo(21, 9);
    expect(contrastRatio([1, 1, 1, 1], [0, 0, 0, 1])).toBeCloseTo(21, 9);
  });

  it('is 1:1 for a colour against itself', () => {
    expect(contrastRatio(fromBytes(80, 80, 80), fromBytes(80, 80, 80))).toBeCloseTo(1, 12);
    expect(contrastRatio([0, 0, 0, 1], [0, 0, 0, 1])).toBeCloseTo(1, 12);
  });

  it('reproduces the two pairs the audit measured as wrong', () => {
    // Both directions of the error: this pair was PASSED while it fails AA …
    expect(contrastRatio(fromBytes(100, 100, 100), [0, 0, 0, 1])).toBeCloseTo(3.548754, 6);
    // … and this pair was FAILED while it clears AA.
    expect(contrastRatio(fromBytes(118, 118, 118), [1, 1, 1, 1])).toBeCloseTo(4.542225, 6);
  });

  it('agrees with published ratios for known greys', () => {
    // #767676 (118) is the lightest grey that clears 4.5:1 on white, which is
    // why it is the value the WCAG guidance and browser devtools quote; its
    // neighbour #777777 (119) is the documented near-miss at 4.48:1. Together
    // they pin the boundary from both sides.
    expect(contrastRatio(fromBytes(119, 119, 119), [1, 1, 1, 1])).toBeCloseTo(4.478089, 6);
    expect(contrastRatio(fromBytes(118, 118, 118), [1, 1, 1, 1])).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(fromBytes(119, 119, 119), [1, 1, 1, 1])).toBeLessThan(4.5);
    // #949494 (148) on white is the 3:1 large-text boundary, approaching it
    // from above: 149 drops under.
    expect(contrastRatio(fromBytes(148, 148, 148), [1, 1, 1, 1])).toBeCloseTo(3.03347, 5);
    expect(contrastRatio(fromBytes(149, 149, 149), [1, 1, 1, 1])).toBeLessThan(3);
  });

  it('is symmetric and bounded to [1, 21]', () => {
    const pairs: [Rgba, Rgba][] = [
      [fromBytes(12, 34, 56), fromBytes(200, 210, 220)],
      [fromBytes(255, 0, 128), fromBytes(0, 255, 0)],
      [fromBytes(3, 3, 3), fromBytes(252, 252, 252)],
    ];
    for (const [a, b] of pairs) {
      expect(contrastRatio(a, b)).toBeCloseTo(contrastRatio(b, a), 12);
      expect(contrastRatio(a, b)).toBeGreaterThanOrEqual(1);
      expect(contrastRatio(a, b)).toBeLessThanOrEqual(21);
    }
  });
});

describe('computed value parsing', () => {
  it('reads the rgb() and rgba() forms the engines serialise', () => {
    expect(parseColor('rgb(100, 100, 100)')).toEqual([100 / 255, 100 / 255, 100 / 255, 1]);
    expect(parseColor('rgba(1, 2, 3, 0.5)')).toEqual([1 / 255, 2 / 255, 3 / 255, 0.5]);
    const percent = parseColor('rgb(50% 25% 0%)')!;
    expect(percent[0]).toBeCloseTo(0.5, 12);
    expect(percent[1]).toBeCloseTo(0.25, 12);
    expect(percent[2]).toBe(0);
    expect(percent[3]).toBe(1);
  });

  it('reads oklch() and color(srgb …) onto the same sRGB scale', () => {
    // oklch(0.5 0 0): achromatic, so it must land on equal channels.
    const [red, green, blue] = parseColor('oklch(0.5 0 0)')!;
    expect(red).toBeCloseTo(green, 12);
    expect(green).toBeCloseTo(blue, 12);
    // White and black are fixed points of the oklab round trip.
    expect(parseColor('oklch(1 0 0)')![0]).toBeCloseTo(1, 6);
    expect(parseColor('oklch(0 0 0)')![0]).toBeCloseTo(0, 6);
    expect(parseColor('color(srgb 0.2 0.4 0.6)')).toEqual([0.2, 0.4, 0.6, 1]);
  });

  it('reads oklab() as its own form, not as oklch()', () => {
    // oklch(L C H) is polar and oklab(L a b) is rectangular, so the same three
    // numbers are different colours: oklch(0.5 0.1 90) is the same colour as
    // oklab(0.5 0 0.1), and neither is oklab(0.5 0.1 0). Reading hue as a
    // rectangular axis (or the reverse) would make the first two disagree.
    const polar = parseColor('oklch(0.5 0.1 90)')!;
    const rectangular = parseColor('oklab(0.5 0 0.1)')!;
    const other = parseColor('oklab(0.5 0.1 0)')!;
    for (let index = 0; index < 3; index += 1) {
      expect(polar[index]).toBeCloseTo(rectangular[index]!, 6);
      expect(Math.abs(polar[index]! - other[index]!)).toBeGreaterThan(0.05);
    }
    // And the achromatic members of both forms coincide.
    expect(parseColor('oklch(0.5 0 0)')).toEqual(parseColor('oklab(0.5 0 0)'));
  });

  it('returns null for forms it will not read, rather than guessing black or white', () => {
    for (const value of [
      '',
      'inherit',
      'currentcolor',
      'lab(50% 40 59.5)',
      'color(display-p3 1 0 0)',
    ]) {
      expect(parseColor(value), value).toBeNull();
    }
  });

  it('treats fully transparent and the transparent keyword as zero alpha', () => {
    expect(parseColor('transparent')).toEqual([0, 0, 0, 0]);
    expect(parseColor('rgba(0, 0, 0, 0)')).toEqual([0, 0, 0, 0]);
  });
});

describe('the page-side bundle is this code', () => {
  /** Evaluate `MATRIX_HELPERS_SOURCE` the way the spec does, in this process. */
  const pageSide = eval(MATRIX_HELPERS_SOURCE) as {
    linearizeChannel: typeof linearizeChannel;
    relativeLuminance: typeof relativeLuminance;
    contrastRatio: typeof contrastRatio;
    parseColor: typeof parseColor;
    compositeOver: typeof compositeOver;
    measuredContrast: typeof measuredContrast;
  };

  it('exposes every helper the spec calls', () => {
    for (const name of [
      'linearizeChannel',
      'relativeLuminance',
      'contrastRatio',
      'parseColor',
      'compositeOver',
      'measuredContrast',
    ]) {
      expect(typeof pageSide[name as keyof typeof pageSide], name).toBe('function');
    }
  });

  it('computes the same numbers as the reviewed module', () => {
    const cases: [Rgba, Rgba][] = [
      [fromBytes(100, 100, 100), [0, 0, 0, 1]],
      [fromBytes(118, 118, 118), [1, 1, 1, 1]],
      [
        [1, 1, 1, 1],
        [0, 0, 0, 1],
      ],
      [fromBytes(119, 119, 119), [1, 1, 1, 1]],
    ];
    for (const [a, b] of cases) {
      expect(pageSide.contrastRatio(a, b)).toBe(contrastRatio(a, b));
      expect(pageSide.relativeLuminance(a)).toBe(relativeLuminance(a));
    }
    expect(pageSide.parseColor('oklch(0.5 0 0)')).toEqual(parseColor('oklch(0.5 0 0)'));
    expect(pageSide.compositeOver(fromBytes(0, 0, 0, 0.5), [1, 1, 1, 1])).toEqual([
      0.5, 0.5, 0.5, 1,
    ]);
  });

  it('closes over no module binding', () => {
    // If the bundle referenced an import, evaluating it above would have
    // thrown a ReferenceError; this asserts the shape that makes it work.
    expect(MATRIX_HELPERS_SOURCE).not.toMatch(/\bimport\b/);
    expect(MATRIX_HELPERS_SOURCE).toContain('const measuredContrast =');
  });
});

describe('measuredContrast refuses to guess', () => {
  /**
   * A minimal stand-in for the DOM calls the walk makes: computed styles keyed
   * by node name (`name` for `color`, `name:bg` for `backgroundColor`), and a
   * real parent chain from the measured element up to the canvas.
   *
   * `ShadowRoot` does not exist in this process, and the walk's `instanceof`
   * check needs it to be a constructor, so the stub provides one: nothing here
   * is a shadow root, which is what the `nodeType` of the returned root says.
   */
  const stub = (colors: Record<string, string>, chain: string[]) => {
    (globalThis as { ShadowRoot?: unknown }).ShadowRoot = class ShadowRoot {};
    const nodes = chain.map((name) => ({
      key: name,
      tagName: name.toUpperCase(),
      parentElement: null as object | null,
      // Nothing in these chains is a code block, so the sibling-surface lookup
      // finds no host and the walk stays ancestor-only.
      matches: () => false,
      getRootNode: () => ({ nodeType: 9 }),
      closest: () => null,
    }));
    for (let index = 0; index < nodes.length - 1; index += 1) {
      nodes[index]!.parentElement = nodes[index + 1]!;
    }
    (globalThis as { getComputedStyle?: unknown }).getComputedStyle = (target: object) => ({
      color: colors[(target as { key: string }).key] ?? 'rgb(0, 0, 0)',
      backgroundColor: colors[`${(target as { key: string }).key}:bg`] ?? 'rgba(0, 0, 0, 0)',
    });
    (globalThis as { document?: unknown }).document = {
      documentElement: nodes[nodes.length - 1],
    };
    return { element: nodes[0] as unknown as Element, canvas: chain[chain.length - 1]! };
  };

  it('reports a colour it cannot read instead of falling back to black', () => {
    const { element } = stub({ element: 'lab(50% 40 59.5)' }, ['element', 'html']);
    const measured = measuredContrast(element);
    expect(measured.unresolved).toEqual(['element.color: lab(50% 40 59.5)']);
    expect(Number.isNaN(measured.ratio)).toBe(true);
  });

  it('measures a readable pair over an opaque canvas', () => {
    const { element } = stub({ element: 'rgb(118, 118, 118)', 'html:bg': 'rgb(255, 255, 255)' }, [
      'element',
      'html',
    ]);
    const measured = measuredContrast(element);
    expect(measured.unresolved).toEqual([]);
    expect(measured.opaque).toBe(true);
    expect(measured.ratio).toBeCloseTo(4.542225, 6);
  });

  it('counts the element own translucent background exactly once', () => {
    // The shipped walk started at the element and the caller then composited
    // the element's background over the result, so a 50 % black wash over a
    // white canvas was measured as 25 % grey: 2.02:1 for black ink instead of
    // 5.28:1. Black over 50 % black on white is black on mid grey.
    const { element } = stub(
      {
        element: 'rgb(0, 0, 0)',
        'element:bg': 'rgba(0, 0, 0, 0.5)',
        'html:bg': 'rgb(255, 255, 255)',
      },
      ['element', 'html'],
    );
    const measured = measuredContrast(element);
    expect(measured.opaque).toBe(true);
    expect(measured.ratio).toBeCloseTo(5.280823, 6);
    expect(measured.ratio).not.toBeCloseTo(2.017522, 3);
  });

  it('walks past a transparent ancestor to the surface behind it', () => {
    const { element } = stub({ element: 'rgb(0, 0, 0)', 'html:bg': 'rgb(255, 255, 255)' }, [
      'element',
      'mid',
      'html',
    ]);
    const measured = measuredContrast(element);
    expect(measured.opaque).toBe(true);
    expect(measured.ratio).toBeCloseTo(21, 6);
  });

  it('says so when nothing the page paints is opaque', () => {
    // Nothing in the chain paints a background, so the surface is the engine's
    // own canvas: the ratio still computes, but the row must be able to tell
    // that it rests on an assumption rather than on the page's own paint.
    const { element } = stub({ element: 'rgb(0, 0, 0)' }, ['element', 'html']);
    const measured = measuredContrast(element);
    expect(measured.unresolved).toEqual([]);
    expect(measured.opaque).toBe(false);
    expect(measured.ratio).toBeCloseTo(21, 6);
  });

  it('stops at the first opaque surface instead of stacking past it', () => {
    // `mid` is opaque, so `html`'s colour must not leak into the measurement.
    const { element } = stub(
      {
        element: 'rgb(255, 255, 255)',
        'mid:bg': 'rgb(0, 0, 0)',
        'html:bg': 'rgb(120, 120, 120)',
      },
      ['element', 'mid', 'html'],
    );
    const measured = measuredContrast(element);
    expect(measured.opaque).toBe(true);
    expect(measured.ratio).toBeCloseTo(21, 6);
  });

  it('measures a shadow-tree control against the sibling surface it is painted on', () => {
    // The code block's copy button lives in the component's shadow tree and is
    // positioned against the `<pre>` the consumer slots as light DOM — not one
    // of its ancestors. `Element.closest` stops at the shadow root, so a walk
    // that relied on it never found the block, fell through to the page paper,
    // and in the dark theme reported white ink on the white page (1.09:1) for
    // a label that really sits on the dark code surface (21:1).
    const shadowRoot = new (
      globalThis as { ShadowRoot: new () => ShadowRoot & { host?: object } }
    ).ShadowRoot();
    const nodes = {
      block: {
        key: 'block',
        tagName: 'OPEN-CODE-BLOCK',
        parentElement: null,
        matches: (selector: string) => selector === 'open-code-block',
        querySelector: (selector: string) => (selector === 'pre' ? nodes.pre : null),
        getRootNode: () => ({ nodeType: 9 }),
      },
      pre: {
        key: 'pre',
        tagName: 'PRE',
        parentElement: null as object | null,
        getRootNode: () => ({ nodeType: 9 }),
      },
      wrapper: {
        key: 'wrapper',
        tagName: 'DIV',
        parentElement: null as object | null,
        matches: () => false,
        getRootNode: () => shadowRoot,
      },
      copy: {
        key: 'copy',
        tagName: 'BUTTON',
        parentElement: null as object | null,
        matches: () => false,
        getRootNode: () => shadowRoot,
      },
      html: {
        key: 'html',
        tagName: 'HTML',
        parentElement: null,
        getRootNode: () => ({ nodeType: 9 }),
      },
    };
    shadowRoot.host = nodes.block;
    nodes.copy.parentElement = nodes.wrapper;
    nodes.pre.parentElement = nodes.block;
    (globalThis as { getComputedStyle?: unknown }).getComputedStyle = (target: object) => {
      const key = (target as { key: string }).key;
      return {
        color: { copy: 'rgb(255, 255, 255)' }[key] ?? 'rgb(0, 0, 0)',
        backgroundColor:
          {
            'pre:bg': 'rgb(0, 0, 0)',
            'html:bg': 'rgb(255, 255, 255)',
          }[`${key}:bg`] ?? 'rgba(0, 0, 0, 0)',
      };
    };
    (globalThis as { document?: unknown }).document = { documentElement: nodes.html };

    const measured = measuredContrast(nodes.copy as unknown as Element);
    expect(measured.unresolved).toEqual([]);
    expect(measured.opaque).toBe(true);
    expect(measured.ratio, 'the label is measured on the surface it is drawn on').toBeCloseTo(
      21,
      6,
    );
  });
});
