# ADR-0128: Decouple Page Registration from the `tagName` Export (definePage Routes)

- Status: ACCEPTED (implemented on the v0.42.0-alpha.17 train, #960)
- Date: 2026-08-14
- Amends: ADR-0119 freeze wording ("`tagName` route elements") with the
  narrowed semantics below

## Context

Since the file-router's first release, a page route's `export const tagName`
did double duty: it named the custom element the generated server entry
registered the route's default export under, and (by starter convention) it
named the content element the page render returned.

That coupling breaks the sanctioned starter shape. A route module combining

```ts
export const tagName = 'home-page';
defineElement('home-page', { render() {/* content */} });
export default definePage({
  render({ request }) {
    return <home-page />;
  },
});
```

silently lost its definePage render at SSR: the entry registered the page
class under `home-page`, the module's own `defineElement('home-page', …)`
content element won the registry (the #952 ownership rule), and the page
render — the only place `request`/`useActionData()` context reaches the
markup — was bypassed. The page rendered, but as a bare content element
without loader/action context.

#960 asked to decouple the two names. Option 2 (chosen): the definePage
render always wins by construction — the entry ignores the `tagName` export
for registration on definePage routes and always registers the page class
under the route-path-derived fallback tag (`app/routes/index.tsx` →
`index-page`). The `tagName` export keeps a single, narrowed meaning: it
names the content element.

## Decision

1. **definePage routes register under the path-derived fallback tag.** The
   route scanner (`route-scanner.ts`) flags routes whose default export is a
   `definePage()` definition (`RouteEntry.definePage`), and the entry
   descriptor (`entry-descriptor.ts`) resolves their registration tag to
   `fileToTagName(filePath)` regardless of the `tagName` export. Detection
   runs against source with string/template contents masked, so guide pages
   embedding `definePage(` code samples in strings are never misflagged.
2. **`tagName` export semantics are narrowed in prose**: on a definePage
   route the export names the content element and never drives registration.
   Plain element routes (default export is an element class, no definePage)
   keep today's semantics exactly — the export remains their registration
   tag.
3. **Migration-period signal**: a definePage route that exports `tagName`
   but never uses the tag (no `defineElement(tagName`/literal call, no
   `<tag` JSX usage) gets a one-time-per-file info note that the export is
   ignored for registration. Sanctioned shape-1 modules — the starter
   pattern, which self-registers the content element and renders `<tag/>` —
   stay silent, so pristine starter builds remain note-free.
4. **The #952 registration-ownership guard stays.** A module-self-registered
   class still wins over the entry's registration for the same tag: it keeps
   guarding plain element routes that self-register their default export,
   and dev re-evaluation of those modules.

## Consequences

- **SSR markup breaking change on shape-1 pages**: the document root gains
  the fallback-tag page element as an outer wrapper (with its own DSD shadow
  root) around the content element — `<home-page>…</home-page>` becomes
  `<index-page><template shadowrootmode="open"><home-page>…</home-page></template></index-page>`.
  Hydration markers are unchanged (they pair per element); the morph client
  is tag-agnostic at the document root (it morphs `body` children, pairing
  by tag on both sides of the same build). User CSS that targeted the old
  root tag must target the new fallback tag or the content element.
- The bug class is eliminated structurally: a content element can no longer
  shadow the page render, because the two never share a registration tag.
- Two valid authoring shapes, documented in the guide: shape-1 (content
  element owns the exported `tagName`; the definePage render returns
  `<that-tag/>`) and shape-2 (no `tagName` export; the definePage render
  owns the logic and returns inner elements with their own tags).
- Orphaned `tagName` exports on definePage routes are inert but reported by
  the scanner note; removing them is cosmetic.

## Migration impact

- `packages/element`: `RouteEntry` gains the optional `definePage` flag
  (additive; the public interface snapshot tracks export statements, not
  interface members).
- Router's Framework Mode tooling: scanner flag + masking + migration note,
  descriptor registration-tag resolution, orchestrator comment. (The original implementation was
  in the now-removed Adapter Vite package.)
- `packages/create` templates: comments narrowed at the `tagName` export;
  template markup unchanged (the sanctioned shape keeps working).
- `www`: no route changes — the site uses plain element routes, whose
  semantics are untouched.

## Erratum (0.43, #971)

The residual corner — a self-registered content element whose tag equals the
route's path-derived fallback tag — still shadowed the page class under the
#952 ownership rule (0.42.x shipped a scanner warning). From 0.43 the scanner
fails the build with rename guidance: the colliding shape never worked
correctly, so failing is honest signaling, not a behavior regression. This is
a patch to this ADR's migration surface, not a change to the decoupling
itself; ADR-0122's frozen semantics are untouched.
