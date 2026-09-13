# Docs Landing Page Spec

## Purpose

The docs landing page is a reference desk. It helps users choose the right
path: build, API, architecture, or roadmap truth.

## Layout

- Hero: title/lede plus an `open-lab-panel` command palette.
- Entry paths: four `open-card` links.
- Reference section: one dark `open-lab-panel` route graph and one light
  `open-lab-panel` workflow.
- Mobile: one column, no horizontal overflow, no cramped header.

## Content

| Entry                | Title                                                        | Link                         |
| -------------------- | ------------------------------------------------------------ | ---------------------------- |
| Build an app         | Project, routes, layouts, islands, content, i18n, deployment | `/guide/getting-started`     |
| Read the API         | Package exports and public framework surface                 | `/apilist`                   |
| Inspect architecture | Package boundaries and rendering decisions                   | `/architecture/architecture` |
| Check roadmap truth  | Shipped, current, planned, and out-of-scope language         | `/roadmap`                   |

## Visual Rules

- Dark route list is the concrete technical artifact.
- Command palette and route graph are more important than the card grid.
- Light panels carry reading and workflow content.
- No page-local color literals.
- No Linear components.
- `open-standards-visual` uses `emphasis="high"` and respects reduced motion.
