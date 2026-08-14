import { NextResponse } from "next/server.js";

import { XApiError } from "../x-api.ts";

const MAX_BODY_BYTES = 1024;
const FLOW_ID_PATTERN = /^[A-Za-z0-9_-]{43}$/;
export type XOAuthStartBody = { capability?: unknown; flowId?: unknown };

type XOAuthStartRouteDependencies = {
  rejectNonLocalRequest(req: Request): NextResponse | null;
  readJsonBody(req: Request, maxBytes: number): Promise<
    | { ok: true; body: XOAuthStartBody }
    | { ok: false; response: NextResponse }
  >;
  start(input: { capability: "research" | "publish"; flowId: string }): Promise<Record<string, unknown>>;
  cancel(flowId: string): boolean;
};

export function createXOAuthStartRouteHandlers(
  dependencies: XOAuthStartRouteDependencies,
) {
  async function POST(req: Request) {
    const forbidden = dependencies.rejectNonLocalRequest(req);
    if (forbidden) return forbidden;
    const parsed = await dependencies.readJsonBody(req, MAX_BODY_BYTES);
    if (!parsed.ok) return parsed.response;
    const capability = parsed.body.capability;
    const flowId = parsed.body.flowId;
    if (capability !== "research" && capability !== "publish") {
      return NextResponse.json({ ok: false, error: "capability must be research or publish" }, { status: 400 });
    }
    if (typeof flowId !== "string" || !FLOW_ID_PATTERN.test(flowId)) {
      return NextResponse.json({ ok: false, error: "flowId must be a valid X OAuth flow ID" }, { status: 400 });
    }
    try {
      return NextResponse.json({ ok: true, ...await dependencies.start({ capability, flowId }) });
    } catch (error) {
      if (error instanceof XApiError) {
        return NextResponse.json({ ok: false, error: error.safeMessage, code: error.code }, { status: 400 });
      }
      return NextResponse.json({ ok: false, error: "X authorization could not be started" }, { status: 500 });
    }
  }

  async function DELETE(req: Request) {
    const forbidden = dependencies.rejectNonLocalRequest(req);
    if (forbidden) return forbidden;
    const parsed = await dependencies.readJsonBody(req, MAX_BODY_BYTES);
    if (!parsed.ok) return parsed.response;
    const flowId = parsed.body.flowId;
    if (typeof flowId !== "string" || !FLOW_ID_PATTERN.test(flowId)) {
      return NextResponse.json({ ok: false, error: "flowId must be a valid X OAuth flow ID" }, { status: 400 });
    }
    return NextResponse.json({ ok: true, cancelled: dependencies.cancel(flowId) });
  }

  return { POST, DELETE };
}
