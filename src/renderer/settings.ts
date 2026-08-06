import { z } from "../../node_modules/zod/index.js";
import { THEMES, DEFAULT_SETTINGS } from "../theme.js";
import { requireElement } from "./dom.js";
import type { Theme } from "../theme.js";
import type { Settings } from "../api.js";

const STORAGE_KEY = "settings";

// THEMES has literal keys; lookups use user-supplied strings
const themesByName: Record<string, Theme> = THEMES;

// Corrected, not rejected: a field that fails its checks catches to default.
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
      .number()
      .transform((size) => Math.min(32, Math.max(8, Math.round(size))))
      .catch(DEFAULT_SETTINGS.fontSize),
  })
  .catch({ ...DEFAULT_SETTINGS });

let settings: Settings = { ...DEFAULT_SETTINGS };
try {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored !== null) {
    settings = settingsSchema.parse(JSON.parse(stored));
  }
} catch {
}

export function getSettings(): Settings {
  return { ...settings };
}

export function currentTheme(): Theme {
  return themesByName[settings.theme];
}

export function updateSettings(partial: Partial<Settings>): void {
  settings = settingsSchema.parse({
    ...settings,
    ...partial,
  });
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // locked storage: the change applies but won't survive a relaunch
  }
  applyCssVariables();
}

// camelCase to kebab-case: tabBarBackground to --tab-bar-background
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
  let highlightFile = "vs.min.css";
  if (currentTheme().colorScheme === "dark") {
    highlightFile = "vs2015.min.css";
  }
  const highlightHref = `../../node_modules/@highlightjs/cdn-assets/styles/${highlightFile}`;
  const highlightCss = requireElement("highlight-css");
  if (highlightCss.getAttribute("href") !== highlightHref) {
    highlightCss.setAttribute("href", highlightHref);
  }
}
