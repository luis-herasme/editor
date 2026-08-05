# Glossary

Terms used in this project, defined for someone new to terminal applications.
This file grows as the project does — every new concept gets an entry.

## Terminal

Originally a physical device: a keyboard and a screen (like the DEC VT100 from
1978) connected to a distant computer by a serial cable. It sent keystrokes down
the wire and displayed the characters that came back. It had no computing power
of its own — hence "dumb terminal". Every piece of software below exists to
imitate this hardware, which is why so much terminal behavior only makes sense
historically.

## Terminal emulator

A program that pretends to be one of those physical terminals. It draws a grid
of characters in a window, sends your keystrokes to a program (usually a
shell), and interprets the bytes coming back — including invisible control
codes — to update the screen. macOS Terminal, iTerm2, and this project are all
terminal emulators. **The terminal emulator does not understand commands** — it
never knows what `ls` means. It only moves bytes and draws characters.

## Shell

The program that actually interprets your commands. When you type `ls -la` and
press Enter, the shell parses that line, finds the `ls` program, runs it, and
shows you a new prompt when it finishes. It's called a "shell" because it's the
layer wrapped around the operating system's core (the kernel). On your Mac the
default shell is **zsh**; bash and fish are other shells. Terminal emulator and
shell are separate programs: the emulator is the window, the shell is the
conversation happening inside it.

## Login shell

A shell started with the `-l` flag, which makes it read your startup files
(`~/.zprofile`, `~/.zshrc` on macOS). We spawn the shell this way so your PATH,
aliases, and prompt look identical to Terminal.app. Without it you'd get a
bare, unconfigured shell.

## TTY

Short for **teletype**, an even older physical terminal that printed on paper.
In Unix the name stuck: a "TTY" is the kernel's representation of a terminal —
a special file (like `/dev/ttys003`) that a program can read from and write to
as if a person were on the other end. Programs check "am I attached to a TTY?"
to decide how to behave: `ls` prints colors to a TTY but plain text when piped
to a file.

## PTY (pseudo-terminal)

A fake TTY created by software instead of hardware. It's a pair of connected
endpoints: the shell attaches to one end and believes it's a real terminal; our
app holds the other end and plays the human — feeding keystrokes in and reading
output out. This is the crucial trick of the whole project: if we launched zsh
with an ordinary pipe instead of a PTY, it would think its output was going to
a file — no colors, no line editing, and vim would refuse to run. `node-pty` is
the library that creates PTYs for us.

## Escape sequences (ANSI codes)

How a shell talks to the terminal beyond plain text. The output stream is mixed
with invisible commands that all start with the ESC byte (27): `ESC[31m` means
"draw the following text in red", `ESC[2J` means "clear the screen", `ESC[H`
means "move the cursor to the top-left". Full-screen programs like vim are
really just fountains of escape sequences. Parsing these correctly is the
hardest part of a terminal emulator — it's the main thing xterm.js does for us.

## xterm.js

A JavaScript library that implements the "screen" half of a terminal emulator:
it maintains the character grid, parses escape sequences, draws everything into
the page, and turns your keypresses into the bytes a shell expects. It powers
the terminal in VS Code. It deliberately does **not** run shells — that's our
job, via node-pty.

## Electron: main process and renderer process

An Electron app is two kinds of programs working together. The **main process**
is a Node.js program with full access to your machine — it opens windows and,
in our app, spawns the shell. Each window runs a **renderer process**: a
Chromium browser page that can show UI but is sandboxed away from your system,
like any web page. Our xterm.js screen lives in the renderer; our PTY lives in
main. They are separate operating-system processes and share no memory.

## IPC (inter-process communication)

How the main and renderer processes talk: named messages passed between them
(`ipcMain` / `ipcRenderer` in Electron). Ours carry the per-tab shell
protocol (`shell:spawn`, `shell:write`, `shell:data`, ...) and the
command bus (`command` in, `event` out) — the full list is "The boundary"
in ARCHITECTURE.md.

## Command / Event

The two halves of the editor's public interface (defined in `api.ts`).
A **command** is an imperative request flowing *into* the editor — "open a
tab", "type this text" — named in the imperative mood. An **event** is a
fact flowing *out* — "tab 3 opened" — named in the past tense, and carrying
a snapshot of the resulting state. Keeping the two directions as two words
(borrowed from the CQRS pattern) matters because an external driver, like
an agent, needs both: send commands, observe events. One word would muddle
which way the arrow points.

## Menu accelerator

A keyboard shortcut attached to an application-menu item (macOS's native way
of owning shortcuts). Accelerators fire *before* the focused web page sees
the key — which cuts both ways: the default menu binds ⌘W to "close window",
so a page could never intercept it for "close tab"; but a menu we define
ourselves gets ⌘T/⌘W reliably, even while xterm has keyboard focus. That's
why our tab shortcuts live in main's menu and arrive in the renderer as
forwarded events rather than keystrokes.

## Preload script

A small script that runs inside the renderer *before* the page loads, with
access to both worlds. It exposes a hand-picked API to the page (our
`window.bridge`) so the sandboxed page never
gets direct access to Node.js. This pattern is called **context isolation**
and is Electron's security model: the page can only do what the preload
explicitly permits.

## Native module / ABI (why `npm run rebuild` exists)

Most npm packages are pure JavaScript, but node-pty contains C++ code compiled
into a binary, because creating PTYs requires operating-system calls JavaScript
can't make. Compiled binaries must match the exact version of the runtime that
loads them — the contract between them is called the **ABI** (application
binary interface). Electron ships its own Node.js whose ABI differs from the
Node on your machine, so after installing, `electron-rebuild` recompiles
node-pty against Electron's headers. Symptom of forgetting this step: the app
crashes on launch with an error like "was compiled against a different Node.js
version".

## TypeScript / type checking

JavaScript plus **type annotations**: `(data: string)` declares what kind of
value is allowed, and the TypeScript compiler proves the whole program agrees
with itself before anything runs — pass a number where a string is declared
and it refuses to compile. The types exist only at compile time; the running
program is plain JavaScript with the annotations removed.

## Type stripping

A Node.js feature (since 22.18) that lets Node run `.ts` files directly by
simply *deleting* the type annotations — without reading them. Fast and
dependency-free, but it is not type checking: `const x: number = "hi"` runs
happily. Also note the renderer can never use it — it runs in Chromium, a
browser, which doesn't understand TypeScript at all. That's why this project
compiles with `tsc` (getting real checking in the bargain) instead of relying
on stripping.

## tsc

The official TypeScript compiler. Does two jobs in one pass: **checks** every
type in `src/` (errors stop the build) and **emits** the equivalent plain
JavaScript into `dist/`, one output file per source file. It's the project's
entire build system — `npm start` is just `tsc && electron .`.

## Declaration file (.d.ts) / declare global

A `.d.ts` file contains only types and compiles to nothing — it's how
libraries ship types for the compiler (xterm's packages in node_modules do
this). We used to write our own, but chose plain `.ts` modules with
explicit `import type` instead: in a growing codebase, every name should
have a greppable import stating where it comes from. The one thing imports
can't express is a name that genuinely exists on the global scope at
runtime — `window.bridge` (preload puts it there) and the
`Terminal`/`FitAddon` globals (xterm's script tags create them). Those are
declared with `declare global`, and that's the only thing it's used for.

## Script vs. module

JavaScript files come in two flavors, and a file's flavor decides how values
get in and out of it. A **module** has private scope: nothing leaks out, and
others reach its values with `import`. A **classic script** (loaded with a
plain `<script>` tag) is the older flavor: its top-level declarations land in
a scope shared by every other script on the page — that's why xterm's script
tag makes `Terminal` just *appear* as a global in the renderer. Modules
themselves come in two dialects: **ES modules** (`import`/`export`, the
standard, what this project uses everywhere) and **CommonJS**
(`require()`/`module.exports`, Node's older invention). Our one CommonJS
file is the preload script, because Electron's sandbox demands it: naming it
`preload.cts` makes tsc emit that single file as `.cjs` (CommonJS) while its
source still reads as `import`.

## CSS custom property

A variable in CSS: declared as `--name: value`, read as `var(--name)`.
JavaScript can set one at runtime (`element.style.setProperty`), which makes
it the bridge for handing a script's values to stylesheets — CSS has no way
to read JavaScript on its own. Ours carry the scrollbar colors from theme.ts
into index.html's styles.

## Character cell / grid

A terminal screen is not free-form text — it's a rigid grid of equal-size
cells, one character each, e.g. 80 columns × 24 rows (the VT100's dimensions,
still the default size everywhere). Everything is measured in cells: cursor
position, window size, vim's layout. Consequence: a window's pixel height is
rarely an exact multiple of the cell height, so a leftover strip of a few
pixels always exists past the last row. Terminals hide it by painting it the
same color as the screen.

## Code - OSS / openvscode-server / Open VSX

Three names that come up around embedding VS Code. **Code - OSS** is the
MIT-licensed open-source codebase behind VS Code; Microsoft's branded "VS
Code" is a proprietary build of it, and the branding plus its extension
marketplace are licensed for official builds only. **openvscode-server** is a
fork of Code - OSS (by Gitpod) that serves the full editor over HTTP so it
runs in any browser — which is what makes it embeddable in our renderer.
**Open VSX** is the vendor-neutral extension registry such forks use instead
of Microsoft's marketplace; it has most popular extensions, minus some
Microsoft-proprietary ones (e.g. Pylance).

## TUI (terminal user interface)

A program whose entire interface is drawn inside a terminal's character grid
using escape sequences — vim, htop, lazygit. The opposite approach to this
app: a TUI lives *inside* a terminal emulator and inherits the grid's limits
(no images, no proportional fonts, no embedded web pages); this app *is* the
terminal emulator, with a full browser page around the grid.

## `<dialog>` element / showModal()

The web platform's built-in modal. Calling `showModal()` on a `<dialog>`
gets you, from the browser engine itself: a dimmable backdrop, a focus trap
(Tab can't wander out), Escape-to-cancel, and `method="dialog"` forms whose
submit closes the dialog carrying a return value. Before it existed, every
app hand-rolled these behaviors (and usually got focus trapping wrong). We
use it for the rename modal — Electron has no *native* text-input dialog,
so an in-window modal is the standard Electron pattern (VS Code's input
boxes are the same idea).

## ResizeObserver

A browser API that calls you back whenever an element's box changes size —
for any reason: window resized, `display` toggled, layout shifted. Each
tab's pane has one, re-fitting its character grid on any change. The
alternative is tracking every *cause* of a size change by hand (a window
listener here, a catch-up call there) and hoping future features remember
to join in — the classic cache-invalidation trap.

## Race condition

A bug where correctness depends on which of two independent things happens to
finish first. Ours: the window loads its page while zsh boots, in parallel.
If zsh's first output arrived before the page was ready to listen, it was
silently lost — the app only worked because zsh is reliably slower. The fix
(spawn the shell only after the page load completes) removes the dependence
on timing entirely. Rule of thumb: "it works because A is slower than B" is
not a design, it's a countdown.

## Scrollback

The lines that have scrolled off the top of the screen. The physical VT100 had
none — text was gone forever. Emulators keep a buffer of them (xterm.js
defaults to 1000 lines) so you can scroll up.

## OSC (Operating System Command)

The family of escape sequences addressed to the terminal *program* rather than
the screen. Ordinary escape codes do things the VT100's hardware did — move
the cursor, color text. OSC sequences (they start with `ESC ]`) ask for things
only the surrounding software can do, and the classic one is the window title:
`ESC ] 0 ; hello BEL` means "call this window *hello*". Try it yourself:
`printf '\e]0;hello\a'`. Configured shells emit one before every prompt
(naming the tab after the current directory), and programs like vim and ssh
set their own while running. The title is therefore not something the emulator
invents — the programs inside announce it, and the emulator just displays the
latest announcement. xterm.js parses the sequence out of the byte stream and
hands us the text as an `onTitleChange` event.

## Docking layout manager

A UI component that owns a region of the page and manages a tree of panes
inside it: each pane has a tab strip, tabs can be dragged to reorder or to
another pane, panes can be split and resized with draggable dividers, and
the whole arrangement can be saved and restored. The pattern is what makes
VS Code's editor area feel the way it does. This project uses
[Dockview](https://dockview.dev): our tab bar and terminal panes are Dockview
"panels". Tabs drag along a strip to reorder, between strips to change
group, and onto a pane's edge to split; window-edge drops and whole-group
drags stay disabled until a feature needs them.

## Drag-and-drop interception (the one-door rule)

How Dockview stays subordinate to the command bus. A docking library
normally applies a drag itself: you drop a tab, the library mutates its
layout, and the application finds out afterwards. That would make gestures
a second write path around the bus. Dockview instead exposes `onWillDrop`,
which fires *before* it mutates anything and can be cancelled. We cancel
every drop, translate it into the equivalent Command (`move-tab` for strip
and pane-center drops, `split-tab` for pane-edge drops), and dispatch that
through `executeCommand`, which performs the identical move
via Dockview's programmatic API (`panel.api.moveTo`). The gesture becomes
just another Command source — same door as the menus, the devtools console,
and the future agent. The one exception is clicking a tab to activate it:
that's focus, not layout, and the mousedown that activates is the same one
that begins a drag, so activation is applied by Dockview and announced on
the bus afterwards as a `tab-activated` Event.
