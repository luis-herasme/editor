import type { ILink, Terminal as XtermTerminal } from "@xterm/xterm";

// path-ish runs ending in .md; excludes brackets so "(see a.md)" matches
const PATH_PATTERN = /[^\s"'`()[\]{}<>]+\.md\b/g;

const MAX_LINE_LENGTH = 4096;

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
      // a wrapped path spans multiple buffer rows; join them
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
          // buffer coords are 1-based; index math assumes single-width chars
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
              return;
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
