import { executeCommand, getTabTitle, focusActiveTab } from "./tabs.js";
import { requireElement } from "./dom.js";

const dialogElement = requireElement("rename-dialog");
if (!(dialogElement instanceof HTMLDialogElement)) {
  throw new Error("#rename-dialog is not a <dialog>");
}
const dialog: HTMLDialogElement = dialogElement;
const inputElement = requireElement("rename-input");
if (!(inputElement instanceof HTMLInputElement)) {
  throw new Error("#rename-input is not an <input>");
}
const input: HTMLInputElement = inputElement;

let targetId = -1;

export function openRenameDialog(id: number): void {
  const title = getTabTitle(id);
  if (title === undefined) {
    return;
  }
  targetId = id;
  dialog.returnValue = "";
  input.value = title;
  dialog.showModal();
  input.select();
}

requireElement("rename-cancel").addEventListener("click", () => {
  dialog.close();
});

dialog.addEventListener("close", () => {
  if (dialog.returnValue === "rename") {
    executeCommand({
      type: "set-tab-title",
      id: targetId,
      title: input.value.trim(),
    });
  }
  focusActiveTab();
});
