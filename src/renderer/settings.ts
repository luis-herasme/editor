// The current settings: which THEMES entry is active, and the terminal
// font. This module owns the value, its persistence, and the hand-off to
// CSS; applying settings to live terminals is tab state and stays in
// tabs.ts (the two meet in the update-settings Command).
//
// Persistence is localStorage: settings are renderer-only state, so no
// IPC message is needed (see ARCHITECTURE.md, "Where future features
// will live"), and Chromium keeps the storage in the app's user-data
// directory across launches.
import { THEMES, DEFAULT_SETTINGS } from "../theme.js";
import type { Theme } from "../theme.js";
import type { Settings } from "../api.js";

const STORAGE_KEY = "settings";

// THEMES has literal keys ("dark" | ...); lookups here use user-supplied
// strings, so widen the type once and guard with `in` checks.
const themesByName: Record<string, Theme> = THEMES;

// The one gate every write passes through: fields are corrected, not
// rejected (an unknown theme name keeps the base value, a wild font size
// is clamped), so `settings` below can never hold a value the rest of
// the app chokes on — localStorage may contain anything.
function sanitize(candidate: Partial<Settings>, base: Settings): Settings {
  const next = { ...base };
  if (typeof candidate.theme === "string" && candidate.theme in themesByName) {
    next.theme = candidate.theme;
  }
  if (
    typeof candidate.fontFamily === "string" &&
    candidate.fontFamily.trim() !== ""
  ) {
    next.fontFamily = candidate.fontFamily.trim();
  }
  if (
    typeof candidate.fontSize === "number" &&
    Number.isFinite(candidate.fontSize)
  ) {
    next.fontSize = Math.min(32, Math.max(8, Math.round(candidate.fontSize)));
  }
  return next;
}

// The try wraps localStorage itself, not just the parse: a second app
// instance finds the storage locked by the first, and access then
// throws. Bad storage means defaults, never a dead renderer.
function loadSettings(): Settings {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored !== null) {
      return sanitize(JSON.parse(stored), DEFAULT_SETTINGS);
    }
  } catch {
    // locked storage or corrupted JSON: fall through
  }
  return { ...DEFAULT_SETTINGS };
}

let settings = loadSettings();

// A copy, so a caller holding the result can't mutate the store.
export function getSettings(): Settings {
  return { ...settings };
}

export function currentTheme(): Theme {
  return themesByName[settings.theme]; // always valid: sanitize() guards it
}

export function updateSettings(partial: Partial<Settings>): void {
  settings = sanitize(partial, settings);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // locked storage (second instance): the change still applies, it
    // just won't survive a relaunch
  }
  applyCssVariables();
}

// CSS can't read JavaScript, so every visual value crosses as a custom
// property, camelCase key to kebab-case var (tabBarBackground becomes
// --tab-bar-background). Called at boot and again on every change:
// setting the same properties re-styles the page in place.
export function applyCssVariables(): void {
  const values = {
    ...currentTheme(),
    fontFamily: settings.fontFamily,
    fontSize: settings.fontSize,
  };
  for (const [key, value] of Object.entries(values)) {
    const cssName =
      "--" + key.replace(/[A-Z]/g, (letter) => "-" + letter.toLowerCase());
    document.documentElement.style.setProperty(cssName, String(value));
  }
}
