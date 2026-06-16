import { NextResponse } from "next/server";
import { evaluateFamiliarContract } from "@/lib/familiar-contract";
import { isValidFamiliarId, readFamiliarContractFiles } from "@/lib/server/familiar-contract-files";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Run the Familiar Contract v0.1.0 adherence check for a familiar.
 *
 * Reads the familiar's identity files (SOUL.md, IDENTITY.md, ward.toml,
 * MEMORY.md) from its workspace and evaluates them against the five-property
 * normative core. Returns the full report — per-property coverage, hard
 * violations, and warnings — so the Studio "Contract" tab can render it.
 *
 * The `id` path segment is the only user-controlled input; it is constrained to
 * a strict familiar-slug allow-list (see `isValidFamiliarId`). An id that could
 * escape the workspace root is rejected with 403 ("path not allowed") rather
 * than read.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!id || !isValidFamiliarId(id)) {
    return NextResponse.json({ ok: false, error: "path not allowed" }, { status: 403 });
  }

  const { workspace, files } = await readFamiliarContractFiles(id);
  const report = evaluateFamiliarContract(files);
  const present = {
    soul: files.soul !== null,
    identity: files.identity !== null,
    ward: files.ward !== null,
    memory: files.memory !== null,
  };

  return NextResponse.json({ ok: true, id, workspace, present, report });
}
