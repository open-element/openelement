# Browser conformance tests

This npm-local test world compiles representative Element fixtures, then runs
the resulting browser modules with Web Test Runner on Chromium, Firefox, and
WebKit.

```sh
deno task wtr:pilot:gate
```

The positive suite covers compiled rendering, events, forms, shadow DOM,
hydration/claim behavior, and instance isolation. The negative harness also
proves that a failing assertion, missing browser, broken transform, zero-test
run, or unmatched test glob exits non-zero.

`package-lock.json` is committed because `npm ci` is part of the hermetic gate.
