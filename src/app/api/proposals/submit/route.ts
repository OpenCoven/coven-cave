import { NextResponse } from "next/server.js";
import { readJsonBody, rejectNonLocalRequest } from "@/lib/server/api-security";
import { parseProposalSubmission, PROPOSAL_REQUEST_MAX_BYTES } from "@/lib/proposal-submission";
import { forwardProposalSubmission } from "@/lib/server/proposal-submission";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: Request) {
  const rejected = rejectNonLocalRequest(req);
  if (rejected) return rejected;
  const parsed = await readJsonBody<unknown>(req, PROPOSAL_REQUEST_MAX_BYTES);
  if (!parsed.ok) return parsed.response;
  const input = parseProposalSubmission(parsed.body);
  if (!input) return NextResponse.json({ error: "Invalid familiar, relative file path, or file contents." }, { status: 400 });
  const outcome = await forwardProposalSubmission(input);
  return NextResponse.json(outcome, { status: outcome.kind === "unknown" || outcome.kind === "unavailable" ? 503 : 200 });
}
