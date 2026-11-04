import { dispatchSubmissionsRequest } from "@/lib/server/opencoven-submissions-host";
import { loadSubmissionsRuntime } from "@/lib/server/opencoven-submissions-loader";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function POST(request: Request) {
  return dispatchSubmissionsRequest("executions", request, loadSubmissionsRuntime);
}
