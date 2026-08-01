import { readJsonBody, rejectNonLocalRequest } from "@/lib/server/api-security";
import {
  createXOAuthStartRouteHandlers,
  type XOAuthStartBody,
} from "@/lib/server/x-oauth-start-route";
import { xOAuthService } from "@/lib/server/x-oauth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const handlers = createXOAuthStartRouteHandlers({
  rejectNonLocalRequest,
  readJsonBody: (req, maxBytes) => readJsonBody<XOAuthStartBody>(req, maxBytes),
  start: (input) => xOAuthService.start(input),
  cancel: (flowId) => xOAuthService.cancel(flowId),
});

export async function POST(req: Request) {
  return handlers.POST(req);
}

export async function DELETE(req: Request) {
  return handlers.DELETE(req);
}
