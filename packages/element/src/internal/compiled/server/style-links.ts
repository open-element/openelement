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
 * Set the emitted stylesheet URLs for this server process. Called by the
 * router's generated SSR/SSG entry (build time and request-time startup) with
 * the base-joined asset addresses Phase 2 emitted.
 *
 * The optional `islandEntries` half carries the per-tag URLs of generated
 * SHADOW hosts (M09-2e / #1803) through the SAME channel: one setter, one
 * entry import, no second public seam. A `null` URL list is the explicit
 * "declared but carrier unavailable" state the nested renderer fails closed on.
 */
export function __setRequestTimeStyleSheetUrls(
  urls: readonly string[] | null | undefined,
  islandEntries?: ReadonlyArray<readonly [string, readonly string[] | null]> | null,
): void {
  styleSheetUrls = urls ?? [];
  islandStyleSheetUrls = new Map(islandEntries ?? []);
}

/**
 * Per-island stylesheet URLs for generated shadow hosts (M09-2e / #1803),
 * keyed by the island's registration tag.
 *
 * A shadow root's sheets are declared INSIDE its DSD template, so the
 * process-wide document list above cannot deliver them. This map is filled
 * from the SAME build-time channel (`virtual:open-element-style-links`) and
 * the SAME server entry import: one setter module, one mechanism. A value of
 * `null` is the explicit "declared but carrier unavailable" state (the dev
 * server has no emitted assets yet); the nested renderer fails closed on it
 * instead of silently rendering an unstyled shadow host.
 */
let islandStyleSheetUrls: ReadonlyMap<string, readonly string[] | null> = new Map();

/**
 * The declared stylesheet URLs for one generated shadow host, or `undefined`
 * when the island declares none. `null` means "declared, carrier unavailable"
 * and must be surfaced as a failure, never treated as no styles.
 */
export function requestTimeIslandStyleLinks(tag: string): readonly string[] | null | undefined {
  return islandStyleSheetUrls.get(tag);
}

/** The component stylesheet URLs this process declares, possibly empty. */
export function requestTimeStyleLinks(): readonly string[] {
  return styleSheetUrls;
}
