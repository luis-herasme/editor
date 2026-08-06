import { BrowserWindow, ipcMain } from "electron";
import type { Command, EditorEvent, EditorState } from "../api.js";

export function dispatch(command: Command): void {
  BrowserWindow.getFocusedWindow()?.webContents.send("command", command);
}

// Read model: every Event carries a full snapshot, so the latest is truth.
let editorState: EditorState = {
  workspaces: [],
  activeWorkspaceId: -1,
};
ipcMain.on("event", (_event, event: EditorEvent) => {
  editorState = event.state;
});
