import { dispatchResearchRequest } from "@/lib/server/research-package";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function POST(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  return dispatchResearchRequest("research/topic-jobs/[id]/cancel", "POST", request, context);
}
