// Main process boot: the window and the app lifecycle. The other main
// modules register their own IPC handlers when imported: shells.ts owns
// the PTYs, menus.ts owns both native menus, bus.ts owns the command bus.
import { app, BrowserWindow } from "electron";
import * as path from "path";
import { THEMES, DEFAULT_SETTINGS } from "../theme.js";
import { killAllShells } from "./shells.js";
import { installAppMenu } from "./menus.js";

function createWindow(): void {
  const browserWindow = new BrowserWindow({
    width: 900,
    height: 600,
    // Shown until the page's first paint. The user's chosen theme lives
    // in the renderer's localStorage, unreadable from here, so this is
    // the default theme's background: a non-default theme repaints on
    // first paint (one frame). Revisit if a config file ever lands.
    backgroundColor: THEMES[DEFAULT_SETTINGS.theme].background,
    // macOS offers no way to recolor the standard title bar, so hide it:
    // the traffic lights stay (inset over the page), and the page's own
    // #title-bar strip takes over the rest (color, title, drag region).
    titleBarStyle: "hiddenInset",
    webPreferences: {
      // preload.cjs, not .js: Electron's sandbox requires CommonJS there,
      // so preload.cts is the one file tsc emits as CommonJS.
      // (import.meta.dirname is ESM's replacement for CommonJS's __dirname.)
      preload: path.join(import.meta.dirname, "../ipc/preload.cjs"),
    },
  });

  browserWindow.on("closed", killAllShells);

  // This file runs from dist/main/, but the page lives (uncompiled) in
  // src/renderer/. The renderer creates the first tab once its script runs.
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
