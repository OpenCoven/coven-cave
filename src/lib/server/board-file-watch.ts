/**
 * Publishes `board` when board.json changes on disk (#5858).
 *
 * A board save in this process already publishes through saveBoard (#5835).
 * This watch covers every other writer: a second Cave server sharing the home
 * (a dev server beside the installed app), or any tool editing the file. Only
 * because every writer is covered may the Board pause its poll in `primary`
 * mode. A save in this process publishes twice; the client coalesces the
 * pair within 100 ms into one refresh.
 */

import path from "node:path";
import { caveHome } from "../coven-paths.ts";
import { markResourceChanged } from "./cave-event-plane-publisher.ts";
import { createFamiliarRosterWatch, watchDirectoryWithFs, type FamiliarRosterWatch } from "./familiar-roster-watch.ts";

export function boardSourceFile(): string {
  return path.join(caveHome(), "board.json");
}

export function startBoardFileWatch(): FamiliarRosterWatch {
  return createFamiliarRosterWatch({
    files: [boardSourceFile()],
    watchDirectory: watchDirectoryWithFs,
    publish: () => {
      markResourceChanged("board");
    },
  });
}
