/**
 * M10a — early packed-consumer smoke (execution-plan.md:54, §5, §8b).
 *
 * The gate asks whether "the generated artifact ... works from a fresh packed
 * application with no workspace aliases and no library TSX". This spike is
 * compiler-private and excluded from the published compiler surface, so the
 * honest slice is to pack the **generated artifact itself** (the ESM text from
 * `recipe.module`) as a standalone tarball, install it into a fresh consumer
 * directory with no aliases, and run it in a separate Node process.
 *
 * Not claimed: this is a non-gating smoke of a smaller artifact, not M12 / S3.
 * The consumer uses a hand-written minimal DOM, not a browser — browser
 * execution is covered by leaf-codegen.browser.test.ts.
 */

import { execFileSync } from 'node:child_process';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, test } from 'vitest';
import { buildSemanticIr } from '../../src/internal/compiler/semantic-ir/index.ts';
import { generateLeafRecipe } from '../../src/internal/compiler/semantic-ir/leaf-codegen/generate.ts';

const PACKAGE_NAME = '@openelement/leaf-recipe-fixture';
const ARTIFACT_SOURCE =
  'function Maybe(props) { return <div>{props.ok ? <span>{props.n}</span> : <em>off</em>}</div>; }';

/** The consumer imports by package name only — no aliases, no workspace paths. */
const RUNNER = `import { mount } from "${PACKAGE_NAME}";

class FakeNode {
  constructor(tagName, nodeValue = "") {
    this.tagName = tagName;
    this.nodeValue = nodeValue;
    this.children = [];
    this.attributes = new Map();
  }
  setAttribute(name, value) { this.attributes.set(name, value); }
  appendChild(child) { this.children.push(child); return child; }
  removeChild(child) {
    const index = this.children.indexOf(child);
    if (index < 0) throw new Error("removeChild: not a child");
    this.children.splice(index, 1);
  }
  insertBefore(node, reference) {
    const index = this.children.indexOf(reference);
    if (index < 0) throw new Error("insertBefore: reference is not a child");
    this.children.splice(index, 0, node);
  }
}

globalThis.document = {
  createElement: (tag) => new FakeNode(tag),
  createTextNode: (value) => new FakeNode(null, value),
};

const branch = (host) => host.children[0].children.find((child) => child.tagName !== null);
const observe = (host) => ({
  tag: branch(host).tagName,
  text: branch(host).children[0]?.nodeValue ?? null,
});

const host = new FakeNode(null);
const instance = mount(host, { props: { ok: true, n: 1 } });
const first = observe(host);
instance.update({ props: { ok: true, n: 2 } });
const refreshed = observe(host);
instance.update({ props: { ok: false, n: 2 } });
const swapped = observe(host);
instance.dispose();
console.log("__OE_M10A__" + JSON.stringify({ first, refreshed, swapped, hostChildren: host.children.length }));
`;

interface SmokeResult {
  first: { tag: string; text: string | null };
  refreshed: { tag: string; text: string | null };
  swapped: { tag: string; text: string | null };
  hostChildren: number;
}

let workRoot: string | null = null;

afterAll(() => {
  // Best effort: a sandbox may deny recursive deletes, but the temp directory
  // lives outside the repository either way and never enters a commit.
  if (workRoot !== null) {
    try {
      rmSync(workRoot, { recursive: true, force: true });
    } catch {
      /* environment policy, not a product failure */
    }
  }
});

/** Build the generated artifact and pack it as a standalone tarball. */
function buildAndPack(): {
  root: string;
  tarball: string;
  consumer: string;
  installed: string;
  generatedModule: string;
} {
  const ir = buildSemanticIr(ARTIFACT_SOURCE, '/consumer.tsx');
  if (ir.component === null) {
    throw new Error(`IR build failed: ${ir.diagnostics.map((d) => d.code).join(', ')}`);
  }
  const generated = generateLeafRecipe(ir.component);
  if (generated.recipe === null) {
    throw new Error(`codegen failed: ${generated.diagnostics.map((d) => d.code).join(', ')}`);
  }
  const generatedModule = generated.recipe.module;

  const root = mkdtempSync(join(tmpdir(), 'oe-leaf-m10a-'));
  workRoot = root;
  const artifact = join(root, 'artifact');
  const dist = join(artifact, 'dist');
  const consumer = join(root, 'consumer');
  mkdirSync(dist, { recursive: true });
  mkdirSync(consumer);

  writeFileSync(
    join(artifact, 'package.json'),
    `${JSON.stringify(
      {
        name: PACKAGE_NAME,
        version: '0.0.0',
        type: 'module',
        exports: { '.': './dist/recipe.mjs' },
        files: ['dist/recipe.mjs'],
        sideEffects: false,
      },
      null,
      2,
    )}\n`,
  );
  writeFileSync(join(dist, 'recipe.mjs'), generatedModule);

  const packed = JSON.parse(
    execFileSync(
      'npm',
      ['pack', '--json', '--ignore-scripts', '--pack-destination', root, artifact],
      { encoding: 'utf8' },
    ),
  ) as { filename: string }[];
  const tarball = join(root, packed[0]!.filename);

  writeFileSync(
    join(consumer, 'package.json'),
    `${JSON.stringify({ name: 'leaf-recipe-consumer', private: true, version: '0.0.0', type: 'module' }, null, 2)}\n`,
  );
  // A local tarball needs no registry. --no-package-lock keeps the consumer
  // minimal; --ignore-scripts proves the artifact runs without install hooks.
  execFileSync(
    'npm',
    [
      'install',
      '--offline',
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
      '--no-package-lock',
      tarball,
    ],
    { cwd: consumer, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  );

  return {
    root,
    tarball,
    consumer,
    installed: join(consumer, 'node_modules', PACKAGE_NAME),
    generatedModule,
  };
}

describe('M10a — generated artifact from a fresh packed consumer', () => {
  test('installs without aliases and runs mount/update/dispose in a separate process', () => {
    const { consumer, installed, tarball, generatedModule } = buildAndPack();

    // No aliases: the installed package is a real directory, not a workspace
    // symlink, and the consumer manifest references no workspace/link/file deps.
    expect(existsSync(tarball)).toBe(true);
    expect(existsSync(installed)).toBe(true);
    expect(lstatSync(installed).isSymbolicLink()).toBe(false);
    const manifest = readFileSync(join(consumer, 'package.json'), 'utf8');
    for (const alias of ['workspace:', 'link:', 'alias', 'packages/', 'semantic-ir']) {
      expect(manifest, `consumer manifest must not contain ${alias}`).not.toContain(alias);
    }
    // npm records a local tarball install as a `file:` dependency. That is the
    // packed artifact itself, not a workspace alias back to repository sources.
    const dependency = (JSON.parse(manifest) as { dependencies?: Record<string, string> })
      .dependencies?.[PACKAGE_NAME];
    expect(dependency).toBeDefined();
    expect(dependency).toMatch(/\.tgz$/);

    // The tarball carries only the generated ESM text and its manifest: no
    // compiler sources, no TSX, no runtime dependency on this repository.
    const installedFiles = readdirSync(installed);
    expect(installedFiles.sort()).toEqual(['dist', 'package.json']);
    expect(readdirSync(join(installed, 'dist'))).toEqual(['recipe.mjs']);
    expect(generatedModule).not.toContain('import ');
    expect(generatedModule).not.toContain('.tsx');
    expect(generatedModule).not.toContain('__partProgram');

    writeFileSync(join(consumer, 'smoke.mjs'), RUNNER);
    const stdout = execFileSync(process.execPath, [join(consumer, 'smoke.mjs')], {
      cwd: consumer,
      encoding: 'utf8',
    });
    const marker = '__OE_M10A__';
    const line = stdout.split('\n').find((entry) => entry.startsWith(marker));
    expect(line, `runner produced no smoke result: ${stdout}`).toBeDefined();
    const result = JSON.parse(line!.slice(marker.length)) as SmokeResult;

    // mount, branch refresh, condition swap and dispose all survive packing.
    expect(result.first).toEqual({ tag: 'span', text: '1' });
    expect(result.refreshed).toEqual({ tag: 'span', text: '2' });
    expect(result.swapped).toEqual({ tag: 'em', text: 'off' });
    expect(result.hostChildren).toBe(0);
  });
});
