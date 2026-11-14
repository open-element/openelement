/** @jsxImportSource @openelement/element */
import { defineIslandConfig } from '@openelement/router';

// ssr: false is the HEAD boundary of the generated-island lane, not a
// semantic choice: entry-level DSD SSR for generated islands (the `__ssrHost`
// call target) has no production caller yet and is M11 wiring. The fixture
// therefore qualifies the generated host as client-only and records the
// plain-tag SSR form instead of claiming a DSD root it cannot produce.
export const openElement = defineIslandConfig({
  hydrate: 'load',
  ssr: false,
  root: 'shadow',
});

/** The authored hit counter the browser probe reads after clicking the host control. */
interface InteropGeneratedHostState {
  generatedHostHits?: number;
}

/**
 * interop-generated-host — the real generated Native Custom Element host.
 *
 * This module is authored as the function-component island M09-1a/1b compile:
 * the build lane turns it into a generated Native CE descriptor, the island
 * client entry calls `customElements.define`, and the shell mounts this
 * authored shadow content. The authored `<slot>` / `part` / `onClick` channels
 * are the landed M09 shadow and M09-2c surfaces — nothing here is hand-written
 * Custom Element code, and the module executes no registration.
 *
 * The fixture page places the four foreign probe tags as this host's light
 * children; the native slots below project them (named caption first, then the
 * default slot), which is what makes the generated host a real composition
 * boundary for the canonical corpus.
 */
export default function InteropGeneratedHost() {
  const noteAuthoredHit = () => {
    const state = (
      globalThis as typeof globalThis & {
        __interopState?: InteropGeneratedHostState;
      }
    ).__interopState;
    if (state) state.generatedHostHits = (state.generatedHostHits ?? 0) + 1;
  };

  return (
    <section id='generated-panel'>
      <slot name='caption'></slot>
      <button
        id='generated-control'
        part='control'
        type='button'
        onClick={noteAuthoredHit}
      >
        generated host
      </button>
      <slot></slot>
    </section>
  );
}
