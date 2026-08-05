// The tabs: each one pairs an xterm.js instance with a shell in main, via
// window.bridge (see ipc/bridge.ts), and this file is where tab ids are
// born. It also holds executeCommand, the command-bus consumer, because
// the consumer's whole job is mutating tab state: the two are one unit.
// The UI controls built here issue Commands rather than calling functions
// directly. The UI is just the first API client (see ARCHITECTURE.md,
// "The command bus").
import { THEME } from "../theme.js";
import type { Command, EditorState, TabInfo } from "../api.js";
import type { ShellDataMessage } from "../ipc/bridge.js";
import type { Terminal as XtermTerminal } from "@xterm/xterm";
import type { FitAddon as XtermFitAddon } from "@xterm/addon-fit";
import { requireElement } from "./dom.js";

// xterm.js arrives via classic <script> tags in index.html (a packaging
// detail), so at runtime Terminal and FitAddon really are page globals,
// declared here, next to their only consumer. `declare global` is reserved
// for names that genuinely exist on the global scope at runtime.
declare global {
  const Terminal: typeof XtermTerminal;
  const FitAddon: { FitAddon: typeof XtermFitAddon };
}

interface Tab {
  terminal: XtermTerminal;
  paneElement: HTMLElement; // the terminal's container; hidden unless active
  buttonElement: HTMLElement; // its entry in the tab bar
  titleElement: HTMLElement; // the button's text: the tab's title
  titlePinned: boolean; // an explicit rename beats the shell's automatic titles
  observer: ResizeObserver; // re-fits the grid when the pane's box changes
}

const tabs = new Map<number, Tab>();
let nextId = 0; // tab ids are born here (see ARCHITECTURE.md: "Tabs")
let activeId = -1;

const tabsElement = requireElement("tabs");
const panesElement = requireElement("terminals");

export function getTabTitle(id: number): string | undefined {
  const tab = tabs.get(id);
  if (!tab) {
    return undefined;
  }
  let title = tab.titleElement.textContent;
  if (title === null) {
    title = "";
  }
  return title;
}

// Every Event carries one of these: the whole visible truth, so observers
// never need to ask questions (see api.ts).
function snapshot(): EditorState {
  const tabList: TabInfo[] = [];
  for (const [id, tab] of tabs) {
    let title = tab.titleElement.textContent;
    if (title === null) {
      title = "";
    }
    tabList.push({
      id,
      title,
    });
  }
  return {
    tabs: tabList,
    activeId,
  };
}

function activateTab(id: number): void {
  const tab = tabs.get(id);
  if (!tab) {
    return;
  }
  for (const [otherId, other] of tabs) {
    other.paneElement.classList.toggle("active", otherId === id);
    other.buttonElement.classList.toggle("active", otherId === id);
  }
  const changed = activeId !== id;
  activeId = id;
  tab.terminal.focus();
  if (changed) {
    window.bridge.emitEvent({
      type: "tab-activated",
      id,
      state: snapshot(),
    });
  }
}

// xterm draws its own selection, so the browser's native Cmd+C sees nothing
// to copy. Handle it ourselves; Cmd+V already works via the Edit menu.
// One shared handler: only the focused (= active) terminal receives keys.
// It fires for keydown, keypress AND keyup, so act on keydown only.
function copyOnCmdC(event: KeyboardEvent): boolean {
  const terminal = tabs.get(activeId)?.terminal;
  if (
    event.type === "keydown" &&
    event.metaKey &&
    event.key === "c" &&
    terminal?.hasSelection()
  ) {
    navigator.clipboard.writeText(terminal.getSelection());
    return false;
  }
  return true;
}

function createTab(): void {
  const id = nextId++;

  const paneElement = document.createElement("div");
  paneElement.className = "terminal-pane";
  panesElement.appendChild(paneElement);

  const titleElement = document.createElement("span");
  titleElement.className = "tab-title";
  // A title is display text, not an id: no need to be unique, so no
  // numbering. The shell usually retitles the tab within moments anyway.
  titleElement.textContent = "Untitled";
  titleElement.title = "Double-click to rename";

  const closeElement = document.createElement("span");
  closeElement.className = "tab-close";
  closeElement.textContent = "×";
  closeElement.title = "Close Tab (⌘W)";
  closeElement.addEventListener("click", (event) => {
    event.stopPropagation(); // don't also bubble to the button and activate a dying tab
    executeCommand({
      type: "close-tab",
      id,
    });
  });

  const buttonElement = document.createElement("button");
  buttonElement.className = "tab";
  // The id rides on the DOM so listeners outside this file (the rename
  // dialog's double-click) can know which tab was hit without importing us.
  buttonElement.dataset.tabId = String(id);
  buttonElement.append(titleElement, closeElement);
  buttonElement.addEventListener("click", () => {
    executeCommand({
      type: "activate-tab",
      id,
    });
  });
  buttonElement.addEventListener("contextmenu", (event) => {
    event.preventDefault();
    window.bridge.showTabMenu(id); // main pops the native menu
  });
  tabsElement.appendChild(buttonElement);

  const terminal = new Terminal({
    fontFamily: THEME.fontFamily,
    fontSize: THEME.fontSize,
    cursorBlink: true,
    theme: { background: THEME.background },
  });
  const fitAddon = new FitAddon.FitAddon();
  terminal.loadAddon(fitAddon);

  // One mechanism for grid sizing: whenever this pane's box changes
  // (window resized, tab revealed after being hidden), re-fit the grid.
  // (A hidden pane has no box, so fit() no-ops until it's visible again.)
  const observer = new ResizeObserver(() => {
    fitAddon.fit();
  });
  observer.observe(paneElement);

  tabs.set(id, {
    terminal,
    paneElement,
    buttonElement,
    titleElement,
    titlePinned: false,
    observer,
  });
  window.bridge.emitEvent({
    type: "tab-opened",
    id,
    state: snapshot(),
  });

  // xterm can only measure a visible container, so show the new tab first,
  // then open and size the terminal in it.
  activateTab(id);
  terminal.open(paneElement);
  fitAddon.fit();
  terminal.focus();

  // The shell is born at the size fit() just produced.
  window.bridge.spawnShell({
    id,
    cols: terminal.cols,
    rows: terminal.rows,
  });

  // keyboard -> shell, and keep this tab's PTY the same size as its grid
  terminal.onData((data) => {
    window.bridge.writeToShell({
      id,
      data,
    });
  });
  terminal.onResize(({ cols, rows }) => {
    window.bridge.resizeShell({
      id,
      cols,
      rows,
    });
  });
  terminal.attachCustomKeyEventHandler(copyOnCmdC);

  // Programs name their own tab: they emit an OSC title sequence (see
  // GLOSSARY.md) mixed into ordinary output, xterm parses it out, and we
  // route it through the bus. The shell is just another API client.
  terminal.onTitleChange((title) => {
    executeCommand({
      type: "set-tab-title",
      id,
      title,
      transient: true,
    });
  });
}

// The command consumer: the single place a Command becomes editor behavior
// (see api.ts and ARCHITECTURE.md, "The command bus").
export function executeCommand(command: Command): void {
  switch (command.type) {
    case "new-tab": {
      createTab();
      return;
    }
    case "close-tab": {
      // Ask main to kill the shell; the tab disappears when the shell's
      // exit lands. An unknown id is a no-op on main's side, so no guard.
      let id = command.id;
      if (id === undefined) {
        id = activeId;
      }
      window.bridge.killShell(id);
      return;
    }
    case "activate-tab": {
      activateTab(command.id);
      return;
    }
    case "write": {
      let id = command.id;
      if (id === undefined) {
        id = activeId;
      }
      window.bridge.writeToShell({
        id,
        data: command.text,
      });
      return;
    }
    case "set-tab-title": {
      let id = command.id;
      if (id === undefined) {
        id = activeId;
      }
      const tab = tabs.get(id);
      if (!tab) {
        return;
      }
      // A pinned title (explicit rename) beats transient ones (the shell's
      // automatic OSC titles). Explicitly renaming to "" unpins.
      if (command.transient && tab.titlePinned) {
        return;
      }
      if (!command.transient) {
        tab.titlePinned = command.title !== "";
      }
      let title = command.title;
      if (title === "") {
        title = "Untitled";
      }
      tab.titleElement.textContent = title;
      window.bridge.emitEvent({
        type: "tab-retitled",
        id,
        state: snapshot(),
      });
      return;
    }
  }
}

// shell -> screen, routed to the right tab (wired up in index.ts)
export function handleShellData(message: ShellDataMessage): void {
  tabs.get(message.id)?.terminal.write(message.data);
}

// The one removal path for a tab: its shell exited (`exit` typed, ⌘W, or
// its × clicked). When the last shell exits, main closes the whole window,
// so this handler never sees an empty tab bar. (Wired up in index.ts.)
export function handleShellExit(id: number): void {
  const tab = tabs.get(id);
  if (!tab) {
    return;
  }
  tabs.delete(id);
  tab.observer.disconnect();
  tab.terminal.dispose();
  tab.paneElement.remove();
  tab.buttonElement.remove();
  if (id === activeId) {
    activeId = -1; // it's gone; a neighbor is activated below
  }
  window.bridge.emitEvent({
    type: "tab-closed",
    id,
    state: snapshot(),
  });
  if (activeId === -1) {
    // The newest remaining tab takes over (activateTab(-1) no-ops when
    // none remain).
    let lastId = -1;
    for (const remainingId of tabs.keys()) {
      lastId = remainingId;
    }
    activateTab(lastId);
  }
}

// The active tab is the default target for focus hand-backs (rename dialog)
export function focusActiveTab(): void {
  tabs.get(activeId)?.terminal.focus();
}
