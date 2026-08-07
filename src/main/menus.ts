// Menu items are Command sources: the renderer decides what a "tab" even is.
import { BrowserWindow, Menu, ipcMain } from "electron";
import { dispatch, lmuxState } from "./bus.js";
import { confirmKilling } from "./dialogs.js";

// Closing a workspace kills every shell in it. `id` defaults to the active
// workspace, matching the Command.
function closeWorkspace(id?: number): void {
  // dispatch targets the focused window; without one there is nothing to close
  const window = BrowserWindow.getFocusedWindow();
  if (!window) {
    return;
  }
  let workspaceId = id;
  if (workspaceId === undefined) {
    workspaceId = lmuxState.activeWorkspaceId;
  }
  const tabIds: number[] = [];
  for (const workspace of lmuxState.workspaces) {
    if (workspace.id !== workspaceId) {
      continue;
    }
    for (const tab of workspace.tabs) {
      tabIds.push(tab.id);
    }
  }
  const proceed = confirmKilling({
    window,
    tabIds,
    action: "Close Workspace",
  });
  if (!proceed) {
    return;
  }
  dispatch({
    type: "close-workspace",
    id: workspaceId,
  });
}

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
          { type: "separator" },
          {
            label: "New Workspace",
            accelerator: "Shift+CmdOrCtrl+T",
            click: () => dispatch({ type: "new-workspace" }),
          },
          {
            label: "Close Workspace",
            accelerator: "Shift+CmdOrCtrl+W",
            click: () => closeWorkspace(),
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

ipcMain.on("workspace:menu", (event, id: number) => {
  Menu.buildFromTemplate([
    {
      label: "Rename Workspace…",
      click: () => event.sender.send("workspace:rename-request", id),
    },
    {
      label: "Close Workspace",
      click: () => closeWorkspace(id),
    },
    { type: "separator" },
    {
      label: "New Workspace",
      click: () => dispatch({ type: "new-workspace" }),
    },
  ]).popup();
});
