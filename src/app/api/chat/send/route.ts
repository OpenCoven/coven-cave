import { executeChatSend } from "@/lib/server/chat-send-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: Request): Promise<Response> {
  return executeChatSend(req);
}
