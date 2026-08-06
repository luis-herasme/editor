import { getSettings, currentTheme, updateSettings } from "./settings.js";
import { renderMarkdown } from "./markdown.js";
import { registerMarkdownLinks } from "./markdown-links.js";
import type { Command, EditorState, LayoutNode, TabInfo } from "../api.js";
import type { ShellDataMessage } from "../ipc/bridge.js";
import type { ITheme, Terminal as XtermTerminal } from "@xterm/xterm";
import type { FitAddon as XtermFitAddon } from "@xterm/addon-fit";
import type {
  AddPanelPositionOptions,
  DockviewGroupPanel,
  IDockviewPanel,
  SerializedDockview,
} from "dockview";
import { requireElement } from "./dom.js";

type SerializedGridNode = SerializedDockview["grid"]["root"];
type SerializedGroup = Exclude<SerializedGridNode["data"], unknown[]>;

declare global {
  const Terminal: typeof XtermTerminal;
  const FitAddon: { FitAddon: typeof XtermFitAddon };
  interface Window {
    dockview: typeof import("dockview");
  }
}

interface TabCommon {
  panel: IDockviewPanel;
  titleElement: HTMLElement;
  titlePinned: boolean;
}

interface TerminalTab extends TabCommon {
  kind: "terminal";
  terminal: XtermTerminal;
  observer: ResizeObserver;
  fitAddon: XtermFitAddon;
}

interface MarkdownTab extends TabCommon {
  kind: "markdown";
  element: HTMLElement;
}

type Tab = TerminalTab | MarkdownTab;

const tabs = new Map<number, Tab>();
let nextId = 0;
let activeId = -1;

let handOffPaneElement: HTMLElement | undefined;
let handOffTabElement: HTMLElement | undefined;

const layoutElement = requireElement("layout");

const dockviewLibrary = window.dockview;
const dockview = new dockviewLibrary.DockviewComponent(layoutElement, {
  theme: dockviewLibrary.themeDark,
  disableFloatingGroups: true,
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
  createRightHeaderActionComponent: (group) => {
    const button = document.createElement("button");
    button.className = "new-tab";
    button.title = "New Tab (⌘T)";
    button.textContent = "+";
    button.addEventListener("click", () => {
      executeCommand({
        type: "new-tab",
        groupId: group.id,
      });
    });
    return {
      element: button,
      init: () => {},
      dispose: () => {},
    };
  },
});

dockview.api.onWillDrop((event) => {
  event.preventDefault();
  const data = event.getData();
  if (!data || data.panelId === null) {
    return;
  }
  const id = Number(data.panelId);
  const group = event.group;
  if (!group) {
    return;
  }
  if (event.kind === "tab" || event.kind === "header_space") {
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
  if (event.position === "center") {
    if (data.groupId === group.id) {
      return;
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

dockview.api.onWillShowOverlay((event) => {
  if (event.kind === "edge") {
    event.preventDefault();
  }
});

dockview.api.onWillDragGroup((event) => {
  event.nativeEvent.preventDefault();
});

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

function findGroup(groupId: string): DockviewGroupPanel | undefined {
  for (const group of dockview.api.groups) {
    if (group.id === groupId) {
      return group;
    }
  }
  return undefined;
}

layoutElement.addEventListener("dblclick", (event) => {
  const target = event.target;
  if (!(target instanceof Element)) {
    return;
  }
  const tabElement = target.closest(".tab");
  if (tabElement instanceof HTMLElement && tabElement.dataset.tabId) {
    executeCommand({
      type: "toggle-maximize",
      id: Number(tabElement.dataset.tabId),
    });
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

type BuildLayoutOptions = {
  node: SerializedGridNode;
  direction: "row" | "column";
};

function buildLayout({ node, direction }: BuildLayoutOptions): LayoutNode {
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
    children.push(
      buildLayout({
        node: child,
        direction: childDirection,
      }),
    );
  }
  return {
    type: "split",
    direction,
    children,
  };
}

type CollectTabsOptions = {
  node: LayoutNode;
  into: TabInfo[];
};

function collectTabs({ node, into }: CollectTabsOptions): void {
  if (node.type === "group") {
    for (const tab of node.group.tabs) {
      into.push(tab);
    }
    return;
  }
  for (const child of node.children) {
    collectTabs({
      node: child,
      into,
    });
  }
}

function snapshot(): EditorState {
  let maximizedGroupId: string | null = null;
  for (const group of dockview.api.groups) {
    if (group.api.isMaximized()) {
      maximizedGroupId = group.id;
      break;
    }
  }
  if (dockview.api.panels.length === 0) {
    return {
      tabs: [],
      layout: null,
      activeId,
      maximizedGroupId,
    };
  }
  const serialized = dockview.api.toJSON();
  let rootDirection: "row" | "column" = "column";
  if (serialized.grid.orientation === dockviewLibrary.Orientation.HORIZONTAL) {
    rootDirection = "row";
  }
  const layout = buildLayout({
    node: serialized.grid.root,
    direction: rootDirection,
  });
  const tabList: TabInfo[] = [];
  collectTabs({
    node: layout,
    into: tabList,
  });
  return {
    tabs: tabList,
    layout,
    activeId,
    maximizedGroupId,
  };
}

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

function xtermTheme(): ITheme {
  const theme = currentTheme();
  return {
    background: theme.background,
    foreground: theme.foreground,
    cursor: theme.cursor,
    selectionBackground: theme.selectionBackground,
  };
}

type TabElements = {
  tabElement: HTMLElement;
  titleElement: HTMLElement;
};

function buildTabElement(id: number): TabElements {
  const titleElement = document.createElement("span");
  titleElement.className = "tab-title";
  titleElement.textContent = "Untitled";
  titleElement.title = "Double-click to fill the window";

  const closeElement = document.createElement("span");
  closeElement.className = "tab-close";
  closeElement.textContent = "×";
  closeElement.title = "Close Tab (⌘W)";
  closeElement.addEventListener("click", (event) => {
    event.stopPropagation();
    executeCommand({
      type: "close-tab",
      id,
    });
  });

  const tabElement = document.createElement("div");
  tabElement.className = "tab";
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

  const { tabElement, titleElement } = buildTabElement(id);

  let position: AddPanelPositionOptions | undefined;
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
    position,
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

  terminal.onTitleChange((title) => {
    executeCommand({
      type: "set-tab-title",
      id,
      title,
      transient: true,
    });
  });

  registerMarkdownLinks({
    terminal,
    openPath: (path) => {
      executeCommand({
        type: "open-markdown",
        path,
        baseTabId: id,
      });
    },
  });
}

function basename(filePath: string): string {
  const slash = filePath.lastIndexOf("/");
  if (slash === -1) {
    return filePath;
  }
  return filePath.slice(slash + 1);
}

type OpenMarkdownTabOptions = {
  filePath: string;
  baseTabId: number | undefined;
  group: DockviewGroupPanel | undefined;
};

async function openMarkdownTab({
  filePath,
  baseTabId,
  group,
}: OpenMarkdownTabOptions): Promise<void> {
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

  let position: AddPanelPositionOptions | undefined;
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
    titlePinned: true,
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
      if (tabs.get(id)?.kind === "markdown") {
        removeTab(id);
        return;
      }
      window.bridge.killShell(id);
      return;
    }
    case "activate-tab": {
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
      tab.panel.setTitle(title);
      window.bridge.emitEvent({
        type: "tab-retitled",
        id,
        state: snapshot(),
      });
      return;
    }
    case "update-settings": {
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
      openMarkdownTab({
        filePath: command.path,
        baseTabId: command.baseTabId,
        group,
      });
      return;
    }
    case "toggle-maximize": {
      let id = command.id;
      if (id === undefined) {
        id = activeId;
      }
      const tab = tabs.get(id);
      if (!tab) {
        return;
      }
      const group = tab.panel.group;
      if (group.api.isMaximized()) {
        group.api.exitMaximized();
      } else {
        dockview.api.maximizeGroup(tab.panel);
      }
      window.bridge.emitEvent({
        type: "maximize-changed",
        id,
        state: snapshot(),
      });
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
