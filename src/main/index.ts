// Main process boot: the window and the app lifecycle. The other main
// modules register their IPC handlers when imported.
import { app, BrowserWindow } from "electron";
import * as path from "path";
import { THEMES, DEFAULT_SETTINGS } from "../theme.js";
import { killAllShells } from "./shells.js";
import { installAppMenu } from "./menus.js";

function createWindow(): void {
  const browserWindow = new BrowserWindow({
    width: 900,
    height: 600,
    // shown until first paint; the default theme's color, since the chosen
    // theme lives in the renderer's localStorage, unreadable from here
    backgroundColor: THEMES[DEFAULT_SETTINGS.theme].background,
    // macOS can't recolor the standard title bar, so hide it: the page's
    // #title-bar strip takes over, the traffic lights stay native
    titleBarStyle: "hiddenInset",
    webPreferences: {
      // Electron's sandbox requires a CommonJS preload; preload.cts is the
      // one file tsc emits as .cjs
      preload: path.join(import.meta.dirname, "../ipc/preload.cjs"),
    },
  });

  browserWindow.on("closed", killAllShells);

  // this file runs from dist/main/; the page lives uncompiled in src/
  browserWindow.loadFile(
    path.join(import.meta.dirname, "../../src/renderer/index.html"),
  );
}

app.whenReady().then(() => {
  installAppMenu();
  createWindow();
});

app.on("window-all-closed", () => {
  app.quit();
});
