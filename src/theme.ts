// The single source of truth for visual values. Three worlds draw
// something, and all three read from here: main (the window), the
// renderer (xterm), and CSS (as custom properties, pushed by
// renderer/settings.ts, which also owns which theme is currently active
// and what font the user picked).
import type { Settings } from "./api.js";

// One complete palette. Every theme defines every key, so switching
// themes can never leave a color behind.
export interface Theme {
  // Handed to CSS's `color-scheme`, so anything Chromium draws itself
  // (scrollbars, form controls) uses the matching variant.
  colorScheme: "dark" | "light";
  // One color for the window, the page, and xterm's cells. The screen is a
  // whole number of character cells, so a few leftover pixels always exist
  // around it; the same color everywhere makes that remainder invisible.
  background: string;
  // Terminal text, cursor, and selection highlight (xterm's theme)
  foreground: string;
  cursor: string;
  selectionBackground: string;
  // Slim translucent scrollbar thumb, like a native macOS overlay scrollbar
  scrollbarThumb: string;
  scrollbarThumbHover: string;
  // Tab bar: offset from the terminal, so the active tab (which shares the
  // terminal's background) reads as connected to it.
  tabBarBackground: string;
  // The window's top strip (the native title bar is hidden; index.html
  // paints this one). Same surface as the tab bar: title bar, strip and
  // tabs read as one piece of chrome above the terminal.
  titleBarBackground: string;
  tabForeground: string;
  tabActiveForeground: string;
  // Hairline separators: between tabs in the strip, and between split
  // panes. Always opaque: a translucent line renders differently on
  // every surface and double-darkens where two of them overlap.
  separator: string;
  // Primary-action color, e.g. the modals' default buttons
  accent: string;
}

export const THEMES = {
  dark: {
    colorScheme: "dark",
    background: "#1e1e1e",
    foreground: "#ffffff",
    cursor: "#ffffff",
    selectionBackground: "rgba(255, 255, 255, 0.3)",
    scrollbarThumb: "rgba(255, 255, 255, 0.25)",
    scrollbarThumbHover: "rgba(255, 255, 255, 0.45)",
    tabBarBackground: "#161616",
    titleBarBackground: "#161616",
    tabForeground: "#8a8a8a",
    tabActiveForeground: "#e6e6e6",
    separator: "#323232",
    accent: "#007aff", // macOS system blue
  },
  light: {
    colorScheme: "light",
    background: "#ffffff",
    foreground: "#1e1e1e",
    cursor: "#1e1e1e",
    selectionBackground: "rgba(0, 0, 0, 0.2)",
    scrollbarThumb: "rgba(0, 0, 0, 0.25)",
    scrollbarThumbHover: "rgba(0, 0, 0, 0.45)",
    tabBarBackground: "#ececec",
    titleBarBackground: "#ececec",
    tabForeground: "#767676",
    tabActiveForeground: "#1a1a1a",
    separator: "#d0d0d0",
    accent: "#007aff",
  },
  // The classic precision-picked palette (https://ethanschoonover.com/solarized)
  "solarized-dark": {
    colorScheme: "dark",
    background: "#002b36",
    foreground: "#839496",
    cursor: "#839496",
    selectionBackground: "rgba(131, 148, 150, 0.3)",
    scrollbarThumb: "rgba(147, 161, 161, 0.25)",
    scrollbarThumbHover: "rgba(147, 161, 161, 0.45)",
    tabBarBackground: "#00212b",
    titleBarBackground: "#00212b",
    tabForeground: "#657b83",
    tabActiveForeground: "#93a1a1",
    separator: "#073642", // solarized base02, its own "background highlight" tone
    accent: "#268bd2",
  },
} satisfies Record<string, Theme>;

export type ThemeName = keyof typeof THEMES;

// What the user can change at runtime (the settings dialog, or an
// update-settings Command — see api.ts). These are only the defaults:
// the current values live in renderer/settings.ts, persisted across
// launches in localStorage.
export const DEFAULT_SETTINGS = {
  theme: "dark",
  fontFamily: "Menlo, monospace",
  fontSize: 13,
  uiFontFamily: "system-ui",
} satisfies Settings & { theme: ThemeName };
