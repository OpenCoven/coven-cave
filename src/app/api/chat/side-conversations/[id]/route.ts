import { sideConversationService, sideConversationRoute, sideConversationErrorResponse } from "@/lib/server/chat-side-conversations";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const query = new URL(request.url).searchParams;
    return Response.json({ ok: true, ...await sideConversationService.get(id, {
      parentSessionId: query.get("parentSessionId"), familiarId: query.get("familiarId"), projectId: query.get("projectId"),
    }) });
  } catch (error) { return sideConversationErrorResponse(error); }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return sideConversationRoute(request, (body) => sideConversationService.lifecycle(id, body));
}
