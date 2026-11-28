export function appendLateHost(root: ShadowRoot): void {
  root.append(document.createElement(['subpage', 'late'].join('-')));
}
