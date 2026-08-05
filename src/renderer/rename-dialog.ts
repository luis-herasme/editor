// The rename modal. Enter/Rename commits, Escape/Cancel closes; the commit
// is a set-tab-title Command, so the UI stays an API client.
import { executeCommand, getTabTitle, focusActiveTab } from "./tabs.js";
import { requireElement } from "./dom.js";

const dialog = requireElement("rename-dialog", HTMLDialogElement);
const input = requireElement("rename-input", HTMLInputElement);

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

// double-clicking a tab's title also opens the dialog; delegated from the
// layout root via the data-tab-id each tab carries
requireElement("layout").addEventListener("dblclick", (event) => {
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
// Cancel, or Escape
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
