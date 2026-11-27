/**
 * @openelement/router/vite - dev runtime pre-bundle decision (B2 follow-up)
 *
 * Late dependency discovery during island activation can start a second dev
 * optimization pass, while Vite holds the module graph. The installed
 * framework dependencies enter the first optimization through
 * `optimizeDeps.include`.
 *
 * The declaration is legal only for an installed copy. For a LINKED workspace
 * package (this repo's fixtures and www) forced pre-bundling would take the
 * package out of source HMR and could serve a pre-bundled copy beside the
 * source one, so the include must stay empty there. These tests pin both
 * shapes and the plugin wiring that reads them.
 */
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { openElement } from '../src/vite/app-vite.ts';
import {
  DEV_RUNTIME_PREBUNDLE_PACKAGES,
  devRuntimePrebundleInclude,
} from '../src/vite/dev-island-client.ts';

const roots: string[] = [];

function scratchRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'oe-prebundle-'));
  roots.push(root);
  return root;
}

/** One package as an installed copy: a real directory under node_modules. */
function installCopy(root: string, name: string): void {
  const dir = join(root, 'node_modules', ...name.split('/'));
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name, version: '0.0.0-test' }));
}

/** One package as a linked workspace source: a symlink out of node_modules. */
function linkCopy(root: string, name: string, source: string): void {
  mkdirSync(dirname(join(root, 'node_modules', ...name.split('/'))), { recursive: true });
  mkdirSync(source, { recursive: true });
  writeFileSync(join(source, 'package.json'), JSON.stringify({ name, version: '0.0.0-linked' }));
  symlinkSync(source, join(root, 'node_modules', ...name.split('/')), 'dir');
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

test('installed copies of both packages are declared for pre-bundling', () => {
  const root = scratchRoot();
  for (const name of DEV_RUNTIME_PREBUNDLE_PACKAGES) installCopy(root, name);
  expect(devRuntimePrebundleInclude(root)).toEqual([...DEV_RUNTIME_PREBUNDLE_PACKAGES]);
  const plugin = openElement().find((candidate) => candidate.name === 'open:dev-island-client');
  expect(plugin?.config?.({ root }, { command: 'serve', mode: 'development' })).toEqual({
    optimizeDeps: { include: [...DEV_RUNTIME_PREBUNDLE_PACKAGES] },
  });
});

test('a linked workspace copy is never declared (source HMR and identity stay intact)', () => {
  const root = scratchRoot();
  const workspace = join(root, 'workspace', 'packages');
  for (const name of DEV_RUNTIME_PREBUNDLE_PACKAGES) {
    linkCopy(root, name, join(workspace, name.split('/').pop() as string));
  }
  // The shape under test really is a link out of node_modules: the manifest
  // resolves outside <root>/node_modules, which is what the decision reads.
  const manifest = join(root, 'node_modules', '@openelement', 'element', 'package.json');
  expect(realpathSync(manifest).startsWith(join(realpathSync(root), 'node_modules'))).toEqual(
    false,
  );
  expect(devRuntimePrebundleInclude(root)).toEqual([]);
  const plugin = openElement().find((candidate) => candidate.name === 'open:dev-island-client');
  expect(plugin?.config?.({ root }, { command: 'serve', mode: 'development' })).toEqual(undefined);
});

test('a half-linked tree declares nothing (no half pre-bundled graph)', () => {
  const root = scratchRoot();
  installCopy(root, '@openelement/element');
  const workspace = join(root, 'workspace', 'packages');
  linkCopy(root, '@openelement/router', join(workspace, 'router'));
  expect(devRuntimePrebundleInclude(root)).toEqual([]);
});

test('a project without the packages declares nothing', () => {
  expect(devRuntimePrebundleInclude(scratchRoot())).toEqual([]);
});

test('the declaration walks up to a workspace root link, like Node resolution', () => {
  const root = scratchRoot();
  const nested = join(root, 'tests', 'fixtures', 'app');
  mkdirSync(nested, { recursive: true });
  const workspace = join(root, 'packages');
  for (const name of DEV_RUNTIME_PREBUNDLE_PACKAGES) {
    linkCopy(root, name, join(workspace, name.split('/').pop() as string));
  }
  expect(devRuntimePrebundleInclude(nested)).toEqual([]);
});
