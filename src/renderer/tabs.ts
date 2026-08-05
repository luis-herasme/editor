// The tabs: each one pairs an xterm.js instance with a shell in main, via
// window.bridge (see ipc/bridge.ts), and this file is where tab ids are
// born. It also holds executeCommand, the command-bus consumer, because
// the consumer's whole job is mutating tab state: the two are one unit.
//
// The tab bar and panes are rendered by Dockview, a docking layout manager
// (see GLOSSARY.md). Dockview is deliberately kept behind the bus: it draws
// the drag gestures, but every layout mutation it would make is cancelled
// in onWillDrop and re-issued as a Command, so gestures and API calls enter
// through the same door, executeCommand (see ARCHITECTURE.md, "The layout
// engine"). Nothing outside this file knows Dockview exists.
import { THEME } from "../theme.js";
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

// Dockview exports its serialized layout but not the node types inside it,
// so both are derived here. A node's `data` is either child nodes (branch)
// or one serialized group (leaf); Array.isArray is what tells them apart.
type SerializedGridNode = SerializedDockview["grid"]["root"];
type SerializedGroup = Exclude<SerializedGridNode["data"], unknown[]>;

// xterm.js and dockview arrive via classic <script> tags in index.html
// (a packaging detail), so at runtime they really are page globals, declared
// here, next to their only consumer. `declare global` is reserved for names
// that genuinely exist on the global scope at runtime.
declare global {
  const Terminal: typeof XtermTerminal;
  const FitAddon: { FitAddon: typeof XtermFitAddon };
  interface Window {
    dockview: typeof import("dockview");
  }
}

interface Tab {
  panel: IDockviewPanel; // the tab's Dockview identity (its pane + tab strip entry)
  terminal: XtermTerminal;
  titleElement: HTMLElement; // the text inside our custom tab: the tab's title
  titlePinned: boolean; // an explicit rename beats the shell's automatic titles
  observer: ResizeObserver; // re-fits the grid when the pane's box changes
}

const tabs = new Map<number, Tab>();
let nextId = 0; // tab ids are born here (see ARCHITECTURE.md: "Tabs")
let activeId = -1;

// Hand-off slots: api.addPanel() synchronously asks the factories below for
// the pane and tab elements; createTab fills these right before each call.
// Only createTab adds panels, so a slot is never occupied twice.
let handOffPaneElement: HTMLElement | undefined;
let handOffTabElement: HTMLElement | undefined;

const layoutElement = requireElement("layout");

const dockviewLibrary = window.dockview;
const dockview = new dockviewLibrary.DockviewComponent(layoutElement, {
  theme: dockviewLibrary.themeDark,
  disableFloatingGroups: true,
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
  createRightHeaderActionComponent: () => {
    const button = document.createElement("button");
    button.id = "new-tab";
    button.title = "New Tab (⌘T)";
    button.textContent = "+";
    button.addEventListener("click", () => {
      executeCommand({ type: "new-tab" });
    });
    return {
      element: button,
      init: () => {},
      dispose: () => {},
    };
  },
});

// The one-door rule for gestures: Dockview renders the drag (ghost, drop
// overlays), but the mutation itself is cancelled here and re-issued as a
// Command, so a drag enters the editor the same way a menu click or an
// agent call does.
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
    // Dropping on a tab targets that tab's position; dropping on the
    // empty strip after the tabs targets the end.
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
  // kind === "content": the pane below the strip. The center merges the
  // tab into this group; a side splits a new group off there.
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

// Window-edge splits aren't designed yet (they need a public API for
// root-relative placement), so suppress just those overlays.
dockview.api.onWillShowOverlay((event) => {
  if (event.kind === "edge") {
    event.preventDefault();
  }
});

// Dragging a whole group (its header) stays disabled: tabs are the unit
// of movement until a feature needs group moves.
dockview.api.onWillDragGroup((event) => {
  event.nativeEvent.preventDefault();
});

// Activation is the one gesture Dockview applies itself: clicking a tab is
// focus, not a layout mutation, and blocking the click would also block the
// drag that starts on the same mousedown. The bus still announces it, and
// the activate-tab Command remains the programmatic path.
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
  // the new terminal itself once it's open.
  if (tab && tab.terminal.element) {
    tab.terminal.focus();
  }
  window.bridge.emitEvent({
    type: "tab-activated",
    id,
    state: snapshot(),
  });
});

// Commands name groups by their opaque id; Dockview hands out group objects.
function findGroup(groupId: string): DockviewGroupPanel | undefined {
  for (const group of dockview.api.groups) {
    if (group.id === groupId) {
      return group;
    }
  }
  return undefined;
}

// Double-clicking a tab strip's empty space opens a tab in that strip's
// group, the terminal-app convention. Delegated from the layout root: the
// void container is the strip's leftover space, so tabs and the + button
// never match.
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

// The pane arrangement as api.ts's LayoutNode tree, built from Dockview's
// own layout serialization: a leaf is a group (its `views` are panel ids
// in strip order), a branch is a split, and nesting alternates direction
// at every level, starting from the root's orientation.
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

// Every Event carries one of these: the whole visible truth, so observers
// never need to ask questions (see api.ts).
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

function createTab(group?: DockviewGroupPanel): void {
  const id = nextId++;

  const paneElement = document.createElement("div");
  paneElement.className = "terminal-pane";

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
    event.stopPropagation(); // don't also activate a dying tab
    executeCommand({
      type: "close-tab",
      id,
    });
  });

  const tabElement = document.createElement("div");
  tabElement.className = "tab";
  // The id rides on the DOM so listeners outside this file (the rename
  // dialog's double-click) can know which tab was hit without importing us.
  tabElement.dataset.tabId = String(id);
  tabElement.append(titleElement, closeElement);
  tabElement.addEventListener("contextmenu", (event) => {
    event.preventDefault();
    window.bridge.showTabMenu(id); // main pops the native menu
  });

  // inactive: activation happens through the bus below, once the tab is
  // registered, so the activation Event carries a complete snapshot.
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

  const terminal = new Terminal({
    fontFamily: THEME.fontFamily,
    fontSize: THEME.fontSize,
    cursorBlink: true,
    theme: { background: THEME.background },
  });
  const fitAddon = new FitAddon.FitAddon();
  terminal.loadAddon(fitAddon);

  // One mechanism for grid sizing: whenever this pane's box changes
  // (window resized, split divider moved, tab revealed), re-fit the grid.
  // (A hidden pane has no box, so fit() no-ops until it's visible again.)
  const observer = new ResizeObserver(() => {
    fitAddon.fit();
  });
  observer.observe(paneElement);

  tabs.set(id, {
    panel,
    terminal,
    titleElement,
    titlePinned: false,
    observer,
  });
  window.bridge.emitEvent({
    type: "tab-opened",
    id,
    state: snapshot(),
  });

  // xterm can only measure a visible container, so activate the new tab
  // first, then open and size the terminal in it.
  panel.api.setActive();
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
      // Dockview answers with onDidActivePanelChange, which updates
      // activeId, focuses the terminal, and emits the Event.
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
      // No-op moves within one group are dropped, mirroring Dockview's own
      // drop guards. Without this, moving a group's only panel removes it,
      // the emptied group is disposed mid-move, and its tab strip
      // disappears. Moving to another group is real even for an only tab.
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
      // Splitting a group's only tab against that same group would tear
      // the group down just to rebuild it beside itself; Dockview treats
      // it as a no-op drop and so do we.
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
      tab.panel.setTitle(title); // keep Dockview's own record (aria, overflow menu) true
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
  if (id === activeId) {
    activeId = -1;
  }
  // Removing the active panel makes Dockview activate a neighbor, which
  // re-enters onDidActivePanelChange before this call returns.
  dockview.api.removePanel(tab.panel);
  window.bridge.emitEvent({
    type: "tab-closed",
    id,
    state: snapshot(),
  });
}

// The active tab is the default target for focus hand-backs (rename dialog)
export function focusActiveTab(): void {
  tabs.get(activeId)?.terminal.focus();
}
