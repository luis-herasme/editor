import { currentTheme, getSettings } from "./settings.js";
import DOMPurify from "../../node_modules/dompurify/dist/purify.es.mjs";
import type MarkdownIt from "markdown-it";
// @ts-expect-error no declaration file next to the browser bundle
import markdownitUntyped from "../../node_modules/markdown-it/dist/browser/markdown-it.esm.min.mjs";
const markdownit: typeof MarkdownIt = markdownitUntyped;
import type mermaidModule from "mermaid";
// @ts-expect-error no declaration file next to the browser bundle
import mermaidUntyped from "../../node_modules/mermaid/dist/mermaid.esm.min.mjs";
const mermaid: typeof mermaidModule = mermaidUntyped;
// highlight.js main is CommonJS-only, kept as dev dependency for types
import type hljsModule from "highlight.js";
// @ts-expect-error no declaration file next to the browser bundle
import hljsUntyped from "../../node_modules/@highlightjs/cdn-assets/es/highlight.min.js";
const hljs: typeof hljsModule = hljsUntyped;

const parser = new markdownit({
  html: true,
  linkify: true,
  highlight: (code, language) => {
    if (language !== "" && hljs.getLanguage(language) !== undefined) {
      return hljs.highlight(code, { language }).value;
    }
    return "";
  },
});

export type MarkdownRender = {
  view: HTMLElement;
  // Diagrams arrive after the text, and a drawn one is taller than the
  // fence it replaces: anything that measures the document (restoring a
  // scroll position) has to wait for this.
  ready: Promise<void>;
};

export function renderMarkdown(markdown: string): MarkdownRender {
  const view = document.createElement("article");
  view.className = "markdown-view";
  view.innerHTML = DOMPurify.sanitize(parser.render(markdown));
  renderTaskLists(view);
  return {
    view,
    ready: renderMermaidDiagrams(view),
  };
}

// GFM task lists: "[ ] " → disabled checkbox, styled in style.css
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

let diagramId = 0;

async function renderMermaidDiagrams(view: HTMLElement): Promise<void> {
  const fences = view.querySelectorAll("code.language-mermaid");
  if (fences.length === 0) {
    return;
  }
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
      // ER rows derive toward black unless mapped
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
      diagram.innerHTML = svg;
      pre.replaceWith(diagram);
    } catch {
      document.getElementById(elementId)?.remove();
    }
  }
}
