// Strict DOM lookups: the page's fixed elements are authored in
// index.html, so a missing id is a build mistake, not a runtime condition.
// A constructor narrows the result for callers that need more than
// HTMLElement (a <dialog>'s showModal, an <input>'s value).
export function requireElement(id: string): HTMLElement;
export function requireElement<T extends HTMLElement>(
  id: string,
  type: new () => T,
): T;
export function requireElement(
  id: string,
  type: new () => HTMLElement = HTMLElement,
): HTMLElement {
  const element = document.getElementById(id);
  if (!(element instanceof type)) {
    throw new Error(
      `#${id} is missing from index.html or is not a ${type.name}`,
    );
  }
  return element;
}
