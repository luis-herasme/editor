// The editor's public interface — read this file first.
//
// Everything the editor can do is a Command; everything that happens is an
// Event. The UI (menu, buttons, clicks) issues these same Commands, so the
// API can never do less than the UI. Try it now in devtools (⌥⌘I):
//
//   editor.command({ type: "new-tab" })
//   editor.command({ type: "write", text: "ls\n" })
//
// Eventually a local server in the main process will feed Commands in and
// stream Events out, so an agent can drive the editor (see ARCHITECTURE.md,
// "The command bus").
//
// Types only: consumers use `import type { ... } from "./api.js"`, which is
// erased at compile time — the emitted api.js is an empty module nothing
// ever loads.

// Imperative requests, into the editor. `id` defaults to the active tab
// where it's optional.
export type Command =
  | { type: "new-tab" }
  | { type: "close-tab"; id?: number }
  | { type: "activate-tab"; id: number }
  | { type: "write"; id?: number; text: string } // type into a terminal
  // Rename a tab. An explicit rename pins the title: later `transient`
  // renames (the shell's automatic OSC titles) are ignored for that tab.
  // An explicit `title: ""` reverts to "Untitled" and unpins.
  | { type: "set-tab-title"; id?: number; title: string; transient?: boolean }

// Facts, out of the editor. Every event carries the state it produced,
// so whatever an observer heard last is the whole truth.
export type EditorEvent =
  | { type: "tab-opened"; id: number; state: EditorState }
  | { type: "tab-closed"; id: number; state: EditorState }
  | { type: "tab-activated"; id: number; state: EditorState }
  | { type: "tab-retitled"; id: number; state: EditorState }

export interface EditorState {
  tabs: { id: number; title: string }[]
  activeId: number
}
