// Renderer boot: this file connects everything, and nothing else. Reading
// it top to bottom should feel like reading the architecture diagram:
// theme into CSS, cable into handlers, first tab out.
//
// It runs as a native ES module (<script type="module"> in index.html);
// window.bridge is the cable to main (typed in ipc/bridge.ts).
import type { Command } from "../api.js";
import { applyCssVariables } from "./settings.js";
import { executeCommand, handleShellData, handleShellExit } from "./tabs.js";
import { openRenameDialog } from "./rename-dialog.js";
import "./settings-dialog.js"; // wires the ⚙ button and the settings modal

applyCssVariables(); // the saved settings, handed to CSS (see settings.ts)

// The cable, wired: everything main can send, and who handles it.
window.bridge.onCommand(executeCommand); // the bus (menus today, a server tomorrow)
window.bridge.onShellData(handleShellData); // shell -> screen
window.bridge.onShellExit(handleShellExit); // shell died -> tab goes
window.bridge.onRenameRequest(openRenameDialog); // context menu "Rename Tab…"

// The public interface, reachable today from the devtools console (⌥⌘I):
//   editor.command({ type: "new-tab" })
declare global {
  interface Window {
    editor: { command: (command: Command) => void };
  }
}
window.editor = { command: executeCommand };

executeCommand({ type: "new-tab" }); // the first tab; this boots the first shell
