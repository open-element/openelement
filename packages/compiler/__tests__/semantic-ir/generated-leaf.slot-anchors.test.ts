/**
 * Light-root slot anchors — the emitted bytes (LOCAL, Node).
 *
 * A generated LIGHT-root element is the only host whose children are
 * PROJECTIONS: it has no shadow boundary, so the platform distributes nothing
 * and the caller's children must be written into the producer's own `<slot>`
 * elements. The producer is a finished string, so the only locator that is not
 * a markup pattern match is a marker the producer itself wrote. This slice adds
 * one `oe:s:<ordinal>:<hex name>` / `oe:/s:…` pair INSIDE each `<slot>`
 * element, carrying both the ordinal and the name.
 *
 * What this file pins:
 *
 *   1. a SLOTTED light producer emits the pair for every slot, with the right
 *      ordinals and the right (hex-carried) names, in both the static
 *      parameterless form and the dynamic `(props, host)` form;
 *   2. a SLOTLESS component's bytes are unchanged on every root — the
 *      byte-identity guarantee, asserted against literal expected bytes rather
 *      than against a recompilation of the same code;
 *   3. a SHADOW root never carries an anchor (its children are distributed by
 *      the platform, so an anchor there would be dead bytes);
 *   4. a light-root `<slot name={…}>` is refused at compile time rather than
 *      baking a guess into the marker.
 *
 * The serializer half lives in `packages/element/__tests__/slot-anchors.test.ts`.
 */

import { describe, expect, test } from 'vitest';
import { compileFunctionModule } from '../../src/internal/compiler/semantic-core/function-frontend.ts';
import { generateLeafModule } from '../../src/internal/compiler/semantic-ir/generated-leaf/generate.ts';
import { generateElementModule } from '../../src/internal/compiler/semantic-ir/generated-element/emit.ts';
import { ELEMENT_CLASSIFIER as CLASSIFIER } from './testlib/element-classifier.ts';

const FILE = '/proj/src/islands/slot-anchors.tsx';

interface Emitted {
  readonly leaf: string;
  readonly module: string;
}

/** Compile one module and emit the generated-element tail for `root`. */
function element(
  source: string,
  root: 'light' | 'shadow-open' | undefined,
  rootComponent: string,
): Emitted {
  const front = compileFunctionModule(source, FILE, { importClassifier: CLASSIFIER });
  expect(front.diagnostics, 'frontend admission').toEqual([]);
  const emitted = generateElementModule(
    front.module!,
    { tag: 'x-probe' },
    { rootComponent, ...(root === undefined ? {} : { root }) },
  );
  expect(emitted.diagnostics.map((item) => item.code)).toEqual([]);
  expect(emitted.module).not.toBeNull();
  expect(emitted.leaf).not.toBeNull();
  return { leaf: emitted.leaf!, module: emitted.module! };
}

/** The `<Name>__ssr` body, or the whole leaf when no producer was emitted. */
function ssrBody(leaf: string, name: string): string | null {
  const match = new RegExp(`export function ${name}__ssr\\([\\s\\S]*?\\n\\}`).exec(leaf);
  return match === null ? null : match[0];
}

describe('light-root slot anchors — emitted bytes', () => {
  test('a static light producer anchors each slot with its ordinal and name', () => {
    const { leaf } = element(
      `function Static(props) {
  return <article class="card"><slot name="head"></slot><slot></slot></article>;
}
`,
      'light',
      'Static',
    );
    const body = ssrBody(leaf, 'Static');
    expect(body).not.toBeNull();
    // The parameterless M08-1a shape does not move: the producer still takes no
    // arguments, and the anchors ride inside the bytes it returns.
    expect(body).toContain('export function Static__ssr() {');
    // Ordinal 0 = the named slot, 1 = the default one; the name rides as UTF-8
    // hex, so `oe:s:0:68656164` is `head`.
    expect(body).toContain('markerText(slotAnchorMarker(0, "head"))');
    expect(body).toContain('markerText(slotAnchorMarker(0, "head", true))');
    expect(body).toContain('markerText(slotAnchorMarker(1, ""))');
    expect(body).toContain('markerText(slotAnchorMarker(1, "", true))');
    // The anchor is INSIDE the slot element: after its open tag and before its
    // close tag. That is what lets the serializer substitute the fallback while
    // the `<slot>` node stays.
    expect(body).toMatch(/<slot[\s\S]*slotAnchorMarker\(0, "head"\)[\s\S]*<\/slot>/);
  });

  test('a dynamic light producer anchors each slot through the push sequence', () => {
    const { leaf } = element(
      `function Dyn(props) {
  return <div class="wrap"><slot name="header"></slot><p>{props.label}</p><slot></slot></div>;
}
`,
      'light',
      'Dyn',
    );
    const body = ssrBody(leaf, 'Dyn');
    expect(body).not.toBeNull();
    expect(body).toContain('export function Dyn__ssr(__oe_props, __oe_host) {');
    expect(body).toContain(
      '__oe_out0.push("<!--", markerText(slotAnchorMarker(0, "header")), "-->");',
    );
    expect(body).toContain(
      '__oe_out0.push("<!--", markerText(slotAnchorMarker(0, "header", true)), "-->");',
    );
    expect(body).toContain('__oe_out0.push("<!--", markerText(slotAnchorMarker(1, "")), "-->");');
    // The dynamic text slot keeps its own separate family.
    expect(body).toContain('markerText(textSlotMarker(0))');
    // The anchor pair brackets the INTERIOR: the open marker is pushed after the
    // start tag and the closing one before the end tag.
    const headerOpen = body.indexOf('markerText(slotAnchorMarker(0, "header"))');
    const headerElementOpen = body.lastIndexOf('"<slot"', headerOpen);
    const headerElementClose = body.indexOf('"</slot>"', headerOpen);
    expect(headerElementOpen).toBeGreaterThan(-1);
    expect(headerElementClose).toBeGreaterThan(headerOpen);
  });

  test('a slot inside a condition branch still gets an ordinal, in emission order', () => {
    const { leaf } = element(
      `function Branchy(props) {
  return <div><slot name="always"></slot>{props.on ? <slot name="on"></slot> : <slot name="off"></slot>}</div>;
}
`,
      'light',
      'Branchy',
    );
    const body = ssrBody(leaf, 'Branchy');
    expect(body).not.toBeNull();
    // The SSR producers INLINE the branch, so all three slots share one
    // ordinal sequence: 0 = always, 1 = on, 2 = off.
    expect(body).toContain('slotAnchorMarker(0, "always")');
    expect(body).toContain('slotAnchorMarker(1, "on")');
    expect(body).toContain('slotAnchorMarker(2, "off")');
  });

  test('the runtime import is registered by the emission predicate, not by hand', () => {
    const slotted = element(
      `function S(props) {
  return <div><slot></slot></div>;
}
`,
      'light',
      'S',
    );
    expect(slotted.leaf).toContain('slotAnchorMarker');
    expect(slotted.leaf).toMatch(/^import \{[^}]*\bslotAnchorMarker\b[^}]*\} from/m);

    const slotless = element(
      `function N(props) {
  return <div>plain</div>;
}
`,
      'light',
      'N',
    );
    expect(slotless.leaf).not.toContain('slotAnchorMarker');
    expect(slotless.leaf).not.toMatch(/^import \{[^}]*\bslotAnchorMarker\b[^}]*\} from/m);
  });
});

describe('light-root slot anchors — byte identity and non-light roots', () => {
  test('a SLOTLESS light component keeps the exact pre-slice producer bytes', () => {
    const { leaf } = element(
      `function Plain(props) {
  return <p class="plain">x</p>;
}
`,
      'light',
      'Plain',
    );
    // The whole body, byte for byte. This is the guarantee the slice must not
    // move: no anchor, no extra push, no changed expression shape.
    expect(ssrBody(leaf, 'Plain')).toEqual(
      'export function Plain__ssr() {\n' +
        '  return "<p" + " " + "class=\\"" + escapeAttrValue("plain") + "\\"" + ">" + ' +
        'escapeText("x") + "</p>";\n' +
        '}',
    );
    expect(leaf).not.toContain('slotAnchorMarker');
  });

  test('a SLOTLESS light component with dynamic content keeps its producer shape', () => {
    const { leaf } = element(
      `function Dyn(props) {
  return <span class="t">{props.label}</span>;
}
`,
      'light',
      'Dyn',
    );
    const body = ssrBody(leaf, 'Dyn');
    expect(body).not.toBeNull();
    expect(body).not.toContain('slotAnchorMarker');
    // The text boundary the pre-slice producer wrote is untouched.
    expect(body).toContain('markerText(textSlotMarker(0))');
    expect(body).toContain('markerText(textSlotMarker(0, true))');
  });

  test('a SHADOW root never carries a slot anchor, even with slots', () => {
    const { leaf, module } = element(
      `function Shadowed(props) {
  return <section><slot name="title"></slot><slot></slot></section>;
}
`,
      'shadow-open',
      'Shadowed',
    );
    // The platform distributes a shadow root's light children, so an anchor
    // there would be dead bytes no consumer reads.
    expect(leaf).not.toContain('slotAnchorMarker');
    expect(module).toContain('ssrHost');
  });

  test('an ABSENT root (the shell defaults to light) carries the anchors', () => {
    const { leaf } = element(
      `function Default(props) {
  return <div><slot name="only"></slot></div>;
}
`,
      undefined,
      'Default',
    );
    expect(ssrBody(leaf, 'Default')).toContain('slotAnchorMarker(0, "only")');
  });

  test('a hostless leaf module (no site) stays byte-identical', () => {
    const front = compileFunctionModule(
      `function Hostless(props) {
  return <div><slot name="a"></slot></div>;
}
`,
      FILE,
      { importClassifier: CLASSIFIER },
    );
    expect(front.diagnostics).toEqual([]);
    // No site fact: the leaf is what `generateLeafModule` produces standalone.
    const withSite = element(
      `function Hostless(props) {
  return <div><slot name="a"></slot></div>;
}
`,
      'light',
      'Hostless',
    );
    const leafOnly = generateLeafModule(front.module!);
    expect(leafOnly.diagnostics).toEqual([]);
    // The standalone leaf carries no anchors: it is not a host, so no serializer
    // can consume them.
    expect(leafOnly.module).not.toContain('slotAnchorMarker');
    // ...and the site form of the same source does, so the difference is the
    // host fact and nothing else.
    expect(withSite.leaf).toContain('slotAnchorMarker');
  });
});

describe('light-root slot anchors — refusals', () => {
  test('a dynamic slot name is refused instead of baking a guess', () => {
    const front = compileFunctionModule(
      `function DynName(props) {
  return <div><slot name={props.which}></slot></div>;
}
`,
      FILE,
      { importClassifier: CLASSIFIER },
    );
    // The frontend may or may not admit a dynamic name; either way no module may
    // be emitted with a guessed anchor.
    if (front.diagnostics.length === 0) {
      const emitted = generateElementModule(
        front.module!,
        { tag: 'x-probe' },
        { root: 'light', rootComponent: 'DynName' },
      );
      expect(emitted.module).toBeNull();
      expect(emitted.diagnostics.map((item) => item.code)).toContain(
        'OEIR_LEAF_UNSUPPORTED_SLOT_NAME',
      );
    } else {
      expect(front.diagnostics.length).toBeGreaterThan(0);
    }
  });

  test('a non-static name on a SHADOW root is not refused (no anchor is emitted)', () => {
    const front = compileFunctionModule(
      `function DynName(props) {
  return <div><slot name={props.which}></slot></div>;
}
`,
      FILE,
      { importClassifier: CLASSIFIER },
    );
    if (front.diagnostics.length > 0) return;
    const emitted = generateElementModule(
      front.module!,
      { tag: 'x-probe' },
      { root: 'shadow-open', rootComponent: 'DynName' },
    );
    // The anchor gate is the LIGHT root, so the shadow lane's bytes are
    // unaffected by a name it never bakes.
    expect(emitted.diagnostics.map((item) => item.code)).not.toContain(
      'OEIR_LEAF_UNSUPPORTED_SLOT_NAME',
    );
  });
});
