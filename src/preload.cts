// Preload script: the bridge between the two worlds.
// The renderer is a sandboxed web page with no access to Node.js; this file
// runs with access to both sides and exposes exactly these capabilities to
// the page as `window.terminal`. Nothing else crosses the boundary.
// The TerminalBridge type (bridge.ts) keeps this and the renderer in sync.
import { contextBridge, ipcRenderer } from "electron";
import type { TerminalBridge } from "./bridge.js";

const bridge: TerminalBridge = {
  create: (id, cols, rows) => ipcRenderer.send("terminal:create", id, cols, rows),
  sendInput: (id, data) => ipcRenderer.send("terminal:input", id, data),
  resize: (id, cols, rows) => ipcRenderer.send("terminal:resize", id, cols, rows),
  close: (id) => ipcRenderer.send("terminal:close", id),
  onData: (callback) =>
    ipcRenderer.on("terminal:data", (_event, id, data) => callback(id, data)),
  onExit: (callback) =>
    ipcRenderer.on("terminal:exited", (_event, id) => callback(id)),
  onCommand: (callback) =>
    ipcRenderer.on("command", (_event, command) => callback(command)),
  emitEvent: (event) => ipcRenderer.send("event", event),
};

contextBridge.exposeInMainWorld("terminal", bridge);
