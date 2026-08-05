// The rename modal (a <dialog> in index.html — see the comment there for
// why it's an in-window modal). Enter/Rename commits, Escape/Cancel closes.
// The commit is just a set-tab-title Command — the UI stays an API client.
import { executeCommand, getTabTitle, focusActiveTab } from "./tabs.js"

const dialog = document.getElementById("rename-dialog") as HTMLDialogElement
const input = document.getElementById("rename-input") as HTMLInputElement
let targetId = -1

export function openRenameDialog(id: number): void {
  const title = getTabTitle(id)
  if (title === undefined) return // no such tab
  targetId = id
  dialog.returnValue = "" // Escape leaves it untouched, so pre-clear
  input.value = title
  dialog.showModal()
  input.select()
}

// Double-clicking a tab's title also opens the dialog. Delegated from the
// tab bar (the tab id rides on each button as data-tab-id) so this module
// needs nothing from tabs.ts to hear about clicks.
document.getElementById("tabs")!.addEventListener("dblclick", (e) => {
  const button = (e.target as Element).closest<HTMLElement>(".tab")
  if (button?.dataset.tabId) openRenameDialog(Number(button.dataset.tabId))
})

document.getElementById("rename-cancel")!.addEventListener("click", () => dialog.close())

// 'close' fires for every way out — Rename (form submit sets returnValue),
// Cancel, or Escape. Commit only the first, then hand focus back.
dialog.addEventListener("close", () => {
  if (dialog.returnValue === "rename") {
    executeCommand({ type: "set-tab-title", id: targetId, title: input.value.trim() })
  }
  focusActiveTab()
})
