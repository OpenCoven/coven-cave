// @ts-nocheck
//
// Guard (#6562): a native Chat task is reserved before its first prompt is
// sent, so the Board dispatches it only once that prompt lands (its
// conversation appears in the session list), asking the server to re-check
// readiness under the board lock. A refusal's updated card is applied at once.
//
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const board = (await readFile(new URL("./board-view.tsx", import.meta.url), "utf8")).replace(/\s+/g, " ");

assert.match(
  board,
  /if \(!pendingBridgeStart \|\| !sessions\.some\(\(session\) => session\.id === pendingBridgeStart\.sessionId\)\) return;/,
  "dispatch waits until the first prompt's conversation exists",
);
assert.match(
  board,
  /fetch\(`\/api\/board\/\$\{encodeURIComponent\(cardId\)\}\/lifecycle`, \{ method: "POST",[\s\S]{0,200}body: JSON\.stringify\(\{ to: "dispatched", onlyIfReady: true,/,
  "the Board asks for a guarded dispatch, never an unconditional one",
);
assert.match(board, /setPendingBridgeStart\(null\); void \(async \(\) => \{/, "the handoff is cleared before the request, so it runs once");
assert.match(
  board,
  /const refusedCard = json\.card; if \(refusedCard\) setCards\(\(prev\) => prev\.map\(\(candidate\) => candidate\.id === id \? refusedCard : candidate\)\);/,
  "a refusal's recorded blocker shows without waiting for a reload",
);
