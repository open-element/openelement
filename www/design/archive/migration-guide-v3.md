# Migration Guide: Web Standards Lab v3

> **Retired 2026-08-02.** This was the v3 implementation contract. The v3
> mockup set was retired on 2026-07-26 and v4 is now the only maintained set
> (see `design/mockups/v4/README.md`); the symbols this guide references
> (`linearTokenSheet`, `packages/ui/src/open-layout.tsx`) no longer exist.
> Kept as a historical snapshot under `design/archive/`.

## Goal

Move `www` to a strict Open Props, UI-package-first Web Standards Lab design.

## Required Changes

1. Rewrite `www/design` as this implementation contract.
2. Use `openPropsTokenSheet` in the shared layout and redesigned pages.
3. Remove `linearTokenSheet` from the homepage, docs landing, roadmap, and
   design-system page.
4. Move reusable surfaces into `@openelement/ui`.
5. Replace local buttons, badges, cards, spec panels, and artifact frames with
   UI package primitives.
6. Fix dark mode at the root token injection and component shadow-boundary level.
7. Validate with desktop/mobile light/dark screenshots and minimum build/check.

## Implementation Notes

- `www/public/theme-init.js` owns early theme selection.
- `www/vite.config.ts` injects Open Props root variables and compatibility aliases.
- `packages/ui/src/open-layout.tsx` owns shared shell, header, sidebar, and footer.
- `www/app/routes/index/index.tsx` owns homepage composition.
- `www/app/routes/docs/index.tsx`, `www/app/routes/roadmap.tsx`, and
  `www/app/routes/architecture/design-system.tsx` must stay aligned with this spec.

## Legacy Assets

Existing mockup SVG/PNG files were generated for earlier directions. Treat them
as historical snapshots until a new generator is produced from v3.
