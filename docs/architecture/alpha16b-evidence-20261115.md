---
status: active
topic: Alpha16b capability-train evidence appendix (2026-11-15)
summary: Five-field records for the Alpha16b server-rendering, lifecycle, retention and style slices, reproducible from a clone; LOCAL/CI provenance stated per row, no milestone exit claimed.
---

# Alpha16b evidence appendix (2026-11-15)

Records for the capability train that
[ADR-0180](../adr/ADR-0180-function-component-lifecycle-intrinsics.md) and
[ADR-0181](../adr/ADR-0181-generated-element-ssr-and-retention.md) authorize.
The form is the five-field record of
[the evidence baseline](./evidence-baseline.md): commit, status, command,
result, provenance. **No row is a milestone exit**, and a row whose status or
provenance says `dirty` is development feedback, not gate evidence.

Every command below runs from the repository root and is reproducible from a
clone at the named commit; nothing here depends on a machine-local path.

## 1. Generated-host SSR vertical (compiler producer → entry import → guard pair → nested renderer → DSD)

| Field | Record |
| --- | --- |
| commit | code commit `2545e0ac6` (the vertical), unchanged by the governance commits after it |
| status | clean worktree at capture (`git status --porcelain` empty) |
| command | `OPEN_ELEMENT_KEEP_INTEROP=1 pnpm --dir tests/fixtures/web-component-interop run qualify` |
| result | exit 0. Real build → temporary app → three engines: chromium `147.0.7727.15`, firefox `148.0.2`, webkit `26.4`; each `pageErrors: []`, DSD present before definition, in-place upgrade with the same `ShadowRoot` and shadow-node identities, `claimMutations: 0`, SSR markup/text/props parity, light child projected after `</template>`. Negatives `wrong-props` and `no-client-registration` red on all three. |
| provenance | `LOCAL` (no CI identity). The qualification harness is `tests/fixtures/web-component-interop/qualify.ts`; it aliases workspace **source**, so this is not packed-consumer evidence. |

Focused rows (Node + Chromium) at the same commit:
`packages/router/__tests__/generated-host-vertical.test.ts` (5),
`packages/element/__tests__/compiled-server/generated-host-nested.test.ts` (16),
`packages/router/__tests__/registry-marker-drift.test.ts` (11),
`packages/router/__tests__/entry-descriptor-generated-host.test.ts` (11).

## 2. Author lifecycle intrinsics

| Field | Record |
| --- | --- |
| commit | code commit `1b5c471d6` |
| status | clean worktree at capture |
| command | `node_modules/.bin/vitest run --project compiler packages/compiler/__tests__/semantic-ir/generated-element.lifecycle.test.ts packages/compiler/__tests__/semantic-ir/generated-element.lifecycle.browser.test.ts` |
| result | 18/18 passed (13 Node artifact rows A1–A13, 5 Chromium rows C1–C4: connect on mount and every reconnect with setup once, cleanup per disconnect, `onDispose` once at teardown after the connection cleanup, throwing callbacks released and rethrown, no SSR invocation). |
| provenance | `LOCAL` Chromium; no CI identity, no Firefox/WebKit (those stay M13). |

## 3. Depth-1 retained child instance

| Field | Record |
| --- | --- |
| commit | code commit `6bd3667d4` |
| status | clean worktree at capture |
| command | `node_modules/.bin/vitest run --project compiler packages/compiler/__tests__/semantic-ir/generated-element.root-instance.browser.test.ts packages/compiler/__tests__/semantic-ir/nested-instance-wiring.artifact.test.ts --project element packages/element/__tests__/compiled-runtime/instance-ledger.test.ts` |
| result | 51/51 passed. The R4 row reads root `1` / child `1` after remove → prop change → re-append, with the child setup counted once and the same root node; depth ≥ 2 keeps the legacy re-evaluating text (characterized, not accepted); the ledger's own rows pin pass epochs, abort-only-new eviction, staged rebinding and explicit release. |
| provenance | `LOCAL` Chromium; no CI identity. |

## 4. Build-time page classification (M01 C07 read)

| Field | Record |
| --- | --- |
| commit | code commit `6bd3667d4` |
| status | clean worktree at capture |
| command | `node_modules/.bin/vitest run --project router packages/router/__tests__/page-classification.test.ts` |
| result | 21/21 passed: class/function positives, the `__partProgram`-property function negative, class-only generated-byte equality, the mixed-entry `routeInfo.pageKind` fork, inline/unresolved/package-alias legacy fallbacks, the two-lane ambiguity refusal and the generated-element page refusal. |
| provenance | `LOCAL`; no CI identity. C07 is **PARTIAL — NOT RETIRED** (`m01-consumer-migration-matrix.md`); M11-2 and C08–C11 remain. |

## 5. Generated-island style declaration

| Field | Record |
| --- | --- |
| commit | code commit `1b5c471d6` |
| status | clean worktree at capture |
| command | `node_modules/.bin/vitest run --project router packages/router/__tests__/island-styles.test.ts packages/router/__tests__/island-style-build.test.ts` |
| result | 39/39 passed. A real Router CLI build emits one content-addressed `@scope`d `.css` asset and records it in the client asset manifest; the island chunk carries no CSS text; styled and unstyled sibling chunks are byte-identical (declaration adds 0 JS bytes); a shadow-root declaration fails the build with `OE_ISLAND_STYLE_SHADOW_UNWIRED`; a class-lane declaration fails with `OE_ISLAND_STYLE_LANE_UNSUPPORTED`. |
| provenance | `LOCAL`; no CI identity. Stylesheet **application** is not wired (GH #1800). |

## 6. M10 P1 — the old generic executor is still reachable (`NOT MET`)

| Field | Record |
| --- | --- |
| commit | `6bd3667d4` (re-captured at a clean SHA, double-run with `dist` deleted between runs) |
| status | clean worktree; `dist/**` is Git-ignored |
| command | `vp run --no-cache --fail-if-no-match --filter @openelement/www build` → `node tools/repo/check-browser-entry-graph.ts www/dist/client/.vite/oe-browser-entry-graph.json` (and the same pair for `apps/saas`) |
| result | both builds exit 0; the checker exits **1 / VIOLATED** for each app (`0 MET / 2 VIOLATED / 0 UNPROVEN`). All six classified generic-executor entries are loaded in both apps from the shared element-runtime chunk: `facade-host`, `runtime-program`, `runtime/fresh-dom`, `runtime/hydrate`, `runtime/kernel`, `runtime/program-kernel`. Artifact sha256 recorded in the run log; artifacts are ephemeral Git-ignored output. |
| provenance | `LOCAL`; no CI identity. `apps/saas` is outside CI coverage (pre-existing) and its `appShell → layout` change is a consumer fix. **P1 is NOT MET** and this row is the evidence of that, not a pass. |

## What these records do not do

- No milestone, gate, exit, closeout or release claim: M09, M10, M11, M12, M13
  and M14 keep their recorded statuses; P1–P5 stay NOT MET.
- No packed-consumer, Firefox/WebKit full-matrix, streaming/deferred or
  non-primitive-seed evidence.
- A `LOCAL` row is reproducible from a clone (the commands are in-tree) but
  carries no CI run identity. Canonical runs are produced on `main` after merge
  by the release train, never at PR time.
