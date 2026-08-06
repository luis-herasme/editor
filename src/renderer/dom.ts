// Strict DOM lookups: the page's fixed elements are authored in
// index.html, so a missing id is a build mistake, not a runtime condition.
export function requireElement(id: string): HTMLElement {
  const element = document.getElementById(id);
  if (element === null) {
    throw new Error(`#${id} is missing from index.html`);
  }
  return element;
}
