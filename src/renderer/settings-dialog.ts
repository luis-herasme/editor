// The settings modal (a <dialog> in index.html; the rename modal's
// pattern). Controls apply live: every change is an update-settings
// Command, so the dialog is just another API client and the editor
// restyles behind it as you pick. Escape or Done closes it; there is no
// cancel/apply state to manage because the Commands already happened.
import { THEMES } from "../theme.js";
import { getSettings } from "./settings.js";
import { executeCommand, focusActiveTab } from "./tabs.js";
import { requireElement } from "./dom.js";

const dialog = requireElement("settings-dialog", HTMLDialogElement);
const themeSelect = requireElement("settings-theme", HTMLSelectElement);
const fontFamilyInput = requireElement("settings-font-family", HTMLInputElement);
const fontSizeInput = requireElement("settings-font-size", HTMLInputElement);

// One <option> per theme: THEMES stays the single source, the display
// name is derived from the key ("solarized-dark" → "Solarized Dark")
for (const name of Object.keys(THEMES)) {
  const option = document.createElement("option");
  option.value = name;
  option.textContent = name
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
  themeSelect.append(option);
}

// Controls always show the store's truth — on open, and again after each
// Command, which may have corrected the request (clamped a font size).
function showCurrentSettings(): void {
  const settings = getSettings();
  themeSelect.value = settings.theme;
  fontFamilyInput.value = settings.fontFamily;
  fontSizeInput.value = String(settings.fontSize);
}

requireElement("settings-button").addEventListener("click", () => {
  showCurrentSettings();
  dialog.showModal();
});

themeSelect.addEventListener("change", () => {
  executeCommand({
    type: "update-settings",
    settings: { theme: themeSelect.value },
  });
  showCurrentSettings();
});

fontFamilyInput.addEventListener("change", () => {
  executeCommand({
    type: "update-settings",
    settings: { fontFamily: fontFamilyInput.value },
  });
  showCurrentSettings();
});

fontSizeInput.addEventListener("change", () => {
  executeCommand({
    type: "update-settings",
    settings: { fontSize: Number(fontSizeInput.value) },
  });
  showCurrentSettings();
});

requireElement("settings-done").addEventListener("click", () => {
  dialog.close();
});

dialog.addEventListener("close", () => {
  focusActiveTab();
});
