import { NextResponse } from "next/server";
import { readJsonBody, rejectNonLocalRequest } from "@/lib/server/api-security";
import {
  buildSkill,
  SKILL_BUILD_ROOTS,
  type SkillBuildInput,
  type SkillBuildRootId,
} from "@/lib/server/skill-build";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Instructions cap is 64 KB; leave headroom for the JSON envelope.
const MAX_BODY_BYTES = 128 * 1024;

type BuildBody = {
  name?: unknown;
  description?: unknown;
  instructions?: unknown;
  root?: unknown;
  tags?: unknown;
};

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asTags(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string");
}

/**
 * POST /api/skills/build — write a new `<root>/<slug>/SKILL.md` for the
 * Marketplace Build tab. Filesystem write → local-origin gated (same policy
 * as DELETE /api/skills/local). Creation-only: an existing skill id in the
 * chosen root returns 409 and never overwrites.
 */
export async function POST(req: Request) {
  const forbidden = rejectNonLocalRequest(req);
  if (forbidden) return forbidden;

  const parsed = await readJsonBody<BuildBody>(req, MAX_BODY_BYTES);
  if (!parsed.ok) return parsed.response;

  const root = asString(parsed.body.root) || "coven";
  if (!SKILL_BUILD_ROOTS.some((entry) => entry.id === root)) {
    return NextResponse.json({ ok: false, error: "unknown destination root" }, { status: 400 });
  }

  const input: SkillBuildInput = {
    name: asString(parsed.body.name),
    description: asString(parsed.body.description),
    instructions: asString(parsed.body.instructions),
    root: root as SkillBuildRootId,
    tags: asTags(parsed.body.tags),
  };

  const result = await buildSkill(input);
  if (!result.ok) {
    const status = result.code === "invalid" ? 400 : result.code === "exists" ? 409 : 500;
    return NextResponse.json({ ok: false, error: result.error, code: result.code }, { status });
  }

  return NextResponse.json({ ok: true, slug: result.slug, path: result.path, dir: result.dir });
}
