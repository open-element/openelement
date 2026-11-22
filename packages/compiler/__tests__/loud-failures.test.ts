/**
 * L3 loud-failure fixes (alpha15 debt ledger CL-5/8/9/10): silent or sloppy
 * behavior that now fails loudly or compares exactly. One consumer-form pin
 * per fix — no more.
 */

import { describe, expect, test } from 'vitest';
import { forbiddenSinkReason } from '@openelement/protocol/forbidden-sinks';
// The CL-10 row below is the only row that touched the retired class compile
// entry; its subject (the compile boundary reports EVERY syntax diagnostic
// through the one error carrier) is a property of the shared parse/diagnostics
// adapter, so it is asserted against the surviving throwing entry instead. The
// carrier itself moved to compiler-diagnostics.ts with that entry's retirement.
import { CompiledElementError } from '../src/internal/compiler/semantic-core/compiler-diagnostics.ts';
import { compileServerComponentModule } from '../src/internal/compiler/semantic-core/server-component.ts';
import { analyzeModuleSemantics } from '../src/internal/compiler/semantic-core/module-analysis.ts';
import { styleRequestFile } from '../src/internal/compiler/style-requests.ts';

describe('CL-10: syntax failure reports every diagnostic, not just the first', () => {
  test('a two-error module throws with both diagnostics ordered', () => {
    const source = 'const a = ;\nconst b = ;\n';
    let caught: CompiledElementError | undefined;
    try {
      // Only the PARSE stage is under test, and it runs before admission on
      // every compile entry: the server entry is the surviving one that throws
      // (the function frontend answers the same syntax diagnostics in its
      // result instead of throwing), so the accumulation contract is pinned
      // here without re-introducing a class-lane fixture.
      compileServerComponentModule(source, '/proj/src/broken.tsx');
    } catch (error) {
      caught = error as CompiledElementError;
    }
    expect(caught).toBeInstanceOf(CompiledElementError);
    expect(caught!.diagnostics.length).toBeGreaterThan(1);
    expect(caught!.diagnostics.every((diagnostic) => diagnostic.code === 'OEC9000')).toEqual(true);
  });
});

describe('CL-9: customElements.define detection is structural, not textual', () => {
  test('bare-global and window-qualified spellings both count', () => {
    const bare = analyzeModuleSemantics(
      "customElements.define('x-bare', class extends HTMLElement {});",
      '/proj/src/a.ts',
    );
    expect(bare.definedCustomElementTags).toContain('x-bare');
    const qualified = analyzeModuleSemantics(
      "window.customElements.define('x-qualified', class extends HTMLElement {});",
      '/proj/src/b.ts',
    );
    expect(qualified.definedCustomElementTags).toContain('x-qualified');
  });

  test('a module-scope shadow is not the platform registry', () => {
    const shadowed = analyzeModuleSemantics(
      [
        "import { customElements } from './shim';",
        "customElements.define('x-shadow', class extends HTMLElement {});",
      ].join('\n'),
      '/proj/src/c.ts',
    );
    expect(shadowed.definedCustomElementTags).not.toContain('x-shadow');
  });
});

describe('CL-8: parent-relative sheet specifiers resolve, never ride verbatim', () => {
  test('../theme.css lands on the parent directory with no .. residue', () => {
    expect(styleRequestFile('/proj/src/nested/card.ts', '../theme.css')).toEqual(
      '/proj/src/theme.css',
    );
  });

  test('./ and bare forms are byte-identical to before', () => {
    expect(styleRequestFile('/proj/src/card.ts', './theme.css')).toEqual('/proj/src/theme.css');
    expect(styleRequestFile('/proj/src/card.ts', 'theme.css')).toEqual('/proj/src/theme.css');
  });
});

describe('CL-5: raw-text tag deny list is case-insensitive', () => {
  test('SCRIPT is refused like script; div passes', () => {
    expect(forbiddenSinkReason('tag', 'SCRIPT')).not.toBeNull();
    expect(forbiddenSinkReason('tag', 'script')).not.toBeNull();
    expect(forbiddenSinkReason('tag', 'div')).toBeNull();
  });
});
