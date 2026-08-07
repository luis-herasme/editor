// The cases run inside the real app: `npm test` starts Electron with
// src/test as its entry, so the window, the preload, the shells and the menu
// are the ones `npm start` produces. This module boots that app, and hands
// the suite a window, a way to wait for Events, and the tally npm test exits
// on.
import { app, BrowserWindow, ipcMain } from "electron";
import { test } from "node:test";
import * as path from "path";
import type { Command, LmuxEvent } from "../api.js";

// A throwaway profile: a run must not read or write the settings and window
// geometry of the app you actually use, and a fresh one starts at a known
// size with default settings.
app.setPath("userData", path.join(app.getPath("temp"), "lmux-test-profile"));

// Watching the bus

const WAIT_TIMEOUT_MS = 5000;

type Waiter = {
  predicate: (event: LmuxEvent) => boolean;
  resolve: (event: LmuxEvent) => void;
  timer: NodeJS.Timeout;
};

const waiters: Waiter[] = [];
let lastEvent: LmuxEvent | undefined;

// main/bus.ts keeps its own listener on this channel; a second one costs
// nothing, so the harness watches the bus without the app knowing.
ipcMain.on("event", (_ipcEvent, lmuxEvent: LmuxEvent) => {
  lastEvent = lmuxEvent;
  const matched: Waiter[] = [];
  for (const waiter of waiters) {
    if (!waiter.predicate(lmuxEvent)) {
      continue;
    }
    matched.push(waiter);
  }
  for (const waiter of matched) {
    waiters.splice(waiters.indexOf(waiter), 1);
    clearTimeout(waiter.timer);
    waiter.resolve(lmuxEvent);
  }
});

// Wait on state, not on event types, wherever the state can say it: one
// Command can emit several Events (new-workspace emits workspace-opened,
// then tab-opened for the shell it creates), and a derived change rides out
// in the Event that caused it. The waiter is registered synchronously, so a
// Command sent just before the await cannot be answered in between.
export function waitForEvent(
  predicate: (event: LmuxEvent) => boolean,
): Promise<LmuxEvent> {
  return new Promise((resolve, reject) => {
    const waiter: Waiter = {
      predicate,
      resolve,
      timer: setTimeout(() => {
        const index = waiters.indexOf(waiter);
        if (index !== -1) {
          waiters.splice(index, 1);
        }
        reject(
          new Error(
            `no matching Event in ${WAIT_TIMEOUT_MS}ms; the last one was ${JSON.stringify(lastEvent)}`,
          ),
        );
      }, WAIT_TIMEOUT_MS),
    };
    waiters.push(waiter);
  });
}

// Booting the app

// Dynamic, so the profile above is set before main's modules read paths off
// it at import time (window-state.ts computes its file path that way).
await import("../main/index.js");
await app.whenReady();

const openWindows = BrowserWindow.getAllWindows();
if (openWindows.length === 0) {
  throw new Error("lmux booted without a window");
}

export const lmuxWindow = openWindows[0];

// Layout-reactive code (ResizeObserver delivery, xterm's fit) rides the
// render loop, which a throttled or occluded window stops running: without
// these, the cases that measure a pane read as false failures.
lmuxWindow.webContents.setBackgroundThrottling(false);
lmuxWindow.setAlwaysOnTop(true);
lmuxWindow.show();
lmuxWindow.focus();

// The renderer opens its first workspace, and its first shell, on boot.
await waitForEvent((event) => event.type === "tab-opened");

// webContents.send takes `any`, so this is the one place a Command sent by a
// case is still checked against the API it is exercising. Sent straight to
// the window rather than through main's dispatch, which targets whichever
// window has OS focus and drops everything when that is none.
export function sendCommand(command: Command): void {
  lmuxWindow.webContents.send("command", command);
}

// Reporting

// node:test's root suite never finishes inside Electron: it ends when the
// event loop drains, which an app's never does. So it prints no summary and
// sets no exit code, and these are what `npm test` reports instead.
let passCount = 0;
let failureCount = 0;
let suiteFinished = false;

type BusTestOptions = {
  name: string;
  body: () => Promise<void>;
};

export function busTest({ name, body }: BusTestOptions): void {
  test(name, async () => {
    try {
      await body();
    } catch (error) {
      failureCount += 1;
      // node:test holds failure detail for the summary it never prints here,
      // so this would otherwise be a bare ✖ with no reason given
      console.error(`\n${name}:`, error);
      throw error;
    }
    passCount += 1;
  });
}

// A regression can end a run on its own: the app closes its window once
// nothing is left to show, which quits it. Without this the process would
// exit 0 in the middle of the suite, having reported nothing at all.
app.on("before-quit", () => {
  if (suiteFinished) {
    return;
  }
  console.error("\nthe app quit before the suite finished");
  app.exit(1);
});

// The suite ends here rather than by returning: nothing else stops an app.
export function endRun(): void {
  suiteFinished = true;
  console.log(`\n${passCount} passed, ${failureCount} failed`);
  let exitCode = 0;
  if (failureCount > 0) {
    exitCode = 1;
  }
  // exit, not quit: the window's close handler asks about running processes,
  // and there is nobody here to answer it
  app.exit(exitCode);
}
