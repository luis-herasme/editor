// Cmd+click on a *.md path in the terminal opens it rendered. A link
// provider is xterm's hook for making arbitrary buffer text clickable.
import type { ILink, Terminal as XtermTerminal } from "@xterm/xterm";

// path-ish runs ending in .md; quotes/brackets excluded so "(see a.md)"
// matches just the path
const PATH_PATTERN = /[^\s"'`()[\]{}<>]+\.md\b/g;

const MAX_LINE_LENGTH = 4096; // don't scan pathological lines

type RegisterMarkdownLinksOptions = {
  terminal: XtermTerminal;
  openPath: (path: string) => void;
};

export function registerMarkdownLinks({
  terminal,
  openPath,
}: RegisterMarkdownLinksOptions): void {
  terminal.registerLinkProvider({
    provideLinks: (bufferLineNumber, callback) => {
      // a long path wraps across buffer rows; join the logical line
      const buffer = terminal.buffer.active;
      let firstRow = bufferLineNumber - 1;
      while (firstRow > 0 && buffer.getLine(firstRow)?.isWrapped) {
        firstRow--;
      }
      let lastRow = bufferLineNumber - 1;
      while (buffer.getLine(lastRow + 1)?.isWrapped) {
        lastRow++;
      }
      let text = "";
      for (let row = firstRow; row <= lastRow; row++) {
        const line = buffer.getLine(row);
        if (!line) {
          callback(undefined);
          return;
        }
        text += line.translateToString(row === lastRow);
      }
      if (text.length > MAX_LINE_LENGTH) {
        callback(undefined);
        return;
      }
      const links: ILink[] = [];
      for (const match of text.matchAll(PATH_PATTERN)) {
        const lastIndex = match.index + match[0].length - 1;
        links.push({
          // buffer coordinates are 1-based; the index math relies on every
          // wrapped row being exactly `cols` characters (true for the
          // single-width characters paths are made of)
          range: {
            start: {
              x: (match.index % terminal.cols) + 1,
              y: firstRow + Math.floor(match.index / terminal.cols) + 1,
            },
            end: {
              x: (lastIndex % terminal.cols) + 1,
              y: firstRow + Math.floor(lastIndex / terminal.cols) + 1,
            },
          },
          text: match[0],
          decorations: {
            pointerCursor: true,
            underline: true,
          },
          activate: (event, linkText) => {
            if (!event.metaKey) {
              return; // Cmd+click, the terminal convention
            }
            openPath(linkText);
          },
        });
      }
      if (links.length === 0) {
        callback(undefined);
        return;
      }
      callback(links);
    },
  });
}
