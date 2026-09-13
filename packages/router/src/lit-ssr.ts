/**
 * @openelement/router/lit-ssr - Server-only Lit page rendering (Beta.2.2, #1339).
 *
 * renderLitPageToHtml() is the lit-mode replacement for the native compiled
 * __ssr/renderDsd page render: it renders one registered LitElement page class
 * to DSD HTML through @lit-labs/ssr. Nested custom elements (Lit islands
 * embedded in the page template) compose through the same SSR registry.
 *
 * Server-only: this module installs the @lit-labs/ssr global DOM shim as an
 * import side effect and must never be reachable from a client bundle. It is
 * deliberately NOT re-exported from the @openelement/router root barrel.
 *
 * Spike-verified contract (Deno 2.9.0 + Node 24.18.0, lit 3.3.3,
 * @lit-labs/ssr 4.1.0):
 * - '@lit-labs/ssr/lib/install-global-dom-shim.js' is a SIDE-EFFECT module
 *   (no exports); it must evaluate before any 'lit' import.
 * - DSD output is `<template shadowroot="open" shadowrootmode="open">` and
 *   keeps `<!--lit-part-->` marker comments — the client hydration support
 *   module needs them, so they are never stripped.
 * - Dynamic tags and property binding names are built with unsafeStatic from
 *   'lit/static-html.js'; values bind uniformly as `.prop=${value}` so
 *   string/number/boolean/object/array props all assign as properties.
 * - Rendering is synchronous via collectResultSync; a template containing a
 *   promise (async directive) fails closed with a render error.
 */

import '@lit-labs/ssr/lib/install-global-dom-shim.js';
import { render } from '@lit-labs/ssr';
import { collectResultSync } from '@lit-labs/ssr/lib/render-result.js';
import { html, unsafeStatic } from 'lit/static-html.js';

import { ERROR_PREFIX, isValidTagName, OpenElementError } from '@openelement/element/authoring';

/**
 * Property binding names become static template text via unsafeStatic; the
 * charset is bounded to identifier-ish names so a hostile or malformed key can
 * never break out of the binding position into template markup.
 */
const PROP_NAME_PATTERN = /^[A-Za-z_$][A-Za-z0-9_$-]*$/;

/** Build the lit template `<tag .k0=${v0} ...></tag>` for a dynamic tag + props record. */
function litPageTemplate(tag: string, props: Record<string, unknown>) {
  const keys = Object.keys(props);
  for (const key of keys) {
    if (!PROP_NAME_PATTERN.test(key)) {
      throw new OpenElementError(
        `${ERROR_PREFIX} lit page prop ${JSON.stringify(key)} is not a safe property binding ` +
          'name; project serializable, identifier-shaped props only.',
        { code: 'LIT_PROP_NAME_INVALID', phase: 'render' },
      );
    }
  }
  const staticTag = unsafeStatic(tag);
  // static-html templates accept a TemplateStringsArray-shaped value; the
  // binding names are static chunks, only the tag and values are dynamic.
  const strings = ['<', ...keys.map((key) => ` .${key}=`), '></', '>'];
  const templateStrings: TemplateStringsArray = Object.assign([...strings], {
    raw: strings,
  }) as TemplateStringsArray;
  return html(templateStrings, staticTag, ...keys.map((key) => props[key]), staticTag);
}

/**
 * Render a registered LitElement page host to DSD HTML.
 *
 * Fails closed when the tag is invalid or no element class is registered for
 * it in the SSR registry: the generated entry registers every page/island
 * class explicitly before rendering, so an unregistered host is a pipeline
 * bug, never a silent passthrough.
 */
export function renderLitPageToHtml(
  { tag, props }: { tag: string; props?: Record<string, unknown> },
): { html: string } {
  if (!isValidTagName(tag)) {
    throw new OpenElementError(
      `${ERROR_PREFIX} Invalid custom element tag: ${String(tag)}. Must contain a hyphen.`,
      { code: 'LIT_TAG_INVALID', phase: 'render' },
    );
  }
  if (typeof customElements === 'undefined' || !customElements.get(tag)) {
    throw new OpenElementError(
      `${ERROR_PREFIX} <${tag}> is not registered in the SSR registry. Generated entries ` +
        'register every page/island class explicitly before rendering; an unregistered Lit ' +
        'page host cannot be server-rendered.',
      { code: 'LIT_PAGE_UNREGISTERED', phase: 'render' },
    );
  }
  const template = litPageTemplate(tag, props ?? {});
  return { html: collectResultSync(render(template)) };
}
