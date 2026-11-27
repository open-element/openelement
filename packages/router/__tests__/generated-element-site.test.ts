/**
 * M09-1b — the router side of the generated Native Custom Element site.
 *
 * Two consumer-form facts:
 *
 * 1. `createGeneratedElementSiteResolver` derives the SAME tag the island
 *    pipeline registers (`transformIslandSource` → `pathToTagName`) and admits
 *    nothing outside `islandsDir` (the layout included: its tag is a router
 *    constant, not a path derivation). The site fact carries the TAG ONLY: the
 *    descriptor root is the authored sidecar's fact (D-root-source), so the
 *    exact-equality assertions below fail if this resolver ever pins a stale
 *    `root` value again.
 * 2. The dev transform (`createCompilerHooks`) is a real host of the compiler:
 *    an island with the sidecar and a local default function component emits
 *    the generated class, the generated module's HMR comparison takes the
 *    full-reload path instead of being mistaken for a class module, the lane's
 *    fail-closed refusals reach the dev overlay through `this.error`, and an
 *    authored shadow sidecar still reaches the emitted descriptor root.
 *
 * The two build call sites (`cli/build-client.ts`, `cli/build-ssg.ts`) pass the
 * same resolver to `compiledElementPlugin`; their end-to-end proof is the
 * packed consumer, which builds the emitted class through the shipped plugin.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { transformIslandSource } from '@openelement/element/build-utils';
import { createGeneratedElementSiteResolver } from '../src/vite/generated-element-site.ts';
import { createCompilerHooks } from '../src/vite/plugin-hmr.ts';
import { createOpenPluginState } from '../src/vite/plugin-config.ts';

const SIDECAR =
  "import { defineIslandConfig } from '@openelement/element/authoring';\n" +
  "export const openElement = defineIslandConfig({ hydrate: 'only' });\n";

const PROFILE = `${SIDECAR}
function DevCard() {
  return <p id="dev-card">generated</p>;
}
export default DevCard;
`;

const PROFILE_CHANGED = `${SIDECAR}
function DevCard() {
  return <p id="dev-card">generated v2</p>;
}
export default DevCard;
`;

/** The same island with the M09-2a authored shadow root in its sidecar. */
const SHADOW_SIDECAR =
  "import { defineIslandConfig } from '@openelement/element/authoring';\n" +
  "export const openElement = defineIslandConfig({ hydrate: 'only', root: 'shadow' });\n";

const SHADOW_PROFILE = `${SHADOW_SIDECAR}
function DevCard() {
  return <section><p id="dev-card">generated</p></section>;
}
export default DevCard;
`;

/**
 * A Vite plugin context whose `error` keeps the structured diagnostic record
 * (`{ id, loc, frame, message, diagnostics }`) the plugin hands the overlay.
 */
const pluginContext = {
  error(error: unknown): never {
    throw error instanceof Error ? error : new Error(String(error));
  },
};

/** Run a transform and keep the diagnostic the plugin reported, if any. */
async function transformCapturing(
  hooks: ReturnType<typeof devHost>['hooks'],
  code: string,
  id: string,
): Promise<{ result: { code: string } | null; diagnostics: Array<{ message: string }> }> {
  const diagnostics: Array<{ message: string }> = [];
  const context = {
    error(error: { message?: string }): never {
      diagnostics.push({ message: error.message ?? String(error) });
      throw new Error('plugin reported a diagnostic');
    },
  };
  const hook = hooks.transform as unknown as (
    this: unknown,
    code: string,
    id: string,
  ) => Promise<{ code: string } | null>;
  let result: { code: string } | null = null;
  try {
    result = await hook.call(context, code, id);
  } catch {
    // the fake context throws after recording
  }
  return { result, diagnostics };
}

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function devHost(options: { islandsDir?: string; viteRoot?: string } = {}) {
  const state = createOpenPluginState({
    islandsDir: options.islandsDir ?? 'app/islands',
    ...(options.viteRoot === undefined ? {} : { root: options.viteRoot }),
  });
  state.viteRoot = options.viteRoot ?? process.cwd();
  const hooks = createCompilerHooks(state);
  return { state, hooks };
}

type TransformHook = (
  this: unknown,
  code: string,
  id: string,
) => Promise<{ code: string; map: unknown } | null>;

function transform(hooks: ReturnType<typeof devHost>['hooks'], code: string, id: string) {
  const hook = hooks.transform as unknown as TransformHook;
  return hook.call(pluginContext, code, id);
}

describe('M09-1b generated element site resolver', () => {
  test('derives the island tag from the same path source the island pipeline uses', () => {
    const site = createGeneratedElementSiteResolver('app/islands');
    for (const [moduleId, tag] of [
      ['app/islands/profile-card.tsx', 'profile-card'],
      ['app/islands/nested/open-card.tsx', 'nested-open-card'],
      ['app/islands/single.tsx', 'single-page'],
      ['app/islands/Card_Probe.tsx', 'card-probe'],
    ] as const) {
      // Exact equality, not a partial match: the host fact carries the tag
      // only. A `root` (or any other) property appearing here is the stale
      // host-side root the compiler lane no longer reads (D-root-source).
      expect(site(moduleId)).toStrictEqual({ tag });
      // The pipeline's own derivation is the authority; a second spelling here
      // would let the class and the registration disagree.
      expect(
        transformIslandSource('', { islandsDir: 'app/islands', filePath: moduleId }).islands[0],
      ).toEqual({ tagName: tag, filePath: moduleId });
    }
  });

  test('admits nothing outside islandsDir, including the layout convention', () => {
    const site = createGeneratedElementSiteResolver('app/islands');
    for (const moduleId of [
      'app/layout.tsx',
      'app/components/profile-card.tsx',
      'app/islands-backup/profile-card.tsx',
      'app/islands/profile-card.css',
    ]) {
      expect(site(moduleId), `${moduleId} must not be a generated element site`).toBeNull();
    }
  });

  test('a leading slash or an absolute project path still reduces to the tag', () => {
    const site = createGeneratedElementSiteResolver('app/islands');
    expect(site('/app/islands/profile-card.tsx')).toStrictEqual({ tag: 'profile-card' });
    expect(site('/srv/app/app/islands/profile-card.tsx')).toStrictEqual({
      tag: 'profile-card',
    });
  });
});

describe('M09-1b router dev host', () => {
  const root = mkdtempSync(join(tmpdir(), 'oe-m09-1b-dev-'));
  roots.push(root);
  const islandFile = join(root, 'app/islands/dev-card.tsx');
  const islandId = '/proj/app/islands/dev-card.tsx';

  test('emits the generated class for an admitted island', async () => {
    const { hooks } = devHost({ viteRoot: '/proj' });
    mkdirSync(join(root, 'app/islands'), { recursive: true });
    writeFileSync(islandFile, PROFILE);

    const id = join(root, 'app/islands/dev-card.tsx');
    const { result } = await transformCapturing(hooks, PROFILE, id);
    expect(result).not.toBeNull();
    expect(result!.code).toContain('createGeneratedElementClass');
    expect(result!.code).toContain('export default __oeDevCardElement;');
    expect(result!.code).toContain('__oeElementTag = "dev-card"');
    expect(result!.code).not.toContain('customElements');
    // A light island pins no descriptor root: the shell owns the `light`
    // default, so a host-supplied root must never reappear in the bytes.
    expect(result!.code).not.toContain('root: "light"');
  });

  test('an authored shadow sidecar selects the direct open-shadow driver', async () => {
    const { hooks } = devHost({ viteRoot: '/proj' });
    const { result } = await transformCapturing(
      hooks,
      SHADOW_PROFILE,
      '/proj/app/islands/dev-card.tsx',
    );
    expect(result).not.toBeNull();
    expect(result!.code).toContain(
      'createDirectShadowElementClassWithProjection as __oe_createElementClass',
    );
    expect(result!.code).toContain('export default __oeDevCardElement;');
    expect(result!.code).toContain('__oeElementTag = "dev-card"');
    // The resolver supplies just the tag. The client-only shadow sidecar selects
    // the open-shadow projection adapter with the same claim body on reconnect.
    expect(result!.code).toContain(
      [
        'const __oeElementDescriptor = {',
        '  tag: "dev-card",',
        '  source: "app/islands/dev-card.tsx#DevCard",',
        '  mount: DevCard__mount,',
        '  claim: DevCard__claim,',
        '};',
        '',
        'const __oeDevCardElement = __oe_createElementClass(__oeElementDescriptor);',
      ].join('\n'),
    );
    expect(result!.code).toContain('export function createDevCardRecipe(');
    expect(result!.code).toContain('function DevCard__claim(');
    expect(result!.code).not.toContain('export function DevCard__ssrHost(');
  });

  test('a hostless module never acquires the generated class', async () => {
    const { hooks } = devHost({ viteRoot: '/proj' });
    const result = await transform(hooks, PROFILE, '/proj/app/components/dev-card.tsx');
    expect(result === null || !result.code.includes('createGeneratedElementClass')).toBe(true);
  });

  test('a missing island sidecar refuses with the coded diagnostic', async () => {
    const { hooks } = devHost({ viteRoot: '/proj' });
    const source = `function DevCard() {
  return <p>generated</p>;
}
export default DevCard;
`;
    const { diagnostics } = await transformCapturing(
      hooks,
      source,
      '/proj/app/islands/dev-card.tsx',
    );
    expect(diagnostics.map((item) => item.message).join('\n')).toMatch(
      /OEIR_GENERATED_ELEMENT_MISSING_SITE_MARKER/,
    );
  });

  test('a props parameter refuses with the coded diagnostic', async () => {
    const { hooks } = devHost({ viteRoot: '/proj' });
    // The M09-1a props gate: no `properties` table is declared here, so the
    // parameter has no attribute channel. A declared table replaces this gate
    // with the M09-2b type/table cross-check, which is why the refusal is
    // scoped to the undeclared shape.
    const source = `${SIDECAR}
function DevCard(props) {
  return <p>{props.label}</p>;
}
export default DevCard;
`;
    const { diagnostics } = await transformCapturing(
      hooks,
      source,
      '/proj/app/islands/dev-card.tsx',
    );
    expect(diagnostics.map((item) => item.message).join('\n')).toMatch(
      /OEIR_GENERATED_ELEMENT_UNDECLARED_PROPS/,
    );
  });

  test('HMR treats a changed generated module as a full reload, not a class edit', async () => {
    const { hooks } = devHost({ viteRoot: root });
    mkdirSync(join(root, 'app/islands'), { recursive: true });
    writeFileSync(islandFile, PROFILE);
    const id = islandId.replace('/proj', root);
    expect(await transform(hooks, PROFILE, id)).not.toBeNull();

    const reloads: string[] = [];
    const hmr = {
      file: islandFile,
      modules: [],
      server: {
        ws: { send: (message: { type: string }) => reloads.push(message.type) },
        environments: {},
      },
      timestamp: 0,
    };
    const hook = hooks.handleHotUpdate as unknown as (context: unknown) => Promise<unknown>;
    // Same bytes: ordinary HMR (the modules the hook returns).
    expect(await hook.call(pluginContext, hmr)).toEqual([]);
    // A changed generated class cannot be patched in place.
    writeFileSync(islandFile, PROFILE_CHANGED);
    expect(await hook.call(pluginContext, hmr)).toEqual([]);
    expect(reloads).toEqual(['full-reload']);
  });
});

describe('alpha16 tag-source slice: a page-local component in the dev host', () => {
  test('a declared sidecar tag admits a module outside islandsDir to the lane', async () => {
    // The reference case: www/app/site-ui/open-artifact-panel.tsx is neither an
    // island (no path convention) nor a package declaration, so before the
    // declared-tag source the dev transform declined it and emitted nothing.
    const tag = 'open-artifact-panel';
    const source =
      "import { defineIslandConfig } from '@openelement/router';\n" +
      `export const openElement = defineIslandConfig({ tag: '${tag}' });\n` +
      'function ArtifactPanel() {\n' +
      '  return <section><slot></slot></section>;\n' +
      '}\n' +
      'export default ArtifactPanel;\n';

    // The provider is read lazily on every transform, so a map the Phase 1 scan
    // populated after the hooks were created answers here.
    const { state, hooks } = devHost({ viteRoot: '/proj' });
    const moduleId = '/proj/app/site-ui/open-artifact-panel.tsx';

    // Without the declared map the module is NOT a site: the pre-slice answer.
    expect(await transform(hooks, source, moduleId)).toBeNull();

    state.ctx.phase1.declaredElementTags = new Map([['app/site-ui/open-artifact-panel.tsx', tag]]);
    const { result } = await transformCapturing(hooks, source, moduleId);
    expect(result).not.toBeNull();
    expect(result!.code).toContain('createGeneratedElementClass');
    expect(result!.code).toContain(`__oeElementTag = "${tag}"`);
    // The tag is the authored one, and the descriptor still takes it from the
    // host site fact rather than re-reading the sidecar.
    expect(result!.code).toContain(`tag: "${tag}"`);
    expect(result!.code).not.toContain('customElements');
  });
});
