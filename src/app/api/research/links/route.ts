import { createResearchLinksRouteHandlers } from "@/lib/server/saved-links-route";
export { createResearchLinksRouteHandlers };
export type { SaveBody, ResearchLinksRouteDependencies } from "@/lib/server/saved-links-route";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const handlers = createResearchLinksRouteHandlers();
export const GET = handlers.GET;
export const POST = handlers.POST;
export const DELETE = handlers.DELETE;
