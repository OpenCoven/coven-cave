import { NextResponse } from "next/server";
import {
  CraftTransactionError,
  craftTransactionStatus,
} from "@/lib/server/craft-install";
import { craftInstallService } from "@/lib/server/craft-install-service";
import { planCraftDraft } from "@/lib/server/craft-draft-plan";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get("id")?.trim() ?? "";
  if (!id) return NextResponse.json({ ok: false, error: "id required" }, { status: 400 });
  try {
    return NextResponse.json({ ok: true, plan: await craftInstallService.plan(id) });
  } catch (error) {
    if (error instanceof CraftTransactionError) {
      // Draft fallback (docs/craft-ux.md F1): local drafts aren't in the
      // catalog, but the agent briefs (and the draft detail) verify them
      // here. Resolve what the catalog can and name the rest honestly.
      if (error.code === "unknown_craft") {
        const draftPlan = await planCraftDraft(id);
        if (draftPlan) {
          return NextResponse.json({
            ok: true,
            draft: true,
            plan: draftPlan.plan,
            draftDiagnostics: draftPlan.draftDiagnostics,
          });
        }
      }
      return NextResponse.json(
        { ok: false, error: error.message, code: error.code, diagnostic: error.diagnostic },
        { status: craftTransactionStatus(error.code) },
      );
    }
    return NextResponse.json({ ok: false, error: "install plan unavailable" }, { status: 500 });
  }
}
