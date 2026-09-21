# @openelement/ui — Third-Party Notices

This file is part of the published package tarball. It records the
third-party components redistributed inside `@openelement/ui` itself. The
repository-level inventory (vendored assets, fonts, Prism) lives in the
repository root `THIRD_PARTY_NOTICES.md`; package-level copies like this one
exist because a package tarball cannot reach repository-root files.

## open-props 1.7.23

Design tokens carried verbatim into the generated token module
(`src/open-props-tokens.ts`) by the package's build-time adapter (task
`generate:ui-tokens`), which reads the
pinned npm dependency at generation time. Only these declarations ship: the
gray ramp, `--indigo-6`, two border sizes, the font weights, and two
line-heights — everything else in the token layer is first-party.

- Upstream: <https://github.com/argyleink/open-props> (tag `1.7.23`,
  <https://open-props.style>)
- License: MIT
- Copyright: Copyright (c) 2021 Adam Argyle

```text
MIT License

Copyright (c) 2021 Adam Argyle

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
