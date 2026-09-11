import { assertEquals, assertRejects, assertThrows } from '@std/assert';
import {
  deriveAllDependencies,
  deriveDependencies,
  type DeriveDepsIo,
  npmPublishTag,
  publishPackage,
  type PublishPackageIo,
} from './publish-npm.ts';
import type { PackageInfo } from './lib/package-graph.ts';

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

Deno.test('npm publish tag follows alpha, beta and rc prerelease names', () => {
  assertEquals(npmPublishTag('1.0.0-alpha.1'), 'alpha');
  assertEquals(npmPublishTag('1.0.0-beta.1'), 'beta');
  assertEquals(npmPublishTag('1.0.0-rc.1'), 'rc');
});

Deno.test('deriveDependencies includes an external npm dependency with a version', () => {
  const localIo: DeriveDepsIo = {
    ...io,
    readPkgJson: () => ({ imports: { 'npm:react@^18.2.0': 'npm:react@^18.2.0' } }),
  };
  const deps = deriveDependencies(pkg('@openelement/element', '1.0.0'), [], localIo);
  assertEquals(deps, { react: '^18.2.0' });
});

Deno.test('deriveDependencies pins the maintained matching fork exactly (#1324)', () => {
  const localIo: DeriveDepsIo = {
    ...io,
    readPkgJson: () => ({
      imports: {
        '@openelement/url-pattern-list': 'npm:@openelement/url-pattern-list@0.6.0',
      },
    }),
  };
  const deps = deriveDependencies(pkg('@openelement/router', '0.44.0'), [], localIo);
  // Exact, never a caret range: consumers must not float past the qualified artifact.
  assertEquals(deps, { '@openelement/url-pattern-list': '0.6.0' });
});

Deno.test('deriveDependencies throws when an npm dependency has no version', () => {
  const localIo: DeriveDepsIo = {
    ...io,
    readPkgJson: () => ({ imports: { 'npm:react': 'npm:react' } }),
  };
  assertThrows(
    () => deriveDependencies(pkg('@openelement/element', '1.0.0'), [], localIo),
    Error,
    'no version',
  );
});

Deno.test('deriveDependencies resolves an internal workspace dependency from source', () => {
  const localIo: DeriveDepsIo = {
    ...io,
    readSrcFiles: () => [`import { x } from '@openelement/router';`],
  };
  const all = [pkg('@openelement/element', '1.0.0'), pkg('@openelement/router', '1.2.3')];
  const deps = deriveDependencies(pkg('@openelement/element', '1.0.0'), all, localIo);
  assertEquals(deps, { '@openelement/router': '1.2.3' });
});

Deno.test('deriveDependencies materializes a root-mapped npm dependency used by source', () => {
  const localIo: DeriveDepsIo = {
    ...io,
    readRootJson: () => ({ imports: { 'react': 'npm:react@^18.2.0' } }),
    readSrcFiles: () => [`import { y } from 'react';`],
  };
  const deps = deriveDependencies(pkg('@openelement/element', '1.0.0'), [], localIo);
  assertEquals(deps, { react: '^18.2.0' });
});

Deno.test('deriveDependencies throws when a root-mapped npm dependency has no version', () => {
  const localIo: DeriveDepsIo = {
    ...io,
    readRootJson: () => ({ imports: { 'react': 'npm:react' } }),
    readSrcFiles: () => [`import { y } from 'react';`],
  };
  assertThrows(
    () => deriveDependencies(pkg('@openelement/element', '1.0.0'), [], localIo),
    Error,
    'no version',
  );
});

Deno.test('deriveAllDependencies reads root imports once for the full package graph', () => {
  let rootReads = 0;
  const localIo: DeriveDepsIo = {
    ...io,
    readRootJson: () => {
      rootReads++;
      return { imports: { react: 'npm:react@^18.2.0' } };
    },
    readSrcFiles: () => ["import 'react';"],
  };
  const packages = [
    pkg('@openelement/element', '1.0.0'),
    pkg('@openelement/router', '1.0.0'),
  ];
  const dependencies = deriveAllDependencies(packages, localIo);
  assertEquals(rootReads, 1);
  assertEquals(dependencies.get('@openelement/element'), { react: '^18.2.0' });
  assertEquals(dependencies.get('@openelement/router'), { react: '^18.2.0' });
});

Deno.test('publishPackage skips an immutable version that already exists', async () => {
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

  assertEquals(published, []);
  assertEquals(logs, [
    '[npm] @openelement/element@0.41.0-alpha.13 already published; skipping.',
  ]);
});

Deno.test('publishPackage does not move latest after a prerelease publish (#607)', async () => {
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

  assertEquals(published.length, 1);
  assertEquals(published[0].slice(0, 2), [
    'publish',
    'packages/element/openelement-element-0.41.0-alpha.13.tgz',
  ]);
  assertEquals(published[0].slice(-2), ['--tag', 'alpha']);
  assertEquals(
    published.some((args) => args.includes('latest')),
    false,
  );
});

Deno.test('publishPackage leaves latest to the npm default for stable versions', async () => {
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

  assertEquals(published.length, 1);
  assertEquals(published[0].includes('--tag'), false);
});

Deno.test('publishPackage does not touch dist-tags during a dry run', async () => {
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

  assertEquals(published.length, 1);
  assertEquals(published[0].includes('--dry-run'), true);
});

Deno.test('publishPackage skips after an E403 only when the version is actually published (#1038)', async () => {
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

  assertEquals(queries, 2);
  assertEquals(logs, [
    '[npm] @openelement/element@0.41.0 already published; skipping.',
  ]);
});

Deno.test('publishPackage propagates an E403 when the version is not actually published (#1038)', async () => {
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

  await assertRejects(
    () => publishPackage(pkg('@openelement/element', '0.41.0'), false, publishIo),
    Error,
    'E403',
  );
  assertEquals(queries, 2, 'pre-publish check plus the post-E403 re-check');
  assertEquals(logs, [], 'no misleading already-published line');
});
