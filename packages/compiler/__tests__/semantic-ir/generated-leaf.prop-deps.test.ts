/**
 * ADR-0183 D-6 — `propDeps` measured, not assumed.
 *
 * D-6 asked whether D-5 (one props record, signal-backed) makes the `propDeps`
 * channel removable. The measurement says NO, and for a reason the two halves
 * have to be read together:
 *
 * - for the ROOT instance the list holds exactly one signal, the props version
 *   channel (`propsChanged`), which after D-5 IS the tracked record's version;
 * - for a COMPONENT-REFERENCE child the list holds the parent's DEFINING-SCOPE
 *   signals behind the passed prop expressions (`text={label.value}` →
 *   `[label]`), and that fact is not expressible through any props version
 *   signal: the child's props object is a plain getter record, and its refresh
 *   closures are driven by `bindSignalWrites` subscriptions rather than by an
 *   auto-tracking effect. A single "props version" on the child would be a
 *   second invalidation channel, which D-2 forbids.
 *
 * So the channel stays; what this row pins is that it carries exactly those two
 * facts and nothing invented.
 */
import { expect, test } from 'vitest';
import { compileFunctionModule } from '../../src/internal/compiler/semantic-core/function-frontend.ts';
import {
  generateLeafModule,
  type GeneratedLeafModule,
} from '../../src/internal/compiler/semantic-ir/generated-leaf/generate.ts';
import { ELEMENT_CLASSIFIER as CLASSIFIER } from './testlib/element-classifier.ts';

const FILE = '/proj/src/leaf.tsx';

function generate(source: string): GeneratedLeafModule {
  const front = compileFunctionModule(source, FILE, { importClassifier: CLASSIFIER });
  expect(front.diagnostics, 'frontend admission').toEqual([]);
  return generateLeafModule(front.module!);
}

test('D-6: the root instance channel is the one props version signal', () => {
  const module = generate(`function C(props) { return <p>{props.text}</p>; }
`).module!;
  expect(module).toContain('propDeps: [__oe_propsChanged]');
});

test('D-6: a child instance channel is the parent defining-scope signal of each passed prop', () => {
  const module = generate(`import { signal } from '@openelement/element';
function Row(props) { return <li>{props.text}</li>; }
function C(props) { const label = signal('a'); return <Row text={label.value} />; }
`).module!;
  expect(module).toContain(
    'const __oe_childHost0 = { bindings: __oe_host.bindings, propDeps: [label] };',
  );
});

test('D-6: a child whose prop reads a parent PROP forwards the parent props channel', () => {
  const module = generate(`function Row(props) { return <li>{props.text}</li>; }
function C(props) { return <Row text={props.title} />; }
`).module!;
  expect(module).toContain('propDeps: [...__oe_host.propDeps]');
});

test('D-6: a child with no parent-scope prop reads inherits an EMPTY list, never a guess', () => {
  const module = generate(`function Row(props) { return <li>{props.text}</li>; }
function C(props) { return <Row text='static' />; }
`).module!;
  expect(module).toContain('propDeps: []');
});
