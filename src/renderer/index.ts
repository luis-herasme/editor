import { commandSchema } from "../api.js";
import { bridge } from "./bridge.js";
import { applyCssVariables } from "./settings.js";
import {
  executeCommand,
  handleShellData,
  readScreen,
  removeTab,
  restoreSession,
} from "./tabs.js";
import { openRenameDialog } from "./rename-dialog.js";
import "./settings-dialog.js";
import "./sidebar-resize.js";

applyCssVariables();

bridge.onCommand(executeCommand);
bridge.onShellData(handleShellData);
bridge.onScreenRead(({ readId, request }) => {
  bridge.answerScreenRead({
    readId,
    result: readScreen(request),
  });
});
bridge.onShellExit(removeTab);
bridge.onRenameRequest((id) => {
  openRenameDialog({
    kind: "tab",
    id,
  });
});
bridge.onWorkspaceRenameRequest((id) => {
  openRenameDialog({
    kind: "workspace",
    id,
  });
});

// The console is a caller from outside our own compiled code, so this door
// checks what it is handed, and says so rather than doing nothing when the
// answer is no. The page's own affordances call executeCommand directly,
// where the compiler has already checked it.
Reflect.set(window, "lmux", {
  command: (command: unknown) => {
    executeCommand(commandSchema.parse(command));
  },
});

const session = await bridge.readSession();
if (session && session.workspaces.length > 0) {
  await restoreSession(session);
} else {
  executeCommand({ type: "new-workspace" });
}
