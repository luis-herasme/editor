import type { Command } from "../api.js";
import { applyCssVariables } from "./settings.js";
import { executeCommand, handleShellData, removeTab } from "./tabs.js";
import { openRenameDialog } from "./rename-dialog.js";
import "./settings-dialog.js";

applyCssVariables();

window.bridge.onCommand(executeCommand);
window.bridge.onShellData(handleShellData);
window.bridge.onShellExit(removeTab);
window.bridge.onRenameRequest(openRenameDialog);

declare global {
  interface Window {
    editor: { command: (command: Command) => void };
  }
}
window.editor = { command: executeCommand };

executeCommand({ type: "new-tab" });
