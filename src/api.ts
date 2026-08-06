// Try me in devtools (⌥⌘I):
//   editor.command({ type: "new-tab" })
//   editor.command({ type: "write", text: "ls\n" })
// Types only: the emitted api.js is empty.

export type SplitSide = "left" | "right" | "top" | "bottom";

// `id` defaults to the active tab where optional.
export type Command =
  | { type: "new-tab"; groupId?: string }
  | { type: "close-tab"; id?: number }
  | { type: "activate-tab"; id: number }
  | { type: "write"; id?: number; text: string }
  | { type: "move-tab"; id?: number; groupId?: string; index: number }
  | { type: "split-tab"; id?: number; targetGroupId?: string; side: SplitSide }
  // An explicit rename pins against shell transient (OSC) titles;
  // `title: ""` reverts to "Untitled" and unpins.
  | { type: "set-tab-title"; id?: number; title: string; transient?: boolean }
  // Invalid values are corrected to their defaults, not rejected.
  | { type: "update-settings"; settings: Partial<Settings> }
  // Default: active group. Relative path resolves against baseTabId's cwd.
  | {
      type: "open-markdown";
      path: string;
      baseTabId?: number;
      groupId?: string;
    }
  | { type: "toggle-maximize"; id?: number };

// Every event carries the full state it produced.


export type EditorEvent =
  | { type: "tab-opened"; id: number; state: EditorState }
  | { type: "tab-closed"; id: number; state: EditorState }
  | { type: "tab-retitled"; id: number; state: EditorState }
  | { type: "tab-moved"; id: number; state: EditorState }
  | { type: "tab-activated"; id: number; state: EditorState }
  // carries the settings as they actually took effect, not as requested
  | { type: "settings-changed"; settings: Settings; state: EditorState }
  | { type: "maximize-changed"; id: number; state: EditorState };

// `theme` stays a plain string so this file stays types-only; the consumer
// validates it. fontFamily/fontSize are the terminal's, uiFontFamily the chrome.
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

// Split direction: resizing changes no tab and emits no Event.
export type LayoutNode =
  | { type: "group"; group: GroupInfo }
  | { type: "split"; direction: "row" | "column"; children: LayoutNode[] };

export interface EditorState {
  tabs: TabInfo[]; // every tab, in visual order
  layout: LayoutNode | null; // null only before the first tab exists
  activeId: number;
  maximizedGroupId: string | null; // the group filling the window, if any
}
