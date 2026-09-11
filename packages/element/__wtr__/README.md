# Browser conformance tests

This npm-local test world compiles representative Element fixtures, then runs
the resulting browser modules with Web Test Runner on Chromium, Firefox, and
WebKit.

```sh
deno task test:element:browser:gate
```

The positive suite covers compiled rendering, events, forms, shadow DOM,
hydration/claim behavior, and instance isolation. A fail-closed configuration
smoke proves the suite's own wiring fails correctly: a run that executes zero
tests is flipped to failed by the zero-tests-guard reporter and exits non-zero.

`package-lock.json` is committed because `npm ci` is part of the hermetic gate.
