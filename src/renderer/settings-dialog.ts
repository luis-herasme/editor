// The settings modal. Controls apply live: every change is an
// update-settings Command, so the dialog is just another API client and
// there is no cancel/apply state; Escape or Done merely close it.
import { THEMES } from "../theme.js";
import { getSettings } from "./settings.js";
import { executeCommand, focusActiveTab } from "./tabs.js";
import { requireElement } from "./dom.js";

const dialog = requireElement("settings-dialog", HTMLDialogElement);
const themeSelect = requireElement("settings-theme", HTMLSelectElement);
const fontFamilyInput = requireElement("settings-font-family", HTMLInputElement);
const fontSizeInput = requireElement("settings-font-size", HTMLInputElement);
const uiFontFamilyInput = requireElement(
  "settings-ui-font-family",
  HTMLInputElement,
);

// one <option> per THEMES entry; the label derives from the key
// ("solarized-dark" becomes "Solarized Dark")
for (const name of Object.keys(THEMES)) {
  const option = document.createElement("option");
  option.value = name;
  option.textContent = name
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
  themeSelect.append(option);
}

// controls always show the store's truth: on open, and again after each
// Command, which may have corrected the request
function showCurrentSettings(): void {
  const settings = getSettings();
  themeSelect.value = settings.theme;
  fontFamilyInput.value = settings.fontFamily;
  fontSizeInput.value = String(settings.fontSize);
  uiFontFamilyInput.value = settings.uiFontFamily;
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

uiFontFamilyInput.addEventListener("change", () => {
  executeCommand({
    type: "update-settings",
    settings: { uiFontFamily: uiFontFamilyInput.value },
  });
  showCurrentSettings();
});

requireElement("settings-done").addEventListener("click", () => {
  dialog.close();
});

dialog.addEventListener("close", () => {
  focusActiveTab();
});
