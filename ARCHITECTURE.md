# Architecture

The goal of this document: keep the app simple *on purpose*. It records the
structure, the reasoning behind it, and the rules for growing it without
wrecking it. Terms are defined in [GLOSSARY.md](GLOSSARY.md); the data-flow
walkthrough lives in [README.md](README.md).

## Why Electron, not a TUI

This app could have been a TUI, a program that draws its interface inside an
existing terminal, the way vim or lazygit do. We chose Electron instead, and
the reason shapes everything that follows: **the terminal grid should be one
view inside the app, not the ceiling of what the app can show.**

A TUI can only ever paint character cells. Electron gives us a full Chromium
page around the terminal, which buys three things:

1. **Comfortable rich content.** Reading a Markdown file should mean real
   typography (headings, proportional fonts, images), not raw `#` marks in a
   grid. Anything the web can render, a view in this app can render.
2. **Integrated browser views.** Embedding a live web page next to the
   terminal is nearly free in Electron; in a TUI it's impossible.
3. **A VS Code view.** VS Code can run in the browser, so it can be embedded
   here as an integrated view into the codebase. Researched and confirmed
   possible; the chosen path is recorded in "Decisions so far."

None of this exists yet; today the app is only the terminal. But when these
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
| serial cable          | IPC channel (the bridge's messages)   |
| the computer          | main process holding a PTY + zsh      |

Everything in the codebase is on one side of that cable or the other. When a
new feature comes along, the first design question is always: **which side
does this belong on, and does the cable need to change?**

## The boundary

The entire contract between the two halves is `window.bridge`, typed in
`ipc/bridge.ts` and implemented in `ipc/preload.cts`:

```
spawnShell(id, cols, rows)   renderer → main   "start a shell for tab `id` at this size"
writeToShell(id, data)       renderer → main   "the user typed these bytes in tab `id`"
resizeShell(id, cols, rows)  renderer → main   "tab `id` is now this size"
killShell(id)                renderer → main   "kill tab `id`'s shell"
onShellData((id, data))      main → renderer   "tab `id`'s shell produced these bytes"
onShellExit((id))            main → renderer   "tab `id`'s shell has exited"
onCommand(callback)          main → renderer   "execute this Command" (see below)
emitEvent(event)             renderer → main   "this Event just happened" (see below)
showTabMenu(id)              renderer → main   "right-click on tab `id`: show its native menu"
onRenameRequest((id))        main → renderer   "the user picked Rename in tab `id`'s menu"
```

Rules that keep this boundary healthy:

1. **The shell protocol carries only bytes, sizes and tab ids.** No
   file paths, no structured objects. The renderer never knows what shell
   is running; the main process never knows how the screen is drawn. The
   one deliberate exception is the command bus (next section): a single
   pair of channels carrying typed `Command`/`EditorEvent` objects, whose
   shapes live in `api.ts` and are compile-checked on both sides.
2. **The renderer stays a dumb screen.** Anything that touches the OS
   (processes, files, clipboard writes are the one pragmatic exception)
   belongs in main.
3. **Grow the protocol, don't bypass it.** A new capability means a new,
   explicitly named message in `preload.cts`, never widening the sandbox or
   exposing Node.js to the page.

This is also the security model (see "Preload script" in the glossary): the
page can only ever do what these functions allow.

## The command bus: the public interface

The most important seam in the project. Everything the editor can do is
expressible as a **Command** (an imperative request: "open a tab", "type
this text"), and everything that happens is announced as an **Event** (a
fact: "tab 3 opened", with a snapshot of the resulting state). The two
unions in `api.ts` *are* the editor's public API; that file is the one
to read first.

```
        dispatch(command)                executeCommand(command)
  main ────────────────────► renderer ──── one switch, the only
   ▲                            │           place state changes
   │  sources: app menu today,  │
   │  a local server tomorrow   ▼
   └──────────────────────── emitEvent(event with state snapshot)
```

The rule that keeps the API honest: **every UI affordance goes through a
command**. The × button, the + button, clicking a tab, ⌘T: none of them
call editor functions directly; they all issue the same Commands an
external caller would. The UI is just the first API client, so the API
can never lag behind the UI.

Two consequences worth naming:

- **Events carry a state snapshot** (`{tabs, layout, activeId}`), so an observer
  never needs a query protocol: whatever arrives last is the truth. Main
  keeps the latest snapshot as the read model a future server will answer
  from.
- **The console is the API today.** `window.editor.command({type: "new-tab"})`
  in devtools (⌥⌘I) drives the real bus. The eventual goal (a local
  server so an LLM agent can fully drive the editor) is then a main-only
  change: a second caller of `dispatch`, plus streaming Events and
  terminal output (which already flows through main) back out.

## Map of the code

Directories mirror this document: two sides, the cable between them, and
the public interface at the top.

```
src/
  api.ts             the public interface: Command / EditorEvent / EditorState / Settings
  theme.ts           the theme palettes (THEMES) and default settings, imported by both sides
  ipc/               the cable
    bridge.ts          the contract type (window.bridge)
    preload.cts        its implementation, the one CommonJS file
  main/
    index.ts           boot: the window and the app lifecycle
    shells.ts          Map<tab id, PTY>: spawn/write/resize/kill + relaying data/exit
    menus.ts           app menu + tab context menu; menu items are Command sources
    bus.ts             dispatch() into the renderer; Event intake (the read model)
  renderer/
    index.html         the page: title bar, sidebar, the layout root, the modals
    style.css          the page's stylesheet; theme values arrive as custom properties
    index.ts           boot: settings → CSS, cable wiring, the first tab
    tabs.ts            Tab store + executeCommand (the consumer) + Dockview, kept behind both
    rename-dialog.ts   the rename modal
    settings.ts        the current settings: value, persistence, hand-off to CSS
    settings-dialog.ts the settings modal; controls are Command sources
    dom.ts             requireElement: strict lookups of index.html's fixed elements
```

A reader who knows the architecture can predict where anything lives; a
file that stops fitting its one-line description above is a file that
wants splitting.

## Decisions so far

Each entry: what we chose, and why. If a decision stops making sense, we
change it and update this list.

- **TypeScript, compiled by `tsc` alone: still no bundler, no framework.**
  (Replaced the original "plain JavaScript, no build step" decision.) Node
  22.18+ (including the Node 24 inside our Electron) can *run* `.ts` files
  natively by stripping the type annotations, but that gets us nothing on its
  own: stripping isn't checking, and the renderer runs in Chromium, which
  can't run TypeScript at all. So the one tool is the official compiler:
  `tsc` type-checks all of `src/` and emits plain JS into `dist/`. Cost we
  accept: a compile step inside `npm start`. The no-bundler rule stands:
  `dist/` files map 1:1 to `src/` files, nothing is fused or minified.
- **The IPC contract is a type.** `src/ipc/bridge.ts` declares `Bridge`;
  preload implements it and the renderer consumes it, so the two sides of the
  boundary cannot silently drift apart; drift is now a compile error.
- **Types are modules, not declaration files.** (Replaced the earlier
  ambient-`.d.ts` pattern.) This will eventually be a large codebase, and at
  scale every name should have a greppable `import type` stating where it
  comes from; ambient types that "appear from nowhere" don't pay their way
  once "where is this defined?" becomes a real question. `api.ts` and
  `bridge.ts` are ordinary modules exporting types; `declare global` is
  reserved for names that genuinely exist on the global scope at runtime
  (`window.bridge`, `window.editor`, xterm's classic-script globals) and
  lives next to what creates or consumes them. Cost we accept: tsc emits an
  empty `dist/api.js` and `dist/ipc/bridge.js` that nothing ever loads.
- **Tabs: a tab id on every message.** (Replaced "one window, one shell,
  no session abstraction"; the predicted ~15-line rewrite arrived when tabs
  did.) One tab = one xterm.js instance in the renderer = one PTY in main's
  `Map<id, pty>`. The *renderer* assigns the ids (a counter): it knows a tab
  exists before main does, so ids flow in the same direction as creation and
  no reply message is needed. The renderer owns everything visual (tab bar,
  which tab is showing); main knows nothing but ids.
- **Shell lifecycle is symmetric, per session.** Closing a tab kills its
  shell; a shell exiting (`exit`, ⌘W) removes its tab: one removal path,
  always triggered by `onExit`. The *last* shell exiting closes the window,
  and closing the window kills every remaining shell.
- **The renderer requests the first shell: the old startup race is gone.**
  Main used to spawn the shell after `loadFile` resolved, so output couldn't
  arrive before the page listened. With tabs, creation starts *in* the page
  (`create` is sent from a running renderer), so a shell can't exist before
  the page is listening; the race is unrepresentable rather than handled.
- **⌘T/⌘W live in the application menu.** Menu accelerators are the
  macOS-native home for shortcuts, and the default menu already binds ⌘W to
  "close window"; a page-level key handler would never see it. So main owns
  a small menu (File > New Tab / Close Tab) whose clicks dispatch Commands
  onto the bus; the renderer decides what a "tab" even is.
- **Commands in, Events out, and the UI is just the first client.**
  (This is the command-bus decision; the design lives in its own section
  above.) We chose the CQRS naming (*command* = imperative request in,
  *event* = fact out) because an external driver needs both directions and
  one word muddles the arrow. The consumer (`executeCommand`) lives in the
  renderer because tab state lives there; the intake (`dispatch`) lives in
  main because the future server must live where Node is. Every UI control
  issues Commands rather than calling functions, so the API cannot lag
  behind the UI; every state change emits an Event carrying a full
  snapshot, so observers need no query protocol. Costs we accept: one
  structured channel pierces the bytes-and-ids rule (typed and
  compile-checked in `api.ts`), and UI clicks take one extra hop through
  the switch.
- **Login shell (`zsh -l`), spawned in `$HOME`.** The app should feel
  identical to Terminal.app on first launch: same prompt, same PATH.
- **xterm.js and node-pty do the hard parts.** Escape-sequence parsing and
  PTY syscalls are decades-deep rabbit holes. We own the wiring, not the
  emulation. (If we ever want to *learn* the parsing, we can write a toy
  parser on the side without touching the app.)

- **Visual settings live in `src/theme.ts`, a plain-script global.** The
  background color had quietly spread to three places in three languages:
  the window (main), the page (CSS), and xterm's theme (renderer); all
  three had to agree by hand. Now `THEME` is defined
  once: both sides import it like any other value; CSS gets its
  colors (page background, scrollbar) pushed in as custom properties, since
  CSS can't read JavaScript. A failed idea worth remembering: we first left
  the page background off entirely, expecting the window's `backgroundColor`
  to show through a transparent page. It doesn't: Chromium paints its own
  canvas behind every page (white, or near-black under `color-scheme: dark`),
  so the visible mismatch came back until the page painted the theme color
  itself.
- **Native ES modules: no CommonJS, no `require`, in our source.**
  (Replaced the original CommonJS emit; decided together with theme.ts.)
  Sharing the first runtime value between browser and Node exposed the cost
  of CommonJS output: a shared file needed the hand-rolled UMD trick, a
  plain-script global for the page plus a `module.exports` guard for
  `require()`. That wart is the smell of a missing module system, and the
  platform ships one: `"type": "module"` in package.json makes Electron run
  our output as ES modules, and the browser loads the renderer with
  `<script type="module">`, still no bundler. The one exception is
  preload: Electron's sandbox requires it to be CommonJS, so it is named
  `preload.cts`; the extension tells tsc to emit that single file as
  `.cjs`, while its source still reads as `import`. Costs we accept: import
  paths must spell out the compiled `.js` extension (Node ESM and browsers
  both demand it), and xterm.js still arrives as classic-script globals
  because that's how the package ships.
- **Tab titles come from the programs inside, via OSC.** A terminal doesn't
  name its own tabs: the shell (or vim, or ssh) emits an OSC title sequence
  (see glossary) mixed into its ordinary output, and the emulator displays
  the latest one. We had penciled "OSC hooks" in as a protocol change below,
  but titles needed none; the bytes already cross the cable as terminal
  output, and xterm.js parses them on the screen side, firing
  `onTitleChange` in the renderer. That handler issues a `set-tab-title`
  Command like any other client, so external callers can rename tabs the
  same way the shell does, and every rename emits a `tab-retitled` Event.
  A tab whose title is `""` (none set yet, or cleared) falls back to a
  plain "Untitled" label: a title is display text, not an identifier, so
  it doesn't need to be unique and gets no number.
- **Directories mirror the architecture; names say what things are.**
  (Replaced the original flat `src/` with two catch-all files.) The layout
  in "Map of the code" exists because the last several features all landed
  in the same two files; growth was making them junk drawers. Two naming
  rules came with the split: a name must describe the thing as it is *now*
  (`window.terminal` became `window.bridge` when it outgrew terminals;
  `bridge.close(id)` became `killShell(id)` because it says side, object
  and consequence), and concepts that aren't distinct don't get distinct
  names (a "session id" was always just the tab's id, so the extra term is
  gone). Cost we accept: more, smaller files, and cross-file navigation
  where one scroll used to do.
- **Explicit renames pin the title; the shell's are transient.** Two
  writers race for the same label: the human (double-click the tab, or any
  API caller) and the shell, which retitles on every prompt. Without a
  rule, a manual rename survives only until the next Enter. So the
  `set-tab-title` Command carries `transient: true` when it originates
  from the shell's OSC stream, and a tab that has been explicitly renamed
  ignores transient updates. Renaming to `""` unpins; the shell's titles
  flow again. The rename affordance: right-click a tab → a real native
  context menu (`Menu.popup`, which only main can create) → "Rename Tab…"
  opens a modal. The modal is an in-window `<dialog>` (`showModal()` gives
  backdrop, focus trap and Escape-cancels from the browser engine) because
  Electron has no native text-input dialog; an in-window modal is the
  standard Electron pattern; VS Code's input boxes work the same way.
  Double-click a tab is the shortcut to the same modal. Either way the
  rename commits by issuing the same `set-tab-title` Command any client
  would.
- **The layout engine: Dockview, kept behind the bus.** (Decided 2026-08
  when tab reordering arrived.) The tab strip and panes are rendered by
  [Dockview](https://dockview.dev) (`dockview`, the vanilla package), a
  zero-dependency docking layout manager. It was chosen over hand-rolling
  because the same drag machinery later gives splits, divider resizing, and
  drag-a-tab-between-splits, the genuinely hard 20% of that feature. The
  condition of entry was keeping the command bus as the single write path,
  and Dockview supports it: every drop fires a cancelable `onWillDrop`
  *before* any mutation, so tabs.ts cancels the drop, re-issues it as a
  `move-tab` Command, and the consumer performs the identical move through
  `panel.api.moveTo()`. A drag therefore enters the editor through the same
  door as a menu click (see "Drag-and-drop interception" in the glossary).
  Dockview is confined to tabs.ts and index.html; `api.ts`, the bridge, and
  main know nothing about it, which is what keeps the provider swappable.
  Two costs we accept: clicking a tab is activation (focus, not layout) and
  is applied by Dockview first, announced on the bus afterwards, because
  blocking that click would also block the drag that starts on the same
  mousedown; and the library arrives as a classic-script global like
  xterm.js, plus its stylesheet, retinted from theme.ts by overriding its
  CSS custom properties. Splits shipped through the same door (2026-08):
  `EditorState.layout` models the pane tree as groups (leaves) and splits
  (branches), built by walking Dockview's own layout serialization, so
  observers see arrangement, not pixels. Dropping a tab on a pane's edge
  issues `split-tab`, on a pane's center `move-tab` into that group, and
  the consumer replays both through `moveTo()`. Deliberately still off:
  window-edge drops (Dockview has no public root-relative placement API)
  and whole-group drags, until a feature needs them; divider sizes are
  not modeled, so resizing a split emits no Event; and Dockview's built-in
  tab-overflow dropdown is disabled, because it cannot render our custom
  tab components (the strip scrolls instead).
- **The title bar is painted, not native.** (Decided 2026-08.) macOS
  offers no way to recolor the standard title bar, so the window is
  created with `titleBarStyle: "hiddenInset"`: the traffic lights stay
  native, drawn inset over the page, and the page's own `#title-bar`
  strip takes over the rest (the theme's color, the centered title, and
  `-webkit-app-region: drag`, which keeps the native behaviors: dragging
  moves the window, double-click zooms it; see "Drag region" in the
  glossary). The tab strip stays below the title bar rather than merging
  into it: a merged strip would need its empty space as the drag handle,
  and a drag region's pixels are deaf to the page, which would have
  killed double-click-to-open-a-tab. Cost we accept: one strip of
  vertical space a merged design would save.
- **Settings: themes and fonts, runtime-changeable, behind the bus.**
  (Extends the theme.ts decision: the single `THEME` const became `THEMES`,
  a set of named palettes, plus `Settings`: which palette is active, the
  terminal's font family and size, and the UI font used by everything
  else.) The current value lives in `renderer/settings.ts`
  and persists in localStorage: settings are renderer-only state, so no
  IPC message was needed; the first entry from the "renderer-only"
  feature list to ship. Changes enter as an `update-settings` Command
  (the settings dialog's controls, a devtools call, and a future agent
  all use the same door), and the consumer *corrects* rather than
  rejects: an unknown theme name is ignored, a wild font size clamped;
  then a `settings-changed` Event reports the values as they actually
  took, and xterm's options are updated on every live terminal with an
  explicit re-fit (a font change alters the cell size without touching
  any pane's box, so the ResizeObservers stay silent). The entry point
  is a sidebar, a vertical strip on the left, VS Code's activity-bar
  pattern, holding only the settings gear for now. Costs we accept:
  main can't read localStorage at window-creation time, so the pre-paint
  window color is the default theme's (one wrong-colored frame on a
  non-default theme; a config file would fix this if one ever lands),
  and a second app instance finds the storage locked, so settings.ts
  treats persistence as best-effort rather than crashing.
- **Validation is declared, not hand-rolled: zod.** (Decided 2026-08,
  refining the settings decision.) The settings gate began as a chain of
  `typeof` checks: schema validation written by hand. zod states the
  same shape declaratively, once, as a static schema with the rule baked
  in: a field that is missing or fails its checks `.catch`es to its
  default, a non-object candidate to the defaults whole. Loading is then
  just `parse(stored)` and updating is `parse({...settings, ...partial})`,
  with no helper functions between the schema and its two call sites. This is
  the project's first non-UI runtime dependency, deliberately used only
  where untrusted data enters (localStorage, `update-settings` payloads);
  the IPC contract stays compile-checked only, until an outside caller
  (the future API server) makes those inputs untrusted too. Delivery
  quirk worth knowing: with no bundler, the browser resolves every
  import itself, and a bare `"zod"` means nothing to it. Import maps are
  the web's fix, but inline ones are blocked by our CSP and external
  ones aren't supported by Chromium yet, so settings.ts imports zod by
  relative `node_modules` path, the same way index.html reaches xterm's
  files. Costs we accept: one ugly import path, and a dependency whose
  ESM build must stay browser-loadable (zod's is: fully relative,
  extension-qualified imports).
- **VS Code view: embed openvscode-server, when we build it.** (Decided
  2026-08 after research; not built yet.) The full VS Code experience comes
  from spawning [openvscode-server](https://github.com/gitpod-io/openvscode-server)
  (a fork of Code - OSS, see glossary, that serves the editor over HTTP) as
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

- **Renderer-only** (no protocol change): search (xterm search addon),
  clickable links, scrollback size, ⌘K clear. (Themes/fonts shipped from
  this list; see the settings decision.)
- **Main-only** (no protocol change): default working directory, shell
  choice, window size persistence.
- **New capabilities** now usually mean new Commands/Events in `api.ts`;
  the bus is the protocol growing point. The public API server (feeding
  `dispatch` from HTTP/WebSocket, streaming Events back) is a main-only
  change.
- **Protocol changes** (the expensive kind, design first): config file (a
  `config:get` message or similar), shell integration/OSC hooks (new main →
  renderer events), VS Code view (a message telling the renderer what port
  openvscode-server landed on). Splits proved the tier system: they
  shipped as a bus change (`split-tab`, `EditorState.layout`) with zero
  IPC change, because each split's terminal reuses the per-tab shell
  machinery unchanged.

The rule of thumb: protocol changes get a moment of planning in this doc
*before* the code is written; the other two kinds can just be built.
