// The shells: one PTY per tab, keyed by the tab id the renderer assigns.
// The renderer (browser side) can't spawn processes, so they live here in
// main. Importing this module registers the shell half of the IPC protocol.
import { BrowserWindow, ipcMain } from "electron";
import * as os from "os";
import * as pty from "node-pty";
import type { ShellDataMessage, ShellSizeMessage } from "../ipc/bridge.js";

// App-lifetime, so module scope: registering handlers inside createWindow
// would re-register them if a second window ever appeared.
const shells = new Map<number, pty.IPty>();

// A new tab: spawn the user's shell inside a pseudo-terminal (PTY), not a
// plain pipe. The PTY is what makes the shell believe it's talking to a
// real terminal, so colors, line editing, and programs like vim work.
// '-l' starts it as a login shell so ~/.zprofile etc. are loaded.
// No startup race here: `spawn` is sent by a running page, so the shell
// can't exist before the renderer is listening.
ipcMain.on("shell:spawn", (event, size: ShellSizeMessage) => {
  let shellPath = process.env.SHELL;
  if (!shellPath) {
    shellPath = "/bin/zsh";
  }
  const shell = pty.spawn(shellPath, ["-l"], {
    name: "xterm-256color",
    cols: size.cols,
    rows: size.rows,
    cwd: os.homedir(),
    env: process.env,
  });
  shells.set(size.id, shell);

  // Replies go to whoever asked: event.sender is the page that sent `spawn`.
  const page = event.sender;

  // shell -> screen: bytes the shell writes are forwarded to its tab
  shell.onData((data: string) => {
    if (page.isDestroyed()) {
      return;
    }
    const message: ShellDataMessage = {
      id: size.id,
      data,
    };
    page.send("shell:data", message);
  });

  // One removal path for a tab, however its shell died (`exit`, ⌘W, the
  // tab's ×): the exit event. The last shell exiting closes the window.
  shell.onExit(() => {
    shells.delete(size.id);
    if (page.isDestroyed()) {
      return;
    }
    page.send("shell:exited", size.id);
    if (shells.size === 0) {
      BrowserWindow.fromWebContents(page)?.close();
    }
  });
});

// keyboard -> shell: keystrokes from a tab are written to its PTY
ipcMain.on("shell:write", (_event, message: ShellDataMessage) => {
  shells.get(message.id)?.write(message.data);
});

// Each PTY must always match its tab's on-screen grid size, or full-screen
// programs (vim, htop) would draw outside the visible area.
ipcMain.on("shell:resize", (_event, size: ShellSizeMessage) => {
  shells.get(size.id)?.resize(size.cols, size.rows);
});

// ⌘W / ×: the renderer asks for the kill; the tab disappears when the
// shell's exit event lands back in the renderer.
ipcMain.on("shell:kill", (_event, id: number) => {
  shells.get(id)?.kill();
});

// Closing the window kills every remaining shell: no orphan processes.
export function killAllShells(): void {
  for (const shell of shells.values()) {
    shell.kill();
  }
}
