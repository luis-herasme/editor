// The IPC contract as a type: if preload.cts and the renderer disagree
// about the bridge's shape, tsc refuses to compile.
import type { Command, EditorEvent } from "../api.js";

// a tab's shell grid size: spawned at one, resized to the next
export interface ShellSizeMessage {
  id: number;
  cols: number;
  rows: number;
}

// bytes between a tab and its shell: keystrokes in, output out
export interface ShellDataMessage {
  id: number;
  data: string;
}

// the markdown view's file access; a relative path resolves against the
// shell cwd of `baseTabId`
export interface ReadFileRequest {
  path: string;
  baseTabId?: number;
}

export type ReadFileResult =
  | { resolvedPath: string; content: string }
  | { error: string };

// The one channel between the two sides, exposed by preload.cts as
// window.bridge. The shell protocol carries only bytes, sizes and tab ids;
// the command bus is the one structured channel.
export interface Bridge {
  spawnShell: (size: ShellSizeMessage) => void;
  writeToShell: (message: ShellDataMessage) => void;
  resizeShell: (size: ShellSizeMessage) => void;
  killShell: (id: number) => void;
  onShellData: (callback: (message: ShellDataMessage) => void) => void;
  onShellExit: (callback: (id: number) => void) => void;
  onCommand: (callback: (command: Command) => void) => void;
  emitEvent: (event: EditorEvent) => void;
  showTabMenu: (id: number) => void; // main shows the native context menu
  onRenameRequest: (callback: (id: number) => void) => void;
  // the one request/response pair on the cable (ipcRenderer.invoke)
  readFile: (request: ReadFileRequest) => Promise<ReadFileResult>;
}

// window.bridge really is a page global at runtime (preload puts it there)
declare global {
  interface Window {
    bridge: Bridge;
  }
}
