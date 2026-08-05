// Both native menus. Menu items are Command sources: they put Commands on
// the bus and the renderer decides what a "tab" even is.
import { Menu, ipcMain } from "electron";
import { dispatch } from "./bus.js";

// ⌘T/⌘W live here, not in the page: accelerators fire before the page
// sees the key, and the default menu's ⌘W would otherwise swallow it.
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
      { role: "editMenu" }, // keeps ⌘C/⌘V working
      { role: "viewMenu" }, // keeps devtools reachable
      { role: "windowMenu" },
    ]),
  );
}

// Right-click on a tab: a real native menu (only main can create one).
// Rename hands off to the renderer's modal.
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
