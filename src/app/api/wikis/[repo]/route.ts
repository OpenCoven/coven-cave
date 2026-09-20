import { createCovenWikiStore } from "@/lib/covenwiki-store";
import { covenWikiResponse } from "@/lib/server/covenwiki-response";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ repo: string }> }) {
  const { repo } = await params;
  return covenWikiResponse("manifest", () => createCovenWikiStore().manifest(repo));
}
