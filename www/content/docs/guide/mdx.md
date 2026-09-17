---
title: 'MDX'
lede: 'Documentation content compiles into the same route and component system as authored pages.'
order: 50
---

## Content source

An `.mdx` file in the routes directory is a route like any other: `app/routes/about.mdx` serves `/about`, is discovered by the same route scanner, and is prerendered at build time. The file holds plain Markdown, and the supported subset is deliberate — headings, paragraphs, emphasis/strong/delete, links, images, lists, code, blockquotes and horizontal rules.

The build lowers the file to a compiled page module before the compiled-element transform runs, so an MDX page ends up in exactly the same Part Program pipeline as an authored `.tsx` page; the element tag is derived from the route-relative file path so the generated entry registers the tag the program declares. Nothing about Markdown reaches the browser: the output is ordinary HTML with the page content in the host's shadow root.

Markdown parsing is the one dependency this path adds, and it is an optional peer of `@openelement/router` — it is only resolved when an `.mdx` file actually enters the build. Add it to the app's import map:

```json
{
  "imports": {
    "marked": "npm:marked@^15.0.0"
  }
}
```

If an `.mdx` route exists without that resolution, the build fails with install guidance instead of emitting a broken page.

## Components

The static subset is the contract, not a starting point. Raw HTML blocks, JSX expressions, ESM `import`/`export` statements and component usage inside `.mdx` fail closed with a source-located build error. A Markdown page is a document; interactive behavior belongs to a compiled element in a `.tsx` route or component, where the full compiler surface — properties, signals, event handlers, slots — is available.

Sites that need richer authoring keep the pipeline site-owned. The router ships routing, render context and document ownership — not a content database — so frontmatter schemas, collection loading, navigation mapping and any custom Markdown renderer are yours. That is the split this repository's own site uses: a collection loader renders Markdown to first-party trusted HTML, and the compiled page receives the result through its props.

## Build path

`deno task build` compiles `.mdx` routes together with the rest of the route tree. They follow the same rendering rules as any page — the default `renderIntent` mode is static, so they are prerendered into `dist/` at their route path and appear in the sitemap like every other route.

Failures surface at build time, not at request time: an unsupported construct, an unresolvable `marked` import or an undeclarable tag all stop the build with a source-located message. `deno task check` type-checks the app's TypeScript sources alongside the build, so authored `.tsx` pages keep their own fast signal while `.mdx` pages are covered by the build itself.

## See also

- [Configuration](/guide/configuration) — where content pipelines stay site-owned.
- [Routing and Data](/guide/routing-and-data) — the route contract an MDX page joins.
- [Styling](/guide/styling) — how rendered content is styled on the page.
