import { readJsonBody, rejectNonLocalRequest } from "@/lib/server/api-security";
import { xOAuthService } from "@/lib/server/x-oauth";
import {
  createXOAuthStartRouteHandlers,
  type XOAuthStartBody,
} from "@/lib/server/x-oauth-start-route";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// cave-lsj8u: the handler logic already lives in x-oauth-start-route.ts,
// dependency-injected so it can be tested without a server. This file is only
// the wiring, deliberately — an earlier version of this route (on tag
// archive/cave-8i8q5-wip-2026-07-29) predates that extraction and accepted
// `capability` alone. The lib requires a `flowId` too and adds DELETE to
// cancel a flow, so restoring that older file would have regressed against
// main's own tested contract.
const handlers = createXOAuthStartRouteHandlers({
  rejectNonLocalRequest,
  readJsonBody: (req, maxBytes) => readJsonBody<XOAuthStartBody>(req, maxBytes),
  start: ({ capability, flowId }) => xOAuthService.start({ capability, flowId }),
  cancel: (flowId) => xOAuthService.cancel(flowId),
});

export const POST = handlers.POST;
export const DELETE = handlers.DELETE;
