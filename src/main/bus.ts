import { BrowserWindow, ipcMain } from "electron";
import type { Command, LmuxEvent, LmuxState } from "../api.js";

export function dispatch(command: Command): void {
  BrowserWindow.getFocusedWindow()?.webContents.send("command", command);
}

// Read model: every Event carries a full snapshot, so the latest is truth.
// A live binding, so importers always read the current value.
export let lmuxState: LmuxState = {
  workspaces: [],
  activeWorkspaceId: -1,
};
ipcMain.on("event", (_event, event: LmuxEvent) => {
  lmuxState = event.state;
});
