/**
 * The document stylesheet links a component's DSD template declares (alpha15 S
 * lane, requirement 3).
 *
 * Framework-generated component CSS must reach an SSR/DSD shadow tree as a
 * declarative external resource — a parser-visible `<link rel="stylesheet">`
 * inside the template — never as inlined CSS text and never as a runtime DOM
 * write. The URLs are content-addressed and only Phase 2 knows them, so the
 * router's SSG/SSR build hands them in through
 * {@linkcode __setRequestTimeStyleSheetUrls} before the render pass: the same
 * request-time channel shape the island client script uses
 * (`__setRequestTimeClientScript`), one mechanism for every build-time-known
 * address. The generated entry carries the call, so the deployed request-time
 * server re-applies it at startup and a prerendered page and a live response
 * declare the same resource.
 *
 * A process that never receives a value keeps the empty list: no link is
 * emitted, which is the documented "no framework stylesheet" state (no
 * Tailwind entry, no admitted candidates, client bundle, dev).
 */

let styleSheetUrls: readonly string[] = [];

/**
 * Set the emitted component stylesheet URLs for this server process. Called by
 * the router's generated SSR/SSG entry (build time and request-time startup)
 * with the base-joined asset addresses Phase 2 emitted.
 */
export function __setRequestTimeStyleSheetUrls(urls: readonly string[] | null | undefined): void {
  styleSheetUrls = urls ?? [];
}

/** The component stylesheet URLs this process declares, possibly empty. */
export function requestTimeStyleLinks(): readonly string[] {
  return styleSheetUrls;
}
