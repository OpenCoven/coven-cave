import { dispatchResearchRequest } from "@/lib/server/research-package";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function GET(request: Request): Promise<Response> {
  return dispatchResearchRequest("research/generations", "GET", request);
}

export function POST(request: Request): Promise<Response> {
  return dispatchResearchRequest("research/generations", "POST", request);
}

export function DELETE(request: Request): Promise<Response> {
  return dispatchResearchRequest("research/generations", "DELETE", request);
}
