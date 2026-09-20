import { createCovenWikiStore } from "@/lib/covenwiki-store";
import { covenWikiResponse } from "@/lib/server/covenwiki-response";

export const dynamic = "force-dynamic";

export async function GET() {
  return covenWikiResponse("wikis", () => createCovenWikiStore().list());
}
