import { salemRetiredResponse } from "@/lib/server/salem-retired";

export const dynamic = "force-dynamic";

export async function GET(_request: Request) {
  return salemRetiredResponse();
}

export async function POST(_request: Request) {
  return salemRetiredResponse();
}
