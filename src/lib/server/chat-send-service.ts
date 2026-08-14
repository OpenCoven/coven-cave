import { executeChatSend as executeCanonicalChatSend } from "@/app/api/chat/send/route";

/**
 * Stable server-side entrypoint for clients that cannot call the App Router
 * module directly.
 */
export async function executeChatSend(req: Request): Promise<Response> {
  return executeCanonicalChatSend(req);
}
