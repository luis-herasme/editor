import { ipcMain } from "electron";
import { readFile, stat } from "fs/promises";
import * as path from "path";
import * as os from "os";
import { getShellCwd } from "./shells.js";
import type { ReadFileRequest, ReadFileResult } from "../ipc/bridge.js";

const MAX_FILE_BYTES = 5_000_000; // rendering a huge file would freeze the page

ipcMain.handle(
  "file:read",
  async (_event, request: ReadFileRequest): Promise<ReadFileResult> => {
    let filePath = request.path;
    if (filePath.startsWith("~/")) {
      filePath = path.join(os.homedir(), filePath.slice(2));
    }
    if (!path.isAbsolute(filePath)) {
      let base: string | undefined;
      if (request.baseTabId !== undefined) {
        base = await getShellCwd(request.baseTabId);
      }
      if (!base) {
        return {
          error: `Can't resolve ${request.path}: the tab's shell directory is unknown`,
        };
      }
      filePath = path.resolve(base, filePath);
    }
    // collapses "..": a link inside a document resolves against that
    // document's directory and can point upwards out of it
    filePath = path.resolve(filePath);
    try {
      const stats = await stat(filePath);
      if (stats.size > MAX_FILE_BYTES) {
        return { error: `${filePath} is too large to render` };
      }
      const content = await readFile(filePath, "utf8");
      return {
        resolvedPath: filePath,
        content,
      };
    } catch (error) {
      return { error: String(error) };
    }
  },
);
