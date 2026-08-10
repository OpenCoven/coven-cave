import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

// Point the store at a scratch Cave home BEFORE importing it — the module
// resolves board.json from caveHome() at import time.
const home = await mkdtemp(path.join(tmpdir(), "cave-backfill-idem-"));
process.env.COVEN_CAVE_HOME = home;
process.env.CAVE_HOME = home;

const { loadBoard, saveBoard } = await import("./cave-board.ts");

/**
 * backfillCard must be a fixed point (cave-0b8t8).
 *
 * It was not. Both link merges resolve a clash with
 * `title: item.title || previous.title`, so the incoming value wins whenever it
 * is non-empty — right when the incoming link is fresh data from Asana or
 * GitHub, wrong when it was invented from a URL. The URL derivations always
 * invent a title, and backfill folded them back in, so a human-authored title
 * survived exactly ONE load and was then replaced by a placeholder.
 *
 * These drive the public save/load path rather than the private function: the
 * defect's whole point is that an ordinary reload loses data, so the test that
 * matters exercises an ordinary reload.
 */

const BASE_CARD = {
  id: "card-1",
  title: "Ship retention",
  status: "todo",
  lifecycle: "todo",
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-01T00:00:00.000Z",
};

async function writeBoard(cards: unknown[]): Promise<void> {
  await mkdir(home, { recursive: true });
  await writeFile(path.join(home, "board.json"), JSON.stringify({ cards }), "utf8");
}

// ── A stored Asana title survives repeated loads ──────────────────────────────
{
  await writeBoard([
    {
      ...BASE_CARD,
      links: ["https://app.asana.com/0/1200/1201"],
      asana: [
        {
          id: "asana:task:1201",
          url: "https://app.asana.com/0/1200/1201",
          gid: "1201",
          kind: "task",
          title: "Ship retention",
        },
      ],
    },
  ]);

  const first = await loadBoard();
  assert.equal(
    first.cards[0].asana?.[0]?.title,
    "Ship retention",
    "the stored title must survive the first load",
  );

  // Write the loaded card back verbatim and load again. This is the cleanest
  // statement of the bug: same bytes in, different card out.
  await saveBoard(first);
  const second = await loadBoard();
  assert.equal(
    second.cards[0].asana?.[0]?.title,
    "Ship retention",
    "the stored title must survive a round-trip — it became 'Asana task 1201'",
  );

  await saveBoard(second);
  const third = await loadBoard();
  assert.deepEqual(third.cards, second.cards, "load is a fixed point after the first normalisation");
}

// ── The same for GitHub, which shares the derive-and-merge shape ──────────────
{
  await writeBoard([
    {
      ...BASE_CARD,
      id: "card-2",
      links: ["https://github.com/OpenCoven/coven-cave/pull/4534"],
      github: [
        {
          id: "github:pull:OpenCoven/coven-cave:4534",
          url: "https://github.com/OpenCoven/coven-cave/pull/4534",
          repo: "OpenCoven/coven-cave",
          kind: "pull",
          number: 4534,
          title: "Fix the claim guard",
        },
      ],
    },
  ]);

  const first = await loadBoard();
  await saveBoard(first);
  const second = await loadBoard();
  assert.equal(
    second.cards[0].github?.[0]?.title,
    "Fix the claim guard",
    "a stored GitHub title must not be replaced by the derived 'repo #number'",
  );
}

// ── A URL with no stored counterpart is still backfilled ──────────────────────
// The fix must not stop derivation working; it must only stop it overwriting.
{
  await writeBoard([
    {
      ...BASE_CARD,
      id: "card-3",
      links: ["https://app.asana.com/0/1200/1301"],
    },
  ]);

  const board = await loadBoard();
  const asana = board.cards[0].asana ?? [];
  assert.equal(asana.length, 1, "a bare Asana URL still becomes a first-class connection");
  assert.equal(asana[0].gid, "1301");
  assert.equal(asana[0].title, "Asana task 1301", "with its derived title, since nothing was stored");
}

console.log("cave-board-backfill-idempotence: all assertions passed");
