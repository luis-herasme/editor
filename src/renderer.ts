// Renderer: sets up xterm.js and wires it to the shell via window.terminal
// (the bridge defined in preload.ts). xterm.js only draws the screen and
// captures keys — the real work happens in the shell, in the main process.
//
// Note: no imports here. This file compiles to a plain browser script;
// Terminal and FitAddon are globals from the <script> tags in index.html
// (typed in bridge.d.ts).
const term = new Terminal({
  fontFamily: 'Menlo, monospace',
  fontSize: 13,
  cursorBlink: true,
  // Match the page background (index.html). The screen is a whole number of
  // character cells, so the window always has a few leftover pixels around
  // it — same color everywhere makes that remainder invisible.
  theme: { background: '#1e1e1e' },
})
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
