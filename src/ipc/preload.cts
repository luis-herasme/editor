// Preload script: the bridge between the two worlds.
// The renderer is a sandboxed web page with no access to Node.js; this file
// runs with access to both sides and exposes exactly these capabilities to
// the page as `window.bridge`. Nothing else crosses the boundary.
// The Bridge type (bridge.ts) keeps this and the renderer in sync.
import type { Bridge } from "./bridge.js";
import { contextBridge, ipcRenderer } from "electron";

const bridge: Bridge = {
  spawnShell: (id, cols, rows) => ipcRenderer.send("shell:spawn", id, cols, rows),
  writeToShell: (id, data) => ipcRenderer.send("shell:write", id, data),
  resizeShell: (id, cols, rows) => ipcRenderer.send("shell:resize", id, cols, rows),
  killShell: (id) => ipcRenderer.send("shell:kill", id),
  onShellData: (callback) =>
    ipcRenderer.on("shell:data", (_event, id, data) => callback(id, data)),
  onShellExit: (callback) =>
    ipcRenderer.on("shell:exited", (_event, id) => callback(id)),
  onCommand: (callback) =>
    ipcRenderer.on("command", (_event, command) => callback(command)),
  emitEvent: (event) => ipcRenderer.send("event", event),
  showTabMenu: (id) => ipcRenderer.send("tab:menu", id),
  onRenameRequest: (callback) =>
    ipcRenderer.on("tab:rename-request", (_event, id) => callback(id)),
};

contextBridge.exposeInMainWorld("bridge", bridge);
