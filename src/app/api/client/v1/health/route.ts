import { clientV1SuccessResponse } from "@/lib/server/client-v1/responses.ts";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  return clientV1SuccessResponse({ status: "ok" });
}
