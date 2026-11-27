/** Compare only the final slug, and only for one simple typing mistake. */
const recoveryPath = /^(\/(?:[a-z0-9-]+\/)*)([a-z0-9-]{4,80})\/?$/;

function isOneEdit(left: string, right: string): boolean {
  if (left.length > right.length) return isOneEdit(right, left);
  if (right.length - left.length > 1) return false;
  let first = 0;
  while (first < left.length && left[first] === right[first]) first++;
  if (left.length !== right.length) return left.slice(first) === right.slice(first + 1);
  if (first === left.length) return false;
  return (
    left.slice(first + 1) === right.slice(first + 1) ||
    (left[first] === right[first + 1] &&
      left[first + 1] === right[first] &&
      left.slice(first + 2) === right.slice(first + 2))
  );
}

/** Reveal one same-directory match using only the inert server-rendered hrefs. */
export function suggestNotFoundRoute(doc: Document): (() => void) | undefined {
  const pathname = doc.defaultView?.location.pathname ?? '';
  const requested = pathname.length <= 160 ? recoveryPath.exec(pathname) : null;
  if (!requested) return;
  const candidates = doc.querySelector<HTMLTemplateElement>('template[data-not-found-candidates]');
  const suggestion = doc.querySelector<HTMLElement>('[data-not-found-suggestion]');
  const output = suggestion?.querySelector('a');
  if (!candidates || !suggestion || !output) return;

  let match: HTMLAnchorElement | undefined;
  for (const candidate of candidates.content.querySelectorAll<HTMLAnchorElement>('a[href]')) {
    const route = recoveryPath.exec(candidate.getAttribute('href') ?? '');
    if (!route || route[1] !== requested[1]) continue;
    if (route[2] === requested[2]) return;
    if (!isOneEdit(requested[2]!, route[2]!)) continue;
    if (match) return;
    match = candidate;
  }
  const href = match?.getAttribute('href');
  if (!href || !match?.textContent) return;
  output.setAttribute('href', href);
  output.textContent = match.textContent;
  suggestion.hidden = false;
  const duplicate = doc.querySelector<HTMLAnchorElement>(
    `.page-404 .popular a[href="${href}"]:not([hidden])`,
  );
  if (duplicate) duplicate.hidden = true;
  return () => {
    suggestion.hidden = true;
    output.removeAttribute('href');
    output.textContent = '';
    if (duplicate) duplicate.hidden = false;
  };
}
