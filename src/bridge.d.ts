// Type declarations shared by both sides of the IPC boundary.
// A .d.ts file contains only types — it produces no JavaScript. This one
// makes the contract from ARCHITECTURE.md ("The boundary") checkable:
// if preload.cts and renderer.ts ever disagree about the bridge's shape,
// tsc refuses to compile.
import type { Terminal as XtermTerminal } from '@xterm/xterm'
import type { FitAddon as XtermFitAddon } from '@xterm/addon-fit'

declare global {
  // The three-function bridge exposed by preload.cts as window.terminal
  interface TerminalBridge {
    sendInput: (data: string) => void
    resize: (cols: number, rows: number) => void
    onData: (callback: (data: string) => void) => void
  }

  interface Window {
    terminal: TerminalBridge
  }

  // xterm.js is loaded via <script> tags in index.html, so the renderer
  // sees these as globals rather than imports. These declarations give
  // the globals the real types from the installed packages.
  const Terminal: typeof XtermTerminal
  const FitAddon: { FitAddon: typeof XtermFitAddon }
}

export {}
