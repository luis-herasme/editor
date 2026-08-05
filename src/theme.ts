// The single source of truth for visual settings. Three worlds draw
// something, and all three read from here: main (the window) and the
// renderer (xterm) import THEME directly; CSS gets the colors it needs
// as custom properties, set by renderer/index.ts.
export const THEME = {
  // One color for the window, the page, and xterm's cells. The screen is a
  // whole number of character cells, so a few leftover pixels always exist
  // around it — same color everywhere makes that remainder invisible.
  background: "#1e1e1e",
  fontFamily: "Menlo, monospace",
  fontSize: 13,
  // Slim translucent scrollbar thumb, like a native macOS overlay scrollbar
  scrollbarThumb: "rgba(255, 255, 255, 0.25)",
  scrollbarThumbHover: "rgba(255, 255, 255, 0.45)",
  // Tab bar: darker than the terminal, so the active tab — which shares the
  // terminal's background — reads as connected to it.
  tabBarBackground: "#161616",
  tabForeground: "#8a8a8a",
  tabActiveForeground: "#e6e6e6",
  // Primary-action color (macOS system blue), e.g. the modal's Rename button
  accent: "#007aff",
} as const
