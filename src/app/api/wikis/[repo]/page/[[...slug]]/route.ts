import { createCovenWikiStore } from "@/lib/covenwiki-store";
import { covenWikiResponse } from "@/lib/server/covenwiki-response";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ repo: string; slug?: string[] }> }) {
  const { repo, slug = [] } = await params;
  return covenWikiResponse("page", () => createCovenWikiStore().page(repo, slug));
}
