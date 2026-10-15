import { dispatchResearchRequest } from "@/lib/server/research-package";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function POST(request: Request): Promise<Response> {
  return dispatchResearchRequest("research/resources/search", "POST", request);
}
