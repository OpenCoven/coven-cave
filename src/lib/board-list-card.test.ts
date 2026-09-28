// @ts-nocheck
// #5690: the board list leaves out Enhance history; the inspector merges it back.
import assert from "node:assert/strict";
import test from "node:test";
import { toBoardListCard, withAgenticEnhance } from "./board-list-card.ts";

const enhance = { proposals: [{ id: "p1", state: "blocked", needsHuman: true }], audit: [{ proposalId: "p1" }] };
const card = { id: "c1", title: "Task", updatedAt: "2026-09-28T00:00:00Z", agenticEnhance: enhance };

test("the list card drops only agenticEnhance", () => {
  const lean = toBoardListCard(card);
  assert.equal("agenticEnhance" in lean, false);
  assert.deepEqual(lean, { id: "c1", title: "Task", updatedAt: "2026-09-28T00:00:00Z" });
  assert.equal(card.agenticEnhance, enhance, "the stored card is not mutated");
  const plain = { id: "c2", title: "No history" };
  assert.equal(toBoardListCard(plain), plain);
});

test("the inspector card carries the newest Enhance state it knows", () => {
  const lean = toBoardListCard(card);
  assert.equal(withAgenticEnhance(lean, null), lean, "nothing loaded yet: the list card as is");
  assert.deepEqual(withAgenticEnhance(lean, enhance).agenticEnhance, enhance, "a lean card gets the loaded state");
  const newer = { proposals: [], audit: [] };
  assert.equal(withAgenticEnhance({ ...card, agenticEnhance: newer }, enhance).agenticEnhance, newer, "a card that carries state wins");
});

test("the inspector loads its own card in full and keeps it on mutation", async () => {
  const { readFileSync } = await import("node:fs");
  const source = readFileSync(new URL("../components/board-inspector.tsx", import.meta.url), "utf8");
  assert.match(source, /fetch\(`\/api\/board\/\$\{encodeURIComponent\(cardId\)\}`/, "the inspector fetches the full card");
  assert.match(source, /\}, \[cardId, cardUpdatedAt\]\);/, "it refreshes when the card changes");
  assert.match(source, /const card = withAgenticEnhance\(listCard, loadedEnhance\);/, "the rendered card carries the loaded history");
  assert.match(source, /if \(next\.id === cardId\) setLoadedEnhance\(next\.agenticEnhance \?\? null\);/, "mutation responses update it directly");
});
