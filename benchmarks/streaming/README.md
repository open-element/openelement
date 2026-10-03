# Alpha5 stream comparison

Build the Native Framework fixture, then measure its generated streamed and
non-streamed GET paths with the same simulated slow loader:

```sh
pnpm --dir tests/fixtures/router-native-framework run build
node benchmarks/streaming/measure.ts --samples 10 --delay 100 \
  --out .artifacts/stream-alpha5-local.json
```

**Manual benchmark**: nothing invokes this script automatically — `pnpm run
bench` and CI never run it. Its output is local evidence: write it to the
gitignored `.artifacts/` tree or another explicit `--out` path, never into
the repository.

The raw result records each Chromium FCP and the time when Playwright observes
the owning Part's text, with a fresh page per sample and alternating route
order. The latter includes polling overhead and is **not standardized TTI**.
Both paths use the same compiled component shape and delay; only
`renderIntent.stream` differs. These local, dirty-checkout samples are advisory:
they are not a CI time gate, Nitro/Workers deployment proof, or an exact-SHA
release qualification. Rebuild and rerun on the review candidate commit.
