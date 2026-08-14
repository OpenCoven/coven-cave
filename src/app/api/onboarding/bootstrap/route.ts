import { createOnboardingBootstrapHandlers } from "@/lib/server/onboarding-bootstrap-route";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const handlers = createOnboardingBootstrapHandlers();
export const GET = handlers.GET;
export const POST = handlers.POST;
