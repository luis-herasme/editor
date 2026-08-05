// The tabs: each one pairs an xterm.js instance with a shell in main, via
// window.bridge (see ipc/bridge.ts) — and this file is where tab ids are
// born. It also holds executeCommand, the command-bus consumer, because
// the consumer's whole job is mutating tab state: the two are one unit.
// The UI controls built here issue Commands rather than calling functions
// directly — the UI is just the first API client (see ARCHITECTURE.md,
// "The command bus").
import { THEME } from "../theme.js"
import type { Command, EditorState } from "../api.js"
import type { Terminal as XtermTerminal } from "@xterm/xterm"
import type { FitAddon as XtermFitAddon } from "@xterm/addon-fit"

// xterm.js arrives via classic <script> tags in index.html (a packaging
// detail), so at runtime Terminal and FitAddon really are page globals —
// declared here, next to their only consumer. `declare global` is reserved
// for names that genuinely exist on the global scope at runtime.
declare global {
  const Terminal: typeof XtermTerminal
  const FitAddon: { FitAddon: typeof XtermFitAddon }
}

interface Tab {
  term: XtermTerminal
  paneEl: HTMLElement // the terminal's container; hidden unless active
  buttonEl: HTMLElement // its entry in the tab bar
  titleEl: HTMLElement // the button's text: the tab's title
  titlePinned: boolean // an explicit rename beats the shell's automatic titles
  observer: ResizeObserver // re-fits the grid when the pane's box changes
}

const tabs = new Map<number, Tab>()
let nextId = 0 // tab ids are born here (see ARCHITECTURE.md: "Tabs")
let activeId = -1

const tabsEl = document.getElementById("tabs")!
const panesEl = document.getElementById("terminals")!

export function getTabTitle(id: number): string | undefined {
  const tab = tabs.get(id)
  return tab ? tab.titleEl.textContent ?? "" : undefined
}

// Every Event carries one of these: the whole visible truth, so observers
// never need to ask questions (see api.ts).
function snapshot(): EditorState {
  return {
    tabs: [...tabs.entries()].map(([id, tab]) => ({ id, title: tab.titleEl.textContent ?? "" })),
    activeId,
  }
}

function activateTab(id: number): void {
  const tab = tabs.get(id)
  if (!tab) return
  for (const [otherId, other] of tabs) {
    other.paneEl.classList.toggle("active", otherId === id)
    other.buttonEl.classList.toggle("active", otherId === id)
  }
  const changed = activeId !== id
  activeId = id
  tab.term.focus()
  if (changed) window.bridge.emitEvent({ type: "tab-activated", id, state: snapshot() })
}

// xterm draws its own selection, so the browser's native Cmd+C sees nothing
// to copy — handle it ourselves. Cmd+V already works via the Edit menu.
// One shared handler: only the focused (= active) terminal receives keys.
// It fires for keydown, keypress AND keyup — act on keydown only.
function copyOnCmdC(e: KeyboardEvent): boolean {
  const term = tabs.get(activeId)?.term
  if (e.type === "keydown" && e.metaKey && e.key === "c" && term?.hasSelection()) {
    navigator.clipboard.writeText(term.getSelection())
    return false
  }
  return true
}

function createTab(): void {
  const id = nextId++

  const paneEl = document.createElement("div")
  paneEl.className = "terminal-pane"
  panesEl.appendChild(paneEl)

  const titleEl = document.createElement("span")
  titleEl.className = "tab-title"
  // A title is display text, not an id — no need to be unique, so no
  // numbering. The shell usually retitles the tab within moments anyway.
  titleEl.textContent = "Untitled"
  titleEl.title = "Double-click to rename"
  const closeEl = document.createElement("span")
  closeEl.className = "tab-close"
  closeEl.textContent = "×"
  closeEl.title = "Close Tab (⌘W)"
  closeEl.addEventListener("click", (e) => {
    e.stopPropagation() // don't also bubble to the button and activate a dying tab
    executeCommand({ type: "close-tab", id })
  })

  const buttonEl = document.createElement("button")
  buttonEl.className = "tab"
  // The id rides on the DOM so listeners outside this file (the rename
  // dialog's double-click) can know which tab was hit without importing us.
  buttonEl.dataset.tabId = String(id)
  buttonEl.append(titleEl, closeEl)
  buttonEl.addEventListener("click", () => executeCommand({ type: "activate-tab", id }))
  buttonEl.addEventListener("contextmenu", (e) => {
    e.preventDefault()
    window.bridge.showTabMenu(id) // main pops the native menu
  })
  tabsEl.appendChild(buttonEl)

  const term = new Terminal({
    fontFamily: THEME.fontFamily,
    fontSize: THEME.fontSize,
    cursorBlink: true,
    theme: { background: THEME.background },
  })
  const fit = new FitAddon.FitAddon()
  term.loadAddon(fit)

  // One mechanism for grid sizing: whenever this pane's box changes —
  // window resized, tab revealed after being hidden — re-fit the grid.
  // (A hidden pane has no box, so fit() no-ops until it's visible again.)
  const observer = new ResizeObserver(() => fit.fit())
  observer.observe(paneEl)

  tabs.set(id, { term, paneEl, buttonEl, titleEl, titlePinned: false, observer })
  window.bridge.emitEvent({ type: "tab-opened", id, state: snapshot() })

  // xterm can only measure a visible container, so show the new tab first,
  // then open and size the terminal in it.
  activateTab(id)
  term.open(paneEl)
  fit.fit()
  term.focus()

  // The shell is born at the size fit() just produced.
  window.bridge.spawnShell(id, term.cols, term.rows)

  // keyboard -> shell, and keep this tab's PTY the same size as its grid
  term.onData((data) => window.bridge.writeToShell(id, data))
  term.onResize(({ cols, rows }) => window.bridge.resizeShell(id, cols, rows))
  term.attachCustomKeyEventHandler(copyOnCmdC)

  // Programs name their own tab: they emit an OSC title sequence (see
  // GLOSSARY.md) mixed into ordinary output, xterm parses it out, and we
  // route it through the bus — the shell is just another API client.
  term.onTitleChange((title) =>
    executeCommand({ type: "set-tab-title", id, title, transient: true })
  )
}

// The command consumer — the single place a Command becomes editor behavior
// (see api.ts and ARCHITECTURE.md, "The command bus").
export function executeCommand(command: Command): void {
  switch (command.type) {
    case "new-tab":
      return createTab()
    case "close-tab":
      // Ask main to kill the shell; the tab disappears when the shell's
      // exit lands. An unknown id is a no-op on main's side — no guard.
      return window.bridge.killShell(command.id ?? activeId)
    case "activate-tab":
      return activateTab(command.id)
    case "write":
      return window.bridge.writeToShell(command.id ?? activeId, command.text)
    case "set-tab-title": {
      const id = command.id ?? activeId
      const tab = tabs.get(id)
      if (!tab) return
      // A pinned title (explicit rename) beats transient ones (the shell's
      // automatic OSC titles). Explicitly renaming to "" unpins.
      if (command.transient && tab.titlePinned) return
      if (!command.transient) tab.titlePinned = command.title !== ""
      tab.titleEl.textContent = command.title || "Untitled"
      return window.bridge.emitEvent({ type: "tab-retitled", id, state: snapshot() })
    }
  }
}

// shell -> screen, routed to the right tab (wired up in index.ts)
export function handleShellData(id: number, data: string): void {
  tabs.get(id)?.term.write(data)
}

// The one removal path for a tab: its shell exited (`exit` typed, ⌘W, or
// its × clicked). When the last shell exits, main closes the whole window —
// this handler never sees an empty tab bar. (Wired up in index.ts.)
export function handleShellExit(id: number): void {
  const tab = tabs.get(id)
  if (!tab) return
  tabs.delete(id)
  tab.observer.disconnect()
  tab.term.dispose()
  tab.paneEl.remove()
  tab.buttonEl.remove()
  if (id === activeId) activeId = -1 // it's gone; a neighbor is activated below
  window.bridge.emitEvent({ type: "tab-closed", id, state: snapshot() })
  if (activeId === -1) activateTab([...tabs.keys()].at(-1) ?? -1)
}

// The active tab is the default target for focus hand-backs (rename dialog)
export function focusActiveTab(): void {
  tabs.get(activeId)?.term.focus()
}
