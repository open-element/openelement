/**
 * Light-mode probe island (#1148 / ADR-0142 acceptance fixture).
 *
 * Exercises the real SSR -> delayed-upgrade path of a `renderMode = 'light'`
 * island in a browser: the server-rendered host carries the internal
 * `data-oe-light` provenance marker, and the client upgrade must activate the
 * surviving DOM in place — node identity, focus, selection, live form values,
 * and a pre-upgrade click all preserved.
 *
 * Driven by tests/fixtures/site-light-probe/e2e/light-mode-activation.spec.ts
 * on Chromium, Firefox, and WebKit; rendered by the fixture's root route.
 *
 * Island config: `ssr: true` admits the host to the SSR renderable set;
 * `dsd` is deliberately omitted — light mode renders into the host and emits
 * no `<template shadowrootmode>`. `hydrate: 'load'` makes the client entry
 * import this island's chunk immediately at evaluation, which is what lets
 * the spec delay the upgrade by holding that chunk's response.
 *
 * GENERATED lane (F16: class → function). `root: 'light'` is the class lane's
 * `root: 'light'`, spelled explicitly rather than left to the lane's light
 * default: the spec asserts `host.shadowRoot === null` AND reads the island's
 * markup out of the document, so the delivery root is the contract under test
 * and must be visible at the declaration.
 *
 * `count` keeps the class lane's `@property({ reflect: false })`: a
 * NON-reflecting but still attribute-backed row (the attribute name stays
 * derived from the property name, so nothing about the wire moves). It lives
 * in the sidecar rather than as a bare local because the row is what makes the
 * shell observe and convert a `count` attribute on the host. The render reads
 * it through a component-local SIGNAL: the class lane re-rendered on a field
 * write, and a plain local would emit one static text node — the click at the
 * end of the spec would then be invisible and the 0/1/2 counter proof lost.
 *
 * `hostClass` is the class lane's reflected rename onto the host's `class`
 * attribute, kept verbatim: the page authors `class='probe-host'` on this host
 * and the spec asserts that class survives activation, so the attribute channel
 * must stay the `class` attribute and not the derived `host-class`.
 */

import { signal } from '@openelement/element';
import { defineIslandConfig } from '@openelement/router';

export const openElement = defineIslandConfig({
  hydrate: 'load',
  ssr: true,
  root: 'light',
  styles: ['./open-light-probe.css'],
  properties: {
    hostClass: { reflect: true, attribute: 'class', default: '' },
    count: { reflect: false, default: 0 },
  },
});

interface OpenLightProbeProps {
  hostClass: string;
  count: number;
}

export default function OpenLightProbe(props: OpenLightProbeProps) {
  const count = signal(props.count ?? 0);

  // The input is a static control: no markers, no bindings. Its typed
  // value, selection, and focus must survive in-place activation.
  // The span is signal-bound text: SSR renders its initial value and
  // activation binds the SURVIVING node (the spec compares that node's
  // identity before and after the upgrade), proving live reactivity.
  // `.probe-shared` is the overlapping class this component's sheet shares
  // with the card component and an unrelated document element (S-C1.2).
  return (
    <div class='light-probe'>
      <p class='probe-shared'>probe text</p>
      <input type='text' class='probe-input' aria-label='Light probe input' />
      <button
        type='button'
        class='probe-button'
        onClick={() => {
          count.value += 1;
        }}
      >
        increment
      </button>
      <span class='probe-count'>{count.value}</span>
    </div>
  );
}
