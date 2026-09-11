/**
 * /fail-unserializable — the fetch action channel must answer the author
 * status even when fail() data cannot serialize (circular structure): the
 * native channel re-renders it fine, and a c.json throw would turn a
 * validation failure into a 500. The payload degrades to data:null.
 *
 * #1146 area 4 extra kinds:
 * - symbol-key: a symbol-KEYED (not symbol-valued) object — JSON.stringify
 *   drops the symbol key silently, the plain key must survive;
 * - big: a deeply nested but serializable payload (64 levels, 64 KiB leaf)
 *   proving neither channel truncates or 500s on large fail() data.
 *
 * v0.44: markup compiled in components/page-fail-unserializable.tsx.
 */
import { definePage, fail, type OpenElementActionFailure } from '@openelement/router';
import FailUnserializablePage from '../components/page-fail-unserializable.tsx';

/** 64-deep serializable payload with a 64 KiB leaf (#1146 area 4b threshold). */
function bigPayload(): Record<string, unknown> {
  let node: Record<string, unknown> = { leaf: 'x'.repeat(64 * 1024) };
  for (let depth = 0; depth < 64; depth++) node = { depth, child: node };
  return node;
}

export function action(
  ctx: { formData: FormData },
): OpenElementActionFailure<unknown> {
  const kind = String(ctx.formData.get('kind') ?? 'circular');
  if (kind === 'undefined') return fail(422, undefined);
  if (kind === 'function') return fail(422, () => 'not serializable');
  if (kind === 'symbol') return fail(422, Symbol('not serializable'));
  if (kind === 'bigint') return fail(422, 1n);
  if (kind === 'symbol-key') return fail(422, { [Symbol('k')]: 'v', plain: 1 });
  if (kind === 'big') return fail(422, bigPayload());
  const circular: Record<string, unknown> = { error: 'always fails' };
  circular.self = circular;
  return fail(422, circular);
}

export default definePage(FailUnserializablePage, {
  renderIntent: { mode: 'dynamic' },
});
