# Keyed update in Chromium

[OpenElement #1633](https://github.com/open-element/openelement/issues/1633#issuecomment-7157521851) retains this benchmark and its noise evidence. This benchmark is report-only.

Each sample mounts a fresh generated custom element with 1,000 keyed table rows. The browser dispatches 16 synchronous clicks. Each click updates the label of every tenth row, starting at the first row. The timer measures the clicks, model updates, keyed reconciliation, and synchronous writes to real Chromium DOM nodes. Setup, warmups, and row identity and label checks happen outside the timed interval. The workload follows the shape of JFB’s `03_update10th1k_x16`. The timing excludes a dedicated layout or paint measurement.

Each run launches a fresh headless Chromium process, opens a 1280 × 900 viewport at DPR 1, and completes five warmup samples before it records 15 samples. The harness preserves each measured sample in order. It records Git revisions, the browser bundle digest, the workload and harness digest, browser version, machine and runtime details, and load averages. On macOS it also records the power source and available thermal summaries. Run it sequentially on one machine under stable power and with competing CPU-heavy jobs stopped.

## Run and compare

From the repository root after installing workspace dependencies and Playwright Chromium:

```sh
vp run --no-cache bench:keyed --note 'AC power, no competing build' --out /tmp/keyed-candidate.json
vp run --no-cache bench:keyed:compare noise /tmp/keyed-candidate.json
```

For an A/B comparison, install dependencies in a separate checkout with a compatible generated-element compiler. Run the same harness from the candidate checkout and pass the comparison checkout as the build root. The runner verifies that the resolved compiler, Element, and Protocol modules belong to that checkout and that those packages and workspace manifests are clean:

```sh
vp run --no-cache bench:keyed --build-root /path/to/baseline --note 'AC power, no competing build' --out /tmp/keyed-baseline.json
vp run --no-cache bench:keyed:compare ab /tmp/keyed-baseline.json /tmp/keyed-candidate.json
```

Use `--runs` and `--samples` to override the defaults for a harness check. For evidence, keep at least five launches per build and 15 samples per launch. The A/B command requires the same machine, browser, DPR, harness, and workload. Review the recorded load and power conditions alongside the comparison.

## Verify provenance refusals

In a disposable checkout with dependencies installed, run the command below.
Then change one input at a time and rerun it.

```sh
vp run --no-cache bench:keyed --build-root /path/to/disposable-checkout --runs 1 --samples 1
```

- Use a subdirectory of the checkout as `--build-root`.
- Point the checkout’s `node_modules/@openelement/compiler` or
  `node_modules/@openelement/element` symlink at another checkout.
- Point `packages/compiler/node_modules/@openelement/protocol` inside the
  disposable checkout at another checkout.
- Edit the disposable checkout’s `packages/protocol/src/index.ts`.

Each change must be refused before Chromium launches. Restore each input
before testing the next.

## Statistics

For each run, quartiles use linear interpolation at index `(n - 1) × q` in the sorted samples. Within-run spread is `100 × (Q3 - Q1) / median`. Consecutive run drift is `100 × abs(nextMedian - previousMedian) / previousMedian`. A pair clears the issue’s noise floor when its drift is below 3% and both runs’ spreads are below 5%. The report also shows whether every recorded pair clears the floor. A/B uses the median of each build’s run medians and reports `100 × (candidate - baseline) / baseline`. Positive values mean slower. Threshold outcomes use unrounded values, and the comparison exits successfully when it produces a valid report.

## 2026-11-27 local pilot

The [baseline receipt](results/2026-11-27-baseline.json) and
[candidate receipt](results/2026-11-27-candidate.json) contain all 150 samples.
The baseline uses `8d5058891`. The candidate uses the compiler and Element
sources at `35b196837` with harness commit `c9c92ee67`. These receipts were captured from isolated workspace installs before the runner added checkout validation, so they retain the original harness digest. An earlier checkout
did not compile the same fixture, so no timings from that checkout enter the
comparison.

The arms ran baseline first on an eight-core Apple M2, under AC power, at
DPR 1 in Chromium 147.0.7727.15. No checkout-owned pack, coverage, or browser
test was running concurrently. macOS Storage Management was active, the
one-minute load ranged from 7.77 to 8.18 during the capture, and macOS
reported no thermal warnings.

| Build | Median of five run medians | Run IQR/median range | Consecutive pairs within floor |
| --- | ---: | ---: | ---: |
| Baseline | 17.700 ms | 3.736–7.759% | 1 / 4 |
| Candidate | 17.300 ms | 3.216–5.491% | 3 / 4 |

The candidate's first four runs cleared the within-run spread floor, and all
four consecutive median deltas were below 3%. Its fifth run exceeded the
spread floor. The baseline also failed the floor across the full series.
The observed A/B delta was −2.26%. The background load and the observed
variance leave the direction of a runtime change unestablished.
