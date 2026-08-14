import { isValidChatAttachmentId } from "@/lib/server/chat-attachment-store";
import { requireClientPrincipal } from "@/lib/server/client-v1/auth";
import {
  ClientAttachmentError,
  isRetryableClientAttachmentError,
  readClientAttachment,
} from "@/lib/server/client-v1/attachment-service";
import { withAuthorizedClientConversation } from "@/lib/server/client-v1/chat-service";
import { clientV1Error } from "@/lib/server/client-v1/responses";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Context = { params: Promise<{ id: string }> };

type ByteRange = { start: number; end: number };

function parseByteRange(value: string | null, size: number): ByteRange | null {
  if (!value || !Number.isSafeInteger(size) || size <= 0) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(value);
  if (!match || (!match[1] && !match[2])) return null;

  if (!match[1]) {
    const suffixLength = Number(match[2]);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) return null;
    return {
      start: Math.max(0, size - suffixLength),
      end: size - 1,
    };
  }

  const start = Number(match[1]);
  const requestedEnd = match[2] ? Number(match[2]) : size - 1;
  if (
    !Number.isSafeInteger(start)
    || !Number.isSafeInteger(requestedEnd)
    || start < 0
    || start >= size
    || requestedEnd < start
  ) {
    return null;
  }
  return {
    start,
    end: Math.min(requestedEnd, size - 1),
  };
}

function encode5987(value: string): string {
  return encodeURIComponent(value)
    .replace(/['()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}

function contentDisposition(name: string, download: boolean): string {
  const kind = download ? "attachment" : "inline";
  const ascii = name.replace(/[^\x20-\x7E]+/g, "_").replace(/["\\]/g, "_") || "attachment";
  return `${kind}; filename="${ascii}"; filename*=UTF-8''${encode5987(name)}`;
}

function attachmentErrorResponse(error: ClientAttachmentError): Response {
  return clientV1Error(
    error.status,
    error.code,
    error.message,
    isRetryableClientAttachmentError(error),
  );
}

export async function GET(req: Request, context: Context): Promise<Response> {
  const auth = await requireClientPrincipal(req, "chat:read");
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  if (!isValidChatAttachmentId(id)) {
    return clientV1Error(404, "not_found", "Attachment not found.", false);
  }

  let attachment;
  try {
    attachment = await readClientAttachment(id, auth.principal.credentialId);
  } catch (error) {
    if (error instanceof ClientAttachmentError) return attachmentErrorResponse(error);
    return clientV1Error(503, "service_unavailable", "Attachments are temporarily unavailable.", true);
  }

  if (attachment.conversationId !== null) {
    try {
      const authorized = await withAuthorizedClientConversation(
        attachment.conversationId,
        async () => true,
      );
      if (!authorized.ok) {
        return clientV1Error(
          authorized.status === 404 ? 404 : 503,
          authorized.status === 404 ? "not_found" : "service_unavailable",
          authorized.status === 404 ? "Attachment not found." : "Attachments are temporarily unavailable.",
          authorized.status !== 404,
        );
      }
    } catch {
      return clientV1Error(503, "service_unavailable", "Attachments are temporarily unavailable.", true);
    }
  }

  const range = parseByteRange(req.headers.get("range"), attachment.sizeBytes);
  if (req.headers.has("range") && !range) {
    const response = clientV1Error(
      416,
      "invalid_request",
      "The requested range is not satisfiable.",
      false,
    );
    response.headers.set("accept-ranges", "bytes");
    response.headers.set("content-range", `bytes */${attachment.sizeBytes}`);
    return response;
  }

  const body = range
    ? attachment.data.subarray(range.start, range.end + 1)
    : attachment.data;
  return new Response(new Uint8Array(body), {
    status: range ? 206 : 200,
    headers: {
      "content-type": attachment.mimeType,
      "content-length": String(body.byteLength),
      "accept-ranges": "bytes",
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
      "cache-control": "private, max-age=3600",
      "content-disposition": contentDisposition(
        attachment.name,
        new URL(req.url).searchParams.get("download") === "1",
      ),
      ...(range
        ? {
            "content-range": `bytes ${range.start}-${range.end}/${attachment.sizeBytes}`,
          }
        : {}),
    },
  });
}
