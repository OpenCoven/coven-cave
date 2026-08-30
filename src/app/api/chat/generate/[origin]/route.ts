import { postChatForGeneration } from "../../send/route";
import { isProjectlessGenerationOrigin } from "@/lib/chat-origins";
import type { SessionOrigin } from "@/lib/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Dedicated generation surface (cave-cst0g).
 *
 * A brand-new conversation's provenance is server-owned: the route that
 * received the request IS the authenticated surface. This route is the ONLY
 * path allowed to mint a projectless generation origin — the path segment
 * names it (canvas | journal | enhance), and the shared chat-send handler
 * stamps it instead of trusting any origin claim in the request body.
 * /api/chat/send (the chat surface) mints no projectless origin at all, so a
 * caller can no longer label a new conversation as a hidden generation to
 * suppress the knowledge vault or keep it out of the chat lists.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ origin: string }> },
) {
  const { origin } = await params;
  if (!isProjectlessGenerationOrigin(origin as SessionOrigin)) {
    return new Response(
      JSON.stringify({
        ok: false,
        error: "unknown generation origin",
      }),
      { status: 400, headers: { "content-type": "application/json" } },
    );
  }
  return postChatForGeneration(req, origin as SessionOrigin);
}
