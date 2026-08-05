// Preload script: the bridge between the two worlds.
// The renderer is a sandboxed web page with no access to Node.js; this file
// runs with access to both sides and exposes exactly three capabilities to
// the page as `window.terminal`. Nothing else crosses the boundary.
// The TerminalBridge type (bridge.d.ts) keeps this and the renderer in sync.
import { contextBridge, ipcRenderer } from "electron";

const bridge: TerminalBridge = {
  sendInput: (data) => ipcRenderer.send("terminal:input", data),
  resize: (cols, rows) => ipcRenderer.send("terminal:resize", cols, rows),
  onData: (callback) =>
    ipcRenderer.on("terminal:data", (_event, data) => callback(data)),
};

contextBridge.exposeInMainWorld("terminal", bridge);
