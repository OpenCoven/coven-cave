/**
 * GET /api/client/v1/familiars/:id/contract
 *
 * One familiar's Familiar Contract: which of SOUL.md / IDENTITY.md / ward.toml /
 * MEMORY.md exist, the identity fields IDENTITY.md declares, the ward parsed
 * from ward.toml — what the familiar may do alone, what it must ask about, the
 * only paths it may change — and the v0.1.0 adherence report. It is the
 * promotion of `/api/familiars/:id/contract`, the read the Studio's Contract
 * tab makes, so a paired client and the desktop render the same ward.
 *
 * "Exists" means "is on the visible roster" — the same source `familiars.list`
 * serves. That costs one daemon round-trip before the workspace is read, and it
 * is paid on purpose: the alternative definition, "has a workspace directory",
 * would let a paired bearer probe which slugs exist on disk outside the roster
 * a Cave has chosen to show. An id the roster does not carry is `not_found`
 * whether or not a directory happens to match it.
 *
 * The credential check is written out here rather than delegated; see the note
 * in the familiars route for why the shape of that check is load-bearing.
 */

import {
  CLIENT_V1_READ_SCOPE,
  assertClientV1NoReadQuery,
  chargeClientV1AuthFailure,
  clientV1BearerFrom,
  clientV1InvalidReadRequest,
  clientV1ReadFailure,
} from "@/lib/server/client-v1/read-guard.ts";
import { projectClientV1FamiliarContract } from "@/lib/server/client-v1/familiar-reads.ts";
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

export function createClientV1FamiliarContractGetHandler(
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

    try {
      assertClientV1NoReadQuery(new URL(request.url));
    } catch (cause) {
      return clientV1InvalidReadRequest(cause);
    }

    const id = (await params).id;
    try {
      // One answer for "no such familiar" and for an id that could never name
      // one. The slug check runs before any source is consulted, so a
      // traversal-shaped id never reaches the roster or the loader.
      if (!isValidFamiliarId(id)) {
        return clientV1ErrorResponse("not_found", "Familiar not found.");
      }
      const roster = await sources.listFamiliars();
      if (!roster.ok) {
        // Reported as unavailable whatever the daemon said, for the reason the
        // familiars route gives: that failure is about Cave's own access token,
        // not the client's bearer.
        return clientV1ErrorResponse(
          "service_unavailable",
          "The familiar roster is unavailable.",
          { retryable: true },
        );
      }
      if (!roster.roster.some((entry) => entry.id === id)) {
        return clientV1ErrorResponse("not_found", "Familiar not found.");
      }
      const loaded = await sources.loadFamiliarContract(id);
      return clientV1SuccessResponse({
        contract: projectClientV1FamiliarContract(id, loaded.files),
      });
    } catch {
      return clientV1ReadFailure();
    }
  };

  return async function clientV1FamiliarContractGet(
    request: Request,
    context: RouteContext,
  ): Promise<Response> {
    return clientV1.authority.handle({
      operation: "familiars.contract.read",
      request,
      invoke: (authorizedRequest) => serve(authorizedRequest, context),
    });
  };
}

export async function GET(request: Request, context: RouteContext): Promise<Response> {
  return createClientV1FamiliarContractGetHandler(
    getClientV1Runtime(),
    clientV1ReadSources(),
  )(request, context);
}
