/**
 * @openelement/router — the style provider port (alpha15 stage 2B).
 *
 * Two different kinds of fact are pinned here:
 *
 * 1. THE PLAN decides engine, enablement and document ownership. Declaring
 *    both engines is a conflict; a required dialect the selected engine does
 *    not implement fails before any compile; automatic mode (an admitted
 *    package requirement, no application declaration) enables the pipeline
 *    with the DEFAULT engine and never introduces a framework document reset.
 *
 * 2. THE UNOCSS ADAPTER is a real engine, not a rename: it resolves the
 *    project's own `uno.config.ts` through the official loader, compiles the
 *    admitted candidates through `createGenerator`, extracts source candidates
 *    through the generator's own extractors, and keeps the framework's
 *    policies where the engine puts them. The assertions read the ACTUAL
 *    compiled CSS the real `unocss` package produced — nothing is mocked, so a
 *    renamed interface would fail every one of them.
 *
 * The engine under test is resolved from the probe fixture's own install
 * (`tests/fixtures/router-unocss-probe`), because the adapter loads `unocss`
 * from the APPLICATION's resolution — the same path a packed consumer takes.
 */

import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { promisify } from 'node:util';
import { expect, test } from 'vitest';
import { PresetErrorCode } from '../src/internal/error-codes.ts';
import { createStyleBuildIntegration } from '../src/vite/internal/style-provider.ts';
import { resolveStylePlan, type ResolvedStyleSelection } from '../src/vite/internal/style-plan.ts';

const runProcess = promisify(execFile);

/** The fixture whose `unocss` install the adapter resolves from. */
const FIXTURE_ROOT = join(import.meta.dirname!, '../../../tests/fixtures/router-unocss-probe');

/** The fixture's own declaration (its declared token source). */
const FIXTURE_DECLARATION = { theme: ['app/styles/tokens.css'] };

/** One admitted declaration, as the manifest scan produces it. */
interface DeclaredRequirement {
  readonly packageName: string;
  readonly tagName: string;
  readonly required: boolean;
  readonly dialect: 'tailwind4';
  readonly sources: readonly string[];
}

function requiredDeclaration(overrides: Partial<DeclaredRequirement> = {}): DeclaredRequirement[] {
  return [
    {
      packageName: '@acme/widgets',
      tagName: 'acme-widget',
      required: true,
      dialect: 'tailwind4',
      sources: [],
      ...overrides,
    },
  ];
}

/** The coded diagnostic one failing call raises (errors classify by code). */
async function errorCodeOf(run: () => unknown): Promise<string | undefined> {
  try {
    await run();
    return undefined;
  } catch (error) {
    return (error as { code?: string }).code;
  }
}

/** The fixture's plan — the application's own `unocss` declaration. */
function fixturePlan(
  declaration: { theme?: string[]; config?: string } = FIXTURE_DECLARATION,
): ResolvedStyleSelection {
  const plan = resolveStylePlan({
    root: FIXTURE_ROOT,
    tailwind: undefined,
    unocss: declaration,
    declarations: [],
  });
  if (plan === undefined) throw new Error('the fixture declaration must resolve a plan');
  return plan;
}

/** The adapter one plan selects, built the way a build or dev server builds it. */
async function integrationFor(
  plan: ResolvedStyleSelection,
  unocss: boolean | { theme?: string[]; config?: string } | undefined,
): Promise<Awaited<ReturnType<typeof createStyleBuildIntegration>>> {
  return await createStyleBuildIntegration({
    root: FIXTURE_ROOT,
    plan,
    unocss,
    componentSheetCandidates: () => [],
    documentCandidates: () => [],
    sources: () => new Map(),
  });
}

// ─── The plan ──────────────────────────────────────────────────────────────

test('declaring both engines is a conflict, never an order-of-keys decision', async () => {
  const code = await errorCodeOf(() =>
    resolveStylePlan({ root: FIXTURE_ROOT, tailwind: true, unocss: true, declarations: [] }),
  );
  expect(code).toBe(PresetErrorCode.STYLE_PROVIDER_CONFLICT);
});

test('the application declaration selects the engine; absence selects the default', () => {
  expect(
    resolveStylePlan({ root: FIXTURE_ROOT, tailwind: undefined, unocss: true, declarations: [] })
      ?.provider,
  ).toBe('unocss');
  expect(
    resolveStylePlan({ root: FIXTURE_ROOT, tailwind: true, unocss: undefined, declarations: [] })
      ?.provider,
  ).toBe('tailwind');

  // An admitted requirement with no application declaration: the default
  // engine (Tailwind), enabled — the pre-2B behaviour, unchanged.
  const automatic = resolveStylePlan({
    root: FIXTURE_ROOT,
    tailwind: undefined,
    unocss: undefined,
    declarations: requiredDeclaration(),
  });
  expect(automatic?.provider).toBe('tailwind');
  expect(automatic?.documentReset, 'automatic mode is not the application’s document').toBe(false);
});

test('an explicit false stays authoritative on either key', () => {
  expect(
    resolveStylePlan({ root: FIXTURE_ROOT, tailwind: false, unocss: undefined, declarations: [] }),
  ).toBeUndefined();
  expect(
    resolveStylePlan({ root: FIXTURE_ROOT, tailwind: undefined, unocss: false, declarations: [] }),
  ).toBeUndefined();
});

test('a required dialect the selected engine does not implement fails before any compile', async () => {
  const code = await errorCodeOf(() =>
    resolveStylePlan({
      root: FIXTURE_ROOT,
      tailwind: undefined,
      unocss: undefined,
      declarations: requiredDeclaration({ dialect: 'bootstrap5' as never }),
    }),
  );
  expect(code).toBe(PresetErrorCode.STYLE_DIALECT_UNSUPPORTED);
});

// ─── The real UnoCSS adapter ───────────────────────────────────────────────

test('the adapter compiles real UnoCSS output for opaque candidates', async () => {
  const integration = await integrationFor(fixturePlan(), FIXTURE_DECLARATION);
  expect(integration.provider.id, 'the engine is UnoCSS, not a Tailwind rename').toBe('unocss');
  expect(
    integration.provider.documentDelivery,
    'UnoCSS generates its document sheet; Tailwind compiles one in the graph',
  ).toBe('generated');

  // Ordinary `tailwind4`-dialect tokens: role utilities, a variant, an opacity
  // modifier and two arbitrary values, compiled by the official generator.
  const css = await integration.provider.compileComponents({
    candidates: [
      'inline-flex',
      'items-center',
      'gap-2',
      'rounded-lg',
      'bg-primary/14',
      'text-foreground',
      'hover:bg-primary/23',
      'focus-visible:outline-2',
      'size-[38px]',
      'max-w-[min(90vw,480px)]',
    ],
    sources: new Map(),
  });

  expect(css, 'the utilities are real declarations, not a passthrough').toMatch(
    /\.inline-flex\s*\{/,
  );
  expect(css, 'a role utility keeps the role variable — the token source owns the value').toMatch(
    /\.text-foreground\s*\{[^}]*var\(--color-foreground\)/,
  );
  expect(css, 'an opacity modifier compiles to a colour mix').toMatch(
    /\.bg-primary\\\/14\s*\{[^}]*color-mix\(/,
  );
  expect(css, 'a variant compiles to its selector').toMatch(
    /\.hover\\:bg-primary\\\/23:hover\s*\{/,
  );
  expect(css, 'an arbitrary value survives').toMatch(/\.size-\\\[38px\\\]\s*\{/);
  expect(css, 'no reset in a shadow sheet').not.toContain('box-sizing: border-box');
});

test('the document sheet carries the token source and the application’s own reset', async () => {
  const integration = await integrationFor(fixturePlan(), FIXTURE_DECLARATION);
  const css = await integration.provider.compileDocument!({
    candidates: ['px-6', 'text-muted'],
    sources: new Map(),
  });

  expect(css, 'the declared token source is inlined').toContain(
    '--color-foreground: var(--gray-12)',
  );
  expect(css, 'Open Props reaches the sheet through the resolved @import').toContain(
    ':where(html)',
  );
  expect(css, 'the preset theme layer ships the scale the utilities read').toContain(
    '--spacing: 0.25rem',
  );
  expect(css, 'the admitted document candidates compiled').toMatch(/\.px-6\s*\{/);
  expect(css, 'the application declared the entry, so the reset it asked for is present').toContain(
    'box-sizing: border-box',
  );
});

test('automatic mode installs the framework preset with the plan’s reset decision', async () => {
  // A configuration with no preset set, so the framework installs its own —
  // the automatic-mode shape, where the reset is the framework's decision and
  // a package's requirement must not restyle the host document.
  const presetsFree = join(FIXTURE_ROOT, `uno.probe-${process.pid}.config.ts`);
  await writeFile(presetsFree, 'export default {};\n', 'utf8');
  const declaration = { config: presetsFree };
  try {
    const plan = fixturePlan(declaration);
    const reduced = await (
      await integrationFor({ ...plan, documentReset: false }, declaration)
    ).provider.compileDocument!({ candidates: ['px-6'], sources: new Map() });
    expect(
      reduced,
      'a package’s requirement never restyles the application’s document',
    ).not.toContain('box-sizing: border-box');
    expect(reduced, 'the theme layer stays: the utilities still resolve').toContain(
      '--spacing: 0.25rem',
    );
    expect(reduced, 'the admitted utility compiled into the reduced document sheet').toMatch(
      /\.px-6\s*\{/,
    );

    const owned = await (
      await integrationFor({ ...plan, documentReset: true }, declaration)
    ).provider.compileDocument!({ candidates: ['px-6'], sources: new Map() });
    expect(owned, 'the application’s own document gets the reset it asked for').toContain(
      'box-sizing: border-box',
    );
  } finally {
    await rm(presetsFree, { force: true });
  }
});

test('the adapter extracts candidates from source through the ENGINE’s own extractors', async () => {
  const integration = await integrationFor(fixturePlan(), FIXTURE_DECLARATION);
  const css = await integration.provider.compileDocument!({
    candidates: [],
    sources: [
      [
        '/app/routes/plain.tsx',
        '<div class="mt-9 text-foreground"><span class="py-7">plain source class</span></div>',
      ],
    ],
  });
  expect(css, 'a class the framework never enumerated still compiles').toMatch(/\.mt-9\s*\{/);
  expect(css, 'the nested token compiled too').toMatch(/\.py-7\s*\{/);
});

test('a Tailwind `@theme` source is refused with both supported shapes named', async () => {
  const declaration = { theme: ['@openelement/ui/theme.css'] };
  const integration = await integrationFor(fixturePlan(declaration), declaration);
  const code = await errorCodeOf(() =>
    integration.provider.compileDocument!({ candidates: [], sources: new Map() }),
  );
  expect(code, 'a source the engine cannot compile fails closed').toBe(
    PresetErrorCode.UNOCSS_THEME_SOURCE_INCOMPATIBLE,
  );
});

test('a declared theme source that is not there is a coded failure', async () => {
  const declaration = { theme: ['app/styles/does-not-exist.css'] };
  const integration = await integrationFor(fixturePlan(declaration), declaration);
  const code = await errorCodeOf(() =>
    integration.provider.compileDocument!({ candidates: [], sources: new Map() }),
  );
  expect(code).toBe(PresetErrorCode.TAILWIND_SOURCE_UNRESOLVED);
});

test('a declared unocss config path that is not there is a coded failure', async () => {
  const declaration = { config: 'uno.missing.config.ts' };
  const code = await errorCodeOf(() => integrationFor(fixturePlan(declaration), declaration));
  expect(code).toBe(PresetErrorCode.UNOCSS_CONFIG_UNRESOLVED);
});

test('a component sheet with nothing admitted compiles to nothing, and is not an error', async () => {
  // The build asks for the component sheet on every build of an app that
  // selected the engine; "no admitted candidate" is the ordinary answer for a
  // component-less app, so it returns empty text and the emitter writes no
  // file. Only an ENABLED compile WITH admitted candidates that still yields no
  // CSS is the coded defect — the guard right below this one.
  const declaration = { theme: [] };
  const integration = await integrationFor(fixturePlan(declaration), declaration);
  expect(await integration.provider.compileComponents({ candidates: [], sources: new Map() })).toBe(
    '',
  );
});

test('theme sources resolve their own @import chain, including a bare package subpath', async () => {
  // The fixture's tokens.css imports `open-props/style` (a bare specifier the
  // browser cannot resolve) and nothing else; this asserts the chain is
  // INLINED rather than left as a specifier, and that the deep import's own
  // variables are the ones the roles read.
  const integration = await integrationFor(fixturePlan(), FIXTURE_DECLARATION);
  const css = await integration.provider.compileDocument!({
    candidates: [],
    sources: new Map(),
  });
  expect(css, 'no @import statement survives (only the provenance comment does)').not.toMatch(
    /^@import/m,
  );
  expect(css, 'the import is recorded, so the sheet says where the layer came from').toContain(
    "/* @import 'open-props/style' */",
  );
  expect(css, 'the imported file’s own variables are present').toContain('--violet-7');
});

test('a candidate set that compiles to nothing is an empty sheet, not a failure', async () => {
  // A class name the engine has no rule for is not a defect to diagnose. The
  // engine COMPILED the set and matched nothing, which is what an application's
  // own native-CSS hooks are: `not-a-utility-token-at-all` is styled by the
  // application's stylesheet, not by a generated utility. An admitted candidate
  // is not a promise that a rule exists for it.
  const integration = await integrationFor(fixturePlan(), FIXTURE_DECLARATION);
  const css = await integration.provider.compileComponents({
    candidates: ['not-a-utility-token-at-all', 'my-semantic-hook'],
    sources: new Map(),
  });
  expect(css.trim(), 'a zero-match compile is delivered as the empty sheet it is').toBe('');
  // The same provider still compiles a candidate the engine knows.
  const real = await integration.provider.compileComponents({
    candidates: ['not-a-utility-token-at-all', 'gap-2'],
    sources: new Map(),
  });
  expect(real, 'the real utility still compiles alongside the opaque hooks').toMatch(
    /\.gap-2\s*\{/,
  );
  // The coded failures this adapter keeps are the ones about the PIPELINE — a
  // missing engine, an unloadable configuration, an unresolvable source, a
  // `@theme` source it cannot compile, a document sheet that is empty because
  // the preset produced no layers at all. Each has its own row here.
  expect(PresetErrorCode.UNOCSS_EMPTY_COMPILE, 'the document guard still owns the code').toBe(
    'OE_PRESET_UNOCSS_EMPTY_COMPILE',
  );
});

test('a missing engine is a coded failure, not a silent skip', async () => {
  // Vitest patches Node's module resolution (vite-node), so a root with
  // nothing installed is only provably bare in a plain Node process — the one
  // the built CLI actually runs in. The probe imports the same adapter over
  // the same plan in that process and reports the code it raised.
  const bare = await mkdtemp(join(tmpdir(), 'oe-no-engine-'));
  try {
    const script = `
      import { resolveStylePlan } from '${join(import.meta.dirname!, '../src/vite/internal/style-plan.ts')}';
      import { createStyleBuildIntegration } from '${join(import.meta.dirname!, '../src/vite/internal/style-provider.ts')}';
      const root = process.argv[1];
      const plan = resolveStylePlan({ root, tailwind: undefined, unocss: true, declarations: [] });
      try {
        await createStyleBuildIntegration({
          root,
          plan,
          unocss: true,
          componentSheetCandidates: () => [],
          documentCandidates: () => [],
          sources: () => new Map(),
        });
        console.log('NO_THROW');
      } catch (error) {
        console.log('CODE=' + String(error?.code));
      }
    `;
    // The vitest worker exports `NODE_PATH`, which would make the child
    // resolve the repo's own install from ANY root — the opposite of a bare
    // root. The child gets a clean resolution environment.
    const childEnv: NodeJS.ProcessEnv = { ...process.env };
    delete childEnv.NODE_PATH;
    const result = await runProcess(
      process.execPath,
      ['--experimental-strip-types', '-e', script, bare],
      { cwd: join(import.meta.dirname!, '..'), env: childEnv },
    );
    expect(result.stdout.trim(), 'a missing peer is a coded failure').toBe(
      `CODE=${PresetErrorCode.UNOCSS_UNRESOLVABLE}`,
    );
  } finally {
    await rm(bare, { recursive: true, force: true });
  }
});

test('the plan’s own conditions, one row at a time', () => {
  const plan = (input: Parameters<typeof resolveStylePlan>[0]) => resolveStylePlan(input);

  // No requirement and no offered source: automatic mode has nothing to run.
  expect(
    plan({
      root: FIXTURE_ROOT,
      tailwind: undefined,
      declarations: requiredDeclaration({ required: false, sources: [] }),
    }),
    'a declaration that neither requires nor offers anything enables nothing',
  ).toBeUndefined();

  // The off switch on the engine the application did NOT select is not a
  // conflict: it is an explicit "not this one".
  expect(
    plan({ root: FIXTURE_ROOT, tailwind: false, unocss: true, declarations: [] })?.provider,
    'tailwind: false beside unocss: true selects UnoCSS',
  ).toBe('unocss');
  expect(
    plan({ root: FIXTURE_ROOT, tailwind: true, unocss: false, declarations: [] })?.provider,
    'and the mirror row selects Tailwind',
  ).toBe('tailwind');
  expect(
    plan({ root: FIXTURE_ROOT, tailwind: undefined, unocss: false, declarations: [] }),
    'unocss: false alone is the off switch',
  ).toBeUndefined();

  // Ordering: two packages that both require the compile resolve by package
  // name, then tag name — never by the order the scan produced them.
  const twoPackageRows = plan({
    root: FIXTURE_ROOT,
    tailwind: undefined,
    declarations: [
      { ...requiredDeclaration()[0]!, packageName: '@zeta/widgets' },
      { ...requiredDeclaration()[0]!, packageName: '@alpha/widgets', tagName: 'alpha-zzz' },
      { ...requiredDeclaration()[0]!, packageName: '@alpha/widgets', tagName: 'alpha-aaa' },
    ],
  });
  expect(twoPackageRows?.provider, 'the default engine still compiles them').toBe('tailwind');
  expect(
    twoPackageRows?.documentReset,
    'automatic mode never resets the application’s document',
  ).toBe(false);

  // An application declaration whose source list is EMPTY is still a
  // declaration: it owns the document (and therefore its reset).
  expect(
    plan({ root: FIXTURE_ROOT, tailwind: { theme: [] }, declarations: [] })?.documentReset,
    'an empty declared source list still owns the document',
  ).toBe(true);
});
