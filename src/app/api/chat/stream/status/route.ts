import { getRunBufferStatus } from "../../../../../lib/server/chat-stream-buffer.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const key = url.searchParams.get("runId")?.trim() || url.searchParams.get("sessionId")?.trim();
  if (!key) {
    return Response.json({ ok: false, error: "runId or sessionId required" }, { status: 400 });
  }

  return Response.json({
    ok: true,
    status: getRunBufferStatus(key),
  });
}
