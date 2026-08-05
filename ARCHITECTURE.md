# Architecture

The goal of this document: keep the app simple *on purpose*. It records the
structure, the reasoning behind it, and the rules for growing it without
wrecking it. Terms are defined in [GLOSSARY.md](GLOSSARY.md); the data-flow
walkthrough lives in [README.md](README.md).

## Why Electron, not a TUI

This app could have been a TUI — a program that draws its interface inside an
existing terminal, the way vim or lazygit do. We chose Electron instead, and
the reason shapes everything that follows: **the terminal grid should be one
view inside the app, not the ceiling of what the app can show.**

A TUI can only ever paint character cells. Electron gives us a full Chromium
page around the terminal, which buys three things:

1. **Comfortable rich content.** Reading a Markdown file should mean real
   typography — headings, proportional fonts, images — not raw `#` marks in a
   grid. Anything the web can render, a view in this app can render.
2. **Integrated browser views.** Embedding a live web page next to the
   terminal is nearly free in Electron; in a TUI it's impossible.
3. **A VS Code view.** VS Code can run in the browser, so it can be embedded
   here as an integrated view into the codebase. Researched and confirmed
   possible; the chosen path is recorded in "Decisions so far."

None of this exists yet — today the app is only the terminal. But when these
features arrive, they are renderer-side views living *beside* xterm.js, and
the split described next is what keeps them from complicating the terminal
itself.

## The one idea

A terminal emulator is naturally two halves, and they were literally two
machines in 1978: a dumb screen-and-keyboard (the VT100) and a computer,
joined by a serial cable. We keep that exact split:

| 1978                  | This app                              |
| --------------------- | ------------------------------------- |
| VT100 (screen + keys) | renderer process running xterm.js     |
| serial cable          | IPC channel (3 messages)              |
| the computer          | main process holding a PTY + zsh      |

Everything in the codebase is on one side of that cable or the other. When a
new feature comes along, the first design question is always: **which side
does this belong on, and does the cable need to change?**

## The boundary

The entire contract between the two halves is `window.terminal`, defined in
`preload.js`:

```
sendInput(data)        renderer → main   "the user typed these bytes"
resize(cols, rows)     renderer → main   "the screen is now this size"
onData(callback)       main → renderer   "the shell produced these bytes"
```

Rules that keep this boundary healthy:

1. **Only bytes and sizes cross it.** No commands, no file paths, no
   structured objects. The renderer never knows what shell is running; the
   main process never knows how the screen is drawn.
2. **The renderer stays a dumb screen.** Anything that touches the OS
   (processes, files, clipboard writes are the one pragmatic exception)
   belongs in main.
3. **Grow the protocol, don't bypass it.** A new capability means a new,
   explicitly named message in `preload.js` — never widening the sandbox or
   exposing Node.js to the page.

This is also the security model (see "Preload script" in the glossary): the
page can only ever do what these three functions allow.

## Decisions so far

Each entry: what we chose, and why. If a decision stops making sense, we
change it and update this list.

- **TypeScript, compiled by `tsc` alone — still no bundler, no framework.**
  (Replaced the original "plain JavaScript, no build step" decision.) Node
  22.18+ — including the Node 24 inside our Electron — can *run* `.ts` files
  natively by stripping the type annotations, but that gets us nothing on its
  own: stripping isn't checking, and the renderer runs in Chromium, which
  can't run TypeScript at all. So the one tool is the official compiler:
  `tsc` type-checks all of `src/` and emits plain JS into `dist/`. Cost we
  accept: a compile step inside `npm start`. The no-bundler rule stands —
  `dist/` files map 1:1 to `src/` files, nothing is fused or minified.
- **The IPC contract is a type.** `src/bridge.d.ts` declares `TerminalBridge`;
  preload implements it and the renderer consumes it, so the two sides of the
  boundary cannot silently drift apart — drift is now a compile error.
- **One window, one shell, no session abstraction.** Tabs would want a
  `Map<sessionId, pty>` and an id on every message — we deliberately did not
  build that. It is a rewrite of ~15 lines when tabs arrive; carrying the
  abstraction before then costs more in reading than it saves in typing.
- **Shell lifecycle is symmetric.** Closing the window kills the shell;
  the shell exiting closes the window. No orphan processes, no zombie windows.
- **The shell spawns only after the page has loaded.** The two halves boot
  in parallel, and shell output sent to a page that isn't listening yet is
  silently dropped — a race we'd usually win (zsh reads dotfiles slower than
  Chromium loads a page) but could lose. Main waits for `loadFile` to
  resolve, tracking the renderer's reported grid size in the meantime, so
  the shell is born already listening *and* at the right size.
- **Login shell (`zsh -l`), spawned in `$HOME`.** The app should feel
  identical to Terminal.app on first launch — same prompt, same PATH.
- **xterm.js and node-pty do the hard parts.** Escape-sequence parsing and
  PTY syscalls are decades-deep rabbit holes. We own the wiring, not the
  emulation. (If we ever want to *learn* the parsing, we can write a toy
  parser on the side without touching the app.)

- **VS Code view: embed openvscode-server, when we build it.** (Decided
  2026-08 after research; not built yet.) The full VS Code experience comes
  from spawning [openvscode-server](https://github.com/gitpod-io/openvscode-server)
  — a fork of Code - OSS (see glossary) that serves the editor over HTTP — as
  a child process in main, and showing `http://localhost:<port>` in an
  `<iframe>` beside xterm.js. This is the terminal design repeated: main owns
  a process, the renderer is a dumb screen for it, and the server's lifecycle
  is symmetric with the window, spawned only when the view is first opened.
  The alternative (self-hosting the static "VS Code for the Web" build) was
  rejected: it cannot see local files without writing a custom
  FileSystemProvider extension, and Node.js-based extensions don't work in
  it. Cost we accept: a second heavyweight process, and extensions come from
  the Open VSX registry rather than Microsoft's marketplace (whose license
  covers only official VS Code builds).

## Where future features will live

A quick map so features land on the right side of the cable:

- **Renderer-only** (no protocol change): themes/fonts, search (xterm
  search addon), clickable links, scrollback size, ⌘K clear.
- **Main-only** (no protocol change): default working directory, shell
  choice, window size persistence.
- **Protocol changes** (the expensive kind — design first): tabs/splits
  (session ids on every message), config file (a `config:get` message or
  similar), shell integration/OSC hooks (new main → renderer events),
  VS Code view (a message telling the renderer what port
  openvscode-server landed on).

The rule of thumb: protocol changes get a moment of planning in this doc
*before* the code is written; the other two kinds can just be built.
