# ADR-0171: The private-artifact static boundary — `dist/server` is never a public static resource

- Status: ACCEPTED; AMENDED 2026-10-31 (implemented:
  `packages/router/src/vite/internal/static-serve.ts` —
  `isPrivateArtifactRequest`, `tryStaticOutcome`, `dispatchRequest`)
- Decided: 2026-10-19 (alpha15 S-01 hotfix lane; the external PR #1611 review's
  FR-01 P1 release blocker, independently reproduced by the alpha15 verification
  on the real `oe start` entry)
- Preserves: ADR-0169 (the request-time rendering surface and the generated
  `dist/server/index.js` module contract are unchanged), ADR-0120 (the
  request-time foundation), ADR-0163 (P8 — the decision lives in the one module
  that already owns static dispatch: no new writer, the build-output →
  static-dispatch crossing is registered in
  [seams.md](../architecture/seams.md), and every consumer reads the same
  predicate)
- Related: the deployment guide's Nitro step ("Copy everything in `dist/`
  **except** `server/`"), the request-time fixture's e2e server (the same
  `dispatchRequest`), and the `static-serve` seam row for the error document
  ([seams.md](../architecture/seams.md))

## Context

When a route declares `renderIntent: { mode: 'dynamic' }` or a page exports an
action, the build emits `dist/server/`: `index.js` (the request-time entry),
`entry.js` (the SSR bundle), `server-manifest.json`, and `package.json` as the
ESM marker. The deployment guide already states the rule — "`dist/server` is
server code, not a public asset, and must never be published as one" — and the
Nitro sequence enforces it by copying everything **except** `server/` into
`nitro-public/`.

The framework's own static dispatch did not enforce it. `oe start` /
`npm start` dispatches a GET/HEAD that no request-time route claims to
`tryStatic`, and `tryStatic` only checked that the resolved file stayed inside
the output root. `dist/server/index.js` is inside that root, so it was served:

| request (real `oe start`, pre-fix) | status | body |
| --- | --- | --- |
| `/server/index.js` | 200 | 3,399 B of the generated request-time entry |
| `/server/entry.js` | 200 | the ~1.2 MB SSR bundle |
| `/%73erver/index.js` | 200 | same bytes, percent-encoded spelling |
| HEAD `/server/index.js` | 200 | — |

That is unauthenticated read access to the server bundle (bundled
loaders/actions/middleware, and any private constant the build inlined into
it), and it contradicts the guide in the same repository. A host or proxy rule
cannot fix it: `oe start` is the documented way to serve and verify the
artifact, and it is exactly the entry the guide's own "Verification" section
tells a deployer to curl. The boundary has to live in the shared dispatch, the
one place every consumer (start, preview, the fixture e2e servers, any
`createFetchHandler` embedder) already goes through.

## Decision

1. **One predicate owns the decision.** `isPrivateArtifactRequest(distDir,
   pathname)` in `packages/router/src/vite/internal/static-serve.ts` answers
   "does this request name the build's private artifact namespace?". The static
   boundary consults it before reading any candidate and again at each
   candidate's realpath; `dispatchRequest` maps the private outcome to a bare
   404 before the request-time fallback. There is deliberately **no** guard in
   `cli/start.ts`: a check that lives in one CLI would drift from preview, the
   fixture servers and future embedders, which is the defect class this ADR
   closes.
2. **The decision inputs are the post-decode, post-normalization, post-realpath
   path.** The pathname is percent-decoded exactly once (query dropped), then
   lexically normalized with `pathe.normalize` on an absolute path — so
   `//server`, `/foo/../server/x`, `/%73erver/x`, `/server%2Fx`, `/Server` and
   backslash spellings all reduce to the same relative path — and its first
   segment is compared to `server` case-insensitively. Independently, every
   candidate's canonical path is computed with `realpathSync` and refused when
   it lies inside `realpath(<distDir>/server)`; that is what catches an in-root
   symlink whose name looks public (`/leaked.js` → `dist/server/index.js`).
   Both halves decide on the normalized/canonical value, never on the raw URL
   text.
3. **The namespace is reserved by name, not sniffed by content.** Everything
   whose normalized first segment is `server` is refused, whether or not this
   build emitted artifacts and whether or not a file exists at the path. A name
   is checkable and stable; guessing which files are build artifacts is
   neither. The consequence is stated rather than hidden: an author's own
   `public/server/…` is not published either (documented in the deployment
   guide).
4. **The answer is a bare 404 with no body.** Not 403, which would confirm that
   a private namespace exists and invite enumeration, and not the SSG error
   document, which is a page-shaped answer for real routes; the reserved
   namespace needs no body and never reads the file. GET and HEAD answer
   identically — HEAD's body is dropped by the `node:http` bridge, so the
   status is the whole answer.
5. **Request-time routes keep their precedence.** The check sits after the
   admission split: an admitted request-time path (`isRequestTimePath`) still
   reaches `dist/server/index.js`, and every mutating method keeps its existing
   routing. The boundary owns the static answer for the requests the
   application did not claim; it does not remove a declared route from an app.
6. **Request-time entry loading is untouched.** The CLI still imports
   `dist/server/index.js` and dispatches admitted paths to it, and the fixture
   e2e server still delegates through the same module contract. Only the HTTP
   read of those files is refused.
7. **What remains public is unchanged:** prerendered pages, `client/` assets,
   `island-manifests/`, `public/` copies, and the `404.html` status contract
   for ordinary misses (all pinned by the existing rows, which still pass).

## Four-question review

The design constitution's P7 four questions, plus the two governance questions
this repository asks of a new surface (P5 deletability, P8 single writer):

1. **Platform capability (P1).** `decodeURIComponent`, path normalization and
   `realpath` are platform primitives. No dependency, no watcher, no config
   knob, no protocol change; the boundary is a pure function plus the
   filesystem calls the read path already made.
2. **Compile time vs runtime (P2).** Which URL a request carries is not a
   build-time fact, so the decision is necessarily per request. What the build
   *can* do — and already does — is emit the artifacts into one directory; this
   boundary turns that build-time emission fact into a runtime rule.
3. **Runtime shape and the server contract (P3).** Still
   `fetch(Request): Response`; existing statuses and bodies are unchanged for
   every path that is not private (the pre-existing test rows all pass). The
   cost is bounded: one additional realpath of `<distDir>/server` plus a
   candidate realpath pass inside the predicate, and one realpath pass on the
   read path (this duplication is deliberate: the point-of-read check closes
   the symlink-swap window between the two evaluations).
4. **Nearest prior art, and the deliberate difference (P7.4).** Static hosts
   (GitHub Pages, Netlify, Cloudflare Pages) define a publish directory, so
   anything outside it is structurally unreachable — but their rule is a host
   setting, and the deployment guide already asked humans to apply it by hand
   to `dist/`. Next.js makes the server/client module graph explicit; our
   generated output is a single `dist/` tree, so the equivalent is a reserved
   first segment. Our deliberate difference from both: the rule is enforced in
   the shared dispatch module, so it is on by default for every consumer
   instead of being a deployment instruction that can be missed. It is also
   deliberately not a configurable deny list — a security boundary that must be
   turned on is off in exactly the deployments that need it.

## Alternatives considered

- **Guard in `cli/start.ts` only.** Rejected: preview, the fixture servers and
  any embedder of `createFetchHandler` would keep the old behavior; the review
  asked for the shared boundary and the repository's own seam doctrine (P8)
  agrees.
- **Host/proxy rules (Cloudflare, Nitro `publicAssets`).** Rejected as the fix:
  they cover one deployment each and leave `oe start` serving the bundle; the
  guide's copy step stays as the covering rule for Nitro's own static layer.
- **Content sniffing or an artifact-filename allowlist** (`index.js`,
  `entry.js`, `server-manifest.json`). Rejected: generated names are an
  implementation detail that will change, and a miss is a leak.
- **403 Forbidden.** Rejected: it distinguishes "exists but private" from "does
  not exist", and the deployment's ordinary 404 behavior is the honest answer.
- **Answer with the build's `404.html` document.** Rejected for this namespace:
  the error document is chosen by the SSG for real page misses, and serving it
  here would read a file for a request the boundary can refuse outright.
- **Serve `server/` only when it contains no generated artifacts.** Rejected:
  not checkable, and it makes the boundary depend on directory contents that a
  later build step can change.

## Limits

- The reservation is by first path segment: `public/server/**` is no longer
  published. That is a deliberate, documented narrowing of the public
  namespace, not an accident.
- A request-time route the application explicitly declares under `/server/…`
  is admitted before this check and stays the application's own route. The
  generated `isRequestTimePath` predicate only matches declared dynamic
  patterns, so this is an explicit author choice rather than a hole.
- Nitro's static layer is the host's own (`nitro-public/`); this ADR governs
  the framework's dispatch. The guide's copy step (everything except
  `server/`) remains the covering rule there, and any future preset that serves
  `dist/` through this module inherits the boundary.
- The residual TOCTOU between a realpath check and the read is the same class
  the root-containment check already accepts (exploiting it needs write access
  to the static tree itself). The private rule is re-applied at the
  point-of-read realpath, so a symlink swapped between the two evaluations is
  still refused; only a swap between that realpath and `readFileSync` remains,
  which is the pre-existing residual.

## Consequences

- The deployment guide's promise is now enforced by the code it describes:
  `dist/server` is unreachable through every framework static dispatch, and
  the request-time server keeps working.
- `public/server/**` stops being published (documented in the deployment
  guide's static-output notes).
- Static dispatch performs one extra realpath of the private root and a second
  candidate realpath pass per request; measured against a static read this is
  noise, and the alternative (a single pass with no point-of-read re-check)
  would widen the symlink-swap window.
- The predicate is exported for tests, so the decision can be pinned directly
  as well as through `tryStatic`/`dispatchRequest`.

## Evidence

- **Unit matrix** — `packages/router/__tests__/static-serve.test.ts`: a real
  temporary dist with a generated-looking `dist/server/index.js`,
  `entry.js`, `server-manifest.json` and public files; the private spellings
  (`/server`, `/server/`, `/%73erver/index.js`, `/%53erver/index.js`,
  `/server%2Findex.js`, `//server/index.js`, `/foo/../server/…`,
  `/%2e%2e/server/…`, query strings, case variants, and an in-root symlink into
  `dist/server`) answer 404 on GET and HEAD with no artifact bytes in the body;
  public pages, hashed assets, the `404.html` status and an ordinary in-root
  symlink keep working; a fake request-time server that would answer 200 to
  everything is never handed a private path.
- **Handler form** — `packages/router/__tests__/start-request-containment.test.ts`:
  a real `dist/server/{index.js,package.json}` loaded through
  `importRequestTimeServer` and served through `createFetchHandler` — the exact
  `serveFetch` entry `oe start` and `oe start --mode=preview` run.
- **Real artifact + browser form** —
  `tests/fixtures/router-request-time/e2e/private-artifacts.spec.ts` (chromium;
  the fixture's e2e server uses the same `dispatchRequest`).
- **Real CLI** — `oe start` over a fresh fixture build: `/server/index.js`,
  `/%73erver/index.js`, `/server/entry.js`, `/Server/index.js`, `/server/`,
  `/foo/../server/index.js`, `?cache=1` and a planted in-root `leaked.js`
  symlink all answer 404 (9 B `Not Found`), HEAD answers 404, while `/`,
  `/guestbook`, `/panel-dynamic` and `/styled/42` answer 200 and the CLI logs
  `request-time server entry loaded (dynamic routes enabled)`. Pre-fix the same
  server answered 200 with the 3,399 B entry (external review FR-01, reproduced
  by the alpha15 verification).
- **Docs** — deployment and security guides (EN + ZH) state the boundary and
  that `oe start`/`npm start` refuse the namespace.

## Amendment (2026-10-31): accepted next architecture, implementation pending

The next output-safety direction is structural separation of the browser public
root from private server output, with a publish manifest defining the allowed
public set. Each deployment exit must prove either runtime validation or
packaging/upload filtering, including missing/stale manifest and traversal,
decode, case and symlink behavior. This is accepted direction, implementation
NOT RUN; directory names and manifest format are not frozen.

Keep the implemented predicate and all evidence above until every replacement
consumer is qualified. Hosts not using framework dispatch need their own
publish-root/filter proof; a stronger build layout does not silently retire the
existing deny boundary or authorize private reads. The independent Alpha17
URL-prefix migration does not block Alpha16 structural safety. A publish
allowlist is not HTML/serialization safety or application authorization.
[ADR-0174](./ADR-0174-generated-code-runtime-and-compatibility.md) separates these
proofs; rollback must preserve matched server/client artifacts.
