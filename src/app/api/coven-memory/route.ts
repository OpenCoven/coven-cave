import {
  canonicalMemoryJson,
  canonicalMemoryListResponse,
  canonicalMemoryMethodNotAllowed,
} from "@/lib/server/canonical-memory-gateway";
import { rejectNonLocalRequest } from "@/lib/server/api-security";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  const denied = rejectNonLocalRequest(req);
  if (denied) {
    return canonicalMemoryJson(
      { ok: false, code: "local_access_required" },
      403,
    );
  }
  return canonicalMemoryListResponse();
}

export function POST() {
  return canonicalMemoryMethodNotAllowed();
}
