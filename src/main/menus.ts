// Menu items are Command sources: the renderer decides what a "tab" even is.
import { Menu, ipcMain } from "electron";
import { dispatch } from "./bus.js";

export function installAppMenu(): void {
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      { role: "appMenu" },
      {
        label: "File",
        submenu: [
          {
            label: "New Tab",
            accelerator: "CmdOrCtrl+T",
            click: () => dispatch({ type: "new-tab" }),
          },
          {
            label: "Close Tab",
            accelerator: "CmdOrCtrl+W",
            click: () => dispatch({ type: "close-tab" }),
          },
        ],
      },
      { role: "editMenu" },
      { role: "viewMenu" },
      { role: "windowMenu" },
    ]),
  );
}

ipcMain.on("tab:menu", (event, id: number) => {
  Menu.buildFromTemplate([
    {
      label: "Rename Tab…",
      click: () => event.sender.send("tab:rename-request", id),
    },
    {
      label: "Close Tab",
      click: () =>
        dispatch({
          type: "close-tab",
          id,
        }),
    },
    { type: "separator" },
    {
      label: "New Tab",
      click: () => dispatch({ type: "new-tab" }),
    },
  ]).popup();
});
