import { app, BrowserWindow, shell } from "electron";
import * as path from "path";
import { THEMES, DEFAULT_SETTINGS } from "../theme.js";
import { killAllShells } from "./shells.js";
import { installAppMenu } from "./menus.js";
import "./files.js"; // registers file:read

// Everything else (file:, and any scheme an OS handler would claim) is
// dropped rather than handed to the OS.
const EXTERNAL_PROTOCOLS = ["http:", "https:", "mailto:"];

function openExternally(url: string): void {
  if (!URL.canParse(url)) {
    return;
  }
  if (!EXTERNAL_PROTOCOLS.includes(new URL(url).protocol)) {
    return;
  }
  shell.openExternal(url);
}

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

  browserWindow.on("closed", killAllShells);

  // The page is the app: letting it navigate would replace the whole UI,
  // shells and all, with no way back. Links leave through the browser
  // instead, and the decision stays on this side of the cable.
  browserWindow.webContents.on("will-navigate", (event, url) => {
    event.preventDefault();
    openExternally(url);
  });
  browserWindow.webContents.setWindowOpenHandler(({ url }) => {
    openExternally(url);
    return { action: "deny" };
  });

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
