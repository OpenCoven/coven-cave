import { NextResponse } from "next/server";
import { buildPromptEnhancement } from "@/lib/prompt-enhancer";

type EnhanceRouteBody = {
  draft?: unknown;
  mode?: unknown;
  context?: unknown;
};

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as EnhanceRouteBody;
  const result = buildPromptEnhancement({
    draft: body.draft,
    mode: body.mode,
    context: body.context,
  });

  if (!result.ok) {
    return NextResponse.json(result, { status: 400 });
  }

  return NextResponse.json(result);
}
