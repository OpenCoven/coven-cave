import {
  sideConversationService, sideConversationRoute, sideConversationErrorResponse,
} from "@/lib/server/chat-side-conversations";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const query = new URL(request.url).searchParams;
    return Response.json({ ok: true, ...await sideConversationService.list({
      parentSessionId: query.get("parentSessionId"), familiarId: query.get("familiarId"), projectId: query.get("projectId"),
    }, query.get("after")) });
  } catch (error) { return sideConversationErrorResponse(error); }
}

export async function POST(request: Request) {
  return sideConversationRoute(request, (body) => sideConversationService.create(body));
}
