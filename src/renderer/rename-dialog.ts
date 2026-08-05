// The rename modal (a <dialog> in index.html; see the comment there for
// why it's an in-window modal). Enter/Rename commits, Escape/Cancel closes.
// The commit is just a set-tab-title Command: the UI stays an API client.
import { executeCommand, getTabTitle, focusActiveTab } from "./tabs.js";
import { requireElement } from "./dom.js";

// instanceof narrows to the concrete element type (and covers the
// missing-element case), so no type assertions are needed. The narrowed
// value is re-declared as a plain typed const so every function below
// sees the narrow type.
const dialogLookup = document.getElementById("rename-dialog");
if (!(dialogLookup instanceof HTMLDialogElement)) {
  throw new Error("#rename-dialog is missing or is not a <dialog>");
}
const dialog: HTMLDialogElement = dialogLookup;

const inputLookup = document.getElementById("rename-input");
if (!(inputLookup instanceof HTMLInputElement)) {
  throw new Error("#rename-input is missing or is not an <input>");
}
const input: HTMLInputElement = inputLookup;

let targetId = -1;

export function openRenameDialog(id: number): void {
  const title = getTabTitle(id);
  if (title === undefined) {
    return; // no such tab
  }
  targetId = id;
  dialog.returnValue = ""; // Escape leaves it untouched, so pre-clear
  input.value = title;
  dialog.showModal();
  input.select();
}

// Double-clicking a tab's title also opens the dialog. Delegated from the
// tab bar (the tab id rides on each button as data-tab-id) so this module
// needs nothing from tabs.ts to hear about clicks.
requireElement("tabs").addEventListener("dblclick", (event) => {
  const target = event.target;
  if (!(target instanceof Element)) {
    return;
  }
  const button = target.closest(".tab");
  if (!(button instanceof HTMLElement)) {
    return;
  }
  if (!button.dataset.tabId) {
    return;
  }
  openRenameDialog(Number(button.dataset.tabId));
});

requireElement("rename-cancel").addEventListener("click", () => {
  dialog.close();
});

// 'close' fires for every way out: Rename (form submit sets returnValue),
// Cancel, or Escape. Commit only the first, then hand focus back.
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
