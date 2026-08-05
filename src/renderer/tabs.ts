// Tab store + executeCommand, the command-bus consumer (api.ts). Dockview
// draws the strip, panes and drag gestures, but every layout mutation it
// would make is cancelled and re-issued as a Command, so gestures and API
// calls enter through the same door. Nothing outside this file knows
// Dockview exists (ARCHITECTURE.md, "The layout engine").
import { getSettings, currentTheme, updateSettings } from "./settings.js";
import { renderMarkdown } from "./markdown.js";
import { registerMarkdownLinks } from "./markdown-links.js";
import type { Command, EditorState, LayoutNode, TabInfo } from "../api.js";
import type { ShellDataMessage } from "../ipc/bridge.js";
import type { Terminal as XtermTerminal } from "@xterm/xterm";
import type { FitAddon as XtermFitAddon } from "@xterm/addon-fit";
import type {
  DockviewGroupPanel,
  IDockviewPanel,
  SerializedDockview,
} from "dockview";
import { requireElement } from "./dom.js";

// Dockview exports its serialized layout but not the node types inside it.
// A node's `data` is either child nodes (branch) or one group (leaf);
// Array.isArray tells them apart.
type SerializedGridNode = SerializedDockview["grid"]["root"];
type SerializedGroup = Exclude<SerializedGridNode["data"], unknown[]>;

// xterm and dockview arrive via classic <script> tags, so at runtime they
// really are page globals.
declare global {
  const Terminal: typeof XtermTerminal;
  const FitAddon: { FitAddon: typeof XtermFitAddon };
  interface Window {
    dockview: typeof import("dockview");
  }
}

interface TabCommon {
  panel: IDockviewPanel; // the tab's Dockview identity
  titleElement: HTMLElement;
  titlePinned: boolean; // an explicit rename beats the shell's OSC titles
}

interface TerminalTab extends TabCommon {
  kind: "terminal";
  terminal: XtermTerminal;
  observer: ResizeObserver; // re-fits the grid when the pane's box changes
  fitAddon: XtermFitAddon; // for update-settings: a font change moves no box
}

interface MarkdownTab extends TabCommon {
  kind: "markdown";
  element: HTMLElement; // the focus target (scrollable view)
}

type Tab = TerminalTab | MarkdownTab;

const tabs = new Map<number, Tab>();
let nextId = 0; // tab ids are born here
let activeId = -1;

// api.addPanel() synchronously asks the factories below for the pane and
// tab elements; createTab fills these right before each call.
let handOffPaneElement: HTMLElement | undefined;
let handOffTabElement: HTMLElement | undefined;

const layoutElement = requireElement("layout");

const dockviewLibrary = window.dockview;
const dockview = new dockviewLibrary.DockviewComponent(layoutElement, {
  theme: dockviewLibrary.themeDark,
  disableFloatingGroups: true,
  // the overflow dropdown can't render our custom tab components; the
  // strip still scrolls
  disableTabsOverflowList: true,
  createComponent: () => {
    const element = handOffPaneElement;
    handOffPaneElement = undefined;
    if (!element) {
      throw new Error("Terminal panels are only added by createTab");
    }
    return {
      element,
      init: () => {},
    };
  },
  createTabComponent: () => {
    const element = handOffTabElement;
    handOffTabElement = undefined;
    if (!element) {
      throw new Error("Terminal tabs are only added by createTab");
    }
    return {
      element,
      init: () => {},
    };
  },
  // called once per group: each pane's + targets its own group
  createRightHeaderActionComponent: (group) => {
    const button = document.createElement("button");
    button.className = "new-tab";
    button.title = "New Tab (⌘T)";
    button.textContent = "+";
    button.addEventListener("click", () => {
      executeCommand({ type: "new-tab", groupId: group.id });
    });
    return {
      element: button,
      init: () => {},
      dispose: () => {},
    };
  },
});

// The one-door rule: cancel every drop and re-issue it as a Command.
dockview.api.onWillDrop((event) => {
  event.preventDefault();
  const data = event.getData();
  if (!data || data.panelId === null) {
    return; // a whole-group drag, not a single tab
  }
  const id = Number(data.panelId);
  const group = event.group;
  if (!group) {
    return; // a window-edge drop; those overlays are suppressed below
  }
  if (event.kind === "tab" || event.kind === "header_space") {
    // on a tab: that tab's position; on the empty strip: the end
    let index = group.panels.length;
    if (event.panel) {
      index = group.panels.indexOf(event.panel);
    }
    executeCommand({
      type: "move-tab",
      id,
      groupId: group.id,
      index,
    });
    return;
  }
  // kind === "content": center merges into the group, a side splits
  if (event.position === "center") {
    if (data.groupId === group.id) {
      return; // a tab dropped onto its own pane, mirroring Dockview's guard
    }
    executeCommand({
      type: "move-tab",
      id,
      groupId: group.id,
      index: group.panels.length,
    });
    return;
  }
  executeCommand({
    type: "split-tab",
    id,
    targetGroupId: group.id,
    side: event.position,
  });
});

// window-edge splits aren't designed yet; suppress just those overlays
dockview.api.onWillShowOverlay((event) => {
  if (event.kind === "edge") {
    event.preventDefault();
  }
});

// tabs are the unit of movement; whole-group drags stay disabled
dockview.api.onWillDragGroup((event) => {
  event.nativeEvent.preventDefault();
});

// Activation is the one gesture Dockview applies itself: it's focus, not
// layout, and blocking the click would also block the drag that starts on
// the same mousedown. The bus still announces it.
dockview.api.onDidActivePanelChange((event) => {
  if (!event.panel) {
    return;
  }
  const id = Number(event.panel.id);
  if (id === activeId) {
    return;
  }
  activeId = id;
  const tab = tabs.get(id);
  // terminal.element is undefined until terminal.open(); createTab focuses
  // the new terminal itself
  if (tab?.kind === "terminal" && tab.terminal.element) {
    tab.terminal.focus();
  }
  if (tab?.kind === "markdown") {
    tab.element.focus();
  }
  window.bridge.emitEvent({
    type: "tab-activated",
    id,
    state: snapshot(),
  });
});

// Commands name groups by id; Dockview hands out group objects.
function findGroup(groupId: string): DockviewGroupPanel | undefined {
  for (const group of dockview.api.groups) {
    if (group.id === groupId) {
      return group;
    }
  }
  return undefined;
}

// Double-clicking a strip's empty space opens a tab in that group. The
// void container is the strip's leftover space, so tabs and + never match.
layoutElement.addEventListener("dblclick", (event) => {
  const target = event.target;
  if (!(target instanceof Element)) {
    return;
  }
  if (!target.closest(".dv-void-container")) {
    return;
  }
  for (const group of dockview.api.groups) {
    if (group.element.contains(target)) {
      executeCommand({
        type: "new-tab",
        groupId: group.id,
      });
      return;
    }
  }
});

// Focus healing: clicks on the chrome move focus out of xterm, and shells
// react to the blur (some blank the window title). preventDefault on tab
// mousedown would keep focus but kills Chromium's tab drag, so heal after
// the click settles instead. The modals are unaffected: they trap focus.
layoutElement.addEventListener("mousedown", () => {
  setTimeout(focusActiveTab, 0);
});

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

// The pane arrangement as api.ts's LayoutNode tree, from Dockview's own
// serialization. Nesting alternates direction at every level.
function buildLayout(
  node: SerializedGridNode,
  direction: "row" | "column",
): LayoutNode {
  const data = node.data;
  if (!Array.isArray(data)) {
    const serializedGroup: SerializedGroup = data;
    const tabList: TabInfo[] = [];
    for (const panelId of serializedGroup.views) {
      const tab = tabs.get(Number(panelId));
      if (!tab) {
        continue;
      }
      let title = tab.titleElement.textContent;
      if (title === null) {
        title = "";
      }
      tabList.push({
        id: Number(panelId),
        title,
        kind: tab.kind,
      });
    }
    return {
      type: "group",
      group: {
        id: serializedGroup.id,
        tabs: tabList,
      },
    };
  }
  let childDirection: "row" | "column" = "row";
  if (direction === "row") {
    childDirection = "column";
  }
  const children: LayoutNode[] = [];
  for (const child of data) {
    children.push(buildLayout(child, childDirection));
  }
  return {
    type: "split",
    direction,
    children,
  };
}

function collectTabs(node: LayoutNode, into: TabInfo[]): void {
  if (node.type === "group") {
    for (const tab of node.group.tabs) {
      into.push(tab);
    }
    return;
  }
  for (const child of node.children) {
    collectTabs(child, into);
  }
}

// Every Event carries one of these: the whole visible truth (api.ts).
function snapshot(): EditorState {
  if (dockview.api.panels.length === 0) {
    return {
      tabs: [],
      layout: null,
      activeId,
    };
  }
  const serialized = dockview.api.toJSON();
  let rootDirection: "row" | "column" = "column";
  if (serialized.grid.orientation === dockviewLibrary.Orientation.HORIZONTAL) {
    rootDirection = "row";
  }
  const layout = buildLayout(serialized.grid.root, rootDirection);
  const tabList: TabInfo[] = [];
  collectTabs(layout, tabList);
  return {
    tabs: tabList,
    layout,
    activeId,
  };
}

// xterm draws its own selection, so the browser's Cmd+C sees nothing to
// copy. Fires for keydown, keypress AND keyup; act on keydown only.
function copyOnCmdC(event: KeyboardEvent): boolean {
  const tab = tabs.get(activeId);
  if (tab?.kind !== "terminal") {
    return true;
  }
  if (
    event.type === "keydown" &&
    event.metaKey &&
    event.key === "c" &&
    tab.terminal.hasSelection()
  ) {
    navigator.clipboard.writeText(tab.terminal.getSelection());
    return false;
  }
  return true;
}

// the active theme in the names xterm's `theme` option expects
function xtermTheme() {
  const theme = currentTheme();
  return {
    background: theme.background,
    foreground: theme.foreground,
    cursor: theme.cursor,
    selectionBackground: theme.selectionBackground,
  };
}

// The strip chrome every tab kind shares: title, ×, context menu
function buildTabElement(id: number): {
  tabElement: HTMLElement;
  titleElement: HTMLElement;
} {
  const titleElement = document.createElement("span");
  titleElement.className = "tab-title";
  titleElement.textContent = "Untitled";
  titleElement.title = "Double-click to rename";

  const closeElement = document.createElement("span");
  closeElement.className = "tab-close";
  closeElement.textContent = "×";
  closeElement.title = "Close Tab (⌘W)";
  closeElement.addEventListener("click", (event) => {
    event.stopPropagation(); // don't also activate a dying tab
    executeCommand({
      type: "close-tab",
      id,
    });
  });

  const tabElement = document.createElement("div");
  tabElement.className = "tab";
  // the id rides on the DOM so the rename dialog's dblclick listener can
  // know which tab was hit without importing us
  tabElement.dataset.tabId = String(id);
  tabElement.append(titleElement, closeElement);
  tabElement.addEventListener("contextmenu", (event) => {
    event.preventDefault();
    window.bridge.showTabMenu(id);
  });
  return {
    tabElement,
    titleElement,
  };
}

function createTab(group?: DockviewGroupPanel): void {
  const id = nextId++;

  const paneElement = document.createElement("div");
  paneElement.className = "terminal-pane";

  // a title is display text, not an id: no numbering, and the shell
  // usually retitles the tab within moments
  const { tabElement, titleElement } = buildTabElement(id);

  // inactive: activation goes through the bus below, once the tab is
  // registered, so the Event carries a complete snapshot
  let position: { referenceGroup: DockviewGroupPanel } | undefined;
  if (group !== undefined) {
    position = { referenceGroup: group };
  }
  handOffPaneElement = paneElement;
  handOffTabElement = tabElement;
  const panel = dockview.api.addPanel({
    id: String(id),
    component: "terminal",
    tabComponent: "terminal-tab",
    title: "Untitled",
    inactive: true,
    position, // undefined targets the active group
  });

  const settings = getSettings();
  const terminal = new Terminal({
    fontFamily: settings.fontFamily,
    fontSize: settings.fontSize,
    cursorBlink: true,
    theme: xtermTheme(),
  });
  const fitAddon = new FitAddon.FitAddon();
  terminal.loadAddon(fitAddon);

  // one mechanism for grid sizing: any box change re-fits the grid
  const observer = new ResizeObserver(() => {
    fitAddon.fit();
  });
  observer.observe(paneElement);

  tabs.set(id, {
    kind: "terminal",
    panel,
    terminal,
    titleElement,
    titlePinned: false,
    observer,
    fitAddon,
  });
  window.bridge.emitEvent({
    type: "tab-opened",
    id,
    state: snapshot(),
  });

  // xterm can only measure a visible container: activate first, then open
  panel.api.setActive();
  terminal.open(paneElement);
  fitAddon.fit();
  terminal.focus();

  // the shell is born at the size fit() just produced
  window.bridge.spawnShell({
    id,
    cols: terminal.cols,
    rows: terminal.rows,
  });

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

  // programs name their own tab via OSC title sequences (GLOSSARY.md);
  // xterm parses them out of the output stream
  terminal.onTitleChange((title) => {
    executeCommand({
      type: "set-tab-title",
      id,
      title,
      transient: true,
    });
  });

  registerMarkdownLinks(terminal, (path) => {
    executeCommand({
      type: "open-markdown",
      path,
      baseTabId: id,
    });
  });
}

function basename(filePath: string): string {
  const slash = filePath.lastIndexOf("/");
  if (slash === -1) {
    return filePath;
  }
  return filePath.slice(slash + 1);
}

// async: the content comes over the cable (file:read in main)
async function openMarkdownTab(
  filePath: string,
  baseTabId: number | undefined,
  group: DockviewGroupPanel | undefined,
): Promise<void> {
  const result = await window.bridge.readFile({
    path: filePath,
    baseTabId,
  });
  const id = nextId++;
  const { tabElement, titleElement } = buildTabElement(id);
  let element: HTMLElement;
  let title = basename(filePath);
  if ("error" in result) {
    element = renderMarkdown(`# Could not open\n\n\`${filePath}\`\n\n${result.error}`);
  } else {
    element = renderMarkdown(result.content);
    title = basename(result.resolvedPath);
  }
  titleElement.textContent = title;

  let position: { referenceGroup: DockviewGroupPanel } | undefined;
  if (group !== undefined) {
    position = { referenceGroup: group };
  }
  handOffPaneElement = element;
  handOffTabElement = tabElement;
  const panel = dockview.api.addPanel({
    id: String(id),
    component: "markdown",
    tabComponent: "markdown-tab",
    title,
    inactive: true,
    position,
  });

  tabs.set(id, {
    kind: "markdown",
    panel,
    titleElement,
    titlePinned: true, // no shell writes here; nothing transient to race
    element,
  });
  window.bridge.emitEvent({
    type: "tab-opened",
    id,
    state: snapshot(),
  });
  panel.api.setActive();
  element.focus();
}

// The single place a Command becomes editor behavior.
export function executeCommand(command: Command): void {
  switch (command.type) {
    case "new-tab": {
      let group: DockviewGroupPanel | undefined;
      if (command.groupId !== undefined) {
        group = findGroup(command.groupId);
        if (!group) {
          return;
        }
      }
      createTab(group);
      return;
    }
    case "close-tab": {
      let id = command.id;
      if (id === undefined) {
        id = activeId;
      }
      // a markdown tab has no shell whose exit would remove it
      if (tabs.get(id)?.kind === "markdown") {
        removeTab(id);
        return;
      }
      // ask main to kill the shell; the tab disappears when the exit lands
      window.bridge.killShell(id);
      return;
    }
    case "activate-tab": {
      // Dockview answers with onDidActivePanelChange, which emits the Event
      tabs.get(command.id)?.panel.api.setActive();
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
    case "move-tab": {
      let id = command.id;
      if (id === undefined) {
        id = activeId;
      }
      const tab = tabs.get(id);
      if (!tab) {
        return;
      }
      let targetGroup = tab.panel.group;
      if (command.groupId !== undefined) {
        const found = findGroup(command.groupId);
        if (!found) {
          return;
        }
        targetGroup = found;
      }
      // a no-op move within one group would dispose the group mid-move if
      // the tab is its only panel; drop it, mirroring Dockview's guards
      if (targetGroup === tab.panel.group) {
        if (targetGroup.panels.length === 1) {
          return;
        }
        if (targetGroup.panels.indexOf(tab.panel) === command.index) {
          return;
        }
      }
      tab.panel.api.moveTo({
        group: targetGroup,
        index: command.index,
      });
      window.bridge.emitEvent({
        type: "tab-moved",
        id,
        state: snapshot(),
      });
      return;
    }
    case "split-tab": {
      let id = command.id;
      if (id === undefined) {
        id = activeId;
      }
      const tab = tabs.get(id);
      if (!tab) {
        return;
      }
      let targetGroup = tab.panel.group;
      if (command.targetGroupId !== undefined) {
        const found = findGroup(command.targetGroupId);
        if (!found) {
          return;
        }
        targetGroup = found;
      }
      // splitting a group's only tab against itself would tear the group
      // down to rebuild it beside itself; a no-op, as in Dockview
      if (targetGroup === tab.panel.group && targetGroup.panels.length === 1) {
        return;
      }
      tab.panel.api.moveTo({
        group: targetGroup,
        position: command.side,
      });
      window.bridge.emitEvent({
        type: "tab-moved",
        id,
        state: snapshot(),
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
      // a pinned title (explicit rename) beats the shell's transient OSC
      // titles; renaming to "" unpins
      const trimmedTitle = command.title.trim();
      if (command.transient && tab.titlePinned) {
        return;
      }
      if (!command.transient) {
        tab.titlePinned = trimmedTitle !== "";
      }
      let title = trimmedTitle;
      if (title === "") {
        title = "Untitled";
      }
      tab.titleElement.textContent = title;
      tab.panel.setTitle(title); // keep Dockview's own record (aria) true
      window.bridge.emitEvent({
        type: "tab-retitled",
        id,
        state: snapshot(),
      });
      return;
    }
    case "update-settings": {
      // settings.ts validates, persists and restyles the page; the live
      // terminals are tab state, so they update here. Explicit fit: a font
      // change alters the cell size but no pane's box, so the
      // ResizeObservers stay silent.
      updateSettings(command.settings);
      const settings = getSettings();
      for (const tab of tabs.values()) {
        if (tab.kind !== "terminal") {
          continue;
        }
        tab.terminal.options.fontFamily = settings.fontFamily;
        tab.terminal.options.fontSize = settings.fontSize;
        tab.terminal.options.theme = xtermTheme();
        tab.fitAddon.fit();
      }
      window.bridge.emitEvent({
        type: "settings-changed",
        settings,
        state: snapshot(),
      });
      return;
    }
    case "open-markdown": {
      let group: DockviewGroupPanel | undefined;
      if (command.groupId !== undefined) {
        group = findGroup(command.groupId);
        if (!group) {
          return;
        }
      }
      void openMarkdownTab(command.path, command.baseTabId, group);
      return;
    }
  }
}

export function handleShellData(message: ShellDataMessage): void {
  const tab = tabs.get(message.id);
  if (tab?.kind !== "terminal") {
    return;
  }
  tab.terminal.write(message.data);
}

// The one removal path for a tab: a shell exit (wired to it in index.ts)
// or a markdown tab's close-tab. When the last shell exits, main closes
// the whole window.
export function removeTab(id: number): void {
  const tab = tabs.get(id);
  if (!tab) {
    return;
  }
  tabs.delete(id);
  if (tab.kind === "terminal") {
    tab.observer.disconnect();
    tab.terminal.dispose();
  }
  if (id === activeId) {
    activeId = -1;
  }
  // removing the active panel re-enters onDidActivePanelChange before this
  // call returns
  dockview.api.removePanel(tab.panel);
  window.bridge.emitEvent({
    type: "tab-closed",
    id,
    state: snapshot(),
  });
}

export function focusActiveTab(): void {
  const tab = tabs.get(activeId);
  if (tab?.kind === "terminal") {
    tab.terminal.focus();
  }
  if (tab?.kind === "markdown") {
    tab.element.focus();
  }
}
