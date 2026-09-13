import { assert, assertEquals, assertStringIncludes } from '@std/assert';
import { join } from '@std/path';
import {
  compilePackageElementModules,
  stageCompiledPackWorkspace,
} from './compiled-pack-staging.ts';
import type { PackageInfo } from './package-graph.ts';

function pkg(name: string, dir: string): PackageInfo {
  return {
    name,
    version: '0.0.0-test',
    dir,
    deps: [],
    exports: {},
    importKeys: new Set(),
    importValues: {},
  };
}

const COMPILED_COMPONENT = `import { element, OpenElement, property } from '@openelement/element';

@element('demo-widget', { root: 'shadow-open' })
export class DemoWidget extends OpenElement {
  @property({ reflect: false })
  label: string = 'demo';

  render() {
    return <span class='widget'>{this.label}</span>;
  }
}
`;

const PLAIN_MODULE = `export const answer: number = 42;
`;

async function makeFixturePackage(): Promise<{ dir: string; cleanup: () => Promise<void> }> {
  const dir = await Deno.makeTempDir({ prefix: 'compiled-pack-staging-test-' });
  Deno.mkdirSync(join(dir, 'src'), { recursive: true });
  Deno.writeTextFileSync(join(dir, 'src', 'demo-widget.tsx'), COMPILED_COMPONENT);
  Deno.writeTextFileSync(join(dir, 'src', 'plain.ts'), PLAIN_MODULE);
  Deno.writeTextFileSync(
    join(dir, 'deno.json'),
    JSON.stringify({ name: '@openelement/demo', version: '0.0.0-test', exports: './src/mod.ts' }),
  );
  Deno.writeTextFileSync(join(dir, 'stray.tgz'), 'not a real tarball');
  return { dir, cleanup: () => Deno.remove(dir, { recursive: true }).catch(() => undefined) };
}

Deno.test('compilePackageElementModules returns [] for packages without compiled elements', () => {
  assertEquals(compilePackageElementModules('packages/create'), []);
});

Deno.test('stageCompiledPackWorkspace stages compiler output and relaxed member options', async () => {
  const fixture = await makeFixturePackage();
  try {
    const target = pkg('@openelement/demo', fixture.dir);
    const compiled = compilePackageElementModules(fixture.dir);
    assertEquals(compiled.length, 1);

    const staged = await stageCompiledPackWorkspace(target, [target], {
      imports: { '@openelement/element': 'npm:@openelement/element@0.0.0-test' },
      compilerOptions: { strict: true },
    }, compiled);
    try {
      const stagedComponent = Deno.readTextFileSync(join(staged.packDir, 'src', 'demo-widget.tsx'));
      assertStringIncludes(stagedComponent, 'static __partProgram = __partProgram;');
      assert(!stagedComponent.includes('@element('));

      // Non-component files pass through untouched.
      assertEquals(Deno.readTextFileSync(join(staged.packDir, 'src', 'plain.ts')), PLAIN_MODULE);

      // Tarball artifacts and publish inputs never leak into staging.
      let strayPresent = false;
      try {
        Deno.statSync(join(staged.packDir, 'stray.tgz'));
        strayPresent = true;
      } catch { /* expected absent */ }
      assert(!strayPresent, 'stale .tgz must not be staged');

      const memberConfig = JSON.parse(
        Deno.readTextFileSync(join(staged.packDir, 'deno.json')),
      ) as { compilerOptions: Record<string, unknown> };
      assertEquals(memberConfig.compilerOptions.noImplicitOverride, false);
      assertEquals(memberConfig.compilerOptions.noImplicitAny, false);

      const rootConfig = JSON.parse(
        Deno.readTextFileSync(join(staged.packDir, '..', 'deno.json')),
      ) as { workspace: string[]; imports: Record<string, string> };
      assertEquals(rootConfig.workspace, [`./${fixture.dir.split('/').pop()}`]);
      assertEquals(rootConfig.imports, {
        '@openelement/element': 'npm:@openelement/element@0.0.0-test',
      });
    } finally {
      await staged.cleanup();
    }
  } finally {
    await fixture.cleanup();
  }
});
