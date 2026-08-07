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
showWorkspaceMenu(id)        renderer → main   "right-click on workspace `id`: show its native menu"
onWorkspaceRenameRequest((id)) main → renderer "the user picked Rename in workspace `id`'s menu"
readFile({path, baseTabId})  renderer → main   "read this file for the markdown view" (the one request/response pair)
```

Rules that keep this boundary healthy:

1. **The shell protocol carries only bytes, sizes and tab ids.** No
   file paths, no structured objects. The renderer never knows what shell
   is running; the main process never knows how the screen is drawn. The
   one deliberate exception is the command bus (next section): a single
   pair of channels carrying typed `Command`/`LmuxEvent` objects, whose
   shapes live in `api.ts` and are compile-checked on both sides.
2. **The renderer stays a dumb screen.** Anything that touches the OS
   (processes, files, clipboard writes are the one pragmatic exception)
   belongs in main.
3. **Grow the protocol, don't bypass it.** A new capability means a new,
   explicitly named message in `preload.cts`, never widening the sandbox or
   exposing Node.js to the page.

This is also the security model (see "Preload script" in the glossary): the
page can only ever do what these functions allow. One rule outside the
bridge serves the same purpose: **the page is never allowed to navigate.**
The window *is* the app, so following a link would replace the sidebar,
the workspaces and every terminal with a web page, unrecoverably. Main
cancels every `will-navigate` and denies every window-open, handing http,
https and mailto URLs to the browser instead and dropping the rest; the
renderer never decides what may reach the OS.

A note on the Content-Security-Policy, because Electron complains about it
at every launch. **The warning is a false positive and the policy is
enforced.** Electron's check reads the *response headers*, and a `file://`
page has none: the only headers our page comes back with are
`Content-Type` and `Last-Modified`. It therefore cannot see the `<meta
http-equiv>` policy in `index.html` and assumes there is none. Measured
against the running app, that policy is doing its job: `eval` and `new
Function` both throw `EvalError`, an injected inline `<script>` never
runs, and `fetch` to a remote host is refused. The warning also only
prints in development, since Electron silences these for a packaged app.
It is left switched on rather than muted, so a *real* warning is still
visible later. The one genuine loosening is `style-src 'unsafe-inline'`,
which Dockview and xterm require because they inject `<style>` blocks at
runtime and offer no way to carry a nonce.

## The command bus: the public interface

The most important seam in the project. Everything lmux can do is
expressible as a **Command** (an imperative request: "open a tab", "type
this text"), and everything that happens is announced as an **Event** (a
fact: "tab 3 opened", with a snapshot of the resulting state). The two
unions in `api.ts` *are* lmux's public API; that file is the one
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
call lmux's functions directly; they all issue the same Commands an
external caller would. The UI is just the first API client, so the API
can never lag behind the UI.

Two consequences worth naming:

- **Events carry a state snapshot** (`{workspaces, activeWorkspaceId}`, each
  workspace holding its own tabs, layout and active tab), so an observer
  never needs a query protocol: whatever arrives last is the truth. Main
  keeps the latest snapshot as the read model a future server will answer
  from.
- **The console is the API today.** `window.lmux.command({type: "new-tab"})`
  in devtools (⌥⌘I) drives the real bus. The eventual goal (a local
  server so an LLM agent can fully drive lmux) is then a main-only
  change: a second caller of `dispatch`, plus streaming Events and
  terminal output (which already flows through main) back out.

## Map of the code

Directories mirror this document: two sides, the cable between them, and
the public interface at the top.

```
src/
  api.ts             the public interface: Command / LmuxEvent / LmuxState / Settings
  theme.ts           the theme palettes (THEMES) and default settings, imported by both sides
  ipc/               the cable
    bridge.ts          the contract type (window.bridge)
    preload.cts        its implementation, the one CommonJS file
  main/
    index.ts           boot: the window and the app lifecycle
    shells.ts          Map<tab id, PTY>: spawn/write/resize/kill + relaying data/exit
    menus.ts           app menu + tab context menu; menu items are Command sources
    bus.ts             dispatch() into the renderer; Event intake (the read model)
    files.ts           file:read for the markdown view; resolves against a shell's cwd
  renderer/
    index.html         the page: title bar, sidebar, the layout root, the modals
    style.css          the page's stylesheet; theme values arrive as custom properties
    index.ts           boot: settings → CSS, cable wiring, the first workspace
    workspaces.ts      Workspace store: one Dockview each, the sidebar, the state snapshot
    tabs.ts            Tab store + executeCommand (the consumer), kept behind the bus
    markdown-tab.ts    a document's pane: the toolbar, the two modes, reload, its links
    rename-dialog.ts   the rename modal
    settings.ts        the current settings: value, persistence, hand-off to CSS
    settings-dialog.ts the settings modal; controls are Command sources
    sidebar-resize.ts  the sidebar's drag handle; a drag ends as one Command
    markdown.ts        GitHub-look rendering (markdown-it + DOMPurify)
    markdown-links.ts  the terminal link provider: Cmd+click a *.md path
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
  (`window.bridge`, `window.lmux`, xterm's classic-script globals) and
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
  always triggered by `onExit`. Closing the window kills every remaining
  shell.
- **The window closes when the last tab does, not the last shell.**
  (Replaced "the last shell exiting closes the window", which predated both
  Markdown tabs and workspaces.) Counting PTYs was main describing the app
  in terms of the one resource it happens to own, and it broke as soon as a
  tab could exist without a shell: exiting the last terminal closed the
  window out from under a Markdown tab, or from under an entire other
  workspace. Main now reads the condition off the snapshot it already keeps
  (`bus.ts`): on a `tab-closed` or `workspace-closed` Event, if no workspace
  has any tabs left, the window closes. No other Event counts, because a new
  workspace is legitimately empty for the instant between its own Event and
  its first tab's.
- **Killing a shell that is busy asks first.** (Decided 2026-08.) Closing
  a window or a workspace ends every shell in it, and a shell ends
  whatever is running inside it: a build, an ssh session, an editor with
  unsaved work. A PTY reports the program currently in its foreground, so
  "busy" is simply that name differing from the shell we spawned, which is
  the same test Terminal.app applies. Both prompts live in main, because
  only main can show a native dialog, only main knows what is in a PTY,
  and only main can cancel a window close. The API is deliberately not
  covered: a `close-workspace` Command issued from the console or a future
  agent proceeds without a dialog, since a caller that isn't a person has
  nothing to answer it with. The affordances a person uses (the menu item,
  the accelerator, the workspace's context menu) all route through main
  already, so they all ask.
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
- **The window remembers where it was; main owns that file.** (Decided
  2026-08.) Size and position persist in `window.json` under Electron's
  userData directory, written on close and read before the window is
  created. It cannot live in localStorage with the other settings, because
  main has to know the geometry *before* a page exists to ask (the same
  ordering problem that makes the pre-paint background the default theme's).
  The file is untrusted input like any other, so it is parsed through a zod
  schema, and four things all mean "use the defaults": no file, an
  unreadable one, one that fails the schema, and bounds that no longer
  overlap any display, which is what happens when a second monitor is
  unplugged between runs. Saving uses the window's *normal* bounds, so a
  zoomed window remembers the size it unzooms to. Cost we accept: the write
  happens on close, so a crash forgets the last move.
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
  The rename commits by issuing the same `set-tab-title` Command any
  client would. (Double-click was originally a shortcut to this modal;
  since 2026-08 it toggles maximize instead, and the context menu is the
  rename affordance.)
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
  `panel.api.moveTo()`. A drag therefore enters lmux through the same
  door as a menu click (see "Drag-and-drop interception" in the glossary).
  Dockview is confined to workspaces.ts (which owns the instances) and the
  few layout calls left in tabs.ts; `api.ts`, the bridge, and
  main know nothing about it, which is what keeps the provider swappable.
  Two costs we accept: clicking a tab is activation (focus, not layout) and
  is applied by Dockview first, announced on the bus afterwards, because
  blocking that click would also block the drag that starts on the same
  mousedown; and the library arrives as a classic-script global like
  xterm.js, plus its stylesheet, retinted from theme.ts by overriding its
  CSS custom properties. Splits shipped through the same door (2026-08):
  `LmuxState.layout` models the pane tree as groups (leaves) and splits
  (branches), built by walking Dockview's own layout serialization, so
  observers see arrangement, not pixels. Dropping a tab on a pane's edge
  issues `split-tab`, on a pane's center `move-tab` into that group, and
  the consumer replays both through `moveTo()`. Deliberately still off:
  window-edge drops (Dockview has no public root-relative placement API)
  and whole-group drags, until a feature needs them; divider sizes are
  not modeled, so resizing a split emits no Event; and Dockview's built-in
  tab-overflow dropdown is disabled, because it cannot render our custom
  tab components (the strip scrolls instead). Double-clicking a tab
  issues `toggle-maximize` (2026-08, the tmux-zoom gesture): the tab's
  group fills the window and `LmuxState.maximizedGroupId` records it.
- **The title bar is painted, not native.** (Decided 2026-08.) macOS
  offers no way to recolor the standard title bar, so the window is
  created with `titleBarStyle: "hiddenInset"`: the traffic lights stay
  native, drawn inset over the page, and the page's own `#title-bar`
  strip takes over the rest (the theme's color, the centered title, which
  names the active workspace, and
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
  is a sidebar, a strip on the left, holding only the settings gear at the
  time (workspaces later filled the rest of it). Costs we accept:
  main can't read localStorage at window-creation time, so the pre-paint
  window color is the default theme's (one wrong-colored frame on a
  non-default theme; a config file would fix this if one ever lands),
  and a second app instance finds the storage locked, so settings.ts
  treats persistence as best-effort rather than crashing.
- **The rendered document has its own font, and the dialog has sections.**
  (Decided 2026-08.) A Markdown view is prose, not chrome: reading it
  wants a different typeface, and often a larger size, than tab labels do.
  So `markdownFontFamily`/`markdownFontSize` join the settings and reach
  the view as `--markdown-font-family`/`--markdown-font-size`, leaving
  `uiFontFamily` to the chrome it was always about; code inside a document
  keeps the terminal's font, because code is code. The dialog grew
  headings to match (Terminal, Interface, Markdown), the theme staying
  above them as the one setting that colors everything. One consequence
  worth naming: a mermaid diagram bakes the theme and the font into the
  SVG when it is drawn, so it can only follow a change by being drawn
  again. `update-settings` therefore redraws open Markdown tabs, but only
  when the theme or the Markdown font actually changed, and each redraw
  restores the scroll position the same way a reload does. This also fixes
  a wart that predates the setting: diagrams used to keep the old palette
  after a theme switch.
- **The sidebar's width is a setting, dragged rather than typed.**
  (Decided 2026-08, when the sidebar grew from an icon strip to a named
  workspace list.) `sidebarWidth` joins the other settings, so it is
  validated and clamped by the same schema, persisted by the same
  localStorage write, and pushed to CSS as `--sidebar-width` like every
  other value; the settings dialog gets no control, because the drag
  handle *is* its UI. A drag issues exactly one `update-settings` Command,
  on release: the pixels moving under the cursor are a preview, the same
  status a split's divider has, and a Command per mousemove would put a
  hundred `settings-changed` Events on the bus for one gesture. The handle
  is a 5px strip positioned over the sidebar's border rather than a column
  of its own, so widening the grab area costs the layout nothing, and it
  lights up as a hairline. Mid-drag the pane area takes
  `pointer-events: none`, or crossing a terminal would start a text
  selection under the cursor. Implementation note worth keeping: this uses
  document-level mousemove/mouseup listeners in the capture phase (xterm
  handles mouse events on the way down) rather than `setPointerCapture`,
  which reads better but cannot be driven by `webContents.sendInputEvent`,
  so the harness could not verify it.
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
- **Markdown views: a second tab kind, opened from terminal links.**
  (Decided 2026-08.) Cmd+clicking a `*.md` path in any terminal opens the
  file rendered in a new tab: an xterm link provider matches the paths
  (joining wrapped buffer rows first, since long paths wrap) and issues an
  `open-markdown` Command, the same door every gesture uses. Rendering is
  markdown-it (GFM task lists are a small DOM pass of our own; the
  plugin for them ships no browser build), sanitized by DOMPurify because
  Markdown may embed raw HTML, and styled by our own rules in style.css:
  GitHub's *layout* (headings, tables, task lists, spacing) but the
  lmux's palette, every surface derived from the theme variables.
  (github-markdown-css was tried first and removed: its hardcoded GitHub
  colors could never sit flush with lmux's background.)
  The markdown libraries are imported as their self-contained browser ESM
  bundles, by path like zod, not as classic-script globals; the two
  bundles without adjacent declaration files borrow their types from the
  packages' normal entries via an annotated const. A ```mermaid fence
  becomes a drawn diagram (mermaid's "base" theme fed our palette via
  themeVariables, its own strict sanitizer on); a fence that doesn't
  parse stays visible as code. By far our heaviest dependency; if startup
  ever drags, defer its script until the first diagram. Other fences are
  colored by highlight.js through markdown-it's `highlight` hook, in VS
  Code's dark palette (hljs's vs2015 theme; vs for light themes); its
  browser ESM build lives in @highlightjs/cdn-assets, the main package
  being CommonJS-only and kept as a dev dependency for its types. The renderer can't read the disk, so the bridge
  grew its first request/response pair, `readFile`: main reads the file
  (capped at 5MB) and resolves a relative path against the clicking tab's
  shell cwd, asked of the OS at click time (lsof on the PTY's pid), so no
  shell configuration is needed. `Tab` became a discriminated union
  (terminal | markdown) sharing one removal path; a markdown tab's ×
  removes it directly, there being no shell exit to wait for. Costs we
  accept: the page can now ask main to read any file (fine for a personal
  tool; revisit before any remote surface exists), the last *shell*
  exiting still closes the window even if markdown tabs remain, and the
  wrapped-row index math assumes single-width characters. Links *inside* a
  rendered document (added 2026-08 with the navigation guard above) follow
  the same door: a relative `*.md` link issues `open-markdown` resolved
  against the directory of the document holding it, so a doc tree is
  browsable in place, while anything carrying a scheme is left to main and
  every other relative path is ignored rather than followed.
- **A markdown tab can show the file instead of the document, and can
  re-read it.** (Decided 2026-08.) Two buttons in a toolbar at the top of
  the pane: one swaps between the rendering and the file's own text, the
  other reads the file again, for the ordinary case of editing a document
  in one tab and reading it in the next. Both are Command sources like
  every other affordance (`set-markdown-mode`, an idempotent setter rather
  than a toggle so an outside caller can state what it wants, and
  `reload-markdown`), and the mode is part of the state: `TabInfo` became
  a union whose markdown arm carries it, which is the same discriminated
  union `Tab` already is in the renderer. The toolbar lives inside the
  pane rather than in the tab strip because Dockview's header actions
  belong to a *group*, not to a tab, so they would appear over terminals
  too. A reload keeps the scroll position, and that is why `renderMarkdown`
  now returns its element together with a `ready` promise: mermaid
  replaces its fences asynchronously with taller drawings, so restoring a
  position before those land lets the browser clamp it to a document that
  is still short (measured: 1500px became 1108px in README.md). The text
  still appears synchronously; only the measuring waits. A failed read
  becomes a document of its own, so the tab and its reload button survive
  a file that isn't there, and reloading again recovers when it returns.
- **Workspaces: one Dockview instance each, all alive at once.** (Decided
  2026-08.) A workspace is a whole lmux of its own inside the window: its
  own pane layout, its own tabs, its own shells (see the glossary). The
  sidebar, which held only the settings gear, becomes their list: one row
  per workspace carrying its whole name, the active one accented, the gear
  pushed to the bottom. Names, not numbers, because the name is the
  workspace's identity: a numbered strip made a rename invisible in the one
  place you pick a workspace from. A workspace takes its name from its
  active tab, the same relationship a tab has with its shell's OSC title
  one level down, and `rename-workspace` pins it against that just as an
  explicit tab rename pins against the shell (`""` unpins; a workspace with
  no tabs falls back to `Workspace N`). A derived rename emits no
  `workspace-renamed` Event of its own: it is a consequence of the
  `tab-activated`, `tab-retitled` or `tab-closed` that caused it, and rides
  out in that Event's snapshot, so observers never see the same change
  announced twice. The
  mechanic is the cheapest one that preserves state: instead of serializing
  a layout and rebuilding it on every switch (which would recreate every
  xterm.js instance and lose scrollback, cursor and running program), each
  workspace gets its own Dockview instance in its own div, and switching is
  `display: none` on one and the theme's background on the other. The
  workspaces behind stay live: a build left compiling keeps compiling. Tab
  ids stay unique across workspaces, so main's `Map<id, pty>`, `readFile`
  and the OSC title path needed no change at all; this shipped as a pure bus
  change (`new-workspace`, `close-workspace`, `activate-workspace`,
  `rename-workspace`, four matching Events) plus one new IPC pair for the
  workspace context menu, which is the tab-menu pattern repeated.
  `LmuxState` grew a level to match the model: `{workspaces,
  activeWorkspaceId}`, each workspace carrying the tabs/layout/activeId
  that used to sit at the top. Costs we accept: a hidden element measures
  zero, so terminals skip fitting while their workspace is away and re-fit
  on the way back (and Dockview is handed its container size explicitly on
  activation, since it measured zero too); group ids are unique per
  workspace only, so a Command naming a group is resolved inside the
  workspace it belongs to; closing a workspace kills its shells, which can
  trip main's "last shell exiting closes the window" rule even when another
  workspace is still open (the same soft spot markdown tabs already have);
  and workspaces are in-memory, so a restart is back to one, as it is for
  tabs.
- **Workspaces are switched by position from the keyboard.** (Decided
  2026-08.) ⌃1 to ⌃9 pick the workspace at that position in the sidebar,
  ⌃⇥ and ⇧⌃⇥ walk the list and wrap at both ends, and all of it lives in
  a Workspace menu that also absorbed New and Close Workspace from File.
  No new Command: the sidebar labels workspaces by position while
  `activate-workspace` takes an id, so main resolves one into the other
  from the state snapshot it already keeps. That is the menu behaving like
  any other API client, which is the same reason the menu owns the
  shortcut rather than the page (a page-level key handler never sees a key
  an accelerator has claimed; see "Menu accelerator" in the glossary). The
  numbered items are static labels, not workspace names: the menu is built
  once at startup and a name can change while it is on screen. A position
  with no workspace behind it does nothing.
- **macOS only for now, and the debt is written down.** (Decided 2026-08.)
  Supporting one platform well beats three badly while this is a learning
  project, and every assumption below was the simplest thing that worked.
  The intent is still to run elsewhere eventually, so the rule (in
  AGENTS.md) is that a change relying on something another platform lacks
  gets called out when it is made rather than discovered later. The
  running list, which is also the porting checklist:

  | Assumption | Where | What another platform needs |
  | --- | --- | --- |
  | `lsof` to read a shell's cwd | `main/shells.ts` | `/proc/<pid>/cwd` on Linux; no direct equivalent on Windows |
  | `titleBarStyle: "hiddenInset"`, and a 36px strip sized for the traffic lights | `main/index.ts`, `style.css` | a non-inset title bar, or the native one |
  | `/bin/zsh` fallback, spawned `-l` | `main/shells.ts` | `$SHELL` is usually right; Windows needs a different shell entirely |
  | `Menlo` as the default terminal font | `theme.ts` | a font that exists there |
  | `role: "appMenu"` | `main/menus.ts` | macOS puts the app menu first; other platforms do not have one |
  | ⌘/⇧⌘/⌃ typed into tooltips and menu labels | `api.ts`, `tabs.ts`, `workspaces.ts`, `index.html` | labels computed per platform (the accelerators themselves already use `CmdOrCtrl`) |

  Note the last row's asymmetry: the *behavior* is already portable because
  menu accelerators are declared `CmdOrCtrl`, and only the *text* people
  read is hardcoded. That is the cheapest kind of debt and the easiest to
  forget.
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
  shipped as a bus change (`split-tab`, `LmuxState.layout`) with zero
  IPC change, because each split's terminal reuses the per-tab shell
  machinery unchanged. Workspaces proved it again at a larger size: a whole
  second lmux inside the window cost four Commands and no shell-protocol
  change, because tab ids were already the only thing main knew about.

The rule of thumb: protocol changes get a moment of planning in this doc
*before* the code is written; the other two kinds can just be built.
