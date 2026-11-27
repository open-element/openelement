# Keyed update in Chromium

[OpenElement #1633](https://github.com/open-element/openelement/issues/1633#issuecomment-7157521851) retains this benchmark and its noise evidence. This benchmark is report-only.

Each sample mounts a fresh generated custom element with 1,000 keyed table rows. The browser dispatches 16 synchronous clicks. Each click updates the label of every tenth row, starting at the first row. The timer measures the clicks, model updates, keyed reconciliation, and synchronous writes to real Chromium DOM nodes. Setup, warmups, and row identity and label checks happen outside the timed interval. The workload follows the shape of JFB’s `03_update10th1k_x16`. The timing excludes a dedicated layout or paint measurement.

Each run launches a fresh headless Chromium process, opens a 1280 × 900 viewport at DPR 1, and completes five warmup samples before it records 15 samples. The harness preserves each measured sample in order. It records Git revisions, the browser bundle digest, the workload and harness digest, browser version, machine and runtime details, and load averages. On macOS it also records the power source and available thermal summaries. Run it sequentially on one machine under stable power and with competing CPU-heavy jobs stopped.

## Run and compare

From the repository root after installing workspace dependencies and Playwright Chromium:

```sh
node benchmarks/keyed/run.ts --note 'AC power, no competing build' --out /tmp/keyed-candidate.json
node benchmarks/keyed/compare.ts noise /tmp/keyed-candidate.json
```

For an A/B comparison, install dependencies in a separate checkout with a compatible generated-element compiler. Run the same harness from the candidate checkout and pass the comparison checkout as the build root:

```sh
node benchmarks/keyed/run.ts --build-root /path/to/baseline --note 'AC power, no competing build' --out /tmp/keyed-baseline.json
node benchmarks/keyed/compare.ts ab /tmp/keyed-baseline.json /tmp/keyed-candidate.json
```

Use `--runs` and `--samples` to override the defaults for a harness check. For evidence, keep at least five launches per build and 15 samples per launch. The A/B command requires the same machine, browser, DPR, harness, and workload. Review the recorded load and power conditions alongside the comparison.

## Statistics

For each run, quartiles use linear interpolation at index `(n - 1) × q` in the sorted samples. Within-run spread is `100 × (Q3 - Q1) / median`. Consecutive run drift is `100 × abs(nextMedian - previousMedian) / previousMedian`. A pair clears the issue’s noise floor when its drift is below 3% and both runs’ spreads are below 5%. The report also shows whether every recorded pair clears the floor. A/B uses the median of each build’s run medians and reports `100 × (candidate - baseline) / baseline`. Positive values mean slower. Threshold outcomes use unrounded values, and the comparison exits successfully when it produces a valid report.
