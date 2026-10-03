import { mkdtemp, rm } from 'node:fs/promises';
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { expect, test } from 'vitest';
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
  const dir = await mkdtemp(join(tmpdir(), 'compiled-pack-staging-test-'));
  mkdirSync(join(dir, 'src'), { recursive: true });
  writeFileSync(join(dir, 'src', 'demo-widget.tsx'), COMPILED_COMPONENT);
  return { dir, cleanup: () => rm(dir, { recursive: true }).catch(() => undefined) };
}

test('compilePackageElementModules returns [] for packages without compiled elements', () => {
  expect(compilePackageElementModules('packages/create')).toEqual([]);
});

test('compilePackageElementModules emits strictly-typed compiler output', async () => {
  const fixture = await makeFixturePackage();
  try {
    const compiled = compilePackageElementModules(fixture.dir);
    expect(compiled.length).toEqual(1);
    expect(compiled[0].relativePath).toEqual('src/demo-widget.tsx');
    // The generated statics carry the authored strictness (no relaxations).
    expect(compiled[0].code).toContain(
      'static __partProgram: typeof __partProgram = __partProgram;',
    );
    expect(compiled[0].code).toContain(
      'static observedAttributes: typeof __observedAttributes = __observedAttributes;',
    );
    // The compile-time-only intrinsic marker never reaches the payload.
    expect(!compiled[0].code.includes('@element(')).toBeTruthy();
  } finally {
    await fixture.cleanup();
  }
});
