import { getSettings, currentTheme, updateSettings } from "./settings.js";
import { renderMarkdown } from "./markdown.js";
import { registerMarkdownLinks } from "./markdown-links.js";
import {
  activateWorkspace,
  activeWorkspace,
  addPanel,
  createWorkspace,
  findGroup,
  findTab,
  refreshWorkspaceName,
  removeWorkspace,
  setWorkspaceName,
  snapshot,
  workspaces,
} from "./workspaces.js";
import type { Workspace } from "./workspaces.js";
import type { Command, MarkdownMode } from "../api.js";
import type { ReadFileResult, ShellDataMessage } from "../ipc/bridge.js";
import type { ITheme, Terminal as XtermTerminal } from "@xterm/xterm";
import type { FitAddon as XtermFitAddon } from "@xterm/addon-fit";
import type { DockviewGroupPanel, IDockviewPanel } from "dockview";

declare global {
  const Terminal: typeof XtermTerminal;
  const FitAddon: { FitAddon: typeof XtermFitAddon };
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
  element: HTMLElement; // the pane: toolbar above, content below
  contentElement: HTMLElement; // what scrolls and takes focus
  modeButton: HTMLElement;
  // what a reload re-reads: the resolved path once we have one, so a
  // reload doesn't depend on the base tab's shell staying where it was
  filePath: string;
  baseTabId: number | undefined;
  mode: MarkdownMode;
  markdown: string; // the file's text, shown raw or rendered
}

export type Tab = TerminalTab | MarkdownTab;

// A resolved tab is the caller's explicit id or the active workspace's
// active tab, when optional; every command that touches a tab resolves
// through these.
type ResolvedTab = {
  id: number;
  tab: Tab;
  workspace: Workspace;
};

function resolveTab(id: number | undefined): ResolvedTab | undefined {
  let resolvedId = id;
  if (resolvedId === undefined) {
    if (!activeWorkspace) {
      return undefined;
    }
    resolvedId = activeWorkspace.activeId;
  }
  const found = findTab(resolvedId);
  if (found === undefined) {
    return undefined;
  }
  return {
    id: resolvedId,
    tab: found.tab,
    workspace: found.workspace,
  };
}

type ResolveTargetGroupOptions = {
  resolved: ResolvedTab;
  groupId: string | undefined;
};

// move/split command group resolution: falls back to the tab's own group;
// undefined means the named group wasn't found and the command bails.
function resolveTargetGroup({
  resolved,
  groupId,
}: ResolveTargetGroupOptions): DockviewGroupPanel | undefined {
  if (groupId === undefined) {
    return resolved.tab.panel.group;
  }
  return findGroup({
    workspace: resolved.workspace,
    groupId,
  });
}

// `id` defaults to the active workspace where optional.
function resolveWorkspace(id: number | undefined): Workspace | undefined {
  if (id === undefined) {
    return activeWorkspace;
  }
  return workspaces.get(id);
}

export function getTabTitle(id: number): string | undefined {
  const found = findTab(id);
  if (!found) {
    return undefined;
  }
  let title = found.tab.titleElement.textContent;
  if (title === null) {
    title = "";
  }
  return title;
}

function copyOnCmdC(event: KeyboardEvent): boolean {
  if (!activeWorkspace) {
    return true;
  }
  const tab = activeWorkspace.tabs.get(activeWorkspace.activeId);
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

let nextId = 0;

type CreateTabOptions = {
  workspace: Workspace;
  group: DockviewGroupPanel | undefined;
};

function createTab({ workspace, group }: CreateTabOptions): void {
  const id = nextId++;

  const paneElement = document.createElement("div");
  paneElement.className = "terminal-pane";

  const { tabElement, titleElement } = buildTabElement(id);
  const panel = addPanel({
    workspace,
    id,
    component: "terminal",
    title: "Untitled",
    paneElement,
    tabElement,
    group,
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

  // one mechanism for grid sizing: any box change re-fits the grid, except
  // the zero box a hidden workspace reports (fitting against it would
  // resize the shell to nothing)
  const observer = new ResizeObserver(() => {
    if (paneElement.clientWidth === 0 || paneElement.clientHeight === 0) {
      return;
    }
    fitAddon.fit();
  });
  observer.observe(paneElement);

  workspace.tabs.set(id, {
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

type MarkdownTextOptions = {
  result: ReadFileResult;
  filePath: string;
};

// A failed read is shown as a document of its own, so the tab (and its
// reload button) survive a path that isn't there yet.
function markdownText({ result, filePath }: MarkdownTextOptions): string {
  if ("error" in result) {
    return `# Could not open\n\n\`${filePath}\`\n\n${result.error}`;
  }
  return result.content;
}

// The text lands synchronously; the returned promise settles once any
// diagrams have too, so a caller can measure the finished document.
async function showMarkdown(tab: MarkdownTab): Promise<void> {
  if (tab.mode === "raw") {
    const source = document.createElement("pre");
    source.className = "markdown-raw";
    source.textContent = tab.markdown;
    tab.modeButton.textContent = "Rendered";
    tab.contentElement.replaceChildren(source);
    return;
  }
  const { view, ready } = renderMarkdown(tab.markdown);
  tab.modeButton.textContent = "Raw";
  tab.contentElement.replaceChildren(view);
  await ready;
}

type MarkdownPane = {
  paneElement: HTMLElement;
  contentElement: HTMLElement;
  modeButton: HTMLElement;
};

// The toolbar's buttons are Command sources like every other affordance;
// each reads the tab back out of the store when clicked.
function buildMarkdownPane(id: number): MarkdownPane {
  const modeButton = document.createElement("button");
  modeButton.className = "markdown-action";
  modeButton.title = "Show the file's source, or its rendering";
  modeButton.addEventListener("click", () => {
    const found = findTab(id);
    if (found === undefined || found.tab.kind !== "markdown") {
      return;
    }
    let mode: MarkdownMode = "raw";
    if (found.tab.mode === "raw") {
      mode = "rendered";
    }
    executeCommand({
      type: "set-markdown-mode",
      id,
      mode,
    });
  });

  const reloadButton = document.createElement("button");
  reloadButton.className = "markdown-action";
  reloadButton.textContent = "Reload";
  reloadButton.title = "Read the file again";
  reloadButton.addEventListener("click", () => {
    executeCommand({
      type: "reload-markdown",
      id,
    });
  });

  const toolbar = document.createElement("div");
  toolbar.className = "markdown-toolbar";
  toolbar.append(modeButton, reloadButton);

  const contentElement = document.createElement("div");
  contentElement.className = "markdown-scroll";
  contentElement.tabIndex = -1;
  contentElement.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }
    const anchor = target.closest("a");
    if (anchor === null) {
      return;
    }
    const href = anchor.getAttribute("href");
    if (href === null) {
      return;
    }
    // A link carrying a scheme (http:, mailto:, file:) is left alone: main
    // cancels the navigation and decides what may reach the OS.
    if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(href)) {
      return;
    }
    // Everything else is ours to handle, and none of it may navigate.
    event.preventDefault();
    let linkPath = href;
    const fragment = linkPath.indexOf("#");
    if (fragment !== -1) {
      linkPath = linkPath.slice(0, fragment);
    }
    if (!linkPath.toLowerCase().endsWith(".md")) {
      return;
    }
    const found = findTab(id);
    if (found === undefined || found.tab.kind !== "markdown") {
      return;
    }
    // relative to the document holding the link, not to any shell
    const directory = found.tab.filePath.slice(
      0,
      found.tab.filePath.lastIndexOf("/") + 1,
    );
    executeCommand({
      type: "open-markdown",
      path: directory + linkPath,
    });
  });

  const paneElement = document.createElement("div");
  paneElement.className = "markdown-pane";
  paneElement.append(toolbar, contentElement);

  return {
    paneElement,
    contentElement,
    modeButton,
  };
}

type OpenMarkdownTabOptions = {
  workspace: Workspace;
  filePath: string;
  baseTabId: number | undefined;
  group: DockviewGroupPanel | undefined;
};

async function openMarkdownTab({
  workspace,
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
  const { paneElement, contentElement, modeButton } = buildMarkdownPane(id);

  let title = basename(filePath);
  let resolvedPath = filePath;
  if (!("error" in result)) {
    title = basename(result.resolvedPath);
    resolvedPath = result.resolvedPath;
  }
  titleElement.textContent = title;

  const panel = addPanel({
    workspace,
    id,
    component: "markdown",
    title,
    paneElement,
    tabElement,
    group,
  });

  const tab: MarkdownTab = {
    kind: "markdown",
    panel,
    titleElement,
    titlePinned: true,
    element: paneElement,
    contentElement,
    modeButton,
    filePath: resolvedPath,
    baseTabId,
    mode: "rendered",
    markdown: markdownText({
      result,
      filePath,
    }),
  };
  showMarkdown(tab);
  workspace.tabs.set(id, tab);
  window.bridge.emitEvent({
    type: "tab-opened",
    id,
    state: snapshot(),
  });
  panel.api.setActive();
  contentElement.focus();
}

// Redraw in place: the restore waits for the diagrams, or the document is
// still short and the browser clamps the position being restored.
async function redrawMarkdown(tab: MarkdownTab): Promise<void> {
  const scrollTop = tab.contentElement.scrollTop;
  await showMarkdown(tab);
  tab.contentElement.scrollTop = scrollTop;
}

async function reloadMarkdownTab(resolved: ResolvedTab): Promise<void> {
  const tab = resolved.tab;
  if (tab.kind !== "markdown") {
    return;
  }
  const result = await window.bridge.readFile({
    path: tab.filePath,
    baseTabId: tab.baseTabId,
  });
  tab.markdown = markdownText({
    result,
    filePath: tab.filePath,
  });
  // an edit shouldn't cost you your place in a long document
  await redrawMarkdown(tab);
  window.bridge.emitEvent({
    type: "markdown-reloaded",
    id: resolved.id,
    state: snapshot(),
  });
}

export function executeCommand(command: Command): void {
  switch (command.type) {
    case "new-tab": {
      if (!activeWorkspace) {
        return;
      }
      let group: DockviewGroupPanel | undefined;
      if (command.groupId !== undefined) {
        group = findGroup({
          workspace: activeWorkspace,
          groupId: command.groupId,
        });
        if (!group) {
          return;
        }
      }
      createTab({
        workspace: activeWorkspace,
        group,
      });
      return;
    }
    case "close-tab": {
      const resolved = resolveTab(command.id);
      if (resolved === undefined) {
        return;
      }
      if (resolved.tab.kind === "markdown") {
        removeTab(resolved.id);
        return;
      }
      window.bridge.killShell(resolved.id);
      return;
    }
    case "activate-tab": {
      const found = findTab(command.id);
      if (found === undefined) {
        return;
      }
      // a tab in a background workspace brings its workspace forward
      if (found.workspace !== activeWorkspace) {
        executeCommand({
          type: "activate-workspace",
          id: found.workspace.id,
        });
      }
      found.tab.panel.api.setActive();
      return;
    }
    case "write": {
      const resolved = resolveTab(command.id);
      if (resolved === undefined) {
        return;
      }
      window.bridge.writeToShell({
        id: resolved.id,
        data: command.text,
      });
      return;
    }
    case "move-tab": {
      const resolved = resolveTab(command.id);
      if (resolved === undefined) {
        return;
      }
      const targetGroup = resolveTargetGroup({
        resolved,
        groupId: command.groupId,
      });
      if (targetGroup === undefined) {
        return;
      }
      if (targetGroup === resolved.tab.panel.group) {
        if (targetGroup.panels.length === 1) {
          return;
        }
        if (targetGroup.panels.indexOf(resolved.tab.panel) === command.index) {
          return;
        }
      }
      resolved.tab.panel.api.moveTo({
        group: targetGroup,
        index: command.index,
      });
      window.bridge.emitEvent({
        type: "tab-moved",
        id: resolved.id,
        state: snapshot(),
      });
      return;
    }
    case "split-tab": {
      const resolved = resolveTab(command.id);
      if (resolved === undefined) {
        return;
      }
      const targetGroup = resolveTargetGroup({
        resolved,
        groupId: command.targetGroupId,
      });
      if (targetGroup === undefined) {
        return;
      }
      if (
        targetGroup === resolved.tab.panel.group &&
        targetGroup.panels.length === 1
      ) {
        return;
      }
      resolved.tab.panel.api.moveTo({
        group: targetGroup,
        position: command.side,
      });
      window.bridge.emitEvent({
        type: "tab-moved",
        id: resolved.id,
        state: snapshot(),
      });
      return;
    }
    case "set-tab-title": {
      const resolved = resolveTab(command.id);
      if (resolved === undefined) {
        return;
      }
      const { id, tab } = resolved;
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
      refreshWorkspaceName(resolved.workspace);
      window.bridge.emitEvent({
        type: "tab-retitled",
        id,
        state: snapshot(),
      });
      return;
    }
    case "update-settings": {
      const previous = getSettings();
      updateSettings(command.settings);
      const settings = getSettings();
      // a drawn diagram has the theme and the font baked into its SVG, so
      // it only follows those two by being drawn again
      const redraw =
        settings.theme !== previous.theme ||
        settings.markdownFontFamily !== previous.markdownFontFamily;
      for (const workspace of workspaces.values()) {
        for (const tab of workspace.tabs.values()) {
          if (tab.kind === "markdown") {
            if (redraw) {
              redrawMarkdown(tab);
            }
            continue;
          }
          tab.terminal.options.fontFamily = settings.fontFamily;
          tab.terminal.options.fontSize = settings.fontSize;
          tab.terminal.options.theme = xtermTheme();
          if (workspace === activeWorkspace) {
            tab.fitAddon.fit();
          }
        }
      }
      window.bridge.emitEvent({
        type: "settings-changed",
        settings,
        state: snapshot(),
      });
      return;
    }
    case "open-markdown": {
      if (!activeWorkspace) {
        return;
      }
      let group: DockviewGroupPanel | undefined;
      if (command.groupId !== undefined) {
        group = findGroup({
          workspace: activeWorkspace,
          groupId: command.groupId,
        });
        if (!group) {
          return;
        }
      }
      openMarkdownTab({
        workspace: activeWorkspace,
        filePath: command.path,
        baseTabId: command.baseTabId,
        group,
      });
      return;
    }
    case "set-markdown-mode": {
      const resolved = resolveTab(command.id);
      if (resolved === undefined || resolved.tab.kind !== "markdown") {
        return;
      }
      if (resolved.tab.mode === command.mode) {
        return;
      }
      resolved.tab.mode = command.mode;
      showMarkdown(resolved.tab);
      window.bridge.emitEvent({
        type: "markdown-mode-changed",
        id: resolved.id,
        state: snapshot(),
      });
      return;
    }
    case "reload-markdown": {
      const resolved = resolveTab(command.id);
      if (resolved === undefined) {
        return;
      }
      reloadMarkdownTab(resolved);
      return;
    }
    case "toggle-maximize": {
      const resolved = resolveTab(command.id);
      if (resolved === undefined) {
        return;
      }
      const group = resolved.tab.panel.group;
      if (group.api.isMaximized()) {
        group.api.exitMaximized();
      } else {
        resolved.workspace.dockview.api.maximizeGroup(resolved.tab.panel);
      }
      window.bridge.emitEvent({
        type: "maximize-changed",
        id: resolved.id,
        state: snapshot(),
      });
      return;
    }
    case "new-workspace": {
      const workspace = createWorkspace();
      activateWorkspace(workspace);
      window.bridge.emitEvent({
        type: "workspace-opened",
        id: workspace.id,
        state: snapshot(),
      });
      createTab({
        workspace,
        group: undefined,
      });
      return;
    }
    case "close-workspace": {
      const workspace = resolveWorkspace(command.id);
      if (workspace === undefined) {
        return;
      }
      // the window always has a workspace to show
      if (workspaces.size === 1) {
        return;
      }
      removeWorkspace(workspace);
      window.bridge.emitEvent({
        type: "workspace-closed",
        id: workspace.id,
        state: snapshot(),
      });
      return;
    }
    case "activate-workspace": {
      const workspace = workspaces.get(command.id);
      if (workspace === undefined || workspace === activeWorkspace) {
        return;
      }
      activateWorkspace(workspace);
      window.bridge.emitEvent({
        type: "workspace-activated",
        id: workspace.id,
        state: snapshot(),
      });
      return;
    }
    case "rename-workspace": {
      const workspace = resolveWorkspace(command.id);
      if (workspace === undefined) {
        return;
      }
      const name = command.name.trim();
      workspace.namePinned = name !== "";
      if (name === "") {
        refreshWorkspaceName(workspace);
      }
      if (name !== "") {
        setWorkspaceName({
          workspace,
          name,
        });
      }
      window.bridge.emitEvent({
        type: "workspace-renamed",
        id: workspace.id,
        state: snapshot(),
      });
      return;
    }
  }
}

export function handleShellData(message: ShellDataMessage): void {
  const found = findTab(message.id);
  if (found === undefined || found.tab.kind !== "terminal") {
    return;
  }
  found.tab.terminal.write(message.data);
}

export function removeTab(id: number): void {
  const found = findTab(id);
  if (found === undefined) {
    return;
  }
  const { workspace, tab } = found;
  workspace.tabs.delete(id);
  if (tab.kind === "terminal") {
    tab.observer.disconnect();
    tab.terminal.dispose();
  }
  if (id === workspace.activeId) {
    workspace.activeId = -1;
  }
  workspace.dockview.api.removePanel(tab.panel);
  // removing the last tab activates no other panel, so nothing else would
  // take the name off the tab that just left
  refreshWorkspaceName(workspace);
  window.bridge.emitEvent({
    type: "tab-closed",
    id,
    state: snapshot(),
  });
}

export function focusActiveTab(): void {
  if (!activeWorkspace) {
    return;
  }
  const tab = activeWorkspace.tabs.get(activeWorkspace.activeId);
  if (tab?.kind === "terminal") {
    tab.terminal.focus();
  }
  if (tab?.kind === "markdown") {
    tab.contentElement.focus();
  }
}
