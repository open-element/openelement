import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { assertRejectsIncludes, assertThrowsIncludes } from '../../tests/lib/vitest-asserts.ts';
import { classifyVpPackLog } from '../lib/vp-pack.ts';
import {
  deriveAllDependencies,
  deriveDependencies,
  importsShapeFromPackageJson,
  type DeriveDepsIo,
  findAbsoluteFileUrlPayload,
  findRawTypeScriptPayload,
  npmPublishTag,
  publishPackage,
  type PublishPackageIo,
  publishRelease,
  type PublishReleaseIo,
  type ReleaseReceipt,
} from './publish-npm.ts';
import {
  NpmViewError,
  prereleaseTag,
  previousPrerelease,
  verifyNpmRelease,
} from './npm-release-verifier.ts';
import type { PackageInfo } from '../lib/package-graph.ts';

function pkg(name: string, version: string): PackageInfo {
  return {
    name,
    version,
    dir: `packages/${name.replace('@openelement/', '')}`,
    deps: [],
    exports: {},
    importKeys: new Set(),
    importValues: {},
  };
}

const io: DeriveDepsIo = {
  readPkgJson: () => ({ imports: {} }),
  readRootJson: () => ({ imports: {} }),
  readSrcFiles: () => [],
};

test('npm publish tag: the 1.0 prerelease line rides latest; earlier lines keep the channel tag', () => {
  // Owner ruling 2026-10-07: from the 1.0 line onward the prerelease IS the
  // shipping line, so `latest` points at it (the alpha alias is re-pointed
  // post-publish by the release workflow).
  expect(npmPublishTag('1.0.0-alpha.11')).toEqual('latest');
  expect(npmPublishTag('1.0.0-beta.1')).toEqual('latest');
  expect(npmPublishTag('1.0.0-rc.1')).toEqual('latest');
  expect(npmPublishTag('0.41.0-alpha.1')).toEqual('alpha');
  expect(npmPublishTag('0.41.0-rc.1')).toEqual('rc');
});

test('deriveDependencies includes an external npm dependency with a version', () => {
  // The derivation is source-driven against the workspace resolution set:
  // the declared dependency exists to resolve it.
  const localIo: DeriveDepsIo = {
    ...io,
    readRootJson: () => ({ imports: { react: 'npm:react@^18.2.0' } }),
    readSrcFiles: () => [`import { x } from 'react';`],
  };
  const deps = deriveDependencies(pkg('@openelement/element', '1.0.0'), [], localIo);
  expect(deps).toEqual({ react: '^18.2.0' });
});

test('deriveDependencies pins the maintained matching fork exactly (#1324)', () => {
  const localIo: DeriveDepsIo = {
    ...io,
    readRootJson: () => ({
      imports: {
        '@openelement/url-pattern-list': 'npm:@openelement/url-pattern-list@0.6.0',
      },
    }),
    readSrcFiles: () => [`import { match } from '@openelement/url-pattern-list';`],
  };
  const deps = deriveDependencies(pkg('@openelement/router', '0.44.0'), [], localIo);
  // Exact, never a caret range: consumers must not float past the qualified artifact.
  expect(deps).toEqual({ '@openelement/url-pattern-list': '0.6.0' });
});

test('deriveDependencies skips declared-but-unused externals', () => {
  // A dependency the source never imports does not ship: only imported
  // specifiers are derived.
  const localIo: DeriveDepsIo = {
    ...io,
    readRootJson: () => ({ imports: { react: 'npm:react@^18.2.0' } }),
    readSrcFiles: () => [`import { x } from '@openelement/router';`],
  };
  const all = [pkg('@openelement/element', '1.0.0'), pkg('@openelement/router', '1.2.3')];
  const deps = deriveDependencies(pkg('@openelement/element', '1.0.0'), all, localIo);
  expect(deps).toEqual({ '@openelement/router': '1.2.3' });
});

test('importsShapeFromPackageJson filters jsr: and workspace: entries', () => {
  // jsr: values never ship (packed modules carry no JSR bridge — enforced by
  // check-package-artifacts) and workspace: values resolve internally; the
  // package.json projection filters both before the derivation sees them.
  expect(
    importsShapeFromPackageJson({
      dependencies: {
        '@std/path': 'jsr:^1.0.0',
        '@openelement/element': 'workspace:*',
        react: '^18.2.0',
      },
    }),
  ).toEqual({ react: 'npm:react@^18.2.0' });
});

test('deriveDependencies resolves an internal workspace dependency from source', () => {
  const localIo: DeriveDepsIo = {
    ...io,
    readSrcFiles: () => [`import { x } from '@openelement/router';`],
  };
  const all = [pkg('@openelement/element', '1.0.0'), pkg('@openelement/router', '1.2.3')];
  const deps = deriveDependencies(pkg('@openelement/element', '1.0.0'), all, localIo);
  expect(deps).toEqual({ '@openelement/router': '1.2.3' });
});

test('deriveDependencies materializes a root-mapped npm dependency used by source', () => {
  const localIo: DeriveDepsIo = {
    ...io,
    readRootJson: () => ({ imports: { react: 'npm:react@^18.2.0' } }),
    readSrcFiles: () => [`import { y } from 'react';`],
  };
  const deps = deriveDependencies(pkg('@openelement/element', '1.0.0'), [], localIo);
  expect(deps).toEqual({ react: '^18.2.0' });
});

test('deriveDependencies keeps direct root-mapped TypeScript 6 exact', () => {
  const localIo: DeriveDepsIo = {
    ...io,
    readRootJson: () => ({ imports: { typescript: 'npm:typescript@6.0.3' } }),
    readSrcFiles: () => [`import ts from 'typescript';`],
  };
  const deps = deriveDependencies(pkg('@openelement/element', '1.0.0'), [], localIo);
  expect(deps).toEqual({ typescript: '6.0.3' });
});

test('deriveDependencies throws when a root-mapped npm dependency has no version', () => {
  const localIo: DeriveDepsIo = {
    ...io,
    readRootJson: () => ({ imports: { react: 'npm:react' } }),
    readSrcFiles: () => [`import { y } from 'react';`],
  };
  assertThrowsIncludes(
    () => deriveDependencies(pkg('@openelement/element', '1.0.0'), [], localIo),
    Error,
    'no version',
  );
});

test('deriveAllDependencies reads root imports once for the full package graph', () => {
  let rootReads = 0;
  const localIo: DeriveDepsIo = {
    ...io,
    readRootJson: () => {
      rootReads++;
      return { imports: { react: 'npm:react@^18.2.0' } };
    },
    readSrcFiles: () => ["import 'react';"],
  };
  const packages = [pkg('@openelement/element', '1.0.0'), pkg('@openelement/router', '1.0.0')];
  const dependencies = deriveAllDependencies(packages, localIo);
  expect(rootReads).toEqual(1);
  expect(dependencies.get('@openelement/element')).toEqual({ react: '^18.2.0' });
  expect(dependencies.get('@openelement/router')).toEqual({ react: '^18.2.0' });
});
test('findRawTypeScriptPayload flags sources but keeps declarations and templates', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pack-raw-typescript-'));
  try {
    await mkdir(`${root}/nested`);
    await writeFile(`${root}/entry.js`, 'export {};');
    await writeFile(`${root}/entry.d.ts`, 'export declare const entry: true;');
    await writeFile(`${root}/nested/source.ts`, 'export const source = true;');
    await writeFile(`${root}/nested/view.tsx`, 'export const view = <div />;');
    await writeFile(`${root}/nested/template.tsx.tmpl`, '<div />');

    expect(findRawTypeScriptPayload(root)).toEqual(['nested/source.ts', 'nested/view.tsx']);
    for (const retained of ['entry.js', 'entry.d.ts', 'nested/template.tsx.tmpl']) {
      await stat(`${root}/${retained}`);
    }
  } finally {
    await rm(root, { recursive: true });
  }
});

test('findAbsoluteFileUrlPayload fails closed on machine paths in inline maps', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pack-absolute-urls-'));
  try {
    // A generic file:// URL in a comment is authored content, not a leak.
    await writeFile(
      `${root}/clean.js`,
      "export const x = 1; // see 'file:///client/islands/client.js'\n",
    );
    await writeFile(`${root}/plain.txt`, 'file:///Users/somebody/project\n');
    expect(findAbsoluteFileUrlPayload(root)).toEqual([]);

    await writeFile(
      `${root}/mapped.js`,
      'export {};\n//# sourceMappingURL=data:application/json;base64,' +
        btoa(JSON.stringify({ sources: ['file:///Users/somebody/project/src/a.ts'] })),
    );
    expect(findAbsoluteFileUrlPayload(root)).toEqual(['mapped.js']);

    await writeFile(
      `${root}/portable.js`,
      'export {};\n//# sourceMappingURL=data:application/json;base64,' +
        btoa(JSON.stringify({ sources: ['../src/a.ts'] })),
    );
    expect(findAbsoluteFileUrlPayload(root)).toEqual(['mapped.js']);
  } finally {
    await rm(root, { recursive: true });
  }
});

test('publishPackage skips an immutable version that already exists', async () => {
  const published: string[][] = [];
  const logs: string[] = [];
  const publishIo: PublishPackageIo = {
    versionExists: () => Promise.resolve(true),
    publish: (args) => {
      published.push(args);
      return Promise.resolve();
    },
    log: (message) => logs.push(message),
  };

  await publishPackage(pkg('@openelement/element', '0.41.0-alpha.13'), false, publishIo);

  expect(published).toEqual([]);
  expect(logs).toEqual(['[npm] @openelement/element@0.41.0-alpha.13 already published; skipping.']);
});

test('publishPackage does not move latest after a prerelease publish (#607)', async () => {
  const published: string[][] = [];
  const publishIo: PublishPackageIo = {
    versionExists: () => Promise.resolve(false),
    publish: (args) => {
      published.push(args);
      return Promise.resolve();
    },
    log: () => {},
  };

  await publishPackage(pkg('@openelement/element', '0.41.0-alpha.13'), false, publishIo);

  expect(published.length).toEqual(1);
  expect(published[0].slice(0, 2)).toEqual([
    'publish',
    'packages/element/openelement-element-0.41.0-alpha.13.tgz',
  ]);
  expect(published[0].slice(-2)).toEqual(['--tag', 'alpha']);
  expect(published.some((args) => args.includes('latest'))).toEqual(false);
});

test('publishPackage leaves latest to the npm default for stable versions', async () => {
  const published: string[][] = [];
  const publishIo: PublishPackageIo = {
    versionExists: () => Promise.resolve(false),
    publish: (args) => {
      published.push(args);
      return Promise.resolve();
    },
    log: () => {},
  };

  await publishPackage(pkg('@openelement/element', '0.41.0'), false, publishIo);

  expect(published.length).toEqual(1);
  expect(published[0].includes('--tag')).toEqual(false);
});

test('publishPackage does not touch dist-tags during a dry run', async () => {
  const published: string[][] = [];
  const publishIo: PublishPackageIo = {
    versionExists: () => Promise.resolve(false),
    publish: (args) => {
      published.push(args);
      return Promise.resolve();
    },
    log: () => {},
  };

  await publishPackage(pkg('@openelement/element', '0.41.0-alpha.13'), true, publishIo);

  expect(published.length).toEqual(1);
  expect(published[0].includes('--dry-run')).toEqual(true);
});

test('publishPackage skips after an E403 only when the version is actually published (#1038)', async () => {
  // E403 is not unique to already-published (token scope, 2FA policy): the
  // registry is re-queried after the failure, and the skip requires the
  // version to be visible.
  let queries = 0;
  const logs: string[] = [];
  const publishIo: PublishPackageIo = {
    versionExists: () => {
      queries++;
      return Promise.resolve(queries > 1);
    },
    publish: () => Promise.reject(new Error('npm error code E403\nnpm error 403 Forbidden')),
    log: (message) => logs.push(message),
  };

  await publishPackage(pkg('@openelement/element', '0.41.0'), false, publishIo);

  expect(queries).toEqual(2);
  expect(logs).toEqual(['[npm] @openelement/element@0.41.0 already published; skipping.']);
});

test('publishPackage propagates an E403 when the version is not actually published (#1038)', async () => {
  // Token-scope/2FA E403 with the version absent from the registry: the old
  // code logged "already published" and went green with nothing published.
  let queries = 0;
  const logs: string[] = [];
  const publishIo: PublishPackageIo = {
    versionExists: () => {
      queries++;
      return Promise.resolve(false);
    },
    publish: () => Promise.reject(new Error('npm error code E403\nnpm error 403 Forbidden')),
    log: (message) => logs.push(message),
  };

  await assertRejectsIncludes(
    () => publishPackage(pkg('@openelement/element', '0.41.0'), false, publishIo),
    Error,
    'E403',
  );
  expect(queries, 'pre-publish check plus the post-E403 re-check').toEqual(2);
  expect(logs, 'no misleading already-published line').toEqual([]);
});

// npm release verification tests.

const VERSIONS_FIELD = (versions: string[]) => JSON.stringify(versions);

test('verifyNpmRelease retries transient registry misses and verifies the matching tag', async () => {
  const calls: string[] = [];
  const sleeps: number[] = [];
  let misses = 2;

  await verifyNpmRelease({
    version: '0.41.0-alpha.13',
    packages: ['element'],
    delaysMs: [0, 1, 2, 4, 8, 15],
    sleep: (ms) => {
      sleeps.push(ms);
      return Promise.resolve();
    },
    query: (specifier, field) => {
      calls.push(`${specifier}:${field}`);
      if (field === 'versions') return Promise.resolve(VERSIONS_FIELD(['0.41.0-alpha.12']));
      if (misses-- > 0) {
        throw new NpmViewError('registry returned 404', true);
      }
      return Promise.resolve('0.41.0-alpha.13');
    },
  });

  expect(calls).toEqual([
    '@openelement/element:versions',
    '@openelement/element@0.41.0-alpha.13:version',
    '@openelement/element@0.41.0-alpha.13:version',
    '@openelement/element@0.41.0-alpha.13:version',
    '@openelement/element:dist-tags.alpha',
  ]);
  expect(sleeps).toEqual([1, 2]);
});

test('verifyNpmRelease default retry schedule covers npm propagation delays', async () => {
  const sleeps: number[] = [];
  let misses = 7;
  await verifyNpmRelease({
    version: '1.0.0',
    packages: ['element'],
    sleep: (ms) => {
      sleeps.push(ms);
      return Promise.resolve();
    },
    query: () => {
      if (misses-- > 0) throw new NpmViewError('registry has not propagated yet', true);
      return Promise.resolve('1.0.0');
    },
  });
  expect(sleeps).toEqual([5_000, 15_000, 30_000, 60_000, 120_000, 180_000, 300_000]);
  expect(sleeps.reduce((total, delay) => total + delay, 0)).toEqual(710_000);
});

test('verifyNpmRelease does not require latest === prerelease (#607)', async () => {
  // Prerelease only checks the alpha/beta/rc tag; latest may stay on stable.
  await verifyNpmRelease({
    version: '0.41.0-alpha.13',
    packages: ['element'],
    delaysMs: [0],
    sleep: () => Promise.resolve(),
    query: (_specifier, field) => {
      if (field === 'versions') return Promise.resolve(VERSIONS_FIELD(['0.41.0-alpha.12']));
      return Promise.resolve(field === 'dist-tags.latest' ? '0.41.2' : '0.41.0-alpha.13');
    },
  });
});

test('verifyNpmRelease rejects a release whose predecessor is unpublished (#869-2.5)', async () => {
  await assertRejectsIncludes(
    () =>
      verifyNpmRelease({
        version: '0.41.0-alpha.13',
        packages: ['router'],
        delaysMs: [0, 1, 2],
        sleep: () => Promise.resolve(),
        query: (_specifier, field) =>
          field === 'versions'
            ? Promise.resolve(VERSIONS_FIELD(['0.41.0-alpha.10', '0.41.0-alpha.11']))
            : Promise.resolve('0.41.0-alpha.13'),
      }),
    Error,
    'Continuity check failed for 0.41.0-alpha.13: predecessor 0.41.0-alpha.12 is not among published versions',
  );
});

test('verifyNpmRelease reports the final observed state after exhausting retries', async () => {
  await assertRejectsIncludes(
    () =>
      verifyNpmRelease({
        version: '0.41.0-alpha.13',
        packages: ['router'],
        delaysMs: [0, 1, 2],
        sleep: () => Promise.resolve(),
        query: () => {
          throw new NpmViewError('npm error E404', true);
        },
      }),
    Error,
    // A persistently E404 name reads as "no registry history" — the
    // first-publish continuity exemption — and the failure surfaces at the
    // version verification step with the observed registry state.
    'version verification failed after 3 attempts: expected=0.41.0-alpha.13, observed=<query failed>',
  );
});

test('verifyNpmRelease does not retry malformed registry responses', async () => {
  let attempts = 0;
  await assertRejectsIncludes(
    () =>
      verifyNpmRelease({
        version: '0.41.0-rc.1',
        packages: ['element'],
        delaysMs: [0, 1, 2],
        sleep: () => Promise.resolve(),
        query: () => {
          attempts++;
          throw new NpmViewError('unexpected npm JSON value', false);
        },
      }),
    NpmViewError,
    'unexpected npm JSON value',
  );
  expect(attempts).toEqual(1);
});

test('prereleaseTag accepts alpha beta and rc lines', () => {
  expect(prereleaseTag('1.2.3-alpha.4')).toEqual('alpha');
  expect(prereleaseTag('1.2.3-beta.4')).toEqual('beta');
  expect(prereleaseTag('1.2.3-rc.4')).toEqual('rc');
});

test('prereleaseTag returns null for stable versions and rejects malformed ones', () => {
  expect(prereleaseTag('0.41.0')).toEqual(null);
  expect(prereleaseTag('0.41.0-alpha.19')).toEqual('alpha');
});

test('verifyNpmRelease verifies stable releases against latest only', async () => {
  const calls: string[] = [];
  await verifyNpmRelease({
    version: '0.41.0',
    packages: ['element'],
    delaysMs: [0],
    sleep: () => Promise.resolve(),
    query: (specifier, field) => {
      calls.push(`${specifier}:${field}`);
      return Promise.resolve('0.41.0');
    },
  });
  expect(calls).toEqual([
    '@openelement/element@0.41.0:version',
    '@openelement/element:dist-tags.latest',
  ]);
});

test('previousPrerelease returns the predecessor on the same line', () => {
  expect(previousPrerelease('0.41.0-alpha.15')).toEqual('0.41.0-alpha.14');
  expect(previousPrerelease('0.41.0-rc.2')).toEqual('0.41.0-rc.1');
  expect(previousPrerelease('0.41.0-alpha.1')).toEqual(null);
  expect(previousPrerelease('0.41.0')).toEqual(null);
});

test('classifyVpPackLog classifies errors, unexpected warnings and undeclared unresolved imports', () => {
  const parsed = classifyVpPackLog(
    "src/a.ts (1:1) [UNRESOLVED_IMPORT] Could not resolve 'lit' in src/a.ts\n" +
      "src/b.ts (2:2) [UNRESOLVED_IMPORT] Could not resolve 'undeclared-pkg' in src/b.ts\n" +
      'ERROR something broke\n' +
      'warn: deprecated option used\n',
    { has: (specifier) => ['lit', '@openelement/element'].includes(specifier) },
  );
  expect(parsed.errors).toEqual(['ERROR something broke']);
  expect(parsed.unexpectedWarnings).toEqual(['warn: deprecated option used']);
  expect(parsed.unresolvedImports.sort()).toEqual(['lit', 'undeclared-pkg']);
  expect(parsed.disallowedUnresolved).toEqual(['undeclared-pkg']);
});

test('classifyVpPackLog leaves clean vp pack output empty', () => {
  expect(
    classifyVpPackLog('ℹ dist/index.js 1.2 kB\n✔ Build complete in 1s\n', { has: () => false }),
  ).toEqual({
    errors: [],
    unexpectedWarnings: [],
    unresolvedImports: [],
    disallowedUnresolved: [],
  });
});

test('classifyVpPackLog treats ANSI-colored output like plain text', () => {
  const parsed = classifyVpPackLog('\x1b[31mERROR\x1b[0m boom\n', { has: () => false });
  expect(parsed.errors).toEqual(['ERROR boom']);
});

// ─── Post-publish release flow (receipt + partial publish) ───────────

function releasePackages(): PackageInfo[] {
  return [
    pkg('@openelement/element', '1.0.0-alpha.1'),
    pkg('@openelement/router', '1.0.0-alpha.1'),
    pkg('@openelement/create', '1.0.0-alpha.1'),
    pkg('@openelement/ui', '1.0.0-alpha.1'),
  ];
}

function releaseIo(overrides: Partial<PublishReleaseIo> = {}): {
  io: PublishReleaseIo;
  receipt: () => ReleaseReceipt | undefined;
  verified: () => boolean;
} {
  let written: ReleaseReceipt | undefined;
  let verifyCalled = false;
  const io: PublishReleaseIo = {
    publish: () => Promise.resolve(),
    verify: () => {
      verifyCalled = true;
      return Promise.resolve();
    },
    sha: () => Promise.resolve('a'.repeat(40)),
    tree: () => Promise.resolve('b'.repeat(40)),
    tarballHash: (entry) => Promise.resolve(`sha256:${entry.name}`),
    writeReceipt: (value) => {
      written = value;
      return Promise.resolve();
    },
    log: () => {},
    ...overrides,
  };
  return { io, receipt: () => written, verified: () => verifyCalled };
}

test('publishRelease verifies every package and writes a bound receipt', async () => {
  const { io, receipt, verified } = releaseIo();
  const result = await publishRelease(releasePackages(), io);
  expect(result.result).toEqual('published');
  expect(result.packages.every((entry) => entry.published && entry.verified)).toEqual(true);
  expect(result.sha).toEqual('a'.repeat(40));
  expect(result.tree).toEqual('b'.repeat(40));
  expect(Object.keys(result.tarballs).length).toEqual(4);
  expect(verified()).toEqual(true);
  expect(receipt()?.result).toEqual('published');
});

test('publishRelease records a partial publish and does not claim success', async () => {
  const { io, receipt, verified } = releaseIo({
    publish: (entry) =>
      entry.name === '@openelement/router'
        ? Promise.reject(new Error('E403 forbidden'))
        : Promise.resolve(),
  });
  const result = await publishRelease(releasePackages(), io);
  expect(result.result).toEqual('partial');
  expect(verified(), 'verification must not run for a partial publish').toEqual(false);
  const router = result.packages.find((entry) => entry.name === '@openelement/router');
  expect(router?.published).toEqual(false);
  expect(router?.error?.includes('E403')).toEqual(true);
  expect(result.packages.filter((entry) => entry.published).length).toEqual(3);
  expect(receipt()?.result).toEqual('partial');
});

test('publishRelease fails closed when registry verification fails', async () => {
  const { io, receipt } = releaseIo({
    verify: () => Promise.reject(new Error('dist-tag beta moved')),
  });
  const result = await publishRelease(releasePackages(), io);
  expect(result.result).toEqual('failed');
  expect(result.packages.every((entry) => entry.published)).toEqual(true);
  expect(result.packages.every((entry) => !entry.verified)).toEqual(true);
  expect(result.packages[0].error?.includes('dist-tag beta moved')).toEqual(true);
  expect(receipt()?.result).toEqual('failed');
});
