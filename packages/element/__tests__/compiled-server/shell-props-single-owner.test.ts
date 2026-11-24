/**
 * ADR-0183 D-5 / D-7 — the props record has ONE owner.
 *
 * The defect this pins: the generated-element shell carried its own props
 * record (a `Map` of plain getters) beside the M04 `createTrackedProps`
 * primitive, and a hand-written `propsChanged` counter beside the primitive's
 * version signal. Two records for one concept is a P6 violation; two
 * invalidation channels is a P8 violation; and because the shell's getters read
 * a Map, nothing they read was trackable — which is why component-authored
 * `computed` was ruled out on 2026-11-18.
 *
 * This is the drift guard that makes the convergence stick: a later change that
 * reintroduces a private props record or a second invalidation channel in the
 * shell fails here, instead of shipping quietly.
 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';

const SHELL_PATH = fileURLToPath(
  new URL('../../src/internal/compiled/generated-element/shell.ts', import.meta.url),
);

describe('ADR-0183: the generated-element shell has one props record and one channel', () => {
  test('the shell imports the ONE props primitive instead of building its own record', async () => {
    const source = await readFile(SHELL_PATH, 'utf8');
    expect(source).toContain('createTrackedProps');
    expect(source).toMatch(
      /import \{[^}]*createTrackedProps[^}]*\} from '\.\.\/runtime\/props\.ts';/,
    );
  });

  test('the shell exposes the primitive version signal as the one propsChanged channel', async () => {
    const source = await readFile(SHELL_PATH, 'utf8');
    // The ABI name stays; it now names the primitive's version signal.
    expect(source).toContain('propsChanged: tracked.version');
    // The hand-written counter is gone, not aliased.
    expect(source).not.toContain('propsChanged.value += 1');
    expect(source).not.toContain('propsChanged: signal(0)');
  });

  test('the shell keeps no second props backing store', async () => {
    const source = await readFile(SHELL_PATH, 'utf8');
    expect(source).not.toContain('readonly values: Map<string, unknown>');
    expect(source).not.toContain('values.set(');
    expect(source).not.toContain('values.get(');
  });
});
