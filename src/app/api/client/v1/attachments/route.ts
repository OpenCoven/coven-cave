import { requireClientPrincipal } from "@/lib/server/client-v1/auth";
import {
  CLIENT_ATTACHMENT_MAX_REQUEST_BYTES,
  ClientAttachmentError,
  parseClientAttachmentForm,
  saveUploadedClientAttachments,
} from "@/lib/server/client-v1/attachment-service";
import { parseIdempotencyKey } from "@/lib/server/client-v1/contract";
import { runIdempotentMutation } from "@/lib/server/client-v1/idempotent-mutation";
import { clientV1Error, clientV1Ok } from "@/lib/server/client-v1/responses";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function attachmentErrorResponse(error: ClientAttachmentError): Response {
  return clientV1Error(
    error.status,
    error.code,
    error.message,
    error.status === 503,
  );
}

async function readBoundedRequestBody(req: Request, maxBytes: number): Promise<Uint8Array> {
  const reader = req.body?.getReader();
  if (!reader) {
    throw new ClientAttachmentError(
      400,
      "invalid_request",
      "Attachments must be sent as multipart/form-data.",
    );
  }
  const chunks: Uint8Array[] = [];
  let receivedBytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      receivedBytes += value.byteLength;
      if (receivedBytes > maxBytes) {
        await reader.cancel().catch(() => {});
        throw new ClientAttachmentError(
          413,
          "invalid_request",
          "The total attachment payload must be 25 MiB or smaller.",
        );
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const body = new Uint8Array(receivedBytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

async function parseMultipartFormWithinLimit(req: Request): Promise<FormData> {
  const body = await readBoundedRequestBody(req, CLIENT_ATTACHMENT_MAX_REQUEST_BYTES);
  try {
    return await new Request(req.url, {
      method: req.method,
      headers: { "content-type": req.headers.get("content-type") ?? "" },
      body: Buffer.from(body),
    }).formData();
  } catch {
    throw new ClientAttachmentError(
      400,
      "invalid_request",
      "Attachments must be sent as multipart/form-data.",
    );
  }
}

export async function POST(req: Request): Promise<Response> {
  const auth = await requireClientPrincipal(req, "attachments:write");
  if (!auth.ok) return auth.response;

  let idempotencyKey: string;
  try {
    idempotencyKey = parseIdempotencyKey(req.headers.get("idempotency-key"));
  } catch (error) {
    return clientV1Error(
      400,
      "invalid_request",
      error instanceof Error ? error.message : "Invalid Idempotency-Key.",
      false,
    );
  }

  const contentType = req.headers.get("content-type") ?? "";
  if (!/^multipart\/form-data\b/i.test(contentType)) {
    return clientV1Error(
      400,
      "invalid_request",
      "Attachments must be sent as multipart/form-data.",
      false,
    );
  }

  const contentLengthHeader = req.headers.get("content-length");
  if (contentLengthHeader) {
    if (!/^(?:0|[1-9]\d*)$/.test(contentLengthHeader)) {
      return clientV1Error(
        400,
        "invalid_request",
        "Content-Length must be a decimal byte count.",
        false,
      );
    }
    const contentLength = Number(contentLengthHeader);
    if (!Number.isSafeInteger(contentLength) || contentLength > CLIENT_ATTACHMENT_MAX_REQUEST_BYTES) {
      return clientV1Error(
        413,
        "invalid_request",
        "The total attachment payload must be 25 MiB or smaller.",
        false,
      );
    }
  }

  let form: FormData;
  try {
    form = await parseMultipartFormWithinLimit(req);
  } catch (error) {
    if (error instanceof ClientAttachmentError) return attachmentErrorResponse(error);
    return clientV1Error(500, "internal_error", "Attachment validation failed.", true);
  }

  let uploads;
  try {
    uploads = await parseClientAttachmentForm(form);
  } catch (error) {
    if (error instanceof ClientAttachmentError) return attachmentErrorResponse(error);
    return clientV1Error(500, "internal_error", "Attachment validation failed.", true);
  }

  return runIdempotentMutation(
    {
      idempotencyKey,
      credentialId: auth.principal.credentialId,
      route: "attachments-upload",
      identity: {
        method: "POST",
        files: uploads.map((upload) => ({
          name: upload.name,
          mimeType: upload.mimeType,
          sizeBytes: upload.sizeBytes,
          sha256: upload.sha256,
        })),
      },
    },
    async (ctx) => {
      try {
        const attachments = await saveUploadedClientAttachments(
          uploads,
          auth.principal.credentialId,
          ctx.effectId,
        );
        return clientV1Ok({ ok: true, attachments }, { status: 201 });
      } catch (error) {
        if (error instanceof ClientAttachmentError) return attachmentErrorResponse(error);
        return clientV1Error(503, "service_unavailable", "Attachments are temporarily unavailable.", true);
      }
    },
  );
}
