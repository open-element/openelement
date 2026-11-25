import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { compiledArtifactClassCandidates } from '@openelement/compiler';
import { expect, test } from 'vitest';
import { writePackedGeneratedElements } from './packed-generated-elements.ts';

test('packed native islands preserve authored exports and deliver the manifest host bindings', async () => {
  const root = await mkdtemp(join(tmpdir(), 'oe-packed-generated-'));
  try {
    const packed = join(root, 'packed');
    const name = '@probe/ui';
    const authored = 'export default function ProbeCard() {}\n';
    const types = 'export default function ProbeCard(): unknown;\n';
    await mkdir(join(root, 'src'));
    await mkdir(join(packed, 'src'), { recursive: true });
    await writeFile(
      join(root, 'src/card.tsx'),
      `
      import { defineIslandConfig } from '@openelement/router';
      export const openElement = defineIslandConfig({ root: 'shadow' });
      export default function ProbeCard() { return <span class="grid">Card</span>; }
    `,
    );
    await writeFile(
      join(root, 'src/generated-manifest.json'),
      JSON.stringify({
        packageName: name,
        declarations: [
          {
            tagName: 'probe-card',
            className: 'ProbeCardElement',
            openElement: { module: `${name}/card`, ssrHostExport: 'ProbeCard__ssrHost' },
          },
        ],
      }),
    );
    await writeFile(join(packed, 'src/card.js'), authored);
    await writeFile(join(packed, 'src/card.d.ts'), types);
    await writePackedGeneratedElements(
      {
        name,
        version: '1.0.0',
        dir: root,
        exports: { './card': './src/card.tsx' },
        deps: [],
        importKeys: new Set(),
        importValues: {},
      },
      packed,
    );
    const entry = await readFile(join(packed, 'src/card.js'), 'utf8');
    expect(entry.startsWith(authored)).toBe(true);
    expect(entry).toContain(
      "export { ProbeCardElement, ProbeCard__ssrHost } from './card.generated.js'",
    );
    expect(compiledArtifactClassCandidates(entry, 'src/card.js')).toEqual(['grid']);
    expect(await readFile(join(packed, 'src/card.d.ts'), 'utf8')).toBe(types);
    const compiled = await readFile(join(packed, 'src/card.generated.js'), 'utf8');
    expect(compiled).toContain('export function ProbeCard__ssrHost');
    expect(compiled).toContain(' as ProbeCardElement');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
