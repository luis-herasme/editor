// Main's end of the command bus (api.ts). Importing this module registers
// the Event intake.
import { BrowserWindow, ipcMain } from "electron";
import type { Command, EditorEvent, EditorState } from "../api.js";

// the single entry point every Command source calls: menus today, a local
// server for agents tomorrow
export function dispatch(command: Command): void {
  BrowserWindow.getFocusedWindow()?.webContents.send("command", command);
}

// the read model a future server will answer from: every Event carries a
// full snapshot, so the latest one is the whole truth
let editorState: EditorState = {
  tabs: [],
  layout: null,
  activeId: -1,
  maximizedGroupId: null,
};
ipcMain.on("event", (_event, event: EditorEvent) => {
  editorState = event.state;
});
