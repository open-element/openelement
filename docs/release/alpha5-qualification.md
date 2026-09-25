# Alpha5 framework qualification (candidate evidence)

This is a candidate evidence map, not a release certificate. The source tree
still reports `1.0.0-alpha.4`; `1.0.0-alpha.5` has not passed exact-SHA release
CI, independent review, or human GO. An unpublished working-tree run does not
prove a packed or deployed artifact.

## Terms and ownership

| Term                      | Meaning                                                                                                                                                                                                        |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Rendered as data resolves | An opted-in dynamic document GET flushes a compiled shell after front-gate decisions, then backfills eligible Parts as their loader fields settle. It is not a new component or application programming model. |
| Part Program              | One versioned compiled program used by server serialization, fresh DOM, and existing-DOM claim. No runtime JSX or VDOM fallback is admitted.                                                                   |
| Part backfill             | Inert, version-bound document frames installed in owned Part ranges. It does not schedule island hydration.                                                                                                    |
| Island hydration          | Independent `load`/`idle`/`visible`/`media`/`only` activation. A streamed page may have no island.                                                                                                             |
| Nitro                     | Deployment exit for a Web `Request` to Web `Response` handler, not an application-facing API.                                                                                                                  |
| No-JS tail                | Readable arrival-order `<noscript>` content after the shell. Exact in-place placement without JavaScript is not promised (ADR-0159).                                                                           |

## Evidence by boundary

| Boundary          | Current local proof                                                                                                                                                                                                                                                    | Not proved by that proof                                                                    |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Build host        | Deno builds `tests/fixtures/router-native-framework`; generated route tests use `renderIntent.stream.defer`.                                                                                                                                                           | A plain Node or pnpm Framework Mode build; Deno remains required.                           |
| Generated handler | `packages/router/__tests__/stream-handler.test.ts` covers shell order, front gate, status/redirect, frozen headers and Cookie, post-flush error, timeout, cancellation, late result, and slow-reader backpressure. Element claim tests cover early/late Part adoption. | Every deployed host's disconnect semantics or an arbitrary JavaScript data-flow analyzer.   |
| Browser document  | `tests/fixtures/router-native-framework/e2e/stream-proof.spec.ts`: generated stream/off GET, delayed Part, late error, non-streaming action, JS claim and no-JS tail on Chromium, Firefox, WebKit.                                                                     | Streaming enhanced navigation GET or exact no-JS Part placement.                            |
| Nitro Node        | `tests/fixtures/router-nitro` builds the `node-server` preset and checks a local HTTP `ReadableStream` transport, shell/frame order, status, headers, Cookie and no-JS tail.                                                                                           | The fixture's transport probe is hand-authored; it is not itself the generated stream page. |
| Nitro Workers     | The same fixture builds `cloudflare_module` and imports/calls its `fetch` export under Deno with simulated env/context.                                                                                                                                                | This is a **module call**, neither a Workers simulator nor a real Cloudflare deployment.    |
| Packed consumers  | `tools/release gate:packed` exercises four tarballs and Native/Lit consumer worlds. Lit stays a separate graph; compiled Part streaming is Native-only.                                                                                                                | Exact alpha5 candidate SHA, deployed Workers, Bun formal support or third-party WC T1/T2.   |

Static GET and dynamic GET without `stream.defer` retain the existing
serializer; the byte-parity fixtures in
`packages/router/__tests__/renderer-adapter.test.ts` and
`packages/router/__tests__/entry-renderer.test.ts` cover their respective
generation boundaries. The reference off route is also asserted to omit
stream metadata. No single one of these tests proves _all_ static output;
candidate checks must verify generated artifacts again before a release.

Actions, uploads, webhooks, and security rejections are not streamed. Headers,
Cookie, status, redirects, CSP nonce, and front-gate loader values settle
before the first byte; a late error is an in-stream outcome and cannot rewrite
HTTP metadata. A deferred loader must not own late redirect or Cookie
decisions. See ADR-0158 and ADR-0159 while they remain **PROPOSED**.

## Local measurement

`benchmarks/streaming/measure.ts` rebuilds nothing: first build the Native
fixture, then run the Chromium measurement against its generated server. The
tracked `benchmarks/streaming/alpha5-local.json` records 10 raw observations
per mode with a simulated 100 ms loader, alternating route order, a fresh
page per observation, browser/toolchain identity and dirty-HEAD provenance.
Its local medians are 48/152 ms for streamed/off first contentful paint and
112.4/151.0 ms for streamed/off **Part-ready polling proxy**. The latter is
not standardized TTI; neither number is a CI timing threshold, official
cross-framework benchmark, or release qualification.

## Remaining release work

- Design owner must resolve ADR-0157/0158/0159; third-party WC T1/T2 and real
  Workers deployment are not established by current local evidence.
- Rebuild, regenerate, verify static-off parity, full browser/packed/fresh-clone
  gates and required CI on one exact candidate SHA. Keep advisory jobs separate
  from required release evidence.
- Obtain independent review and human GO. A remote PR merge, npm publication,
  and production deployment each require their own explicit authorization.
- Hosted Supabase, Stripe, SMTP, scanners and cloud-account qualification
  belong to `apps/saas`, not this framework release blocker chain.
