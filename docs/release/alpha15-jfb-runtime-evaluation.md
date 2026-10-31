# Alpha15 JFB runtime evaluation — alpha14 vs alpha15 (single machine)

Release evidence for the Alpha15 closeout: a **runtime** comparison of
`1.0.0-alpha.14` and `1.0.0-alpha.15` on the public js-framework-benchmark
(JFB) keyed workload, run **interleaved on one machine** with one Chrome build.
This document is the runtime counterpart to
[`alpha15-ab-evaluation.md`](./alpha15-ab-evaluation.md), which is a byte-level
footprint measurement. Byte size and runtime are different claims; neither
document is used to support the other.

**Terminology.** Everything here is a *single-machine internal measurement*.
It is **not** an official js-framework-benchmark submission, **not** a
leaderboard result, and **not** a same-load regression claim against other
frameworks. Only the two OpenElement revisions are compared, and only against
each other.

| | |
| --- | --- |
| Arm A | `@openelement/*` `1.0.0-alpha.14` — registry install (the published line) |
| Arm B | `@openelement/*` `1.0.0-alpha.15` — local tarballs packed from `6ae441644` |
| Harness | js-framework-benchmark `8103f1fe`, branch `add-openelement-keyed` |
| Runner | `webdriver-ts/dist/benchmarkRunner.js`, puppeteer runner, `--headless` |
| Rounds | 4 interleaved rounds A→B→A→B→A→B→A→B (8 runner invocations) |
| Environment | Apple M2 (8 cores), macOS 26.5.1 arm64, Chrome 155.0.8059.84, Node v24.18.0, npm 11.16.0 |

## Entries

Both arms are the same JFB entry source; **only `package.json`'s dependency
versions differ** (proved by `shasum` over every source file — see
`<scratch>/jfb-evidence/arm-source-shasum.txt`, with `<scratch>` a local out-of-tree directory):

- `frameworks/keyed/openelement-alpha14/` — `@openelement/element` `1.0.0-alpha.14`
  from the registry.
- `frameworks/keyed/openelement-alpha15/` — the same dependency resolved to the
  local `openelement-element-1.0.0-alpha.15.tgz` (plus the other local tarballs
  the entry needs).

**One source change was required** and is applied to both arms identically: the
Vite plugin entry moved from `@openelement/element/vite` to
`@openelement/compiler/vite`, per the published guide
(`www/content/docs/guide/getting-started.md`);
alpha15's `element` package has no `./vite` export while `compiler@alpha.14`
already provides one, so this is the documented usage that resolves on **both**
arms. Every other entry file is byte-identical to the pre-existing alpha.4-era
entry.

The historical alpha.4 entry is **not** part of this comparison: its recorded
framework id and environment predate the current harness, so its numbers are
unusable as a baseline. Its 15 result files were verified untouched
(sha256 before/after) and are listed only as a trend point in §7.

## Run protocol

- 15 official per-benchmark ids per invocation, in the harness's own order:
  `01_run1k`, `02_replace1k`, `03_update10th1k_x16`, `04_select1k`, `05_swap1k`,
  `06_remove-one-1k`, `07_create10k`, `08_create1k-after1k_x2`,
  `09_clear1k_x8`, `21_ready-memory`, `22_run-memory`, `25_run-clear-memory`,
  `40_sizes` (→ `41_size-uncompressed`, `42_size-compressed`, `43_first-paint`).
  `30_startup` (lighthouse) is not present in this harness revision and could not
  be selected.
- CPU channels: `total` and `script`, default harness iteration count
  (15 per benchmark per invocation) → n = 60 samples per benchmark per arm.
- Memory: one harness iteration per invocation → n = 4 per arm.
- Size/first-paint: deterministic subbenchmarks → n = 4 per arm.
- Interleaving is the point: A and B alternate within the session so ambient
  drift (thermal, background load) affects both arms.

## Results

Pooled per-benchmark medians, IQR and ratios (B = alpha15, A = alpha14):
`arm-report.md` §6 in the evidence bundle carries the full table. Headline
numbers:

| benchmark | channel | A median | B median | B/A median | B/A geo-mean |
| --- | --- | --- | --- | --- | --- |
| 01_run1k | total | 35.70 | 35.50 | 0.994 | 0.990 |
| 02_replace1k | total | 40.40 | 40.95 | 1.014 | 1.009 |
| 03_update10th1k_x16 | total | 22.95 | 24.00 | 1.046 | 1.016 |
| 04_select1k | total | 8.10 | 8.30 | 1.025 | 1.023 |
| 05_swap1k | total | 26.35 | 27.40 | 1.040 | 1.023 |
| 06_remove-one-1k | total | 17.80 | 18.05 | 1.014 | 1.007 |
| 07_create10k | total | 367.30 | 375.60 | 1.023 | 1.018 |
| 08_create1k-after1k_x2 | total | 42.75 | 42.70 | 0.999 | 1.009 |
| 09_clear1k_x8 | total | 18.80 | 18.20 | 0.968 | 0.963 |
| 07_create10k | script | 68.05 | 72.50 | 1.065 | 1.062 |

**CPU geometric mean over the nine CPU benchmarks**

| channel | basis | A | B | B/A |
| --- | --- | --- | --- | --- |
| total | per-benchmark median | 32.19 | 32.62 | **1.0133 (+1.33 %)** |
| total | per-benchmark geo-mean | 32.54 | 32.74 | 1.0062 (+0.62 %) |
| script | per-benchmark median | 8.66 | 8.80 | **1.0162 (+1.62 %)** |
| script | per-benchmark geo-mean | 8.82 | 8.79 | 0.9965 (−0.35 %) |

**Memory**

| benchmark | A median | B median | B/A median |
| --- | --- | --- | --- |
| 21_ready-memory | 1.1935 | 1.2260 | 1.0272 (+2.72 %) |
| 22_run-memory | 3.2975 | 3.3199 | 1.0068 (+0.68 %) |
| 25_run-clear-memory | 1.4226 | 1.4624 | 1.0279 (+2.79 %) |

**Size and first paint**

| subbenchmark | A median | B median | B/A median |
| --- | --- | --- | --- |
| 41_size-uncompressed | 118.60 | 132.20 | **1.1147 (+11.47 %)** |
| 42_size-compressed | 26.70 | 29.70 | **1.1124 (+11.24 %)** |
| 43_first-paint | 191.55 | 195.75 | 1.0219 (+2.19 %) |

## Threshold verdict (owner-approved criteria)

The owner-approved gate is: **geometric-mean CPU change > 5 %**, **any single
CPU/memory item > 10 %**, or **memory > 10 %** → the owner decides.

- **CPU geometric mean: not triggered** (+1.33 % total, +1.62 % script on the
  median basis; +0.62 % / −0.35 % on the per-benchmark geo-mean basis).
- **No single CPU benchmark and no memory item exceeds 10 %** (largest:
  `07_create10k` script +6.54 %, `03_update10th1k_x16` total +4.58 %;
  memory largest +2.79 %).
- **Surfaced separately, not folded into the verdict:** the JFB *size*
  subbenchmark is **+11.47 % uncompressed / +11.24 % compressed**, above the
  10 % single-item level. Size is not one of the three named threshold
  categories (CPU geo-mean, single CPU/memory item, memory), so it does not
  trigger mechanically — it is reported here so the owner can decide whether
  size belongs in the gate. The build output measured in the entries is
  121,133 → 135,062 B (+11.49 %).

No regression or improvement characterisation is asserted anywhere in this
document; the ratios above are the evidence.

## Deviations, failures and honesty notes

1. **One runner invocation failed and was retried.** Round 2, arm A
   (alpha14): `No commit event found for traces/…_02_replace1k_5.json` →
   `Cannot compute stats on empty array`, one plausibility check failed, exit 1.
   The harness's own retry still archived a complete 15-id JSON set (the failed
   iteration contributes no value), but the invocation is counted as failed in
   the log. Only 1 of 8 invocations; the same arm was clean in rounds 1/3/4, and
   a fourth interleaved pair was added so both arms end on a clean round.
2. **`--framework` must be given the `keyed/<dir>` form.** Without the prefix the
   runner silently reports "successful run" with zero benchmarks; the first
   attempt did exactly that and was discarded (recorded in the run log).
3. **`08_create1k-after1k_x2`** is the id present in harness `8103f1fe`; the
   `_x16` spelling does not exist there (the alpha.4-era result files also use
   `_x2`).
4. **Size is a build-output subbenchmark**, not a runtime one; it is included
   because JFB reports it and because it is the one figure above the 10 % level.
5. **alpha.4 is historical advisory only** — different framework id, different
   harness revision, different machine history. It is not compared and not
   gated; its files were verified byte-identical before and after this run.
6. The JFB aggregator (`npm run results`) was deliberately **not** run: its
   outputs (`results.json`, `results.ts`) were already dirty in the local clone
   and regenerating them was out of scope for a read-only measurement. Raw
   per-benchmark JSON is the evidence instead.

## Reproduction

1. In the JFB clone (`add-openelement-keyed`, harness `8103f1fe`), create the two
   entries under `frameworks/keyed/` with identical sources and the two
   dependency sets described above; `npm install` and `npm run build-prod` in
   each.
2. `node webdriver-ts/dist/benchmarkRunner.js --framework keyed/openelement-alpha14 keyed/openelement-alpha15 --benchmark <id list> --headless --chromeBinary "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"`,
   alternating arms at least three times on an otherwise idle machine.
3. Read the official per-benchmark JSON under `webdriver-ts/results/`; aggregate
   medians/IQR/geometric means per arm without touching the pre-existing alpha.4
   files.
4. Environment manifest, entry shasums, build logs, all raw JSON, all runner logs
   and the aggregation script are bundled in the release-evidence archive
   `alpha15-ab-jfb-evidence.tar.zst` (staged for the GitHub Release at
   publication; digest and the 503-entry sha256 manifest are recorded in
   [`evidence/alpha15/`](./evidence/alpha15/README.md)). `arm-report.md` §9 is
   the full inventory inside the archive.

## Artifact index

Members of the release-evidence archive (`jfb/` subtree; the digest is recorded
under [`evidence/alpha15/README.md`](./evidence/alpha15/README.md)):

| artifact | archive member |
| --- | --- |
| Full report (tables, protocol, deviations, advisory) | `jfb/arm-report.md` |
| Metrics tables | `jfb/metrics.md`, `jfb/metrics.json` |
| Raw per-benchmark JSON (8 × 15) | `jfb/json/` |
| Runner logs | `jfb/logs/` |
| Runner invocation records | `jfb/run-arms*.sh`, `jfb/run-arms*.out` |
| Environment manifest | `jfb/environment.txt` |
| Entry source shasums (same-source proof) | `jfb/arm-source-shasum.txt`, `jfb/arm-vs-original-shasum.txt` |
| Build/install logs | `jfb/build.log`, `jfb/install.log` |
| alpha.4 protection (before/after) | `jfb/alpha4-protection-before.txt`, `jfb/alpha4-protection-after.txt` |
| Aggregation script | `jfb/aggregate.py` |
