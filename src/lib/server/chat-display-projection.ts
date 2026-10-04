import { createHash } from "node:crypto";
import { containsSecretText, redactSecretText } from "../secret-redaction.ts";

export type DisplayClassification = "tool-input" | "tool-output" | "tool-name" | "provider-summary" | "provider-progress" | "diagnostic";
const CLASSIFICATIONS = new Set<unknown>(["tool-input", "tool-output", "tool-name", "provider-summary", "provider-progress", "diagnostic"]);
const OPAQUE_KEYS = new Set(["_meta", "signature", "encrypted_content", "encryptedContent", "redacted_thinking", "providerMetadata", "provider_metadata"]);
const SIGNED_URL_KEYS = /^(?:x-amz-signature|x-goog-signature|signature|sig|policy|key-pair-id)$/i;
const MAX_UNIT_BYTES = 256 * 1024;

function redactSignedUrls(text: string): string {
  return text.replace(/(?:https?:)?\/\/[^\s<>"'`]+|[/?#][^\s<>"'`]+/gi, (candidate) => {
    // Inspect signing keys even when another redactor has already replaced
    // part of the authority/path and the string is no longer a valid URL.
    const decoded = candidate.replace(/&(?:amp;)*(?:amp|#0*38|#x0*26);/gi, "&");
    const keys = decoded.split(/[?#]/).slice(1).flatMap((query) => [...new URLSearchParams(query).keys()]);
    return keys.some((key) => SIGNED_URL_KEYS.test(key)) ? "[redacted signed URL]" : candidate;
  });
}

/** One complete display unit selected by an adapter's native schema. This
 * policy is server-owned; fields within the payload cannot opt into disclosure.
 * Unknown classifications and incomplete units default to metadata only.
 * Apply existing credential redaction and common PII/signed-URL rules BEFORE
 * any display truncation. This is not an authorization or exhaustive PII engine. */
export function projectDisplayText(value: unknown, policy?: { classification: DisplayClassification; complete: boolean }): string | undefined {
  if (policy?.complete !== true || !CLASSIFICATIONS.has(policy.classification) || typeof value !== "string" || Buffer.byteLength(value) > MAX_UNIT_BYTES) return undefined;
  try {
    const signedUrls = redactSignedUrls(value);
    let redacted = redactSecretText(signedUrls);
    let opaque = false;
    try {
      const decoded = JSON.parse(redacted, (key, entry: unknown) => {
        if (!OPAQUE_KEYS.has(key)) return entry;
        opaque = true;
        return "[withheld provider state]";
      });
      if (opaque) redacted = JSON.stringify(decoded);
    } catch { /* Plain display text is also an admitted complete unit. */ }
    const filtered = redactSignedUrls(redacted)
      .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[redacted email]")
      .replace(/\b\d{3}-\d{2}-\d{4}\b/g, "[redacted identifier]")
      .replace(/(?:\+\d{1,3}[ .-]?)?(?:\(\d{3}\)|\b\d{3})[ .-]\d{3}[ .-]\d{4}\b/g, "[redacted phone]");
    // Keep formatting for ordinary tool JSON. Inspection uses the normalized
    // form too, so escaped JSON cannot conceal an email or signed URL.
    return signedUrls !== value || opaque || filtered !== redacted || containsSecretText(value) ? filtered : value;
  } catch { return undefined; }
}

/** Native correlation stays private when it is not a safe display token. The
 * reserved hash namespace prevents an attacker-chosen native ID from colliding
 * with another call's projected ID. This grants no identity or authority. */
export function projectDisplayId(value: string): string {
  if (!value.startsWith("opaque-") && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,511}$/.test(value) &&
    projectDisplayText(value, { classification: "tool-name", complete: true }) === value) return value;
  return `opaque-${createHash("sha256").update(value).digest("hex")}`;
}

/** Application progress labels/details are complete units. Keep exactly the
 * same projection for live events and saved presentation diagnostics. */
export function projectProgressDetails(value: { id: string; label: string; detail?: string }): { id: string; label: string; detail?: string } {
  const label = projectDisplayText(value.label, { classification: "diagnostic", complete: true });
  const detail = projectDisplayText(value.detail, { classification: "diagnostic", complete: true });
  return {
    id: projectDisplayId(value.id),
    label: label ? Array.from(label).slice(0, 2048).join("") : "Activity details unavailable.",
    ...(detail ? { detail: Array.from(detail).slice(0, 8192).join("") } : {}),
  };
}
