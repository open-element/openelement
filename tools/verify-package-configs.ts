/** Verify release-critical workspace package configuration before packing. */

import { basename, dirname, join } from '@std/path';
import { readPackages } from './lib/package-graph.ts';
import { readJson } from './lib/fs.ts';
import { PACKAGE_VERSION } from './project-constants.ts';

const requiredPublishedFiles = ['deno.json', 'README.md', 'LICENSE'];

/**
 * Cross-assert the embedded create CLI version against the workspace package
 * line (#713). packages/create/src/version.ts is rewritten by the version bump
 * but lives outside the package deno.json files the graph check covers, so a
 * missed bump would otherwise ship a CLI advertising a stale version.
 */
export function createVersionFailures(createVersionSource: string): string[] {
  const match = createVersionSource.match(/CREATE_VERSION = '([^']+)'/u);
  if (!match) {
    return ['packages/create/src/version.ts: CREATE_VERSION anchor missing'];
  }
  if (match[1] !== PACKAGE_VERSION) {
    return [
      `packages/create/src/version.ts: CREATE_VERSION ${match[1]} does not match ` +
      `docs/release/release-state.json sourceVersion ${PACKAGE_VERSION}`,
    ];
  }
  return [];
}

async function main(): Promise<void> {
  const failures: string[] = [];
  const packages = await readPackages();

  failures.push(
    ...createVersionFailures(await Deno.readTextFile('packages/create/src/version.ts')),
  );

  for (const pkg of packages) {
    const configPath = join(pkg.dir, 'deno.json');
    const config = await readJson(configPath) as {
      name?: unknown;
      version?: unknown;
      exports?: unknown;
      publish?: { include?: unknown };
    };

    if (config.version !== PACKAGE_VERSION) {
      failures.push(
        `${configPath}: version ${
          typeof config.version === 'string' ? config.version : '<missing>'
        } does not match PACKAGE_VERSION ${PACKAGE_VERSION}`,
      );
    }
    if (!config.exports) failures.push(`${configPath}: missing public exports`);

    const include = config.publish?.include;
    if (!Array.isArray(include)) {
      failures.push(`${configPath}: publish.include must be an array`);
    } else {
      for (const required of requiredPublishedFiles) {
        if (!include.includes(required)) {
          failures.push(`${configPath}: publish.include omits ${required}`);
        }
      }
    }

    for (const required of requiredPublishedFiles) {
      try {
        await Deno.stat(join(dirname(configPath), required));
      } catch {
        failures.push(`${pkg.name}: missing ${required}`);
      }
    }

    if (!pkg.name.startsWith('@openelement/')) {
      failures.push(`${basename(pkg.dir)}: package name must use @openelement scope`);
    }
  }

  if (failures.length > 0) {
    console.error('Package configuration verification failed:');
    for (const failure of failures) console.error(`- ${failure}`);
    Deno.exit(1);
  }

  console.log(`Package configuration verification passed (${packages.length} packages).`);
}

if (import.meta.main) await main();
