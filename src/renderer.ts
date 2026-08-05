// Renderer: sets up xterm.js and wires it to the shell via window.terminal
// (the bridge defined in preload.cts). xterm.js only draws the screen and
// captures keys — the real work happens in the shell, in the main process.
//
// This file runs as a native ES module (<script type="module"> in
// index.html), so it can import. Terminal and FitAddon are still globals
// from classic <script> tags (typed in bridge.d.ts).
import { THEME } from "./theme.js"

const term = new Terminal({
  fontFamily: THEME.fontFamily,
  fontSize: THEME.fontSize,
  cursorBlink: true,
  theme: { background: THEME.background },
})

// CSS can't read THEME directly, so hand it the colors it needs as custom
// properties — index.html paints the page and scrollbar with var(...).
document.documentElement.style.setProperty('--background', THEME.background)
document.documentElement.style.setProperty('--scrollbar-thumb', THEME.scrollbarThumb)
document.documentElement.style.setProperty('--scrollbar-thumb-hover', THEME.scrollbarThumbHover)
const fitAddon = new FitAddon.FitAddon()
term.loadAddon(fitAddon)
term.open(document.getElementById('terminal')!)

// keyboard -> shell, and shell -> screen
term.onData((data) => window.terminal.sendInput(data))
window.terminal.onData((data) => term.write(data))

// Keep the character grid and the PTY the same size as the window.
// (If fit() lands exactly on the 80×24 default, onResize won't fire — fine,
// because the main process assumes 80×24 until told otherwise.)
term.onResize(({ cols, rows }) => window.terminal.resize(cols, rows))
window.addEventListener('resize', () => fitAddon.fit())
fitAddon.fit()

// xterm draws its own selection, so the browser's native Cmd+C sees nothing
// to copy — handle it ourselves. Cmd+V already works via the Edit menu.
// This handler fires for keydown, keypress AND keyup — act on keydown only.
term.attachCustomKeyEventHandler((e) => {
  if (e.type === 'keydown' && e.metaKey && e.key === 'c' && term.hasSelection()) {
    navigator.clipboard.writeText(term.getSelection())
    return false
  }
  return true
})

term.focus()
