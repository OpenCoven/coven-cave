/**
 * GET /api/client/v1/projects
 *
 * The canonical read of the Cave project registry
 * (`<caveHome>/projects.json`), one page at a time. This is the operator view
 * `loadProjects` returns — every registered project, deduplicated by normalized
 * root — and deliberately not the familiar-scoped view `/api/projects?familiarId=`
 * serves: a Client v1 credential is not a familiar, so there is no familiar
 * whose access could be applied, and inventing one would answer a permission
 * question this route never asked.
 *
 * The credential check is written out here rather than delegated; see the note
 * in the familiars route for why the shape of that check is load-bearing.
 */

import {
  compareClientV1RecencyKeys,
  paginateClientV1Keyset,
} from "@/lib/server/client-v1/pagination.ts";
import {
  CLIENT_V1_READ_SCOPE,
  chargeClientV1AuthFailure,
  clientV1BearerFrom,
  clientV1InvalidReadRequest,
  clientV1ReadFailure,
  parseClientV1ReadPage,
} from "@/lib/server/client-v1/read-guard.ts";
import {
  clientV1ReadSources,
  type ClientV1ReadSources,
} from "@/lib/server/client-v1/read-sources.ts";
import {
  clientV1ProjectPageKey,
  projectClientV1Project,
  sortClientV1Projects,
} from "@/lib/server/client-v1/reads.ts";
import {
  clientV1ErrorResponse,
  clientV1RateLimitResponse,
  clientV1SuccessResponse,
} from "@/lib/server/client-v1/responses.ts";
import {
  getClientV1Runtime,
  type ClientV1Runtime,
} from "@/lib/server/client-v1/runtime.ts";
import { LOCAL_PEER_HEADER } from "@/proxy-helpers.ts";

export const dynamic = "force-dynamic";

export function createClientV1ProjectsGetHandler(
  clientV1: ClientV1Runtime,
  sources: ClientV1ReadSources,
) {
  return async function clientV1ProjectsGet(request: Request): Promise<Response> {
    const stamp = request.headers.get(LOCAL_PEER_HEADER);
    if (!clientV1.authenticator.isTrustedLoopback(stamp)) {
      return clientV1ErrorResponse("unauthorized", "Unauthorized.");
    }
    const auth = await clientV1.authenticator.requireScope({
      bearer: clientV1BearerFrom(request),
      scope: CLIENT_V1_READ_SCOPE,
    });
    if (!auth.ok) return chargeClientV1AuthFailure(clientV1, auth, stamp!);
    const budget = clientV1.rateLimiter.consumeAuthenticated(auth.credential.id);
    if (!budget.allowed) return clientV1RateLimitResponse(budget);

    let page;
    try {
      page = parseClientV1ReadPage(new URL(request.url));
    } catch (cause) {
      return clientV1InvalidReadRequest(cause);
    }

    // Guarded from the read down: loadProjects returns whatever projects.json
    // parsed to, so a hand-edited row missing createdAt is refused by
    // projectClientV1Project rather than escaping as a non-envelope 500.
    try {
      const projects = await sources.listProjects();
      const { cursor, items } = paginateClientV1Keyset(sortClientV1Projects(projects), {
        limit: page.limit,
        after: page.after,
        keyOf: clientV1ProjectPageKey,
        compare: compareClientV1RecencyKeys,
      });
      return clientV1SuccessResponse(
        { projects: items.map(projectClientV1Project) },
        cursor ? { cursor } : {},
      );
    } catch {
      return clientV1ReadFailure();
    }
  };
}

export async function GET(request: Request): Promise<Response> {
  return createClientV1ProjectsGetHandler(getClientV1Runtime(), clientV1ReadSources())(request);
}
