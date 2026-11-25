# Qualification toolchain

The repository's qualification toolchain is pinned by four owner files, not by
the machine a run happens to execute on. This directory reproduces those pins as
a container recipe:

| pin | version | owner file | why |
| --- | --- | --- | --- |
| Node.js | `24.18.0` | `.node-version` | CI resolves the toolchain from this file (`actions/setup-node` `node-version-file`) |
| pnpm | `12.8.1` | root `package.json` `packageManager` | the package manager for every install/gate; CI installs the same exact pin |
| Playwright | `1.59.1` | root `package.json` devDependencies (`playwright` and `@playwright/test`, pinned equal) + `pnpm-lock.yaml` | browser revision set for the Chromium/Firefox/WebKit proofs |
| OS | Debian bookworm (slim) | `tools/release/toolchain/Dockerfile` base image | the glibc/libffi/libnss set the browsers run against |

The `check-toolchain-pins.ts` verifier checks that all four agree across
`.node-version`, `package.json`, `pnpm-lock.yaml`, `tools/release/toolchain/Dockerfile`,
the CI workflows, and this README — a drift in any one file fails it.

## Build

```sh
docker build -t openelement-toolchain:qualification tools/release/toolchain
```

For a frozen qualification, also pin the base image by digest so the same tag
cannot resolve to different bytes later:

```sh
docker pull node:24.18.0-bookworm-slim
docker image inspect --format '{{index .RepoDigests 0}}' node:24.18.0-bookworm-slim
# node:24.18.0-bookworm-slim@sha256:<digest>
docker build \
  --build-arg NODE_IMAGE=node:24.18.0-bookworm-slim@sha256:<digest> \
  -t openelement-toolchain:qualification tools/release/toolchain
docker image inspect --format '{{index .RepoDigests 0}}' openelement-toolchain:qualification
```

Record the resolved digests in the qualification report. The Dockerfile checks
`node --version` and `pnpm --version` during the build.

## Run the gates inside

The repository is bind-mounted; dependencies are installed into the mounted
workspace with the frozen lockfile (the image itself carries only the
toolchain):

```sh
docker run --rm -it -v "$PWD:/work" -w /work openelement-toolchain:qualification bash
# inside the container, once per mount:
pnpm install --frozen-lockfile
./node_modules/.bin/vp run check
./node_modules/.bin/vp run test
```

`pnpm install --frozen-lockfile` inside the image is the same command CI's
setup action runs; the pnpm store is not baked into the image so the lockfile is
always the authority.

## Verify the pins (no Docker required)

```sh
node tools/release/check-toolchain-pins.ts
```

The release preflight uses this check and fails if the pins disagree.
