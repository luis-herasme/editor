# editor-terminal

A minimal terminal emulator for macOS, built with [Electron](https://www.electronjs.org/)
and [xterm.js](https://xtermjs.org/) as a learning project. Unfamiliar terms are
defined in [GLOSSARY.md](GLOSSARY.md).

## Run it

```sh
npm install
npm run rebuild   # recompile node-pty for Electron (see "Native module" in the glossary)
npm start         # type-checks + compiles src/ to dist/, then launches
```

`npm run check` type-checks without launching.

## How it works

The app is two processes. Each tab pairs one xterm.js instance (renderer)
with one shell in a PTY (main); every IPC message carries the tab's id so
the two sides stay paired:

```mermaid
flowchart LR
    subgraph app["Electron app"]
        subgraph renderer["renderer process (the window)"]
            xterm["one xterm.js per tab<br/>draws the grid, captures keys"]
        end
        subgraph mainp["main process (Node.js)"]
            ptyend["one PTY per tab<br/>(node-pty, Map&lt;id, pty&gt;)"]
        end
    end
    zsh["zsh (one per tab)"]

    xterm -- "spawnShell(id, cols, rows)" --> ptyend
    xterm -- "writeToShell(id, data)" --> ptyend
    xterm -- "resizeShell(id, cols, rows)" --> ptyend
    xterm -- "killShell(id)" --> ptyend
    ptyend -- "onShellData(id, data)" --> xterm
    ptyend -- "onShellExit(id)" --> xterm
    ptyend <--> zsh
```

All arrows between the processes pass through `window.bridge`, which
`src/ipc/preload.cts` exposes to the page. (The bridge also carries the
command bus and the tab context menu — the full contract is
`src/ipc/bridge.ts`.)

Life of a keystroke — you press `l`:

```mermaid
sequenceDiagram
    participant You
    participant X as xterm.js<br/>(renderer/tabs.ts)
    participant M as main process<br/>(main/shells.ts)
    participant P as PTY
    participant Z as zsh

    You->>X: press "l"
    X->>M: writeToShell(id, "l")
    M->>P: shell.write("l")
    P->>Z: "l"
    Z-->>P: echoes "l" back (maybe with color codes)
    P-->>M: shell.onData fires
    M-->>X: onShellData(id, ...)
    X->>X: parse escape sequences, draw "l"
```

The character you see is drawn in the *last* step, not the first — like the
original hardware terminals, nothing appears on screen until the program on
the other end echoes it back.

## Files

| File                           | Role                                                         |
| ------------------------------ | ------------------------------------------------------------ |
| `src/api.ts`                   | **The public interface**: every Command in, every Event out  |
| `src/theme.ts`                 | All visual settings (colors, font) in one importable place   |
| `src/ipc/bridge.ts`            | The IPC contract as a type (`window.bridge`)                 |
| `src/ipc/preload.cts`          | Security bridge: implements `window.bridge`, nothing else    |
| `src/main/index.ts`            | Main boot: the window and the app lifecycle                  |
| `src/main/shells.ts`           | One PTY per tab: spawn/write/resize/kill, relays data/exit   |
| `src/main/menus.ts`            | App menu + tab context menu (menu items issue Commands)      |
| `src/main/bus.ts`              | Commands in via `dispatch()`; Events out into the read model |
| `src/renderer/index.html`      | The page: tab bar, panes, the rename dialog                  |
| `src/renderer/index.ts`        | Renderer boot: theme → CSS, cable wiring, first tab          |
| `src/renderer/tabs.ts`         | Tab store + operations + `executeCommand` (the consumer)     |
| `src/renderer/rename-dialog.ts`| The rename modal                                             |
| `tsconfig.json`                | Compiler settings; `tsc` mirrors `src/` into `dist/` 1:1     |

There is deliberately no bundler, no framework, and no abstraction for
features we don't have yet. Features get added when we need them.

## Driving the editor

Everything the editor can do is a Command, and everything that happens is
an Event — the unions in [src/api.ts](src/api.ts) are the whole public
interface, and the UI itself is just its first client. Try it from the
devtools console (⌥⌘I):

```js
editor.command({ type: "new-tab" })
editor.command({ type: "write", text: "ls\n" })
editor.command({ type: "close-tab" })
```

The endgame (see ARCHITECTURE.md, "The command bus") is a local server in
the main process feeding the same bus, so an agent can fully drive the
editor.
# editor
