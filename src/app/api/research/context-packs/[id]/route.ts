import { dispatchResearchRequest } from "@/lib/server/research-package";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function GET(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  return dispatchResearchRequest("research/context-packs/[id]", "GET", request, context);
}

export function DELETE(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  return dispatchResearchRequest("research/context-packs/[id]", "DELETE", request, context);
}
