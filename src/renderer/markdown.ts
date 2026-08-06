// GitHub-look Markdown rendering. markdown-it parses, DOMPurify sanitizes
// (Markdown may embed raw HTML), github-markdown-css provides the look
// (its dark/light file toggled by settings.ts), mermaid draws ```mermaid
// fences. All three are imported as their self-contained browser ESM
// bundles, by path like zod: no bundler, and bare names mean nothing to
// the browser.
import { currentTheme, getSettings } from "./settings.js";
import DOMPurify from "../../node_modules/dompurify/dist/purify.es.mjs";
// these two bundles ship no declaration files; their types come from the
// packages' normal entries, joined to the value by an annotated const
import type MarkdownIt from "markdown-it";
// @ts-expect-error no declaration file next to the browser bundle
import markdownitUntyped from "../../node_modules/markdown-it/dist/browser/markdown-it.esm.min.mjs";
const markdownit: typeof MarkdownIt = markdownitUntyped;
import type mermaidModule from "mermaid";
// @ts-expect-error no declaration file next to the browser bundle
import mermaidUntyped from "../../node_modules/mermaid/dist/mermaid.esm.min.mjs";
const mermaid: typeof mermaidModule = mermaidUntyped;
// highlight.js publishes its browser ESM bundle in @highlightjs/cdn-assets
// (the main package is CommonJS-only, kept as a dev dependency for types)
import type hljsModule from "highlight.js";
// @ts-expect-error no declaration file next to the browser bundle
import hljsUntyped from "../../node_modules/@highlightjs/cdn-assets/es/highlight.min.js";
const hljs: typeof hljsModule = hljsUntyped;

const parser = new markdownit({
  html: true, // embedded HTML is allowed in, DOMPurify guards it below
  linkify: true,
  // GitHub colors code fences; hljs emits the token spans, the github
  // theme stylesheet colors them. Unknown languages stay escaped text.
  highlight: (code, language) => {
    if (language !== "" && hljs.getLanguage(language) !== undefined) {
      return hljs.highlight(code, { language }).value;
    }
    return "";
  },
});

export function renderMarkdown(markdown: string): HTMLElement {
  const view = document.createElement("article");
  view.className = "markdown-view";
  view.tabIndex = -1; // focusable, so keyboard scrolling works
  view.innerHTML = DOMPurify.sanitize(parser.render(markdown));
  renderTaskLists(view);
  void renderMermaidDiagrams(view);
  return view;
}

// GFM task lists. markdown-it core leaves "[ ] " as text; this swaps it
// for a disabled checkbox (GitHub's .task-list-item markup, styled in
// style.css). A loose list wraps the item text in a <p>.
function renderTaskLists(view: HTMLElement): void {
  for (const item of view.querySelectorAll("li")) {
    let textNode = item.firstChild;
    if (textNode instanceof HTMLParagraphElement) {
      textNode = textNode.firstChild;
    }
    if (textNode === null || textNode.nodeType !== Node.TEXT_NODE) {
      continue;
    }
    const text = textNode.textContent;
    if (text === null) {
      continue;
    }
    let checked = false;
    if (text.startsWith("[x] ") || text.startsWith("[X] ")) {
      checked = true;
    } else if (!text.startsWith("[ ] ")) {
      continue;
    }
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.disabled = true;
    checkbox.checked = checked;
    checkbox.className = "task-list-item-checkbox";
    textNode.textContent = " " + text.slice(4);
    textNode.parentNode?.insertBefore(checkbox, textNode);
    item.classList.add("task-list-item");
    item.parentElement?.classList.add("contains-task-list");
  }
}

let diagramId = 0; // mermaid.render wants a unique element id per diagram

// GitHub draws ```mermaid fences as diagrams, so we do too: each fence's
// source goes to mermaid and the SVG replaces the code block. A fence
// that doesn't parse stays visible as code.
async function renderMermaidDiagrams(view: HTMLElement): Promise<void> {
  const fences = view.querySelectorAll("code.language-mermaid");
  if (fences.length === 0) {
    return;
  }
  // Diagrams draw with the editor's own palette: mermaid's "base" theme
  // exists to take variables. Per batch, not once: a view opened after a
  // theme switch matches it.
  const theme = currentTheme();
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: "strict",
    theme: "base",
    themeVariables: {
      darkMode: theme.colorScheme === "dark",
      background: theme.background,
      primaryColor: theme.tabBarBackground,
      primaryTextColor: theme.tabActiveForeground,
      primaryBorderColor: theme.separator,
      secondaryColor: theme.tabBarBackground,
      tertiaryColor: theme.background,
      lineColor: theme.tabForeground,
      edgeLabelBackground: theme.background,
      // ER attribute rows and notes derive toward black unless mapped
      // (rowOdd/rowEven are the current renderer's names, attribute* the
      // older ones)
      rowOdd: theme.background,
      rowEven: theme.tabBarBackground,
      attributeBackgroundColorOdd: theme.background,
      attributeBackgroundColorEven: theme.tabBarBackground,
      noteBkgColor: theme.tabBarBackground,
      noteTextColor: theme.tabActiveForeground,
      fontFamily: getSettings().uiFontFamily,
    },
  });
  for (const fence of fences) {
    const source = fence.textContent;
    const pre = fence.closest("pre");
    if (source === null || pre === null) {
      continue;
    }
    const elementId = `mermaid-diagram-${diagramId++}`;
    try {
      const { svg } = await mermaid.render(elementId, source);
      const diagram = document.createElement("div");
      diagram.className = "mermaid-diagram";
      // mermaid's strict mode sanitizes its own output; DOMPurify here
      // would strip the SVG's inline styles
      diagram.innerHTML = svg;
      pre.replaceWith(diagram);
    } catch {
      // invalid source: the fence stays as code; drop mermaid's leftover
      // scratch element
      document.getElementById(elementId)?.remove();
    }
  }
}
