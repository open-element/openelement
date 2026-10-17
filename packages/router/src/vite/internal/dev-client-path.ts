/**
 * The path a browser knows a module by — what an HMR update payload must name.
 *
 * A module the browser fetched carries its fetched URL, and that URL is what
 * Vite's client registers in its hot-module map: the client is served the
 * base-less path (`createHotContext("/@id/__x00__…")` — measured under
 * `base: '/sub/'`), while the browser's own request keeps the base. An update
 * must therefore name the SERVER-side url, never a base-prefixed variant: a
 * path the client never registered is silently dropped by the update walk, and
 * the edit appears to do nothing.
 *
 * A module whose graph entry was instead created from its `\0`-virtual id
 * (the style-asset graph id: the transform of the importing island resolves
 * it, and the SSR render loads it) carries that RAW id as its url, which no
 * client can match. The browser-facing form is Vite's own encoding of the id —
 * `@id/__x00__<id minus NUL>` — the placeholder Vite substitutes so the null
 * byte can ride a URL.
 */
export function devClientModulePath(module: { id: string | null; url: string }): string {
  const id = module.id;
  if (id === null || module.url !== id || !id.startsWith('\0')) return module.url;
  return `/@id/__x00__${id.slice(1)}`;
}
