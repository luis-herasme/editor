// Both native menus: the application menu and the tab context menu.
// Menu items are just Command sources: they put Commands on the bus and the
// renderer decides what a "tab" even is. Importing this module registers
// the context-menu request handler.
import { Menu, ipcMain } from "electron";
import { dispatch } from "./bus.js";

// ⌘T/⌘W live here, not in the page: menu accelerators are the macOS-native
// home for shortcuts, and the default menu's ⌘W ("close window") would
// otherwise swallow the key before the page ever saw it.
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
      { role: "viewMenu" }, // keeps devtools reachable while learning
      { role: "windowMenu" },
    ]),
  );
}

// Right-click on a tab: pop the native macOS context menu (a real NSMenu;
// only main can create one). Rename is the one non-Command item: Electron
// has no native text-input dialog, so the menu hands off to the renderer's
// rename modal.
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
