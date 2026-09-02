/**
 * GET /api/client/v1/familiars/:id/analytics
 *
 * One familiar's execution analytics: the aggregate windows Cave keeps (`7d`,
 * `14d`, `8w`, `all`), a runs-per-day series on the two day-shaped windows,
 * the most recent attempts, and whether the history behind the numbers is
 * complete. It is the promotion of `/api/familiars/:id/execution-analytics`,
 * the read the Studio's Activity tab makes.
 *
 * Optional `window` narrows the response to one window; optional `recent`
 * (0–100, default 50) bounds the attempt list. Any other parameter, a repeated
 * one, or a value outside its bound is refused rather than corrected.
 *
 * Existence is roster membership, checked before the store is read, for the
 * reason the contract route gives. The credential check is written out here
 * rather than delegated; see the note in the familiars route for why the
 * shape of that check is load-bearing.
 */

import {
  CLIENT_V1_READ_SCOPE,
  chargeClientV1AuthFailure,
  clientV1BearerFrom,
  clientV1InvalidReadRequest,
  clientV1ReadFailure,
} from "@/lib/server/client-v1/read-guard.ts";
import {
  parseClientV1FamiliarAnalyticsQuery,
  projectClientV1FamiliarAnalytics,
} from "@/lib/server/client-v1/familiar-reads.ts";
import {
  clientV1ReadSources,
  type ClientV1ReadSources,
} from "@/lib/server/client-v1/read-sources.ts";
import {
  clientV1ErrorResponse,
  clientV1RateLimitResponse,
  clientV1SuccessResponse,
} from "@/lib/server/client-v1/responses.ts";
import {
  getClientV1Runtime,
  type ClientV1Runtime,
} from "@/lib/server/client-v1/runtime.ts";
import { isValidFamiliarId } from "@/lib/server/familiar-id.ts";
import { LOCAL_PEER_HEADER } from "@/proxy-helpers.ts";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export function createClientV1FamiliarAnalyticsGetHandler(
  clientV1: ClientV1Runtime,
  sources: ClientV1ReadSources,
) {
  const serve = async (
    request: Request,
    { params }: RouteContext,
  ): Promise<Response> => {
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

    let query;
    try {
      query = parseClientV1FamiliarAnalyticsQuery(new URL(request.url));
    } catch (cause) {
      return clientV1InvalidReadRequest(cause);
    }

    const id = (await params).id;
    try {
      if (!isValidFamiliarId(id)) {
        return clientV1ErrorResponse("not_found", "Familiar not found.");
      }
      const roster = await sources.listFamiliars();
      if (!roster.ok) {
        return clientV1ErrorResponse(
          "service_unavailable",
          "The familiar roster is unavailable.",
          { retryable: true },
        );
      }
      if (!roster.roster.some((entry) => entry.id === id)) {
        return clientV1ErrorResponse("not_found", "Familiar not found.");
      }
      const analytics = await sources.readFamiliarAnalytics({
        familiarId: id,
        recentLimit: query.recentLimit,
      });
      return clientV1SuccessResponse({
        analytics: projectClientV1FamiliarAnalytics(analytics, query.window),
      });
    } catch {
      return clientV1ReadFailure();
    }
  };

  return async function clientV1FamiliarAnalyticsGet(
    request: Request,
    context: RouteContext,
  ): Promise<Response> {
    return clientV1.authority.handle({
      operation: "familiars.analytics.read",
      request,
      invoke: (authorizedRequest) => serve(authorizedRequest, context),
    });
  };
}

export async function GET(request: Request, context: RouteContext): Promise<Response> {
  return createClientV1FamiliarAnalyticsGetHandler(
    getClientV1Runtime(),
    clientV1ReadSources(),
  )(request, context);
}
