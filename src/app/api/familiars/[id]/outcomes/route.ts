import { NextResponse } from "next/server";
import { loadBoard } from "@/lib/cave-board";
import { summarizeFamiliarOutcomes, type FamiliarOutcome } from "@/lib/familiar-outcomes";
import { redactSecretText } from "@/lib/secret-redaction";
import { listSelfReports } from "@/lib/server/familiar-self-reports";
import { loadMessageFeedback } from "@/lib/server/message-feedback-store";
import { isValidFamiliarId } from "@/lib/server/familiar-id";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Redact the prose fields only. The generic deep redactor treats `sessionId`
// as a session secret and would erase the thread link this route exists to
// provide (the #5666 failure). Ids and URLs here are not secrets.
function redactOutcome(outcome: FamiliarOutcome): FamiliarOutcome {
  return {
    ...outcome,
    ...(outcome.cardTitle ? { cardTitle: redactSecretText(outcome.cardTitle) } : {}),
    ...(outcome.detail ? { detail: redactSecretText(outcome.detail) } : {}),
  };
}

/**
 * GET /api/familiars/[id]/outcomes
 *
 * What actually happened to this familiar's work (accepted or rejected, from
 * Board lifecycle, GitHub PR state, and thumbs votes in chat), and how well its self-reported
 * confidence predicted that. See src/lib/familiar-outcomes.ts for the rules.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!isValidFamiliarId(id)) {
    return NextResponse.json({ ok: false, error: "path not allowed" }, { status: 403 });
  }
  const [board, reports, feedback] = await Promise.all([
    loadBoard(),
    listSelfReports(id, { limit: "all" }),
    loadMessageFeedback(),
  ]);
  const summary = summarizeFamiliarOutcomes(id, board.cards, reports.reports, feedback);
  return NextResponse.json({
    ok: true,
    ...summary,
    outcomes: summary.outcomes.map(redactOutcome),
  });
}
