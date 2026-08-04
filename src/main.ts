// Main process: the Node.js side of the app. It owns the window and the shell.
// The renderer (browser side) can't spawn processes, so the shell lives here.
import { app, BrowserWindow, ipcMain } from "electron";
import * as path from "path";
import * as os from "os";
import * as pty from "node-pty";

function createWindow(): void {
  const win = new BrowserWindow({
    width: 900,
    height: 600,
    backgroundColor: "#1e1e1e",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
    },
  });

  // The shell doesn't exist until the page has loaded (see below), but the
  // renderer starts talking to us as soon as its script runs — so track the
  // grid size it reports, and spawn the shell at that size later.
  let cols = 80;
  let rows = 24;
  let shell: pty.IPty | undefined;
  let shellExited = false;

  // keyboard -> shell: keystrokes from the renderer are written to the PTY
  ipcMain.on("terminal:input", (_event, data: string) => shell?.write(data));

  // The PTY must always match the on-screen grid size, or full-screen
  // programs (vim, htop) would draw outside the visible area.
  ipcMain.on("terminal:resize", (_event, newCols: number, newRows: number) => {
    cols = newCols;
    rows = newRows;
    shell?.resize(cols, rows);
  });

  win.on("closed", () => {
    if (shell && !shellExited) shell.kill();
  });

  // main.js runs from dist/, but index.html lives (uncompiled) in src/.
  // The promise resolves once the page has finished loading — only then is
  // it safe to spawn the shell: output sent to a page that isn't listening
  // yet would be silently lost (a startup race we'd usually win, because
  // zsh boots slower than the page, but "usually" isn't a design).
  win.loadFile(path.join(__dirname, "../src/index.html")).then(() => {
    if (win.isDestroyed()) return;

    // Spawn the user's shell inside a pseudo-terminal (PTY), not a plain
    // pipe. The PTY is what makes the shell believe it's talking to a real
    // terminal, so colors, line editing, and programs like vim work.
    // '-l' starts it as a login shell so ~/.zprofile etc. are loaded.
    shell = pty.spawn(process.env.SHELL || "/bin/zsh", ["-l"], {
      name: "xterm-256color",
      cols,
      rows,
      cwd: os.homedir(),
      env: process.env,
    });

    // shell -> screen: bytes the shell writes are forwarded to the renderer
    shell.onData((data: string) => {
      if (!win.isDestroyed()) win.webContents.send("terminal:data", data);
    });

    // Typing `exit` closes the window; closing the window kills the shell.
    shell.onExit(() => {
      shellExited = true;
      if (!win.isDestroyed()) win.close();
    });
  });
}

app.whenReady().then(createWindow);
app.on("window-all-closed", () => app.quit());
