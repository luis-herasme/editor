// The IPC contract as a type — nothing else. This makes the contract from
// ARCHITECTURE.md ("The boundary") checkable: if preload.cts and the
// renderer ever disagree about the bridge's shape, tsc refuses to compile.
import type { Command, EditorEvent } from "../api.js"

// The one channel between the two sides, exposed by preload.cts as
// window.bridge. Every shell message carries the tab's id — assigned by
// the renderer, which knows a tab exists before main does.
export interface Bridge {
  // The per-tab shell protocol: only bytes, sizes and tab ids.
  spawnShell: (id: number, cols: number, rows: number) => void
  writeToShell: (id: number, data: string) => void
  resizeShell: (id: number, cols: number, rows: number) => void
  killShell: (id: number) => void
  onShellData: (callback: (id: number, data: string) => void) => void
  onShellExit: (callback: (id: number) => void) => void
  // The command bus (api.ts): Commands arrive from main's dispatch,
  // Events are announced back. The one structured channel on the cable.
  onCommand: (callback: (command: Command) => void) => void
  emitEvent: (event: EditorEvent) => void
  // Right-click on a tab: main shows the native context menu (only main
  // can); "Rename" comes back as a request, since the editing happens in
  // the renderer's modal.
  showTabMenu: (id: number) => void
  onRenameRequest: (callback: (id: number) => void) => void
}

// window.bridge really is a page global at runtime — preload puts it
// there — so its type is declared globally too. In this codebase,
// `declare global` is reserved for exactly that: names that genuinely
// exist on the global scope at runtime.
declare global {
  interface Window {
    bridge: Bridge
  }
}
