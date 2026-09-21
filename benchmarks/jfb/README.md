# js-framework-benchmark (JFB) local harness

The local, reproducible implementation of the
[js-framework-benchmark](https://github.com/krausest/js-framework-benchmark)
suite for OpenElement (issue #1219). It exists so a performance claim about
this framework is measured by code in this repository, against stock
implementations, with the driver semantics written down — not quoted from a
third-party run.

**Results are local output, never a committed baseline.** They land in
`.artifacts/jfb-evidence.json` (gitignored) or an explicit `--out` path, are
redacted (hostname, username, home, absolute build paths) and re-validated
before they are written.

## Run it

```bash
deno install                                        # harness deps (npm:typescript, playwright)

# 1. Build every implementation bundle (out of tree, default <os-tmp>/openelement-jfb)
deno run --allow-read --allow-write --allow-net --allow-env --allow-run --allow-sys benchmarks/jfb/harness/build.ts
# → prints a build directory

# 2. Measure
deno run --allow-read --allow-write --allow-net --allow-env --allow-run --allow-sys \
  benchmarks/jfb/harness/run.ts --build-dir <dir> --out /tmp/jfb.json
```

`deno task bench` (repo root) runs the benchmark self-checks: this harness's
`harness.test.ts` plus the micro benchmark suite. It does not launch browsers —
a full JFB run needs installed browsers and takes minutes.

## What is measured

Implementations (stock sources at the pinned JFB commit, `fetch-stock.ts`):
`oe` (this framework), `vanillajs`, `preact-signals`, `lit`, `solid`, `vue`,
`svelte`. Brotli bundle sizes plus the CPU benchmark set `01`–`09`, memory
probes `21`/`22`/`25`, and one explicitly labelled OpenElement diagnostic
(`26`, run-10k memory).

Deviations from the stock driver are recorded in the evidence itself
(10 iterations vs stock 15; `swap` measured with `afterframe` timing, which the
stock afterframe driver leaves unmeasured; no CPU throttling; probe 26).
Timing is the stock `afterframe` semantics (rAF + MessageChannel task) — see
`spec.ts`, which is dependency-free and shared by the runner, the tests, and
the serialized evidence.

## Files

| file                     | role                                                                                           |
| ------------------------ | ---------------------------------------------------------------------------------------------- |
| `harness/build.ts`       | builds `oe` with the workspace compiler, stock comparators in per-implementation npm sandboxes |
| `harness/fetch-stock.ts` | fetches stock sources at the pinned JFB commit (network, cached)                               |
| `harness/spec.ts`        | driver semantics + benchmark/metric definitions (dependency-free)                              |
| `harness/run.ts`         | Playwright-driven measurement, writes redacted evidence                                        |
| `harness/evidence.ts`    | redaction + validation of the evidence record                                                  |
| `harness/model.ts`       | stock comparator dependency model                                                              |
| `harness.test.ts`        | self-checks for the spec/evidence contract (runs in the default suite)                         |
| `src/oe/`                | the OpenElement implementation under test                                                      |

## Honesty rules

- Raw samples are never compared across machines as if they were a verdict;
  the micro benchmark and the size budgets are the gates that run in CI.
- A claim that a change made OpenElement faster must be backed by a rerun with
  the baseline file named (see `docs/maintainers/` for the current baseline).
- Machine identity never enters the evidence (see `evidence.ts`).
