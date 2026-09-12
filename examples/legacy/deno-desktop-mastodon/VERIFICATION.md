# Mastodon Desktop — Verification Checklist

## Automated checks (CI-enforced)

The root `deno task examples:check` gate runs unconditionally in CI (AutoFlow
`ci` and `release` tiers run every triggered gate regardless of changed
paths) and covers:

- [x] `deno task check` — type check of `main.ts` and `mastodon.tsx`.
- [x] `deno task smoke` — 23 unit tests (format, cache, api, server smoke).

## Verified locally (not CI-gated)

- [x] `deno run -A npm:vite build` succeeds and stays within the manifest
      budget declared in `vite.config.ts` (`islandKB: 350`, `totalJsKB: 450`).
      Last local run: 2026-07-24. This step is not part of CI.

## Manual smoke

The items below were verified by hand; no automated gate exercises them.

- [x] `deno task dev:api` starts without errors on port 8000.
- [x] `GET /api/timeline` returns the fixture timeline JSON.
- [x] `GET /api/profile/:acct` returns the fixture account.
- [x] `GET /api/status/:id` returns the fixture status.
- [x] `deno task dev:web` starts Vite without errors.
- [x] `/` renders the timeline with status cards.
- [x] `/profile/admin@mastodon.social` renders profile header and posts.
- [x] `/status/111111111111111111` renders the status and reply thread.
- [x] `/settings` renders the settings island and persists changes.
- [x] Theme toggle works and persists across reloads.
- [x] SPA fallback serves `dist/index.html` for all routes.

## Framework stress points exercised

- SPA router with parametric routes (`/profile/:acct`, `/status/:id`).
- OpenElement class-based page components receiving loader data.
- Functional components nested inside OpenElement render output.
- Preact island (`settings-island`) registered and hydrated.
- Design-system tokens injected via adopted stylesheets.
- Client-side cache layer backed by `localStorage`.
- Dual-mode API client (fixtures / live) returning `ApiResult<T>`.
