import {
  canonicalMemoryMethodNotAllowed,
  canonicalMemoryOverviewResponse,
} from "@/lib/server/canonical-memory-gateway";
import { rejectUnverifiedMobileCanonicalMemoryRequest } from "@/lib/server/mobile-canonical-memory-request";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  const denied = rejectUnverifiedMobileCanonicalMemoryRequest(req);
  if (denied) return denied;
  return canonicalMemoryOverviewResponse();
}

export function POST() {
  return canonicalMemoryMethodNotAllowed();
}

export const HEAD = POST;
export const OPTIONS = POST;
