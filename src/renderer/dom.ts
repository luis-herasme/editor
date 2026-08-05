// One strict DOM lookup for the renderer. The page's fixed elements are
// authored in index.html, so a missing id is a build mistake, not a runtime
// condition: fail loudly here instead of carrying a null around.
export function requireElement(id: string): HTMLElement {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`Required element #${id} is missing from index.html`);
  }
  return element;
}
