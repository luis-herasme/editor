// Send Commands, assert on the state that comes back. The architecture was
// built for this: executeCommand is the one place state changes, and every
// Event carries a full snapshot, so a case needs no DOM knowledge except
// where the state deliberately holds none (a terminal's fitted size, a
// document's scroll position), which is what the probes below are for.
import { describe } from "node:test";
import assert from "node:assert/strict";
import * as path from "path";
import { z } from "zod";
import {
  busTest,
  endRun,
  lmuxWindow,
  sendCommand,
  waitForEvent,
} from "./harness.js";
import { lmuxState } from "../main/bus.js";
import type { LmuxState, WorkspaceInfo } from "../api.js";

// tsc emits no .md, so the fixture is read from source, the way main reads
// index.html.
const FIXTURE_PATH = path.join(
  import.meta.dirname,
  "../../src/test/fixtures/document.md",
);

// executeJavaScript is the only way to ask the page something the bus does
// not carry, and it takes a string: nothing typed can express a DOM read
// across processes. Every probe skips the elements of a hidden workspace,
// which are still in the DOM.
const VISIBLE_TERMINAL_ROWS = `(() => {
  const counts = [];
  for (const element of document.querySelectorAll(".xterm-rows")) {
    if (element.offsetParent === null) {
      continue;
    }
    counts.push(element.children.length);
  }
  return counts;
})()`;

const VISIBLE_DOCUMENT = `(() => {
  for (const element of document.querySelectorAll(".markdown-scroll")) {
    if (element.offsetParent === null) {
      continue;
    }
    return {
      scrollTop: element.scrollTop,
      maximumScrollTop: element.scrollHeight - element.clientHeight,
      diagramCount: element.querySelectorAll("svg").length,
    };
  }
  return null;
})()`;

const rowCountsSchema = z.array(z.number().int());
const scrollTopSchema = z.number();
const pageHeightSchema = z.number();
const documentSchema = z.object({
  scrollTop: z.number(),
  maximumScrollTop: z.number(),
  diagramCount: z.number().int(),
});

async function pageHeight(): Promise<number> {
  const probed = await lmuxWindow.webContents.executeJavaScript(
    "window.innerHeight",
  );
  return pageHeightSchema.parse(probed);
}

async function visibleDocument(): Promise<z.infer<typeof documentSchema>> {
  const probed =
    await lmuxWindow.webContents.executeJavaScript(VISIBLE_DOCUMENT);
  return documentSchema.parse(probed);
}

// The one probe that takes an argument, so its script is built rather than
// declared: the offset is our own number, in our own script.
async function scrollDocumentTo(offset: number): Promise<number> {
  const probed = await lmuxWindow.webContents.executeJavaScript(`(() => {
    for (const element of document.querySelectorAll(".markdown-scroll")) {
      if (element.offsetParent === null) {
        continue;
      }
      element.scrollTop = ${offset};
      return element.scrollTop;
    }
    return null;
  })()`);
  return scrollTopSchema.parse(probed);
}

async function visibleTerminalRows(): Promise<number> {
  const probed =
    await lmuxWindow.webContents.executeJavaScript(VISIBLE_TERMINAL_ROWS);
  const counts = rowCountsSchema.parse(probed);
  const rows = counts.at(0);
  if (rows === undefined) {
    throw new Error("no terminal is visible");
  }
  return rows;
}

function countTabs(state: LmuxState): number {
  let count = 0;
  for (const workspace of state.workspaces) {
    count += workspace.tabs.length;
  }
  return count;
}

type StateLookupOptions = {
  state: LmuxState;
  id: number;
};

// Both lookups return undefined rather than throwing: they run inside wait
// predicates, where what is being waited for legitimately does not exist yet.
function findWorkspace({
  state,
  id,
}: StateLookupOptions): WorkspaceInfo | undefined {
  for (const workspace of state.workspaces) {
    if (workspace.id === id) {
      return workspace;
    }
  }
  return undefined;
}

function findTabTitle({ state, id }: StateLookupOptions): string | undefined {
  for (const workspace of state.workspaces) {
    for (const tab of workspace.tabs) {
      if (tab.id === id) {
        return tab.title;
      }
    }
  }
  return undefined;
}

function tabIds(workspace: WorkspaceInfo): number[] {
  const ids: number[] = [];
  for (const tab of workspace.tabs) {
    ids.push(tab.id);
  }
  return ids;
}

// A new workspace announces itself, then its first shell, in two Events.
// Waiting on the tab count lands on the second one whatever the order.
async function openWorkspace(): Promise<WorkspaceInfo> {
  const tabCount = countTabs(lmuxState);
  sendCommand({ type: "new-workspace" });
  const opened = await waitForEvent(
    (event) => countTabs(event.state) === tabCount + 1,
  );
  const workspace = opened.state.workspaces.at(-1);
  if (workspace === undefined) {
    throw new Error("new-workspace opened nothing");
  }
  return workspace;
}

const POLL_INTERVAL_MS = 50;
const POLL_TIMEOUT_MS = 5000;

type PollOptions = {
  check: () => Promise<boolean>;
  description: string; // what was being waited for, for the failure message
};

// For what changes without an Event: a window's new size reaching the page,
// a terminal's rows being written out, a diagram being drawn.
async function pollUntil({ check, description }: PollOptions): Promise<void> {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (await check()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
  throw new Error(`timed out waiting for ${description}`);
}

const suite = describe("the command bus", () => {
  busTest({
    name: "tab ids stay unique across workspaces",
    body: async () => {
      const workspace = await openWorkspace();
      const tabCount = countTabs(lmuxState);
      sendCommand({ type: "new-tab" });
      const opened = await waitForEvent(
        (event) => countTabs(event.state) === tabCount + 1,
      );
      const state = opened.state;

      assert.ok(
        state.workspaces.length > 1,
        "the case needs a second workspace to be worth anything",
      );
      const ids: number[] = [];
      for (const each of state.workspaces) {
        ids.push(...tabIds(each));
      }
      assert.equal(
        new Set(ids).size,
        ids.length,
        `two tabs share an id: ${ids.join(", ")}`,
      );
      assert.equal(
        findWorkspace({ state, id: workspace.id })?.tabs.length,
        2,
        "the new tab did not land in the new workspace",
      );
    },
  });

  busTest({
    name: "switching workspaces keeps the terminals, refitted to the window",
    body: async () => {
      const first = lmuxState.workspaces.at(0);
      if (first === undefined) {
        throw new Error("no workspace to switch between");
      }
      if (lmuxState.activeWorkspaceId !== first.id) {
        sendCommand({ type: "activate-workspace", id: first.id });
        await waitForEvent(
          (event) => event.state.activeWorkspaceId === first.id,
        );
      }
      const before = findWorkspace({ state: lmuxState, id: first.id });
      if (before === undefined) {
        throw new Error(`workspace ${first.id} vanished`);
      }
      const rowsBefore = await visibleTerminalRows();

      // grow the window while this workspace is off screen, where its
      // terminals cannot see it happen
      await openWorkspace();
      const heightBefore = await pageHeight();
      const [width, height] = lmuxWindow.getSize();
      lmuxWindow.setSize(width, height + 200);
      await pollUntil({
        check: async () => (await pageHeight()) > heightBefore,
        description: "the window's new height to reach the page",
      });

      sendCommand({ type: "activate-workspace", id: first.id });
      const activated = await waitForEvent(
        (event) => event.state.activeWorkspaceId === first.id,
      );

      const after = findWorkspace({ state: activated.state, id: first.id });
      if (after === undefined) {
        throw new Error(`workspace ${first.id} vanished`);
      }
      assert.deepEqual(
        tabIds(after),
        tabIds(before),
        "switching away and back lost a tab",
      );
      // the refit is applied on activation, but xterm writes the new rows
      // out on its next frame, so this polls rather than reading once
      await pollUntil({
        check: async () => (await visibleTerminalRows()) > rowsBefore,
        description: `the terminal to refit past its old ${rowsBefore} rows`,
      });

      // hand the window back the size it was found at, so the later cases
      // measure what they expect to
      lmuxWindow.setSize(width, height);
    },
  });

  busTest({
    name: "a workspace wears its active tab's title, unless a rename pins it",
    body: async () => {
      const workspace = await openWorkspace();
      const tab = workspace.tabs.at(0);
      if (tab === undefined) {
        throw new Error("a new workspace opens with one tab");
      }

      sendCommand({ type: "set-tab-title", id: tab.id, title: "compiler" });
      await waitForEvent(
        (event) =>
          findWorkspace({ state: event.state, id: workspace.id })?.name ===
          "compiler",
      );

      sendCommand({
        type: "rename-workspace",
        id: workspace.id,
        name: "release",
      });
      await waitForEvent(
        (event) =>
          findWorkspace({ state: event.state, id: workspace.id })?.name ===
          "release",
      );

      // pinned: the tab may retitle itself all it likes
      sendCommand({ type: "set-tab-title", id: tab.id, title: "linker" });
      const retitled = await waitForEvent(
        (event) => findTabTitle({ state: event.state, id: tab.id }) === "linker",
      );
      assert.equal(
        findWorkspace({ state: retitled.state, id: workspace.id })?.name,
        "release",
        "a pinned workspace name followed its tab",
      );

      // "" unpins, and the name falls back to the tab it is wearing
      sendCommand({ type: "rename-workspace", id: workspace.id, name: "" });
      const unpinned = await waitForEvent(
        (event) => event.type === "workspace-renamed",
      );
      assert.equal(
        findWorkspace({ state: unpinned.state, id: workspace.id })?.name,
        "linker",
        "unpinning left the workspace with its pinned name",
      );
    },
  });

  busTest({
    name: "reloading a document keeps the reader's place",
    body: async () => {
      const tabCount = countTabs(lmuxState);
      sendCommand({ type: "open-markdown", path: FIXTURE_PATH });
      const opened = await waitForEvent(
        (event) => countTabs(event.state) === tabCount + 1,
      );
      if (opened.type !== "tab-opened") {
        throw new Error(`a tab arrived as a ${opened.type}`);
      }

      // mermaid replaces its fence with a drawing well after the text lands,
      // and the document grows when it does: measuring before that settles
      // would take a position against one document and check it against
      // another.
      let previousHeight = -1;
      await pollUntil({
        check: async () => {
          const probed = await visibleDocument();
          const settled =
            probed.diagramCount > 0 &&
            probed.maximumScrollTop === previousHeight;
          previousHeight = probed.maximumScrollTop;
          return settled;
        },
        description: "the drawn document's height to settle",
      });

      // Halfway, not the bottom: a position resting against the bottom moves
      // on its own whenever the viewport changes height, and the window does
      // change height under this suite. Halfway down the drawn document is
      // still far below the bottom of the undrawn one, which is what a
      // restore that ran too early would clamp to.
      const drawn = await visibleDocument();
      const target = Math.round(drawn.maximumScrollTop / 2);
      assert.ok(target > 0, "the fixture is too short to scroll");
      assert.equal(
        await scrollDocumentTo(target),
        target,
        "the document would not take the position to restore",
      );

      // the one case the state cannot answer: a reload changes none of it,
      // so the Event itself is the signal
      sendCommand({ type: "reload-markdown", id: opened.id });
      await waitForEvent((event) => event.type === "markdown-reloaded");

      const restored = await visibleDocument();
      assert.equal(
        restored.scrollTop,
        target,
        `the reload moved the reader within a document ${restored.maximumScrollTop} tall`,
      );
    },
  });

  // Last: it closes every other workspace to get to the one that matters.
  busTest({
    name: "the last workspace refuses to close",
    body: async () => {
      while (lmuxState.workspaces.length > 1) {
        const doomed = lmuxState.workspaces.at(-1);
        if (doomed === undefined) {
          break;
        }
        const remaining = lmuxState.workspaces.length - 1;
        sendCommand({ type: "close-workspace", id: doomed.id });
        await waitForEvent(
          (event) => event.state.workspaces.length === remaining,
        );
      }
      const survivor = lmuxState.workspaces.at(0);
      if (survivor === undefined) {
        throw new Error("the app closed its way down to nothing");
      }

      const tabCount = countTabs(lmuxState);
      sendCommand({ type: "close-workspace", id: survivor.id });
      // A refused Command emits nothing, so there is nothing to wait for: a
      // Command that does emit fences it, and the snapshot that one carries
      // is the proof, rather than a timeout meaning success.
      sendCommand({ type: "new-tab" });
      const fenced = await waitForEvent(
        (event) => countTabs(event.state) === tabCount + 1,
      );

      assert.equal(
        fenced.state.workspaces.length,
        1,
        "the last workspace closed",
      );
      assert.equal(fenced.state.workspaces.at(0)?.id, survivor.id);
    },
  });
});

await suite;
endRun();
