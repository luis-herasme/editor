import { app, BrowserWindow } from "electron";
import * as path from "path";
import { THEMES, DEFAULT_SETTINGS } from "../theme.js";
import { killAllShells } from "./shells.js";
import { confirmKilling } from "./dialogs.js";
import { lmuxState } from "./bus.js";
import { installAppMenu } from "./menus.js";
import "./files.js"; // registers file:read

function createWindow(): void {
  const browserWindow = new BrowserWindow({
    width: 900,
    height: 600,
    // default theme's color, since the chosen one lives in localStorage
    backgroundColor: THEMES[DEFAULT_SETTINGS.theme].background,
    titleBarStyle: "hiddenInset",
    webPreferences: {
      preload: path.join(import.meta.dirname, "../ipc/preload.cjs"),
    },
  });

  browserWindow.on("close", (event) => {
    const tabIds: number[] = [];
    for (const workspace of lmuxState.workspaces) {
      for (const tab of workspace.tabs) {
        tabIds.push(tab.id);
      }
    }
    const proceed = confirmKilling({
      window: browserWindow,
      tabIds,
      action: "Close Window",
    });
    if (proceed) {
      return;
    }
    event.preventDefault();
  });

  browserWindow.on("closed", killAllShells);

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
