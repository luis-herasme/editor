// Renderer: owns the tabs. Each tab is one xterm.js instance wired to one
// shell in the main process via window.terminal (the bridge defined in
// preload.cts) — every message carries the tab's session id, and this file
// is where ids are born. xterm.js only draws the screen and captures keys;
// the real work happens in the shells, in the main process.
//
// This file runs as a native ES module (<script type="module"> in
// index.html), so it can import. The `import type` lines are erased at
// compile time — they exist only for the checker.
import { THEME } from "./theme.js"
import type { Command, EditorState } from "./api.js"
import type { Terminal as XtermTerminal } from "@xterm/xterm"
import type { FitAddon as XtermFitAddon } from "@xterm/addon-fit"
import type {} from "./bridge.js" // brings in the window.terminal global type

// xterm.js arrives via classic <script> tags in index.html (a packaging
// detail), so at runtime Terminal and FitAddon really are page globals —
// declared here, next to their only consumer. `declare global` is reserved
// for names that genuinely exist on the global scope at runtime.
declare global {
  const Terminal: typeof XtermTerminal
  const FitAddon: { FitAddon: typeof XtermFitAddon }
}

// CSS can't read THEME directly, so every entry is handed over as a custom
// property, camelCase key → kebab-case var (tabBarBackground → --tab-bar-background).
for (const [key, value] of Object.entries(THEME)) {
  const cssName = "--" + key.replace(/[A-Z]/g, (c) => "-" + c.toLowerCase())
  document.documentElement.style.setProperty(cssName, String(value))
}

interface Tab {
  term: XtermTerminal
  pane: HTMLElement // the terminal's container; hidden unless active
  button: HTMLElement // its entry in the tab bar
  label: HTMLElement // the button's text — see renderLabels
  title: string // what the shell asked to be called (OSC); "" = no title yet
  observer: ResizeObserver // re-fits the grid when the pane's box changes
}

const tabs = new Map<number, Tab>()
let nextId = 0 // session ids are born here (see ARCHITECTURE.md: "Tabs")
let activeId = -1

const tabsEl = document.getElementById("tabs")!
const panesEl = document.getElementById("terminals")!

// A tab is labeled by its title if the shell has set one (see the OSC entry
// in GLOSSARY.md), else "Untitled-n" (VS Code's convention), numbered by
// position, not session id: ids are never reused, so an id-derived number
// would creep upward forever as tabs close.
function renderLabels(): void {
  let n = 1
  for (const tab of tabs.values()) tab.label.textContent = tab.title || `Untitled-${n++}`
}

// Every Event carries one of these: the whole visible truth, so observers
// never need to ask questions (see api.ts).
function snapshot(): EditorState {
  return {
    tabs: [...tabs.entries()].map(([id, tab]) => ({ id, label: tab.label.textContent ?? "" })),
    activeId,
  }
}

function activateTab(id: number): void {
  const tab = tabs.get(id)
  if (!tab) return
  for (const [otherId, other] of tabs) {
    other.pane.classList.toggle("active", otherId === id)
    other.button.classList.toggle("active", otherId === id)
  }
  const changed = activeId !== id
  activeId = id
  tab.term.focus()
  if (changed) window.terminal.emitEvent({ type: "tab-activated", id, state: snapshot() })
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

  const pane = document.createElement("div")
  pane.className = "terminal-pane"
  panesEl.appendChild(pane)

  const label = document.createElement("span")
  label.className = "tab-label"
  const close = document.createElement("span")
  close.className = "tab-close"
  close.textContent = "×"
  close.title = "Close Tab (⌘W)"
  close.addEventListener("click", (e) => {
    e.stopPropagation() // don't also bubble to the button and activate a dying tab
    executeCommand({ type: "close-tab", id })
  })

  const button = document.createElement("button")
  button.className = "tab"
  button.append(label, close)
  button.addEventListener("click", () => executeCommand({ type: "activate-tab", id }))
  tabsEl.appendChild(button)

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
  observer.observe(pane)

  tabs.set(id, { term, pane, button, label, title: "", observer })
  renderLabels()
  window.terminal.emitEvent({ type: "tab-opened", id, state: snapshot() })

  // xterm can only measure a visible container, so show the new tab first,
  // then open and size the terminal in it.
  activateTab(id)
  term.open(pane)
  fit.fit()
  term.focus()

  // The shell is born at the size fit() just produced.
  window.terminal.create(id, term.cols, term.rows)

  // keyboard -> shell, and keep this tab's PTY the same size as its grid
  term.onData((data) => window.terminal.sendInput(id, data))
  term.onResize(({ cols, rows }) => window.terminal.resize(id, cols, rows))
  term.attachCustomKeyEventHandler(copyOnCmdC)

  // Programs name their own tab: they emit an OSC title sequence (see
  // GLOSSARY.md) mixed into ordinary output, xterm parses it out, and we
  // route it through the bus — the shell is just another API client.
  term.onTitleChange((title) => executeCommand({ type: "set-tab-title", id, title }))
}

// The command consumer — the single place a Command becomes editor behavior
// (see api.ts and ARCHITECTURE.md, "The command bus"). The UI controls
// above route through here too: the UI is just the first API client, which
// is what keeps "everything is possible via commands" structurally true.
function executeCommand(command: Command): void {
  switch (command.type) {
    case "new-tab":
      return createTab()
    case "close-tab":
      // Ask main to kill the shell; the tab disappears when onExit lands.
      // An unknown id is a no-op on main's side, so no guard is needed.
      return window.terminal.close(command.id ?? activeId)
    case "activate-tab":
      return activateTab(command.id)
    case "write":
      return window.terminal.sendInput(command.id ?? activeId, command.text)
    case "set-tab-title": {
      const id = command.id ?? activeId
      const tab = tabs.get(id)
      if (!tab) return
      tab.title = command.title
      renderLabels()
      return window.terminal.emitEvent({ type: "tab-retitled", id, state: snapshot() })
    }
  }
}

// The public interface, reachable today from the devtools console (⌥⌘I):
//   editor.command({ type: "new-tab" })
declare global {
  interface Window {
    editor: { command: (command: Command) => void }
  }
}
window.editor = { command: executeCommand }

// Commands arriving over the cable (menu today, a server tomorrow)
window.terminal.onCommand(executeCommand)

// shell -> screen, routed to the right tab
window.terminal.onData((id, data) => tabs.get(id)?.term.write(data))

// The one removal path for a tab: its shell exited (`exit` typed, ⌘W, or its
// × clicked). When the last shell exits, main closes the whole window — this
// handler never sees an empty tab bar.
window.terminal.onExit((id) => {
  const tab = tabs.get(id)
  if (!tab) return
  tabs.delete(id)
  tab.observer.disconnect()
  tab.term.dispose()
  tab.pane.remove()
  tab.button.remove()
  renderLabels()
  if (id === activeId) activeId = -1 // it's gone; a neighbor is activated below
  window.terminal.emitEvent({ type: "tab-closed", id, state: snapshot() })
  if (activeId === -1) activateTab([...tabs.keys()].at(-1) ?? -1)
})

document.getElementById("new-tab")!.addEventListener("click", () =>
  executeCommand({ type: "new-tab" })
)

executeCommand({ type: "new-tab" }) // the first tab — this boots the first shell
