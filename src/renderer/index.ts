// Renderer boot: this file connects everything, and nothing else.
// window.bridge is the cable to main (ipc/bridge.ts).
import type { Command } from "../api.js";
import { applyCssVariables } from "./settings.js";
import { executeCommand, handleShellData, handleShellExit } from "./tabs.js";
import { openRenameDialog } from "./rename-dialog.js";
import "./settings-dialog.js"; // wires the ⚙ button and the settings modal

applyCssVariables(); // the saved settings, handed to CSS

window.bridge.onCommand(executeCommand);
window.bridge.onShellData(handleShellData);
window.bridge.onShellExit(handleShellExit);
window.bridge.onRenameRequest(openRenameDialog);

// the public interface, reachable from the devtools console (⌥⌘I):
//   editor.command({ type: "new-tab" })
declare global {
  interface Window {
    editor: { command: (command: Command) => void };
  }
}
window.editor = { command: executeCommand };

executeCommand({ type: "new-tab" }); // boots the first shell
