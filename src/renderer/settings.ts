// The current settings: value, localStorage persistence, hand-off to CSS.
// Applying them to live terminals is tab state and stays in tabs.ts.
//
// zod arrives by relative path: with no bundler the browser resolves every
// import itself and a bare "zod" means nothing to it (inline import maps
// are blocked by our CSP, external ones unsupported by Chromium).
import { z } from "../../node_modules/zod/index.js";
import { THEMES, DEFAULT_SETTINGS } from "../theme.js";
import type { Theme } from "../theme.js";
import type { Settings } from "../api.js";

const STORAGE_KEY = "settings";

// THEMES has literal keys; lookups here use user-supplied strings
const themesByName: Record<string, Theme> = THEMES;

// The gate every write passes through: corrected, not rejected. A field
// that is missing or fails its checks catches to its default; a non-object
// candidate to the defaults whole. localStorage may contain anything.
const settingsSchema = z
  .object({
    theme: z
      .string()
      .refine((name) => name in themesByName)
      .catch(DEFAULT_SETTINGS.theme),
    fontFamily: z.string().trim().min(1).catch(DEFAULT_SETTINGS.fontFamily),
    uiFontFamily: z
      .string()
      .trim()
      .min(1)
      .catch(DEFAULT_SETTINGS.uiFontFamily),
    fontSize: z
      .number() // rejects NaN and ±Infinity by itself
      .transform((size) => Math.min(32, Math.max(8, Math.round(size))))
      .catch(DEFAULT_SETTINGS.fontSize),
  })
  .catch({ ...DEFAULT_SETTINGS });

// localStorage itself can throw: a second app instance finds it locked.
// Bad storage means defaults, never a dead renderer.
let settings: Settings = { ...DEFAULT_SETTINGS };
try {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored !== null) {
    settings = settingsSchema.parse(JSON.parse(stored));
  }
} catch {
  // locked storage or corrupted JSON: the defaults stand
}

// a copy, so a caller holding the result can't mutate the store
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
    // locked storage: the change applies but won't survive a relaunch
  }
  applyCssVariables();
}

// CSS can't read JavaScript: every visual value crosses as a custom
// property, camelCase to kebab-case (tabBarBackground becomes
// --tab-bar-background). Re-setting the properties restyles in place.
export function applyCssVariables(): void {
  const values = {
    ...currentTheme(),
    fontFamily: settings.fontFamily,
    fontSize: settings.fontSize,
    uiFontFamily: settings.uiFontFamily,
  };
  for (const [key, value] of Object.entries(values)) {
    const cssName =
      "--" + key.replace(/[A-Z]/g, (letter) => "-" + letter.toLowerCase());
    document.documentElement.style.setProperty(cssName, String(value));
  }
}
