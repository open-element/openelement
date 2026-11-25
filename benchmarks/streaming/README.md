# Archived streamed GET comparison

This manual benchmark compared first paint and content readiness for the same
slow loader under streamed and full response delivery. The current Native
Framework fixture omits both comparison routes. To reproduce the historical
measurement, use the [last fixture and benchmark revision with those routes](https://github.com/open-element/openelement/tree/cd7e9e065/benchmarks/streaming).
The measured readiness value includes Playwright polling overhead and bounds a
local browser comparison.
