// The editor's public interface: read this file first.
//
// Everything the editor can do is a Command; everything that happens is an
// Event. The UI issues these same Commands, so the API can never do less
// than the UI. Try it in devtools (⌥⌘I):
//
//   editor.command({ type: "new-tab" })
//   editor.command({ type: "write", text: "ls\n" })
//
// Types only: consumers use `import type`; the emitted api.js is empty.

// where a split lands, relative to its target group
export type SplitSide = "left" | "right" | "top" | "bottom";

// Imperative requests, into the editor. `id` defaults to the active tab
// where it's optional.
export type Command =
  | { type: "new-tab"; groupId?: string }
  | { type: "close-tab"; id?: number }
  | { type: "activate-tab"; id: number }
  | { type: "write"; id?: number; text: string } // type into a terminal
  // Move a tab into a group's strip at `index` (0 = leftmost). `groupId`
  // defaults to the tab's current group: a plain reorder.
  | { type: "move-tab"; id?: number; groupId?: string; index: number }
  // Split: move a tab into a new group created on `side` of the target
  // group (default: the tab's own group).
  | { type: "split-tab"; id?: number; targetGroupId?: string; side: SplitSide }
  // An explicit rename pins the title against the shell's `transient`
  // (OSC) renames; an explicit `title: ""` reverts to "Untitled" and unpins.
  | { type: "set-tab-title"; id?: number; title: string; transient?: boolean }
  // Change any subset of the settings; omitted fields keep their value.
  // Invalid values are corrected to their defaults, not rejected.
  | { type: "update-settings"; settings: Partial<Settings> }
  // Open a file rendered as GitHub-flavored Markdown in a new tab
  // (default: the active group). A relative path resolves against the
  // shell cwd of `baseTabId` (the terminal the link was clicked in).
  | {
      type: "open-markdown";
      path: string;
      baseTabId?: number;
      groupId?: string;
    };

// Facts, out of the editor. Every event carries the state it produced, so
// whatever an observer heard last is the whole truth. tab-moved covers
// reorders, merges and splits alike.
export type EditorEvent =
  | { type: "tab-opened"; id: number; state: EditorState }
  | { type: "tab-closed"; id: number; state: EditorState }
  | { type: "tab-retitled"; id: number; state: EditorState }
  | { type: "tab-moved"; id: number; state: EditorState }
  | { type: "tab-activated"; id: number; state: EditorState }
  // carries the settings as they actually took effect, not as requested
  | { type: "settings-changed"; settings: Settings; state: EditorState };

// What the user can adjust at runtime. `theme` names a THEMES entry
// (theme.ts); it stays a plain string so this file exports types only,
// and the consumer validates the name. fontFamily/fontSize are the
// terminal's; uiFontFamily is everything else.
export interface Settings {
  theme: string;
  fontFamily: string;
  fontSize: number;
  uiFontFamily: string;
}

export interface TabInfo {
  id: number;
  title: string;
  kind: "terminal" | "markdown";
}

// One tab strip and the pane below it. Group ids are opaque handles
// assigned by the layout engine.
export interface GroupInfo {
  id: string;
  tabs: TabInfo[];
}

// The pane arrangement as a tree: a group is a leaf, a split lays its
// children side by side ("row") or stacked ("column"). Divider sizes are
// deliberately not modeled: resizing changes no tab and emits no Event.
export type LayoutNode =
  | { type: "group"; group: GroupInfo }
  | { type: "split"; direction: "row" | "column"; children: LayoutNode[] };

export interface EditorState {
  tabs: TabInfo[]; // every tab, in visual order
  layout: LayoutNode | null; // null only before the first tab exists
  activeId: number;
}
