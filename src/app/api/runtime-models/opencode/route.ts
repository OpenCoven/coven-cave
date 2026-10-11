import { GET as getRuntimeInventory } from "../[runtime]/route";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  return getRuntimeInventory(req, { params: Promise.resolve({ runtime: "opencode" }) });
}
