import { assert, assertEquals, assertStringIncludes } from '@std/assert';
import { join } from '@std/path';
import { compilePackageElementModules } from './compiled-pack-staging.ts';

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

async function makeFixturePackage(): Promise<{ dir: string; cleanup: () => Promise<void> }> {
  const dir = await Deno.makeTempDir({ prefix: 'compiled-pack-staging-test-' });
  Deno.mkdirSync(join(dir, 'src'), { recursive: true });
  Deno.writeTextFileSync(join(dir, 'src', 'demo-widget.tsx'), COMPILED_COMPONENT);
  return { dir, cleanup: () => Deno.remove(dir, { recursive: true }).catch(() => undefined) };
}

Deno.test('compilePackageElementModules returns [] for packages without compiled elements', () => {
  assertEquals(compilePackageElementModules('packages/create'), []);
});

Deno.test('compilePackageElementModules emits strictly-typed compiler output', async () => {
  const fixture = await makeFixturePackage();
  try {
    const compiled = compilePackageElementModules(fixture.dir);
    assertEquals(compiled.length, 1);
    assertEquals(compiled[0].relativePath, 'src/demo-widget.tsx');
    // The generated statics carry the authored strictness (no relaxations).
    assertStringIncludes(
      compiled[0].code,
      'static __partProgram: typeof __partProgram = __partProgram;',
    );
    assertStringIncludes(
      compiled[0].code,
      'static observedAttributes: typeof __observedAttributes = __observedAttributes;',
    );
    // The compile-time-only intrinsic marker never reaches the payload.
    assert(!compiled[0].code.includes('@element('));
  } finally {
    await fixture.cleanup();
  }
});
