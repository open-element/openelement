/**
 * Preact island support (v0.44) — internal module, not a public subpath.
 *
 * The island is a plain autonomous custom element — it does NOT extend
 * OpenElement and carries no compiled Part Program (foreign-element
 * semantics: no DSD shadow, no kernel claim). Server-side prerendering renders
 * the Preact component with preact-render-to-string into the host's light-DOM
 * content (`PreactIslandConstructor.renderSsr`); on the client,
 * connectedCallback hydrates that surviving light-DOM content with
 * preactHydrate (ssr: true) or renders from scratch with preactRender.
 *
 * Props come from the static `options.props` plus the host element's
 * attributes (attribute values are always strings). The removed
 * getSsrProps/DATA_SSR_PROPS channel is gone: islands that need structured
 * server data read it from attributes or module scope.
 */

import { assertValidTagName } from '@openelement/element/authoring';
import { h, hydrate as preactHydrate, render as preactRender } from 'preact';
import type { ComponentChild } from 'preact';
import { renderToString } from 'preact-render-to-string';

type PreactIslandProps = Record<string, unknown>;

type PreactIslandComponent<
  Props extends PreactIslandProps = PreactIslandProps,
> = (
  props: Props,
) => ComponentChild;

/** Options for {@linkcode definePreactIsland} (base props, SSR participation). */
export interface PreactIslandOptions {
  /**
   * Server-render the island's light-DOM content (default). Set `false` for a
   * CSR-only island rendered from scratch in connectedCallback(). Note:
   * `hydrate`/`dsd` strategies from defineIslandConfig() are not supported
   * here — the island activates immediately.
   */
  ssr?: boolean;
  props?: PreactIslandProps;
}

/** A Preact island constructor plus its server-render seam. */
export interface PreactIslandConstructor extends CustomElementConstructor {
  /**
   * Render the component to the host's light-DOM inner HTML. Returns '' when
   * the island is CSR-only (`ssr: false`). Hosts/pipelines that prerender
   * foreign island content call this and inject the result as the host's
   * light-DOM children; the client then hydrates it in place.
   */
  renderSsr(props?: PreactIslandProps): string;
}

function collectAttributes(host: HTMLElement): PreactIslandProps {
  const props: PreactIslandProps = {};
  const attrs = host.attributes;
  if (!attrs) return props;
  for (const attr of Array.from(attrs)) {
    props[attr.name] = attr.value;
  }
  return props;
}

function resolveProps(
  host: HTMLElement,
  baseProps: PreactIslandProps,
): PreactIslandProps {
  return {
    ...baseProps,
    ...collectAttributes(host),
  };
}

/** Define a Preact component as a custom-element island with attribute-to-props bridging. */
export function definePreactIsland<
  Props extends PreactIslandProps = PreactIslandProps,
>(
  tagName: string,
  Component: PreactIslandComponent<Props>,
  options: PreactIslandOptions = {},
): PreactIslandConstructor {
  assertValidTagName(tagName);
  const baseProps = options.props ?? {};

  class OpenElementPreactIsland extends HTMLElement {
    #preactMounted = false;
    #detachGeneration = 0;

    #preactVNode() {
      return h(Component, resolveProps(this, baseProps) as Props);
    }

    connectedCallback(): void {
      // A same-turn DOM move disconnects and reconnects before the deferred
      // teardown below. Invalidate that teardown and keep Preact as the sole
      // owner of the existing tree.
      this.#detachGeneration++;
      if (this.#preactMounted) return;
      const vnode = this.#preactVNode();
      if (options.ssr !== false && this.childNodes.length > 0) {
        // Light-DOM hydration: the host's server-rendered content survives.
        preactHydrate(vnode, this);
      } else {
        preactRender(vnode, this);
      }
      this.#preactMounted = true;
    }

    /**
     * Imperative re-render seam (e.g. after module-scope signal changes):
     * re-renders through the existing Preact owner when mounted.
     */
    update(): void {
      if (!this.#preactMounted) return;
      preactRender(this.#preactVNode(), this);
    }

    disconnectedCallback(): void {
      const generation = ++this.#detachGeneration;
      queueMicrotask(() => {
        if (
          generation !== this.#detachGeneration ||
          this.isConnected ||
          !this.#preactMounted
        ) return;
        preactRender(null, this);
        this.#preactMounted = false;
      });
    }

    /** Server prerender seam: light-DOM content HTML for the host. */
    static renderSsr(props?: PreactIslandProps): string {
      if (options.ssr === false) return '';
      return renderToString(h(Component, { ...baseProps, ...(props ?? {}) } as Props));
    }
  }

  // #952: same dev-SSR re-define semantics as compiled island registration —
  // the marked SSR stub registry outlives module re-evaluation, so island
  // edits must overwrite the stale class; browser registries keep the
  // duplicate guard.
  // Contract: the marker name is chartered as SSR_REGISTRY_STUB_MARKER in
  // @openelement/element internal/protocol/ssr-registry-markers.ts (#965);
  // app cannot import element internals, so keep the literal in sync.
  const registry = typeof customElements !== 'undefined' ? customElements : undefined;
  if (
    registry &&
    ((registry as { __openElementSsrStub?: boolean }).__openElementSsrStub === true ||
      !registry.get(tagName))
  ) {
    registry.define(tagName, OpenElementPreactIsland);
  }

  return OpenElementPreactIsland;
}
