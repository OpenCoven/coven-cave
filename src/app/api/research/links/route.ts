import { dispatchResearchRequest } from "@/lib/server/research-package";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function GET(request: Request): Promise<Response> {
  return dispatchResearchRequest("research/links", "GET", request);
}

export function POST(request: Request): Promise<Response> {
  return dispatchResearchRequest("research/links", "POST", request);
}

export function DELETE(request: Request): Promise<Response> {
  return dispatchResearchRequest("research/links", "DELETE", request);
}
