# ADR-0178: A published artifact is qualified against its release line

- Status: ACCEPTED
- Date: 2026-11-14
- Owner authorization: 2026-11-14 — #1717 named the defect and delegated the
  choice between (a) re-pin the starter in the next release and (b) judge the
  published starter by its release line. This record takes (b). It creates no
  release, tag, publication or milestone claim, so it needs no further ruling to
  land; the fallback's retirement (see "Written retirement condition") is a future
  owner action.
- Related: ADR-0151 (release-gate verdict contract), ADR-0175 (record vs view),
  ADR-0137, #1717, #1683, #1716

## Context

`tools/release/published-consumer-qualification.ts` qualifies the **published**
packages from the registry — the artifact adopters actually install. Until this
record it also asserted, inside
`assertPackageManagerNeutralManifest` (`:611-616` before this change), that the
published starter's `devDependencies.vite` equalled `VITE_DEV_PIN`, the constant
`tools/repo/deps-vite-check.ts`:30 exports for **this checkout**.

Those are two different subjects. `1.0.0-alpha.15` was published on 2026-10-19
carrying vite `8.0.16`; `main` moved to `8.1.6` in #1683 afterwards. The
published artifact did not move with it, so from #1683 onward every
qualification run of alpha.15 failed by construction:

```
Error: Published starter is not the package-manager-neutral form:
devDependency vite=8.0.16, expected the router's own pin 8.1.6
```

All four legs (Starter ubuntu/macos/windows, Published runtimes) failed on this
one assertion — #1717, dispatched run 42245102064 at `4615022`. The gate was not
detecting a defect in the artifact; it was restating a working-tree fact as if
it were a property of the release. A gate that cannot pass is not a strict gate,
it is an ignored one.

## Decision

A published artifact is judged by the release it shipped in. The qualification
resolves the expected starter vite pin from the **release tag's own copy of the
create template**, never from the working tree:

```
releaseLineVitePin(version) -> git show <tag>:packages/create/templates/package.json.tmpl
                            -> devDependencies.vite
```

- The tag is `create-v<version>` — the T7 per-package form
  `.github/workflows/autoflow-release.yml` "Create per-package GitHub Releases"
  creates with `gh release create --target <sha>`. `1.0.0-alpha.15` is the first
  release that has it (all six `<pkg>-v1.0.0-alpha.15` tags exist).
- The retired `v<version>` umbrella tag is deliberately **not** a candidate. It
  is the only record alpha.1–alpha.14 have, and those releases shipped the
  Vite+ catalog form whose starter carried no vite devDependency of its own —
  there is no pin to compare, so a fallback would be a compatibility path that
  can never produce a value.
- The resolved pin is a required argument to
  `assertPackageManagerNeutralManifest` / `assertStarterIsPackageManagerNeutral`
  — there is **no default**. A default would restore exactly this defect: an
  artefact qualified against whatever the caller's checkout happens to hold.
- Both published-artifact entry surfaces resolve it for the version they
  qualify: the qualification matrix (`--mode starter`) and the exact-version
  smoke (`--smoke`). `tools/release/consumer-packaged-starter.ts`:430 keeps
  `VITE_DEV_PIN`, and correctly so — it qualifies a **packed candidate built
  from this checkout**, where the checkout *is* the release.
- The check stays exact (`!==`, not a range, not a floor) and every other
  neutral-form assertion is unchanged. What changes is only *which record* the
  expected value comes from.
- `.github/workflows/published-consumers.yml` checks out with
  `fetch-depth: 0` + `fetch-tags: true`: a release tag points at the release
  commit, which a depth-1 graph does not hold once the release is older than
  the checkout.

## Why not (a) — re-pin the starter in the next release

(a) does not repair the gate, it postpones the failure by one release: the
moment `main`'s toolchain moves again, the same run fails again for the same
non-reason. The gate exists to qualify **published** registries, a set that is
older than `main` by definition, so a check that only works while published and
unpublished happen to agree cannot do its job.

## Why not a tracked copy in `docs/release/release-state.json`

`release-state.json` is the right shape for registry read-back (it already
records dist-tags, verified by `registry-drift-check.ts`), but adding a
`toolchain.vite` field would make it a **second** statement of a value the
release tag already carries, and a copy is only trustworthy with a drift guard
that re-reads the tag — i.e. the same tag read, with a second owner attached.
P6 forbids the parallel mechanism; the tag alone is the single authority.

## What actually moved

| File | Change |
| --- | --- |
| `tools/release/published-consumer-qualification.ts` | `releaseLineVitePin()` + `ReleaseLineVitePin`; the pin becomes a required parameter; both published call sites resolve it from the qualified version. `VITE_DEV_PIN` stays for `nodeConsumerManifest` (the harness installs vite itself to satisfy the router's optional peer) and is no longer an implicit expectation. |
| `tools/release/published-consumer-qualification.test.ts` | Every guard test states its release line explicitly; one regression test pins the alpha.15 shape (a `8.0.16` starter passing under the alpha.15 record and failing under a different one); two tests drive `releaseLineVitePin` against a scratch git repo — T7 tag, absence of a compatibility candidate, missing-tag failure, non-exact pin failure — so the resolver is proven without depending on which tags CI happens to fetch. |
| `.github/workflows/published-consumers.yml` | `fetch-depth: 0` + `fetch-tags: true` on both checkouts, with the reason inline. |

## Design-principle check

- **P6** — one authority for "what pin did this release carry": the release tag.
  No tracked copy, no drift guard, no second owner.
- **P8** — one owner per seam. "What the working tree pins" (owner:
  `deps-vite-check.ts`) and "what a release carried" (owner: its tag) are now
  separate seams with separate owners instead of one assertion that silently
  claimed to be both.
- **P5** — no compatibility path is introduced: one tag form, no fallback, and
  the implicit default is deleted rather than replaced.
- **P1/P2/P3** — no product runtime surface, no compile-time cost, no change to
  the WinterTC server contract. Tooling only.
- **P4** — unaffected; no HTTP or routing behaviour is touched.

## P7 four questions

1. **Can the platform do this?** The platform here is `git` and npm, both
   already in the qualification path; no new subsystem is introduced.
2. **Can the cost be paid at compile time?** n/a — release tooling.
3. **If runtime, does it read as platform code and honor the server contract?**
   n/a — no runtime or server surface.
4. **Nearest prior art, and is the difference deliberate?** The prior art is the
   defect itself: release gates that compare a published artifact against the
   current checkout (the `catch { return false }` class this module's header
   documents). Deliberate difference: expected values are pinned to the record
   the artifact was published under, and the verdict fails closed when that
   record is unreadable.

## Written retirement condition

None is needed: this record introduces no compatibility path. It deletes a
default (the implicit `VITE_DEV_PIN`) rather than adding one, and it accepts
exactly one tag form. P5 is satisfied by construction — there is nothing here
to retire later. A release whose `create-v<version>` tag is absent fails closed
and names the fetch that restores it.

## What this record does not do

- It does not re-publish, re-pin or re-tag anything, and does not change the
  starter's shipped pin. alpha.15 keeps `8.0.16`, which is what it shipped.
- It does not claim the alpha.15 qualification now passes end to end. It removes
  this false negative; the run must still be dispatched and its result recorded
  in the release evidence. A green matrix is not a milestone exit.
- It does not make pre-T7 releases qualifiable: alpha.1–alpha.14 have no
  `create-v<version>` tag and no neutral-form starter, so they fail closed with
  the cause named instead of passing silently.
- It grants no exemption from ADR-0137 §1, and it is not evidence for any P5
  inventory, milestone exit or owner decision (D2).
