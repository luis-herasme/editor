// The editor's public interface: read this file first.
//
// Everything the editor can do is a Command; everything that happens is an
// Event. The UI (menu, buttons, clicks) issues these same Commands, so the
// API can never do less than the UI. Try it now in devtools (⌥⌘I):
//
//   editor.command({ type: "new-tab" })
//   editor.command({ type: "write", text: "ls\n" })
//
// Eventually a local server in the main process will feed Commands in and
// stream Events out, so an agent can drive the editor (see ARCHITECTURE.md,
// "The command bus").
//
// Types only: consumers use `import type { ... } from "./api.js"`, which is
// erased at compile time. The emitted api.js is an empty module nothing
// ever loads.

// Where a split lands, relative to its target group.
export type SplitSide = "left" | "right" | "top" | "bottom";

// Imperative requests, into the editor. `id` defaults to the active tab
// where it's optional.
export type Command =
  | { type: "new-tab" }
  | { type: "close-tab"; id?: number }
  | { type: "activate-tab"; id: number }
  | { type: "write"; id?: number; text: string } // type into a terminal
  // Move a tab into a group's tab strip at `index` (0 = leftmost).
  // `groupId` defaults to the tab's current group: a plain reorder.
  // Dragging a tab along a strip issues this same Command.
  | { type: "move-tab"; id?: number; groupId?: string; index: number }
  // Split: move a tab into a new group created on `side` of the target
  // group (default: the tab's own group). Dragging a tab onto a pane's
  // edge issues this same Command.
  | { type: "split-tab"; id?: number; targetGroupId?: string; side: SplitSide }
  // Rename a tab. An explicit rename pins the title: later `transient`
  // renames (the shell's automatic OSC titles) are ignored for that tab.
  // An explicit `title: ""` reverts to "Untitled" and unpins.
  | { type: "set-tab-title"; id?: number; title: string; transient?: boolean };

// Facts, out of the editor. Every event carries the state it produced,
// so whatever an observer heard last is the whole truth. tab-moved covers
// reorders, merges and splits alike: the layout in the snapshot is the
// part that differs.
export type EditorEvent =
  | { type: "tab-opened"; id: number; state: EditorState }
  | { type: "tab-closed"; id: number; state: EditorState }
  | { type: "tab-retitled"; id: number; state: EditorState }
  | { type: "tab-moved"; id: number; state: EditorState }
  | { type: "tab-activated"; id: number; state: EditorState };

export interface TabInfo {
  id: number;
  title: string;
}

// A tab group: one tab strip and the pane below it. Group ids are opaque
// strings assigned by the layout engine; treat them as handles to pass
// back into Commands, not as names.
export interface GroupInfo {
  id: string;
  tabs: TabInfo[];
}

// The pane arrangement as a tree: a group is a leaf, and a split lays its
// children out side by side ("row") or stacked ("column"). Divider sizes
// are deliberately not modeled: resizing changes no tab and emits no
// Event. If an observer ever needs sizes, that's a designed addition here.
export type LayoutNode =
  | { type: "group"; group: GroupInfo }
  | { type: "split"; direction: "row" | "column"; children: LayoutNode[] };

export interface EditorState {
  tabs: TabInfo[]; // every tab, in visual order: left-to-right, top-to-bottom
  layout: LayoutNode | null; // null only before the first tab exists
  activeId: number;
}
