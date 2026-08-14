import { NextResponse } from "next/server";
import { restoreCards, type Card } from "@/lib/cave-board";

/**
 * Put whole cards back under their original ids.
 *
 * Undo previously re-created cleared cards through `POST /api/board`, which
 * mints a fresh id and accepts only a subset of fields — so every Bead and
 * GitHub reference to the old id broke, and step state, Asana links,
 * dependencies and lifecycle history were dropped on the floor (cave-xddxs).
 *
 * Restore is additive by construction: an id that is currently live is reported
 * back as `skipped` rather than overwritten, so this can never clobber a card
 * that returned by some other route while the undo banner was still up.
 */
export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json body" }, { status: 400 });
  }
  const cards = (body as { cards?: unknown })?.cards;
  if (!Array.isArray(cards)) {
    return NextResponse.json({ ok: false, error: "cards array required" }, { status: 400 });
  }
  const usable = cards.filter(
    (card): card is Card =>
      Boolean(card) && typeof card === "object" && typeof (card as Card).id === "string",
  );
  if (usable.length === 0) {
    return NextResponse.json({ ok: false, error: "no restorable cards" }, { status: 400 });
  }
  const { restored, skipped } = await restoreCards(usable);
  return NextResponse.json({ ok: true, restored, skipped });
}
