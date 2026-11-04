import { salemRetiredResponse } from "@/lib/server/salem-retired";

export const dynamic = "force-dynamic";

export async function POST(_request: Request) {
  return salemRetiredResponse();
}
