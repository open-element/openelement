# benchmarks/jfb — local js-framework-benchmark baseline (issue #1219)

A reproducible, standards-based keyed [js-framework-benchmark](https://github.com/krausest/js-framework-benchmark)
(JFB) implementation for OpenElement plus a comparator harness, built for
**diagnosis, not ranking**. "Top N" is not a criterion; the purpose is to
detect structural problems (Region pathology, kernel overhead, leaks,
claim≈rerender, broken partial updates) with full provenance.

## What is measured

- The stock JFB CPU benchmark set 01–09 (create 1k, replace 1k, partial
  update, select, swap, remove, create 10k, append 1k, clear) with the stock
  webdriver-ts warmup counts (5/5/3/1/5/5/5/5/5) and stock DOM verifications
  after every step.
- Memory probes 21 (ready), 22 (run 1k), 25 (run/clear ×5) plus the labeled
  OE extension 26 (run 10k), using `window.gc` + `performance.memory` in
  Chromium (stock JFB method).
- Timing semantics are the stock "afterframe" ones, reimplemented inline:
  `t0 = performance.now(); el.click();` resolve after one
  `requestAnimationFrame` + one `MessageChannel` task
  (`harness/spec.ts: AFTERFRAME_SOURCE`).

## Implementations

| id               | source                                                       |
| ---------------- | ------------------------------------------------------------ |
| `oe`             | `src/oe/jfb-table.tsx` compiled by the canonical compiler    |
| `vanillajs`      | stock, verbatim (no build step upstream)                     |
| `preact-signals` | stock, bundled (esbuild; stock uses rollup+babel)            |
| `lit`            | stock, bundled (esbuild + stock tsconfig decorator settings) |
| `solid`          | stock, bundled (babel-preset-solid, then esbuild)            |
| `vue`            | stock, bundled (@vue/compiler-sfc, then esbuild)             |
| `svelte`         | stock, bundled (svelte/compiler, then esbuild)               |

Stock sources are fetched at bench time from the pinned JFB commit
(`harness/fetch-stock.ts`) and verified against recorded SHA-256 digests;
nothing third-party is vendored into the repository. npm comparator builds
install the stock `package.json` dependency ranges into an out-of-tree
sandbox; resolved versions are recorded in the evidence.

### OE granularity (the non-cheating contract)

`src/oe/jfb-table.tsx` is **one** `@element` component whose render owns the
jumbotron buttons and one `<table>`; the 10,000 rows are plain `<tr>` DOM
inside a single keyed `each` Region (`key={row.id}`) — **not** 10,000 custom
elements. Grammar v1 admits no per-item event handlers, so row select/remove
use one delegated click handler on the table (the same delegation the stock
lit implementation uses); the keyed diff itself is genuine keyed
reconciliation. Selection is carried in row data (`cls`) so a select op
writes exactly the affected class attributes (stock vanillajs touches two
rows; OE's keyed diff updates the same two rows' attributes).

## Running

```sh
# full run: build everything (fetches pinned stock sources), drive Chromium,
# write benchmarks/jfb/evidence.json
deno run -A benchmarks/jfb/harness/run.ts --memory

# offline / fast iteration against a local JFB checkout at the pinned commit
deno run -A benchmarks/jfb/harness/run.ts --jfb-path /path/to/js-framework-benchmark \
  --local-only --iterations 3 --out /tmp/jfb.json
```

Flags: `--iterations N` (default 10; stock JFB uses 15), `--impl a,b`,
`--browser chromium|firefox|webkit` (memory probes are Chromium-only),
`--build-dir <dir>`, `--out <path>`.

## Fairness self-review (required by the packet)

1. **Same machine, same browser binary, same launch flags, sequential fixed
   order** (`oe`, `vanillajs`, then comparators). Thermal/background drift is
   a known residual risk; the run records `recordedAt`, raw samples, min/max
   so drift is visible in the data.
2. **Identical page structure and CSS**: every implementation serves the
   stock `index.html` (OE's page mirrors vanillajs with a component host) and
   the stock `currentStyle.css`, so layout/style cost is comparable.
3. **Identical driver**: one afterframe timing implementation, one
   verification implementation, fresh page per measured iteration (matching
   the stock playwright runner), no CPU throttling (stock default).
4. **Stock implementations unmodified**: comparator sources are byte-identical
   to the pinned JFB commit (SHA-256 enforced). Bundling replaces only the
   build orchestration (rollup/vite → esbuild) with equivalent transforms;
   recorded per comparator in evidence.
5. **No OE fast paths**: the OE implementation uses the public compiled
   pipeline (compiler → Part Program → kernel), the stock data generator
   verbatim, and performs the same DOM structure as every other
   implementation. No benchmark-only runtime changes were made.
6. **Randomness**: each implementation generates its own labels via the stock
   `_random` algorithm (stock behavior); label distributions are identical,
   so cross-implementation data variance matches upstream JFB practice.
7. **Known deviations** (also recorded in the evidence file): iteration count
   10 vs stock 15; swap-rows timed with afterframe (stock afterframe driver
   leaves swap unmeasured; the CDP variant times it); select measures 10
   sub-runs per iteration (stock `additionalNumberOfRuns: 10`); probe
   26_run10k-memory is an OE diagnostic extension; numbers are comparable
   only within a run — never to official JFB published results.

## Evidence

- `benchmarks/jfb/evidence.json` — committed browser results with full
  provenance (OE SHA, JFB commit, browser/toolchain versions, machine,
  warmup policy, raw samples, medians, geometric mean).
- `benchmarks/micro/micro-evidence.json` — kernel/Region/claim/compiler
  microbenchmarks on the counting fake DOM (no layout/paint).

## Tests

`harness.test.ts` and `../micro/micro.test.ts` are deterministic: they assert
spec/model consistency, OE granularity, DOM-op counts and evidence schema —
never timings.
