import { sideConversationService, sideConversationRoute } from "@/lib/server/chat-side-conversations";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return sideConversationRoute(request, (body) => sideConversationService.bringBack(id, body));
}
