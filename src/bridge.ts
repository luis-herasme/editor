// The IPC contract as a type — nothing else. This makes the contract from
// ARCHITECTURE.md ("The boundary") checkable: if preload.cts and renderer.ts
// ever disagree about the bridge's shape, tsc refuses to compile.
import type { Command, EditorEvent } from "./api.js"

// The bridge exposed by preload.cts as window.terminal. Every session
// message carries the tab's id — assigned by the renderer, which knows a
// tab exists before main does.
export interface TerminalBridge {
  create: (id: number, cols: number, rows: number) => void
  sendInput: (id: number, data: string) => void
  resize: (id: number, cols: number, rows: number) => void
  close: (id: number) => void
  onData: (callback: (id: number, data: string) => void) => void
  onExit: (callback: (id: number) => void) => void
  // The command bus (api.ts): Commands arrive from main's dispatch,
  // Events are announced back. The one structured channel on the cable.
  onCommand: (callback: (command: Command) => void) => void
  emitEvent: (event: EditorEvent) => void
}

// window.terminal really is a page global at runtime — preload puts it
// there — so its type is declared globally too. In this codebase,
// `declare global` is reserved for exactly that: names that genuinely
// exist on the global scope at runtime.
declare global {
  interface Window {
    terminal: TerminalBridge
  }
}
