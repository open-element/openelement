---
title: 'Performance & Benchmarks'
lede: 'Zero-noise. What we actually measure.'
order: 100
navLabel: 'Performance'
section: 'Reference'
---

## Output size

Numbers measured on 2026-09-17 from the docs site's own build (`www/dist`, built with `deno task site:build` on this repository at commit `c953ac80`). Every row carries the command that reproduces it; page and URL counts follow the route set, so re-run them after content changes.

| Metric                 | Value                                              |
| ---------------------- | -------------------------------------------------- |
| Pre-rendered documents | 64 HTML files                                      |
| URLs in `sitemap.xml`  | 62                                                 |
| Total static output    | 7.2 MB                                             |
| Island manifests       | 64 — one per page                                  |
| Search index           | 31 pages per locale (en, zh), 62 fragments, 1.1 MB |

```bash
deno task site:build                        # regenerate everything below first
find www/dist -name '*.html' | wc -l        # 64
grep -c '<loc>' www/dist/sitemap.xml        # 62
du -sh www/dist                             # 7.2M
ls www/dist/island-manifests | wc -l        # 64
cat www/dist/pagefind/pagefind-entry.json   # page_count 31 per language
```

## Island bundles

The docs site is a normal openElement app, islands included, so its client output is a fair sample. Raw and gzip sizes of every emitted chunk:

| Chunk                          | Raw bytes | gzip -9 |
| ------------------------------ | --------- | ------- |
| `client.js` (shared entry)     | 7,103     | 1,849   |
| `island-open-layout`           | 88,337    | 16,183  |
| `island-open-cinematic-scroll` | 78,176    | 23,894  |
| `open-button`                  | 16,043    | —       |
| `island-open-dragon-live-gaze` | 14,161    | —       |
| `island-open-page-rail`        | 8,250     | 2,120   |
| `open-code-block`              | 8,254     | 2,688   |
| `island-open-hero-polish`      | 4,436     | —       |
| `open-badge`                   | 4,010     | —       |

```bash
ls -l www/dist/client/islands/*.js
gzip -9 -c www/dist/client/islands/client.js | wc -c
```

What a page actually downloads follows from its island manifest, not from the total:

| Route                    | Client payload (raw) | Distinct chunks |
| ------------------------ | -------------------- | --------------- |
| `/guide/mdx`             | 103,690 B            | 3               |
| `/guide/getting-started` | 111,944 B            | 4               |
| `/`                      | 200,467 B            | 6               |

Across all 64 page manifests the site declares 10 island tags in 284 entries: the chrome islands (`open-layout`, `open-search`, `open-theme-toggle`) on every page, `open-page-rail` on 54, `open-code-block` on 22, and the remaining tags on a handful of pages each.

```bash
cat www/dist/island-manifests/page-<hash>.json   # one page's island set: tag, chunk, strategy, layer
python3 -c "import json,glob,collections; print(collections.Counter(t for f in glob.glob('www/dist/island-manifests/*.json') for t in (i['tagName'] for i in json.load(open(f))['islands'])))"
```

A project with no islands and no enhanced forms emits no client entry at all: DSD components need no framework virtual-DOM runtime, so pure-static pages stay script-free.

## Rendering

| Metric            | Behavior                                                                                                       |
| ----------------- | -------------------------------------------------------------------------------------------------------------- |
| DSD SSR           | Components serialize as Declarative Shadow DOM; the browser parses shadow roots natively, with no script cost. |
| Island hydration  | Per component, gated by its declared strategy (`load` / `idle` / `visible` / `only`).                          |
| Navigation        | Browser-native navigation; View Transitions and Speculation Rules stay opt-in.                                 |
| Mandatory runtime | None. Client JavaScript exists only where a module declared an island or a form opted into enhancement.        |

## See also

- [Current Architecture](/architecture/architecture) — the layers these numbers come from.
- [Island Deep Dive](/architecture/islands-deep) — the four component layers and their strategies.
- [Design System](/architecture/design-system) — how the site's own styles and tokens are composed.
