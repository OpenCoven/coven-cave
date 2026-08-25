import { NextResponse } from "next/server";

import { MAX_X_JSON_BYTES, XApiError, type XScope } from "@/lib/x-api";
import { readJsonBody, rejectNonLocalRequest } from "@/lib/server/api-security";
import {
  requireXCapability,
  toXErrorResponse,
  withXWritePreflight,
} from "@/lib/server/x-access";
import { createXPost } from "@/lib/server/x-client";
import { xCredentialService } from "@/lib/server/x-credentials";
import {
  listXPublications,
  publishXPublication,
  resolveXPublication,
  upsertXPublicationDraft,
} from "@/lib/server/x-publications";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Drafting and publishing X posts for one familiar.
 *
 * Publishing is the only outbound write in the X integration, so the rules
 * here are stricter than the read routes':
 *
 *  - Every action needs the familiar's `publish` capability, which is a
 *    separate grant from `research`. Being able to read X is not permission
 *    to post as the account.
 *  - `publish` requires the confirmation token minted by `draft` for that
 *    exact text. Editing the draft mints a new one, so an approval never
 *    carries from the wording a person reviewed to a later one.
 *  - Nothing retries. A dispatched write whose outcome is unknown leaves the
 *    record `uncertain` and refuses further publishing until a human records
 *    what actually happened via `resolve`.
 *
 * `tweet.write` is requested only here; the read routes never ask for it, so
 * a connection that has not been granted posting rights fails at the
 * preflight rather than at the post.
 */
const WRITE_SCOPES: XScope[] = ["tweet.write", "users.read"];

type PublishBody = {
  action?: unknown;
  familiarId?: unknown;
  publicationId?: unknown;
  text?: unknown;
  confirmationToken?: unknown;
  outcome?: unknown;
  postId?: unknown;
  note?: unknown;
};

function invalid(message: string): XApiError {
  return new XApiError("invalid-request", message);
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || value === "") throw invalid(`${field} is required`);
  return value;
}

/**
 * The connected account's handle, used to build the canonical URL. It is
 * optional on purpose: `canonicalXPostUrl` falls back to the handle-free
 * `/i/web/status/<id>` form, and a post that demonstrably went out must still
 * be recorded even if the connection dropped between the write and this read.
 */
function connectedUsername(): string | undefined {
  const status = xCredentialService.getConnectionStatus();
  return status.connected ? status.account.username : undefined;
}

function connectedAccount() {
  const status = xCredentialService.getConnectionStatus();
  return status.connected ? status.account : undefined;
}

export async function GET(req: Request) {
  const forbidden = rejectNonLocalRequest(req);
  if (forbidden) return forbidden;
  const familiarId = new URL(req.url).searchParams.get("familiarId");
  try {
    if (!familiarId) throw invalid("familiarId is required");
    // Gated on the capability but not on a live connection, so the history of
    // what was posted — and anything left `uncertain` — stays readable after
    // a disconnect. That backlog is exactly what someone needs to see.
    await requireXCapability(familiarId, "publish");
    const publications = await listXPublications(familiarId);
    return NextResponse.json({ ok: true, publications });
  } catch (error) {
    return toXErrorResponse(error);
  }
}

export async function POST(req: Request) {
  const forbidden = rejectNonLocalRequest(req);
  if (forbidden) return forbidden;
  const parsed = await readJsonBody<PublishBody>(req, MAX_X_JSON_BYTES);
  if (!parsed.ok) return parsed.response;
  const body = parsed.body;

  try {
    const familiarId = requireString(body.familiarId, "familiarId");
    await requireXCapability(familiarId, "publish");

    switch (body.action) {
      case "draft": {
        const account = connectedAccount();
        const draft = await upsertXPublicationDraft({
          familiarId,
          text: typeof body.text === "string" ? body.text : "",
          accountId: account?.id ?? "",
          ...(body.publicationId === undefined
            ? {}
            : { publicationId: requireString(body.publicationId, "publicationId") }),
        });
        return NextResponse.json({
          ok: true,
          publication: draft.publication,
          confirmationToken: draft.confirmationToken,
          ...(account ? { account } : {}),
        });
      }

      case "publish": {
        const confirmedAccount = connectedAccount();
        const result = await publishXPublication(
          {
            familiarId,
            publicationId: requireString(body.publicationId, "publicationId"),
            confirmationToken: body.confirmationToken,
            accountId: confirmedAccount?.id ?? "",
          },
          {
            // The preflight sits inside `send` so the access token is minted
            // as late as possible, right before the request goes out. A
            // capability or token failure here is a definite failure — nothing
            // reached X — so the store returns the record to `draft`.
            send: (text, confirmedAccountId) =>
              withXWritePreflight(familiarId, WRITE_SCOPES, (accessToken) => {
                const currentAccount = connectedAccount();
                if (!currentAccount || currentAccount.id !== confirmedAccountId) {
                  throw invalid(
                    "The connected X account changed. Review the wording and account again.",
                  );
                }
                return createXPost(accessToken, text);
              }),
            accountUsername: connectedUsername,
          },
        );
        return NextResponse.json({
          ok: true,
          publication: result.publication,
          alreadyPublished: result.alreadyPublished,
        });
      }

      case "resolve": {
        // Read the connection once: two calls re-read the credential store and
        // can disagree, which would pass an explicit `undefined` handle after
        // the first call said there was one.
        const username = connectedUsername();
        const publication = await resolveXPublication({
          familiarId,
          publicationId: requireString(body.publicationId, "publicationId"),
          outcome: body.outcome,
          postId: body.postId,
          note: body.note,
          ...(username === undefined ? {} : { accountUsername: username }),
        });
        return NextResponse.json({ ok: true, publication });
      }

      default:
        throw invalid("action must be draft, publish or resolve");
    }
  } catch (error) {
    return toXErrorResponse(error);
  }
}
