#!/usr/bin/env -S deno run --allow-read --allow-write --allow-run --allow-env --allow-net --allow-sys
/**
 * Third-party WC SSR corpus (v0.44 compiled authoring):
 * pin the SSR output FORM and SSR admission classification of each consumed
 * third-party Web Component kind as a known, machine-readable record.
 *
 * For every corpus entry this asserts:
 * - tag presence in the SSG HTML,
 * - authored light-DOM children surviving verbatim (v0.44: none — the
 *   compiler grammar admits foreign hosts as empty static shells with literal
 *   attributes only; slotted content is stamped at island activation and is
 *   pinned by the browser probes instead),
 * - presence/absence of a DSD `<template shadowrootmode>` per component kind,
 * - the data-eid event-binding attribute (v0.44: never — the legacy
 *   marker-based event binding was replaced by compiled event Parts claimed
 *   in place, and foreign hosts are opaque to the compiler),
 * - the admission decision the build's ssrAdmissionPlan assigned
 *   ('unscanned' when the tag never enters the scan; #979/0.43.0-alpha.2
 *   records consumed foreign tags as explicit source:'foreign' client-only
 *   decisions, so corpus tags now classify as 'client-only').
 *
 * The point is pinning each library's observed behavior as a known form, not
 * asserting one specific form is 'correct'.
 *
 * Prints the deterministic record to stdout. CI may retain ordinary job output;
 * generated evidence is not committed to the product repository.
 */

import { join } from '@std/path';

import { escapeRegExp } from './lib/text.ts';
import { prepareFixtureApp, verifyBrowser } from './third-party-wc-smoke.ts';

interface SsrAdmissionDecision {
  tagName: string;
  modulePath: string;
  source: string;
  renderPath: string;
  reason: string;
}

interface SsrAdmissionPlan {
  renderableTags: string[];
  clientOnlyTags: string[];
  rejectedTags: string[];
  reasons: Record<string, string>;
  decisions: SsrAdmissionDecision[];
}

interface CorpusExpectation {
  /** Authored light-DOM children surviving SSR (v0.44: always empty — stamped at activation). */
  lightDomChildren: string[];
  /** Whether SSR emits a DSD shadow template directly inside the tag. */
  dsdTemplate: boolean;
  /** Whether the tag carries a data-eid event-binding attribute (v0.44: never). */
  dataEid: boolean;
  /** Expected admission renderPath, or 'unscanned' when not in the plan. */
  admission: string;
}

interface CorpusEntry {
  tag: string;
  library: string;
  metadata: 'openelement-config' | 'cem' | 'stencil-collection' | 'none';
  expect: CorpusExpectation;
}

const CORPUS: CorpusEntry[] = [
  // openElement control: a local island with ssr+dsd — the only fixture tag
  // the admission plan should classify at all.
  {
    tag: 'alpha3-wc-fixture',
    library: '@openelement/router',
    metadata: 'openelement-config',
    expect: {
      lightDomChildren: [],
      dsdTemplate: true,
      dataEid: false,
      admission: 'ssr+client',
    },
  },
  {
    tag: 'alpha3-lit-counter',
    library: 'lit',
    metadata: 'none',
    expect: {
      lightDomChildren: [],
      dsdTemplate: false,
      dataEid: false,
      admission: 'client-only',
    },
  },
  {
    tag: 'alpha3-lit-host',
    library: 'lit',
    metadata: 'none',
    expect: {
      lightDomChildren: [],
      dsdTemplate: false,
      dataEid: false,
      admission: 'client-only',
    },
  },
  {
    tag: 'sl-button',
    library: '@shoelace-style/shoelace',
    metadata: 'cem',
    expect: {
      lightDomChildren: [],
      dsdTemplate: false,
      dataEid: false,
      admission: 'client-only',
    },
  },
  {
    tag: 'sl-switch',
    library: '@shoelace-style/shoelace',
    metadata: 'cem',
    expect: {
      lightDomChildren: [],
      dsdTemplate: false,
      dataEid: false,
      admission: 'client-only',
    },
  },
  {
    tag: 'sl-dialog',
    library: '@shoelace-style/shoelace',
    metadata: 'cem',
    expect: {
      lightDomChildren: [],
      dsdTemplate: false,
      dataEid: false,
      admission: 'client-only',
    },
  },
  {
    tag: 'md-filled-button',
    library: '@material/web',
    metadata: 'none',
    expect: {
      lightDomChildren: [],
      dsdTemplate: false,
      dataEid: false,
      admission: 'client-only',
    },
  },
  {
    tag: 'md-outlined-text-field',
    library: '@material/web',
    metadata: 'none',
    expect: {
      lightDomChildren: [],
      dsdTemplate: false,
      dataEid: false,
      admission: 'client-only',
    },
  },
  {
    tag: 'md-switch',
    library: '@material/web',
    metadata: 'none',
    expect: {
      lightDomChildren: [],
      dsdTemplate: false,
      dataEid: false,
      admission: 'client-only',
    },
  },
  {
    tag: 'alpha3-native-badge',
    library: 'bare-native',
    metadata: 'none',
    expect: {
      lightDomChildren: [],
      dsdTemplate: false,
      dataEid: false,
      admission: 'client-only',
    },
  },
  {
    tag: 'alpha3-fast-counter',
    library: '@microsoft/fast-element@3.0.2',
    metadata: 'none',
    expect: {
      lightDomChildren: [],
      dsdTemplate: false,
      dataEid: false,
      admission: 'client-only',
    },
  },
  {
    tag: 'ion-button',
    library: '@ionic/core@8.8.18 (Stencil compiled output)',
    metadata: 'stencil-collection',
    expect: {
      lightDomChildren: [],
      dsdTemplate: false,
      dataEid: false,
      admission: 'client-only',
    },
  },
];

const METADATA_PROBES = [
  {
    library: '@shoelace-style/shoelace@2.20.1',
    path: 'node_modules/@shoelace-style/shoelace/dist/custom-elements.json',
    format: 'cem',
    expected: true,
  },
  {
    library: '@ionic/core@8.8.18',
    path: 'node_modules/@ionic/core/dist/collection/collection-manifest.json',
    format: 'stencil-collection',
    expected: true,
  },
  {
    library: '@microsoft/fast-element@3.0.2',
    path: 'node_modules/@microsoft/fast-element/custom-elements.json',
    format: 'cem',
    expected: false,
  },
  {
    library: '@material/web@2.4.1',
    path: 'node_modules/@material/web/custom-elements.json',
    format: 'cem',
    expected: false,
  },
] as const;

async function pathExists(path: string): Promise<boolean> {
  try {
    await Deno.stat(path);
    return true;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return false;
    throw error;
  }
}

/** Extract the generated `var ssrAdmissionPlan = {...}` object literal. */
export function extractSsrAdmissionPlan(entryJs: string): SsrAdmissionPlan {
  const marker = 'var ssrAdmissionPlan = ';
  const start = entryJs.indexOf(marker);
  if (start === -1) throw new Error('ssrAdmissionPlan not found in server entry');
  let i = start + marker.length;
  if (entryJs[i] !== '{') throw new Error('ssrAdmissionPlan is not an object literal');
  let depth = 0;
  const begin = i;
  for (; i < entryJs.length; i++) {
    if (entryJs[i] === '{') depth++;
    else if (entryJs[i] === '}') {
      depth--;
      if (depth === 0) break;
    }
  }
  if (depth !== 0) throw new Error('ssrAdmissionPlan object literal is unbalanced');
  return JSON.parse(entryJs.slice(begin, i + 1)) as SsrAdmissionPlan;
}

interface SsrFormObservation {
  tagPresent: boolean;
  lightDomChildren: string[];
  dsdTemplate: boolean;
  dataEid: boolean;
}

function observeSsrForm(html: string, entry: CorpusEntry): SsrFormObservation {
  const openTag = new RegExp(`<${escapeRegExp(entry.tag)}(\\s[^>]*)?>`);
  const match = openTag.exec(html);
  const tagPresent = match !== null;
  const dsdTemplate = tagPresent &&
    new RegExp(`<${escapeRegExp(entry.tag)}(\\s[^>]*)?>\\s*<template shadowrootmode`).test(html);
  const dataEid = tagPresent && /\bdata-eid=/.test(match![0]);
  const lightDomChildren = entry.expect.lightDomChildren.filter((child) => html.includes(child));
  return { tagPresent, lightDomChildren, dsdTemplate, dataEid };
}

async function main(): Promise<void> {
  const tmpRoot = await Deno.makeTempDir({ prefix: 'openelement-third-party-wc-corpus-' });
  const keep = Deno.env.get('OPEN_ELEMENT_KEEP_THIRD_PARTY_WC_SMOKE') === '1';
  try {
    const appDir = await prepareFixtureApp(tmpRoot);
    const html = await Deno.readTextFile(join(appDir, 'dist', 'third-party-wc', 'index.html'));
    const entryJs = await Deno.readTextFile(join(appDir, 'dist', 'server', 'entry.js'));
    const plan = extractSsrAdmissionPlan(entryJs);
    const decisionByTag = new Map(plan.decisions.map((d) => [d.tagName, d]));
    const browser = await verifyBrowser(join(appDir, 'dist'));
    const metadataProbes = await Promise.all(METADATA_PROBES.map(async (probe) => ({
      library: probe.library,
      format: probe.format,
      path: probe.path.replace(/^node_modules\//, ''),
      available: await pathExists(join(appDir, probe.path)),
      expected: probe.expected,
    })));

    const failures: string[] = [];
    for (const probe of metadataProbes) {
      if (probe.available !== probe.expected) {
        failures.push(
          `${probe.library}: ${probe.format} availability=${probe.available}, expected ${probe.expected}`,
        );
      }
    }
    const entries = CORPUS.map((entry) => {
      const form = observeSsrForm(html, entry);
      const decision = decisionByTag.get(entry.tag);
      const admission = decision
        ? { renderPath: decision.renderPath, reason: decision.reason }
        : { renderPath: 'unscanned', reason: 'tag never enters the island scan' };

      const e = entry.expect;
      if (!form.tagPresent) failures.push(`${entry.tag}: tag missing from SSR HTML`);
      if (form.lightDomChildren.length !== e.lightDomChildren.length) {
        failures.push(
          `${entry.tag}: light-DOM children ${JSON.stringify(form.lightDomChildren)} != expected ${
            JSON.stringify(e.lightDomChildren)
          }`,
        );
      }
      if (form.dsdTemplate !== e.dsdTemplate) {
        failures.push(`${entry.tag}: dsdTemplate=${form.dsdTemplate}, expected ${e.dsdTemplate}`);
      }
      if (form.dataEid !== e.dataEid) {
        failures.push(`${entry.tag}: dataEid=${form.dataEid}, expected ${e.dataEid}`);
      }
      if (admission.renderPath !== e.admission) {
        failures.push(
          `${entry.tag}: admission=${admission.renderPath} (${admission.reason}), expected ${e.admission}`,
        );
      }

      const browserCapabilities = browser[entry.tag];
      if (
        !browserCapabilities ||
        Object.values(browserCapabilities).some((value) => value === false)
      ) {
        failures.push(`${entry.tag}: one or more browser capability probes failed`);
      }
      return {
        tag: entry.tag,
        library: entry.library,
        metadata: entry.metadata,
        admission,
        ssrForm: form,
        browserCapabilities,
      };
    });

    if (failures.length > 0) {
      throw new Error(`SSR corpus mismatches:\n- ${failures.join('\n- ')}`);
    }

    const record = {
      schemaVersion: 2,
      // No timestamp: output stays deterministic and diffable in CI logs.
      source: 'tools/third-party-wc-corpus.ts',
      note:
        'Pins admission, SSR form, metadata availability, and browser interoperability probes; client-only is an explicit supported path, not an SSR claim.',
      metadataProbes,
      entries,
    };
    console.log(JSON.stringify(record, null, 2));
    console.log('third-party WC SSR corpus passed');
  } finally {
    if (keep) {
      console.log(`Keeping third-party WC corpus project at ${tmpRoot}`);
    } else {
      await Deno.remove(tmpRoot, { recursive: true });
    }
  }
}

if (import.meta.main) {
  await main();
}
