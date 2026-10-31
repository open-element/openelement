# Alpha15 release evidence — A/B and JFB (durable pointer)

This directory is the **durable pointer** for the two release-evidence documents:

- [`alpha15-ab-evaluation.md`](../../alpha15-ab-evaluation.md) — byte-level A/B
  inventory (baseline A `3613d841c`, mid arm, candidate C
  `d9eb755d3`, alpha14 arm `v1.0.0-alpha.14` = `e9af510de`).
- [`alpha15-jfb-runtime-evaluation.md`](../../alpha15-jfb-runtime-evaluation.md)
  — single-machine runtime comparison, alpha.14 registry install vs alpha.15
  local tarballs packed from `6ae441644`, harness `8103f1fe`.

The measurement was taken on `d9eb755d3`; the delta to the submitted final SHA
is documentation-only (see the A/B document's delta note).

`<scratch>` in this directory's evidence documents stands for a local
out-of-tree directory; the recorded session logs lived in one and are not
committed.

## What is tracked here, and what is a release asset

Tracked (small, reviewable):

| file | purpose |
| --- | --- |
| `report-repro-final.js` | re-reads the A/B byte/closure tables and asserts 86 selected cells against the recorded artifacts |
| `three-arm-repro.js` | re-asserts the two three-arm tables (22 selected cells) against the three-arm session artifacts |
| `late-host-walk-bench.js` | synthetic composed-tree walk benchmark used by ADR-0170's cost evidence |
| `sha256-manifest.txt` | sha256 of every file in the release-evidence archive (503 entries) |

Release asset (not committed — committed temporary evidence is forbidden by
CONTRIBUTING): **`alpha15-ab-jfb-evidence.tar.zst`**, 223,543 bytes,
sha256 `53d974907cb851b6b2d906465e46ac93f577f51552041c8a82195df7338e8451`,
524 members. The archive is **staged for the GitHub Release** and must be
attached at publication time at the same digest. The digest above is the
verification anchor; the staged copy is
`.artifacts/release-evidence/alpha15-ab-jfb-evidence.tar.zst` in the release
workspace (gitignored).

## Obtaining and verifying the raw package before approval

Reviewers must be able to obtain and verify these bytes *before* the publication
Release exists (review FR-06/REL-03). Three handoff options were evaluated:

- **(a) tracked `docs/release/evidence/alpha15/`** — rejected. The
  asset-provenance policy (`tools/repo/check-assets-provenance.ts`) governs
  `www/public/assets` only and neither authorizes nor forbids this directory;
  the governing rule is CONTRIBUTING.md:12 ("Do not commit … temporary
  evidence"), and the archive is a per-measurement binary whose publication form
  is a Release asset. Tracking it would put the raw bytes in every clone and
  every future diff while changing the provenance question from "do these bytes
  match the pinned digest?" to "did the commit that carried them modify them?".
- **(b) a CI artifact uploaded by a workflow job** — rejected as the primary
  path: the archive is produced on the measurement machine, so CI can only
  upload it if it is checked in or fetched first; CI artifacts also expire and
  require GitHub authentication, so they cannot be a reviewer's anonymous first
  verification.
- **(c) evidence-only prerelease on the release fork — chosen.** The owner
  creates one prerelease per candidate (tag `evidence-<sha7>`, marked
  `--prerelease`, explicitly *not* a product release). It is fetchable before
  approval, its bytes are anchored by the digest above, and the same bytes are
  re-attached to `v1.0.0-alpha.15` at publication — the handoff copy never
  replaces the publication asset.

Fetch and verify (either command downloads identical bytes; the verifier fails
closed on any digest, hash, assertion or documented-number mismatch).
`<scratch>` below is a local out-of-tree directory of your choice:

```sh
# Anonymous fetch from the public fork (no repository access needed):
gh release download evidence-ef5da43 -R SisyphusZheng/openelement \
  -p alpha15-ab-jfb-evidence.tar.zst -D <scratch>/rel03
# or, without gh:
curl -fsSL -o <scratch>/rel03/alpha15-ab-jfb-evidence.tar.zst \
  https://github.com/SisyphusZheng/openelement/releases/download/evidence-ef5da43/alpha15-ab-jfb-evidence.tar.zst

# Verify: pinned sha256 + byte size + 503 member hashes + 86/22 assertions
# + the JFB numbers recomputed from the raw package against metrics.json and
# the JFB document. Exit 1 on any failed check.
node tools/release/verify-evidence-archive.ts --archive <scratch>/rel03/alpha15-ab-jfb-evidence.tar.zst
# or let the verifier fetch it (same checks, digest comes from this README):
node tools/release/verify-evidence-archive.ts \
  --url https://github.com/SisyphusZheng/openelement/releases/download/evidence-ef5da43/alpha15-ab-jfb-evidence.tar.zst
```

Owner-gated creation of the handoff prerelease (one per candidate; REL-08
creates the real Release later with the same asset):

```sh
gh release create evidence-ef5da43 --repo SisyphusZheng/openelement \
  --target alpha15 --prerelease \
  --title "alpha15 raw measurement evidence (evidence-only)" \
  --notes "Evidence-only handoff for PR #1611 review. Not a product release." \
  .artifacts/release-evidence/alpha15-ab-jfb-evidence.tar.zst
```

**Created 2026-10-19** as the pre-approval handoff (REL-03):
<https://github.com/SisyphusZheng/openelement/releases/tag/evidence-ef5da43> —
the fetch-from-URL verification was run against it and printed
`VERDICT: verified` (14/14 checks). It is an evidence-only prerelease, never a
product release; the real `v1.0.0-alpha.15` Release may re-attach the same
asset at publication (REL-08).

Before approval, the checklist line for the PR body is the verifier's
`VERDICT: verified` line plus the `sha256` it printed — never a hand-written
table. If the digest or any documented number changes, the verifier fails and
the new bytes must not be cited as verifying the old measurement (QUAL-05
invalidation rule).

Archive layout:

| member | content | files |
| --- | --- | --- |
| `ab-3arm/` | three-arm sweep plus the main A→C sweep artifacts (`raw/`, `logs/`, `timings.jsonl`, `starter-*`, `*.log`) | 197 |
| `ab-d9/` | re-measured candidate sweep (candidate tree `3299f3f5`, 1584 files) | 142 |
| `jfb/` | JFB bundle: `metrics.json`, `json/` (8 runner invocations × 15 ids), `logs/`, `aggregate.py`, environment and shasum files | 150 |
| `harness/` | collector, sweep driver, starter legs, timing wrapper (historical scripts; paths inside them are the measurement machine's) | 12 |
| `reproducers/` | the two table reproducers as originally run, plus the walk benchmark | 3 |

## Verify the whole package (preferred)

`node tools/release/verify-evidence-archive.ts --archive <path-or-fetch>` runs
every check below in one command (digest, 503 member hashes, 86/22 assertions,
JFB recomputation); the raw commands are kept here for manual reproduction.

## Reproduce the table assertions

```sh
# inside the unpacked archive root
shasum -a 256 -c sha256-manifest.txt

AB_OUT=<unpacked>/ab-d9 \
  node report-repro-final.js docs/release/alpha15-ab-evaluation.md
# expected: REPORT↔ARTIFACT (final): 86 assertions, 0 failed

OE_AB_3ARM=<unpacked>/ab-3arm OE_AB_FINAL=<unpacked>/ab-d9 \
  node three-arm-repro.js docs/release/alpha15-ab-evaluation.md
# expected: THREE-ARM↔ARTIFACT: 22 assertions, 0 failed
```

The reproducer scripts assert the selected cells listed in the A/B document's
"Validation of this document" (byte totals, class splits, closure rows,
three-arm totals). They do not assert the Δ% columns or the advisory timing
table; the doc says so.

## Recompute the JFB tables

`jfb/metrics.json` carries the pooled medians/IQR/ratios and the
`cpu_geomean_ratios`/`threshold_flags` used by the JFB document;
`jfb/aggregate.py` is the aggregation script that produced it, and the
per-invocation JSON under `jfb/json/` is the raw input. `jfb/arm-report.md` §9
is the full artifact index. The JFB document is a single-machine internal
measurement, not a js-framework-benchmark submission and not a leaderboard
result.

## Synthetic walk benchmark (ADR-0170 cost evidence)

```sh
OE_PLAYWRIGHT_MODULE=<repo>/node_modules/playwright/index.js \
  node late-host-walk-bench.js
# run 1: {"elements":10100,"singleWalkP50Ms":0.3999…,"singleWalkP95Ms":0.6999…,
#         "worstMs":1.6999…,"eighteenWalkUpperBoundMs":12.599…}
# run 2: p50 0.3999…, p95 0.5999…, worst 1.5, eighteenWalkUpperBoundMs 10.799…
```

It is a replica of the production fused walk (same selector-list +
`shadowRoot` descent) on a 10,100-element composed tree with one pending tag and
no host. The production function is not exported for instrumentation, so this
measures the algorithm rather than an instrumented build; ADR-0170 records that
limitation, the numbers (p95 0.60–0.70 ms, 18-walk p95 bound 10.8–12.6 ms
across two runs), and the p95-based upper bound that stays above the design
record's 10 ms target.

## Boundaries

- Byte axis ≠ runtime axis; the two documents are not interchangeable and
  neither is a cross-framework ranking.
- The JFB document is a single-machine internal measurement (not a submission,
  not a leaderboard result, not a same-load comparison).
- alpha.4 JFB data is historical advisory only and is not part of the
  comparison.
- Timing in the A/B document is advisory-only and is not used for any claim.

## Sanitised replacement package (2026-10-31)

The original asset above is **historical and unchanged**: the PB-02 audit
records machine-specific build paths in its unpacked content (7,221
machine-path rows across 292 files; every row was classified during triage, and
0 credential/customer-data candidates were found under the recorded scanner
scope). Its bytes, digest and tags are not modified — only the sanitised
replacement below is new.

The replacement is published as an **evidence-only prerelease** (not a product
release) on the release fork:
<https://github.com/SisyphusZheng/openelement/releases/tag/evidence-sanitized-2026-10-31>

- asset: `alpha15-ab-jfb-evidence.sanitized-2026-10-31.tar.zst`
- **233,633 bytes**, sha256
  `7e9a4f6d678ef8222d6d39612fb7fa2c2b604370eb153413a41312f47cc52a60`,
  **525 members** (the original 524-member set plus `SANITIZATION.md`),
  **504 hashed entries** (the original 503-path set plus `SANITIZATION.md`).
- changes: machine-specific **path prefixes only** — home roots became
  `<HOME>`, CI workspace roots `<CI_WORKSPACE>`, scratch/worktree checkout
  roots `<CHECKOUT>`, temporary roots `<TMP>`, hosted toolchain cache roots
  `<TOOLCACHE>`. Relative tails are preserved; no measurement value,
  assertion, timing figure, failure log or conclusion was edited; per-file
  line counts are identical to the source (990 lines rewritten across 286
  files, 1,124 prefix occurrences). `SANITIZATION.md` inside the archive
  records the rules, the replacement statistics and the residual boundaries.

The replacement digest **does not replace or validate the original digest**.
Cite each measurement with the digest that actually carries it. The verifier
described above is anchored to the historical original's claims; for the
replacement use the copyable commands from the release note:

```sh
shasum -a 256 alpha15-ab-jfb-evidence.sanitized-2026-10-31.tar.zst
# expected 7e9a4f6d678ef8222d6d39612fb7fa2c2b604370eb153413a41312f47cc52a60
tar -tf alpha15-ab-jfb-evidence.sanitized-2026-10-31.tar.zst | wc -l   # 525
mkdir -p <scratch>/sanitized-check
tar -xf alpha15-ab-jfb-evidence.sanitized-2026-10-31.tar.zst -C <scratch>/sanitized-check
(cd <scratch>/sanitized-check && shasum -a 256 -c SHA256SUMS)                # 504 lines, all OK
```

Scope boundary: the PB-02 NOT SCANNED list applies — no full-history scan, no
other releases/assets, no Actions artifacts, no nested archives, and no
credential audit. Rule-based "no leaks found" is not proof of absence.
