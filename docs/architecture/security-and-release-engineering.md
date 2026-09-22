# Security and release engineering

Generic checks are delegated directly to mature tools: gitleaks, CodeQL, dependency review, actionlint, zizmor, Deno formatting/lint/typechecking, and Markdown lint. OpenElement-specific tests remain only for Element/Router semantics, package artifacts, browser/server graphs, and release state.

Executable specifications live in explicit fixtures, not in `tools/`. Source fixtures diagnose development regressions; release admission accepts only packed or published consumers installed outside the workspace. Test layers stay separate: Deno tests own pure semantics, Web Test Runner owns compiled Custom Element browser conformance, and Playwright owns document/application E2E.

A release is bound to one exact candidate SHA. Required CI, human review, a fresh independent verifier, Trusted Publishing/OIDC, package provenance, and explicit maintainer approval establish release trust. Git tags preserve pre-1.0 source history; GitHub Releases begin with `1.0.0-alpha.1` and release tooling must work with no older Release objects.

## CSRF same-origin floor and its residual window

The generated action POST handler carries a fail-closed same-origin floor (`packages/router/src/vite/internal/ssg/entry-action-runtime.ts`, codegen-pinned in `entry-renderer.test.ts`, behavior-pinned end to end by `tests/fixtures/router-request-time/e2e/csrf.spec.ts` and by the CSRF steps of `packages/router/__tests__/request-time-parity.test.ts`). A request is rejected when `Sec-Fetch-Site` is `cross-site`; when `Origin` is present, not `null`, and does not match the request URL origin (loopback hostname aliases `localhost` / `127.0.0.1` / `[::1]` count as the same origin); or when `Sec-Fetch-Site` is `same-site` but `Origin` is missing or `null` — a forged header, since browsers send `Origin` on POST (#921). `Origin: null` with `Sec-Fetch-Site: same-origin` is a browser that suppressed the referrer (#938) and passes. `OPEN_ELEMENT_DISABLE_CSRF=1` on the request env binding (`c.env` / Nitro runtime env) opts the whole floor out per environment.

Clients that omit **both** `Origin` and Fetch Metadata are allowed — that is the compatibility trade-off the floor deliberately makes for non-browser callers (curl, health probes, scripted clients). The residual window is that a browser-shaped request can present the same headers. #1382 narrows it without closing it:

An `application/x-www-form-urlencoded` or `multipart/form-data` body is _browser-shaped_: those are content types a native form submission produces, and an enhanced (JS) submit sends the same bytes on the fetch channel (ADR-0153's submission tuple). When such a body arrives with no `Origin` and no Fetch Metadata **and** carries browser navigation evidence — `Upgrade-Insecure-Requests: 1`, or the `text/html` Accept every form navigation sends — the request is cross-site by construction and is rejected with the same 403 (and the same RFC 9457 problem document on the fetch channel) the other rules answer with. The evidence test is what keeps tooling working: a scripted client sends neither marker and is still allowed. An absent `Origin` no longer passes merely by looking like a browser.

What stays open, deliberately, after #1382:

- `Origin: null` without Fetch Metadata on a browser-shaped body still passes: `null` is an origin the browser _sent_, and refusing it would break the #938 no-referrer page the rule exists to admit. Closing this needs a session-bound token, not a header heuristic.
- A form `enctype="text/plain"` body is not browser-shaped by the content-type rule, so it is judged by `Origin` / Fetch Metadata alone. Browsers have sent `Origin` on cross-origin POSTs since CORS, so this is a narrow gap for a client that suppresses all of it at once.
- The floor guards generated action POSTs only. Custom API routes and ambient-authentication apps must apply their own check — the middleware recipe on the guide's Security page is the supported shape; `middleware.corsOrigin` is not a CSRF control.
- `OPEN_ELEMENT_DISABLE_CSRF=1` disables every rule above, including the #1382 one. Keep it to test/dev environments; a request-env value that survives to production silently removes the floor.
- The cost of the rule: a browser posting through an intermediary that strips `Origin` and Fetch Metadata while preserving the form navigation's `Accept` / `Upgrade-Insecure-Requests` markers is now rejected. That is fail-closed by intent — such an intermediary also erases the evidence the floor reads — and the env opt-out is the escape hatch.

Framework-owned session APIs are not in the current contract: session transport, cookie attributes (`HttpOnly`, `Secure`, `SameSite`, `__Host-` prefix) and any token channel belong to the provider recipe, which must apply the same-origin floor on top of its own state changes.
