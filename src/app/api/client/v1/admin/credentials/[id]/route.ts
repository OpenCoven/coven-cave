import { clientV1CredentialMetadata } from "@/lib/server/client-v1/credential-store.ts";
import { requireClientV1Admin } from "@/lib/server/client-v1/admin-auth.ts";
import {
  getClientV1Runtime,
  type ClientV1Runtime,
} from "@/lib/server/client-v1/runtime.ts";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

function invalidReason(): Response {
  return Response.json(
    { ok: false, error: "invalid revocation reason" },
    { status: 400 },
  );
}

function parseReason(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const body = value as Record<string, unknown>;
  if (Object.keys(body).length !== 1 || typeof body.reason !== "string") {
    return null;
  }
  const reason = body.reason.trim();
  if (
    !reason
    || reason.length > 256
    || /[\u0000-\u001f\u007f]/u.test(reason)
  ) {
    return null;
  }
  return reason;
}

export function createAdminCredentialDeleteHandler(runtime: ClientV1Runtime) {
  return async function adminCredentialDelete(
    req: Request,
    { params: rawParams }: RouteContext,
  ): Promise<Response> {
    const denied = requireClientV1Admin(req, { mutation: true });
    if (denied) return denied;

    const { id } = await rawParams;
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return invalidReason();
    }
    const reason = parseReason(body);
    if (!reason) return invalidReason();

    const before = await runtime.credentialStore.reload();
    if (!before.has(id)) {
      return Response.json(
        { ok: false, error: "credential not found" },
        { status: 404 },
      );
    }
    await runtime.credentialStore.revoke(id, reason);
    const credential = (await runtime.credentialStore.reload()).get(id);
    if (!credential) {
      return Response.json(
        { ok: false, error: "credential not found" },
        { status: 404 },
      );
    }
    return Response.json({
      ok: true,
      credential: clientV1CredentialMetadata(credential),
    });
  };
}

export async function DELETE(
  req: Request,
  context: RouteContext,
): Promise<Response> {
  return createAdminCredentialDeleteHandler(getClientV1Runtime())(
    req,
    context,
  );
}
