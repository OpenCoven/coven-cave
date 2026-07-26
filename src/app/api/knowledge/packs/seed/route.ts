import { NextResponse } from "next/server";
import { isValidPackSlug, type KnowledgePackSeedRequest } from "@/lib/knowledge-pack-types";
import { readJsonBody, rejectNonLocalRequest } from "@/lib/server/api-security";
import { readKnowledgePack, seedKnowledgePack } from "@/lib/server/knowledge-packs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_BODY_BYTES = 32 * 1024;

type SeedBody = Partial<KnowledgePackSeedRequest>;

export async function POST(req: Request) {
  const forbidden = rejectNonLocalRequest(req);
  if (forbidden) return forbidden;

  const parsed = await readJsonBody<SeedBody>(req, MAX_BODY_BYTES);
  if (!parsed.ok) return parsed.response;

  const body = parsed.body;
  const packId = typeof body.packId === "string" ? body.packId.trim() : "";
  if (!isValidPackSlug(packId)) return NextResponse.json({ ok: false, error: "invalid pack id" }, { status: 400 });
  if (!(await readKnowledgePack(packId))) return NextResponse.json({ ok: false, error: "unknown pack" }, { status: 404 });

  try {
    if (body.target === "vault") {
      return NextResponse.json(await seedKnowledgePack({ packId, target: "vault" }));
    }
    if (body.target === "project") {
      const projectRoot = typeof body.projectRoot === "string" ? body.projectRoot : "";
      const subfolder = typeof body.subfolder === "string" && body.subfolder.trim() ? body.subfolder.trim() : undefined;
      if (!projectRoot.trim()) return NextResponse.json({ ok: false, error: "projectRoot required" }, { status: 400 });
      return NextResponse.json(await seedKnowledgePack({ packId, target: "project", projectRoot, ...(subfolder ? { subfolder } : {}) }));
    }
    return NextResponse.json({ ok: false, error: "invalid target" }, { status: 400 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "seed failed";
    const status = message === "unknown pack" ? 404 : 400;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
