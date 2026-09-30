/**
 * SSR admission-plan reader for the qualify harnesses (#1472).
 *
 * The Router build emits the admission plan as a plain object literal
 * (`var ssrAdmissionPlan = {...}`) inside the generated server entry. The
 * harness reads that literal as DATA (balanced-brace slice + JSON.parse) and
 * never imports, loads, or runs the generated entry.
 */

export interface SsrAdmissionDecision {
  tagName: string;
  modulePath: string;
  source: string;
  renderPath: string;
  reason: string;
}

export interface SsrAdmissionPlan {
  renderableTags: string[];
  clientOnlyTags: string[];
  rejectedTags: string[];
  reasons: Record<string, string>;
  decisions: SsrAdmissionDecision[];
}

/**
 * Parse the `var ssrAdmissionPlan = {...}` object literal out of the
 * generated server entry text. The scan is quote-aware so brace characters
 * inside string values (admission reasons, module paths) cannot unbalance
 * the depth count.
 */
export function extractSsrAdmissionPlan(entryJs: string): SsrAdmissionPlan {
  const match = entryJs.match(/(?:var|const|let)\s+ssrAdmissionPlan\s*=\s*/);
  if (!match || match.index === undefined) {
    throw new Error('ssrAdmissionPlan not found in generated server entry');
  }
  const begin = match.index + match[0].length;
  if (entryJs[begin] !== '{') {
    throw new Error('ssrAdmissionPlan is not an object literal');
  }
  let depth = 0;
  let quote: '"' | "'" | null = null;
  let escaped = false;
  let end = -1;
  for (let index = begin; index < entryJs.length; index++) {
    const character = entryJs[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === quote) quote = null;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === '{') depth++;
    if (character === '}') {
      depth--;
      if (depth === 0) {
        end = index + 1;
        break;
      }
    }
  }
  if (end === -1) {
    throw new Error('ssrAdmissionPlan object literal is unbalanced');
  }
  const parsed = JSON.parse(entryJs.slice(begin, end)) as Record<string, unknown>;
  if (!Array.isArray(parsed.decisions)) {
    throw new Error('ssrAdmissionPlan.decisions is missing');
  }
  return {
    renderableTags: parsed.renderableTags as string[],
    clientOnlyTags: parsed.clientOnlyTags as string[],
    rejectedTags: parsed.rejectedTags as string[],
    reasons: parsed.reasons as Record<string, string>,
    decisions: (parsed.decisions as Record<string, unknown>[]).map((decision) => ({
      tagName: String(decision.tagName ?? ''),
      modulePath: String(decision.modulePath ?? ''),
      source: String(decision.source ?? ''),
      renderPath: String(decision.renderPath ?? ''),
      reason: String(decision.reason ?? ''),
    })),
  };
}
