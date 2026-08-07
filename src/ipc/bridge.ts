// tsc refuses if preload.cts and the renderer disagree about this
// shape. The shell protocol carries bytes/sizes/tab ids; the command
// bus is the one structured channel.
import type { Command, LmuxEvent } from "../api.js";

export type ShellSizeMessage = {
  id: number;
  cols: number;
  rows: number;
};

export type ShellDataMessage = {
  id: number;
  data: string;
};

// Relative path resolves against the shell cwd of `baseTabId`.
export type ReadFileRequest = {
  path: string;
  baseTabId?: number;
};

export type ReadFileResult =
  | { resolvedPath: string; content: string }
  | { error: string };

export type Bridge = {
  spawnShell: (size: ShellSizeMessage) => void;
  writeToShell: (message: ShellDataMessage) => void;
  resizeShell: (size: ShellSizeMessage) => void;
  killShell: (id: number) => void;
  onShellData: (callback: (message: ShellDataMessage) => void) => void;
  onShellExit: (callback: (id: number) => void) => void;
  onCommand: (callback: (command: Command) => void) => void;
  emitEvent: (event: LmuxEvent) => void;
  showTabMenu: (id: number) => void;
  onRenameRequest: (callback: (id: number) => void) => void;
  showWorkspaceMenu: (id: number) => void;
  onWorkspaceRenameRequest: (callback: (id: number) => void) => void;
  // the only request/response pair on the cable (ipcRenderer.invoke)
  readFile: (request: ReadFileRequest) => Promise<ReadFileResult>;
};
