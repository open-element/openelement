/**
 * Static module imports in the generated-element lane (binding import channel).
 *
 * A generated module replaces the authored one at the same graph position, so a
 * component may read a STATIC IMPORT directly: the import is re-emitted
 * verbatim and the read never becomes a host binding the shell would have to
 * supply. Reactive resources (`signal(...)`) keep their existing host-binding
 * refusal: this channel admits values, not runtime resources.
 *
 * Artifact-level rows only (no browser).
 */

import { describe, expect, test } from 'vitest';
import { compileGeneratedElementIfAdmitted } from '../../src/internal/compiler/semantic-ir/generated-element/compile.ts';
import { createGeneratedElementSiteResolver } from '../../../router/src/vite/generated-element-site.ts';

const SIDECAR =
  "import { defineIslandConfig } from '@openelement/router';\n" +
  'export const openElement = defineIslandConfig({\n' +
  "  root: 'shadow',\n" +
  '});\n';

const siteFor = createGeneratedElementSiteResolver('app/islands');

function compile(source: string): string {
  const file = 'app/islands/import-probe.tsx';
  const site = siteFor(file);
  if (site === null) throw new Error('the probe file must be admitted by the site resolver');
  return compileGeneratedElementIfAdmitted(source, file, { site }).code;
}

function importsOf(module: string): string[] {
  return module.split('\n').filter((line) => line.startsWith('import '));
}

describe('generated-element static imports', () => {
  test('re-emits the named import a setup local or a callback reads', () => {
    const module = compile(
      SIDECAR +
        "import { applyDocumentTheme } from './theme-contract.ts';\n" +
        "import { onConnect } from '@openelement/element';\n" +
        'function Probe() {\n' +
        '  const initial = applyDocumentTheme;\n' +
        '  onConnect(() => { initial(globalThis.document.documentElement, "dark"); });\n' +
        '  return <button part="toggle">ok</button>;\n' +
        '}\n' +
        'export default Probe;\n',
    );
    expect(importsOf(module)).toContain(
      'import { applyDocumentTheme } from "./theme-contract.ts";',
    );
    // The erased intrinsic and the sidecar helper are never emitted.
    expect(module).not.toContain('@openelement/element"');
    expect(module).not.toContain("from '@openelement/element'");
    expect(module).not.toContain('defineIslandConfig');
  });

  test('keeps the alias, default and namespace spellings', () => {
    const module = compile(
      SIDECAR +
        "import { readSaved as read, THEME_KEY } from './theme-state.ts';\n" +
        "import helpers from './helpers.ts';\n" +
        "import * as extra from './extra.ts';\n" +
        "import { onConnect } from '@openelement/element';\n" +
        'function Probe() {\n' +
        '  onConnect(() => { globalThis.__x = [read(), THEME_KEY, helpers.mode, extra.flag]; });\n' +
        '  return <button part="toggle">ok</button>;\n' +
        '}\n' +
        'export default Probe;\n',
    );
    const imports = importsOf(module);
    expect(imports).toContain('import { readSaved as read } from "./theme-state.ts";');
    expect(imports).toContain('import { THEME_KEY } from "./theme-state.ts";');
    expect(imports).toContain('import helpers from "./helpers.ts";');
    expect(imports).toContain('import * as extra from "./extra.ts";');
  });

  test('drops an import the component never reads', () => {
    const module = compile(
      SIDECAR +
        "import { unused } from './unused.ts';\n" +
        "import { onConnect } from '@openelement/element';\n" +
        'function Probe() {\n' +
        '  onConnect(() => {});\n' +
        '  return <button part="toggle">ok</button>;\n' +
        '}\n' +
        'export default Probe;\n',
    );
    expect(module).not.toContain('./unused.ts');
  });

  test('a reactive resource is created by the retained root factory (ADR-0183 D-4)', () => {
    const file = 'app/islands/import-probe.tsx';
    const source =
      SIDECAR +
      "import { onConnect, signal } from '@openelement/element';\n" +
      'function Probe() {\n' +
      '  const theme = signal("dark");\n' +
      '  onConnect(() => { theme.value = "light"; });\n' +
      '  return <button part="toggle">ok</button>;\n' +
      '}\n' +
      'export default Probe;\n';
    const compiled = compileGeneratedElementIfAdmitted(source, file, {
      site: { tag: 'import-probe' },
    });
    expect(compiled).not.toBeNull();
    // The resource is a factory-created binding now: declared in the retained
    // setup factory and returned in the record the shell keeps as `bindings`.
    expect(compiled!.code).toContain('const theme = signal((');
    expect(compiled!.code).toContain('return { theme, __oe_connect };');
    // 2026-11-20: the hook that READS the factory-created signal is carried,
    // not silently dropped. Before this fix the read was classified as a host
    // binding (the resource loop registers every signal name there), the hook
    // gate skipped the callback without a diagnostic, and the build stayed
    // green while the callback never ran.
    expect(compiled!.code).toContain('__oe_connect.push');
    expect(compiled!.code).toContain('theme . value');
    // The P1 boundary holds: the factories come from the narrow runtime entry.
    expect(compiled!.code).toContain('from "@openelement/element/internal/compiled/leaf-runtime"');
  });
});
