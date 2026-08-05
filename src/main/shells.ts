// One PTY per tab, keyed by the tab id the renderer assigns. The renderer
// can't spawn processes; importing this module registers the shell half of
// the IPC protocol.
import { BrowserWindow, ipcMain } from "electron";
import { execFile } from "child_process";
import * as os from "os";
import * as pty from "node-pty";
import type { ShellDataMessage, ShellSizeMessage } from "../ipc/bridge.js";

// module scope: app-lifetime, survives any window
const shells = new Map<number, pty.IPty>();

// A PTY, not a plain pipe: it's what makes the shell believe it's talking
// to a real terminal (colors, line editing, vim). '-l' loads ~/.zprofile
// etc. No startup race: spawn is sent by a running page.
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

  const page = event.sender; // replies go to whoever asked

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

  // the one removal path for a tab, however its shell died; the last shell
  // exiting closes the window
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

ipcMain.on("shell:write", (_event, message: ShellDataMessage) => {
  shells.get(message.id)?.write(message.data);
});

// the PTY must match the on-screen grid, or vim/htop draw outside it
ipcMain.on("shell:resize", (_event, size: ShellSizeMessage) => {
  shells.get(size.id)?.resize(size.cols, size.rows);
});

ipcMain.on("shell:kill", (_event, id: number) => {
  shells.get(id)?.kill();
});

// A tab's shell cwd, asked of the OS at call time (lsof on the PTY's
// process): works with any shell, no shell configuration needed.
export function getShellCwd(id: number): Promise<string | undefined> {
  const shell = shells.get(id);
  if (!shell) {
    return Promise.resolve(undefined);
  }
  return new Promise((resolve) => {
    execFile(
      "lsof",
      ["-a", "-p", String(shell.pid), "-d", "cwd", "-F", "n"],
      (error, stdout) => {
        if (error) {
          resolve(undefined);
          return;
        }
        for (const line of stdout.split("\n")) {
          if (line.startsWith("n")) {
            resolve(line.slice(1));
            return;
          }
        }
        resolve(undefined);
      },
    );
  });
}

// closing the window leaves no orphan processes
export function killAllShells(): void {
  for (const shell of shells.values()) {
    shell.kill();
  }
}
