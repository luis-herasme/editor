// Main process: the Node.js side of the app. It owns the window and the
// shells. The renderer (browser side) can't spawn processes, so they live
// here — one PTY per tab, keyed by the session id the renderer assigns.
import { app, BrowserWindow, Menu, ipcMain } from "electron";
import * as path from "path";
import * as os from "os";
import * as pty from "node-pty";
import { THEME } from "./theme.js";
import type { Command, EditorEvent, EditorState } from "./api.js";

// The sessions map, ipcMain handlers and menu are app-lifetime things, so
// they live at module scope — registering them inside createWindow would
// re-register them if a second window ever appeared.
const sessions = new Map<number, pty.IPty>();

// A new tab: spawn the user's shell inside a pseudo-terminal (PTY), not a
// plain pipe. The PTY is what makes the shell believe it's talking to a
// real terminal, so colors, line editing, and programs like vim work.
// '-l' starts it as a login shell so ~/.zprofile etc. are loaded.
// No startup race here: `create` is sent by a running page, so the shell
// can't exist before the renderer is listening.
ipcMain.on("terminal:create", (event, id: number, cols: number, rows: number) => {
  const shell = pty.spawn(process.env.SHELL || "/bin/zsh", ["-l"], {
    name: "xterm-256color",
    cols,
    rows,
    cwd: os.homedir(),
    env: process.env,
  });
  sessions.set(id, shell);

  // Replies go to whoever asked: event.sender is the page that sent `create`.
  const page = event.sender;

  // shell -> screen: bytes the shell writes are forwarded to its tab
  shell.onData((data: string) => {
    if (!page.isDestroyed()) page.send("terminal:data", id, data);
  });

  // One removal path for a tab, however its shell died (`exit`, ⌘W, the
  // tab's ×): the exit event. The last shell exiting closes the window.
  shell.onExit(() => {
    sessions.delete(id);
    if (page.isDestroyed()) return;
    page.send("terminal:exited", id);
    if (sessions.size === 0) BrowserWindow.fromWebContents(page)?.close();
  });
});

// keyboard -> shell: keystrokes from a tab are written to its PTY
ipcMain.on("terminal:input", (_event, id: number, data: string) =>
  sessions.get(id)?.write(data)
);

// Each PTY must always match its tab's on-screen grid size, or full-screen
// programs (vim, htop) would draw outside the visible area.
ipcMain.on("terminal:resize", (_event, id: number, cols: number, rows: number) =>
  sessions.get(id)?.resize(cols, rows)
);

// ⌘W / ×: the renderer asks for the kill; the tab disappears when onExit fires.
ipcMain.on("terminal:close", (_event, id: number) => sessions.get(id)?.kill());

function createWindow(): void {
  const win = new BrowserWindow({
    width: 900,
    height: 600,
    // Shown until the page's first paint — the same THEME color the page
    // then paints itself, so startup doesn't flash a different color.
    backgroundColor: THEME.background,
    webPreferences: {
      // preload.cjs, not .js: Electron's sandbox requires CommonJS there,
      // so preload.cts is the one file tsc emits as CommonJS.
      // (import.meta.dirname is ESM's replacement for CommonJS's __dirname.)
      preload: path.join(import.meta.dirname, "preload.cjs"),
    },
  });

  win.on("closed", () => {
    for (const shell of sessions.values()) shell.kill();
  });

  // main.js runs from dist/, but index.html lives (uncompiled) in src/.
  // The renderer creates the first tab itself once its script runs.
  win.loadFile(path.join(import.meta.dirname, "../src/index.html"));
}

// The command bus (see ARCHITECTURE.md and api.ts). Commands are how
// *anything* tells the editor to do something — today the app menu, next a
// local server so an agent can drive the editor. This dispatch is the
// single entry point that future source will call.
const dispatch = (command: Command) =>
  BrowserWindow.getFocusedWindow()?.webContents.send("command", command);

// The other half of the bus: every state change comes back as an Event
// carrying a full snapshot. Kept as the read model the future server will
// answer "what does the editor look like?" from.
let editorState: EditorState = { tabs: [], activeId: -1 };
ipcMain.on("event", (_event, event: EditorEvent) => {
  editorState = event.state;
});

// ⌘T/⌘W live here, not in the page: menu accelerators are the macOS-native
// home for shortcuts, and the default menu's ⌘W ("close window") would
// otherwise swallow the key before the page ever saw it. Menu items are
// just Command sources — the renderer decides what a "tab" is.
app.whenReady().then(() => {
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      { role: "appMenu" },
      {
        label: "File",
        submenu: [
          { label: "New Tab", accelerator: "CmdOrCtrl+T", click: () => dispatch({ type: "new-tab" }) },
          { label: "Close Tab", accelerator: "CmdOrCtrl+W", click: () => dispatch({ type: "close-tab" }) },
        ],
      },
      { role: "editMenu" }, // keeps ⌘C/⌘V working
      { role: "viewMenu" }, // keeps devtools reachable while learning
      { role: "windowMenu" },
    ])
  );
  createWindow();
});

app.on("window-all-closed", () => app.quit());
