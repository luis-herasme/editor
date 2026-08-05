// Main's end of the command bus (see ARCHITECTURE.md and api.ts).
// Importing this module registers the Event intake.
import { BrowserWindow, ipcMain } from "electron";
import type { Command, EditorEvent, EditorState } from "../api.js";

// Commands are how *anything* tells the editor to do something — today the
// menus, next a local server so an agent can drive the editor. This is the
// single entry point that future source will call.
export const dispatch = (command: Command) =>
  BrowserWindow.getFocusedWindow()?.webContents.send("command", command);

// The other half of the bus: every state change comes back as an Event
// carrying a full snapshot. Kept as the read model the future server will
// answer "what does the editor look like?" from.
let editorState: EditorState = { tabs: [], activeId: -1 };
ipcMain.on("event", (_event, event: EditorEvent) => {
  editorState = event.state;
});
