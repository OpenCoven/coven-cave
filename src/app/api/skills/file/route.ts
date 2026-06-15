import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import { isAllowedSkillFilePath } from "@/lib/server/skill-file-paths";

export const dynamic = "force-dynamic";

/**
 * Read a skill / harness-instructions markdown file for the Capabilities
 * inspector preview. The `path` param is constrained to the well-known harness
 * roots under $HOME by isAllowedSkillFilePath — out-of-tree paths get 403.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const target = url.searchParams.get("path");
  if (!target) {
    return NextResponse.json({ ok: false, error: "path required" }, { status: 400 });
  }
  if (!isAllowedSkillFilePath(target)) {
    return NextResponse.json({ ok: false, error: "path not allowed" }, { status: 403 });
  }
  let text: string;
  try {
    text = await readFile(target, "utf8");
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "read failed" },
      { status: 404 },
    );
  }
  return NextResponse.json({ ok: true, path: target, text });
}
