// Preload script: the bridge between the two worlds.
// The renderer is a sandboxed web page with no access to Node.js; this file
// runs with access to both sides and exposes exactly these capabilities to
// the page as `window.bridge`. Nothing else crosses the boundary.
// The Bridge type (bridge.ts) keeps this and the renderer in sync.
import type { Bridge, ShellDataMessage } from "./bridge.js";
import { contextBridge, ipcRenderer } from "electron";

const bridge: Bridge = {
  spawnShell: (size) => ipcRenderer.send("shell:spawn", size),
  writeToShell: (message) => ipcRenderer.send("shell:write", message),
  resizeShell: (size) => ipcRenderer.send("shell:resize", size),
  killShell: (id) => ipcRenderer.send("shell:kill", id),
  onShellData: (callback) =>
    ipcRenderer.on("shell:data", (_event, message: ShellDataMessage) =>
      callback(message),
    ),
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
