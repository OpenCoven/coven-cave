/**
 * GET /api/client/v1/familiars
 *
 * The canonical read of this Cave's visible familiar roster, one page at a
 * time. Projected from `loadVisibleFamiliarRoster` — the daemon roster merged
 * with familiars.toml and the removal tombstones — which is the same source the
 * Cave's own roster UI reads, so a paired client and the desktop never disagree
 * about who exists.
 *
 * The credential check below is written out here rather than delegated: this
 * path is listed in CLIENT_V1_AUTHENTICATED_PATHS, and a listed path is
 * *demoted* by proxy() — the mobile-access gate is skipped and the request
 * returns before the sidecar-token block, leaving this call to requireScope as
 * the only credential check in the whole request. The loopback stamp is checked
 * first anyway, as the second of two layers: #4855 made proxy() refuse any
 * client-v1 request-target containing a `%` or a `\` outright, closing the
 * percent-encoded escape from that branch (#4854) — but the route still does not
 * assume the branch it is listed for ran, because the cost of assuming wrong is
 * an unauthenticated read and the cost of checking is one string compare.
 */

import {
  compareClientV1AscendingKeys,
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
  clientV1FamiliarPageKey,
  projectClientV1Familiar,
  sortClientV1Familiars,
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

export function createClientV1FamiliarsGetHandler(
  clientV1: ClientV1Runtime,
  sources: ClientV1ReadSources,
) {
  const serve = async (request: Request): Promise<Response> => {
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

    // Read the roster only after the credential is settled: this is a live
    // request to the daemon, so running it first would let an unauthenticated
    // caller drive traffic off the machine and time the answer.
    //
    // Everything from here down is inside the guard: the roster is a daemon
    // HTTP response with no schema in front of it, so a renamed or retyped
    // field reaches projectClientV1Familiar, which refuses it. Uncaught, that
    // refusal left the handler as a non-envelope 500.
    try {
      const result = await sources.listFamiliars();
      if (!result.ok) {
        // Reported as unavailable whatever the daemon said — including its own
        // 401/403. That failure is about Cave's access token, not the client's
        // bearer, and answering `unauthorized` would tell a correctly paired
        // client to discard a credential that is working perfectly.
        return clientV1ErrorResponse(
          "service_unavailable",
          "The familiar roster is unavailable.",
          { retryable: true },
        );
      }

      const { cursor, items } = paginateClientV1Keyset(sortClientV1Familiars(result.roster), {
        limit: page.limit,
        after: page.after,
        keyOf: clientV1FamiliarPageKey,
        compare: compareClientV1AscendingKeys,
      });
      return clientV1SuccessResponse(
        { familiars: items.map(projectClientV1Familiar) },
        cursor ? { cursor } : {},
      );
    } catch {
      return clientV1ReadFailure();
    }
  };

  return async function clientV1FamiliarsGet(
    request: Request,
  ): Promise<Response> {
    return clientV1.authority.handle({
      operation: "familiars.list",
      request,
      invoke: serve,
    });
  };
}

export async function GET(request: Request): Promise<Response> {
  return createClientV1FamiliarsGetHandler(getClientV1Runtime(), clientV1ReadSources())(request);
}
