// The IPC contract as a type, nothing else. This makes the contract from
// ARCHITECTURE.md ("The boundary") checkable: if preload.cts and the
// renderer ever disagree about the bridge's shape, tsc refuses to compile.
import type { Command, EditorEvent } from "../api.js";

// Every shell message carries the tab's id, assigned by the renderer, which
// knows a tab exists before main does. Multi-value messages travel as one
// named-field object, so nothing depends on argument order.
// (cols/rows match xterm's and node-pty's own property names.)

// A tab's shell grid size: a shell is spawned at one and resized to the next.
export interface ShellSizeMessage {
  id: number;
  cols: number;
  rows: number;
}

// Bytes between a tab and its shell: keystrokes in, output out.
export interface ShellDataMessage {
  id: number;
  data: string;
}

// The one channel between the two sides, exposed by preload.cts as
// window.bridge.
export interface Bridge {
  // The per-tab shell protocol: only bytes, sizes and tab ids.
  spawnShell: (size: ShellSizeMessage) => void;
  writeToShell: (message: ShellDataMessage) => void;
  resizeShell: (size: ShellSizeMessage) => void;
  killShell: (id: number) => void;
  onShellData: (callback: (message: ShellDataMessage) => void) => void;
  onShellExit: (callback: (id: number) => void) => void;
  // The command bus (api.ts): Commands arrive from main's dispatch,
  // Events are announced back. The one structured channel on the cable.
  onCommand: (callback: (command: Command) => void) => void;
  emitEvent: (event: EditorEvent) => void;
  // Right-click on a tab: main shows the native context menu (only main
  // can); "Rename" comes back as a request, since the editing happens in
  // the renderer's modal.
  showTabMenu: (id: number) => void;
  onRenameRequest: (callback: (id: number) => void) => void;
}

// window.bridge really is a page global at runtime (preload puts it there),
// so its type is declared globally too. In this codebase, `declare global`
// is reserved for exactly that: names that genuinely exist on the global
// scope at runtime.
declare global {
  interface Window {
    bridge: Bridge;
  }
}
