import { NextResponse } from "next/server.js";

import { MOBILE_ACCESS_HEADER } from "../../proxy-helpers.ts";
import { loadMobileWriteAccess } from "../project-permissions.ts";
import { isLocalOrigin } from "./local-origin.ts";

/**
 * True when the proxy has marked this request as coming from the human's
 * paired phone. The marker is trustworthy because the proxy strips any
 * client-supplied `x-coven-cave-mobile-access` header and re-adds it only
 * after validating the mobile credential (pinned in
 * project-permission-routes.test.ts).
 */
export function isVerifiedMobileRequest(req: Request): boolean {
  return req.headers.get(MOBILE_ACCESS_HEADER) === "1";
}

/**
 * Gate for human-confirmed grant mutations (direct grants, proposal
 * decisions). The local desktop (loopback) always qualifies. The human's
 * paired phone qualifies ONLY when the desktop opt-in
 * `allowMobileGrantMutations` is enabled — the flag itself is mutable only
 * from the desktop (/api/mobile-permissions PATCH is loopback-gated), so the
 * phone can never widen its own authority. Familiar-relayed approval fields
 * are rejected separately by each route's rejectRelayedApproval guard.
 */
export async function requireTrustedHumanGrantMutation(req: Request): Promise<Response | null> {
  if (isLocalOrigin(req)) return null;
  if (isVerifiedMobileRequest(req)) {
    const { allowMobileGrantMutations } = await loadMobileWriteAccess();
    if (allowMobileGrantMutations) return null;
    return NextResponse.json(
      {
        ok: false,
        error:
          "grant changes from the phone are disabled — enable \u201cAllow permission changes from phone\u201d in desktop Settings",
      },
      { status: 403 },
    );
  }
  return NextResponse.json(
    { ok: false, error: "grant changes must be confirmed from the local desktop" },
    { status: 403 },
  );
}
