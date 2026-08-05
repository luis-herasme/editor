// The current settings: which THEMES entry is active, and the terminal
// font. This module owns the value, its persistence, and the hand-off to
// CSS; applying settings to live terminals is tab state and stays in
// tabs.ts (the two meet in the update-settings Command).
//
// Persistence is localStorage: settings are renderer-only state, so no
// IPC message is needed (see ARCHITECTURE.md, "Where future features
// will live"), and Chromium keeps the storage in the app's user-data
// directory across launches.
// zod arrives by relative path, the way index.html reaches xterm's
// files: with no bundler, the browser resolves every import itself, and
// a bare "zod" means nothing to it. (Import maps are the standard fix,
// but inline ones are blocked by our CSP and external ones aren't
// supported by Chromium yet.) tsc still finds the types alongside.
import { z } from "../../node_modules/zod/index.js";
import { THEMES, DEFAULT_SETTINGS } from "../theme.js";
import type { Theme } from "../theme.js";
import type { Settings } from "../api.js";

const STORAGE_KEY = "settings";

// THEMES has literal keys ("dark" | ...); lookups here use user-supplied
// strings, so widen the type once.
const themesByName: Record<string, Theme> = THEMES;

// The gate every write passes through: corrected, not rejected. A field
// that is missing or fails its checks becomes its default (the
// `catch`es); a candidate that isn't an object at all becomes the
// defaults whole. So `settings` below can never hold a value the rest
// of the app chokes on — localStorage may contain anything.
const settingsSchema = z
  .object({
    theme: z
      .string()
      .refine((name) => name in themesByName)
      .catch(DEFAULT_SETTINGS.theme),
    fontFamily: z.string().trim().min(1).catch(DEFAULT_SETTINGS.fontFamily),
    fontSize: z
      .number() // rejects NaN and ±Infinity by itself
      .transform((size) => Math.min(32, Math.max(8, Math.round(size))))
      .catch(DEFAULT_SETTINGS.fontSize),
  })
  .catch({ ...DEFAULT_SETTINGS });

// The try wraps localStorage itself, not just the parse: a second app
// instance finds the storage locked by the first, and access then
// throws. Bad storage means defaults, never a dead renderer.
let settings: Settings = { ...DEFAULT_SETTINGS };
try {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored !== null) {
    settings = settingsSchema.parse(JSON.parse(stored));
  }
} catch {
  // locked storage or corrupted JSON: the defaults stand
}

// A copy, so a caller holding the result can't mutate the store.
export function getSettings(): Settings {
  return { ...settings };
}

export function currentTheme(): Theme {
  return themesByName[settings.theme]; // always valid: the schema guards it
}

export function updateSettings(partial: Partial<Settings>): void {
  settings = settingsSchema.parse({ ...settings, ...partial });
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
