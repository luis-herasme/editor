import type { Command } from "../api.js";
import { applyCssVariables } from "./settings.js";
import { executeCommand, handleShellData, removeTab } from "./tabs.js";
import { openRenameDialog } from "./rename-dialog.js";
import "./settings-dialog.js";

applyCssVariables();

window.bridge.onCommand(executeCommand);
window.bridge.onShellData(handleShellData);
window.bridge.onShellExit(removeTab);
window.bridge.onRenameRequest((id) => {
  openRenameDialog({
    kind: "tab",
    id,
  });
});
window.bridge.onWorkspaceRenameRequest((id) => {
  openRenameDialog({
    kind: "workspace",
    id,
  });
});

declare global {
  interface Window {
    lmux: { command: (command: Command) => void };
  }
}
window.lmux = { command: executeCommand };

executeCommand({ type: "new-workspace" });
