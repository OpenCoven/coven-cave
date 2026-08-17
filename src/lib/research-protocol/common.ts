export type UnknownFields = Record<string, unknown>;

export type ProtocolErrorCode =
  | "invalid_type"
  | "invalid_value"
  | "missing_field"
  | "unknown_major"
  | "digest_mismatch"
  | "semantic_conflict";

export type ProtocolParseError = {
  code: ProtocolErrorCode;
  path: string;
  message: string;
};

export type ProtocolParseResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: ProtocolParseError };

export const RETENTION_ORDER = {
  "run-only": 0,
  "7-days": 1,
  project: 2,
} as const;

export type RetentionPolicyV1 = keyof typeof RETENTION_ORDER;

const SHA256_RE = /^[a-f0-9]{64}$/;
const OPAQUE_ID_BODY_RE = /^[A-Za-z0-9_-]+$/;
const UTC_TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const JSON_POINTER_RE = /^(?:$|\/(?:[^~/]|~0|~1)*(?:\/(?:[^~/]|~0|~1)*)*)$/;

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isUtcTimestamp(value: unknown): value is string {
  if (typeof value !== "string" || !UTC_TIMESTAMP_RE.test(value)) return false;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value;
}

export function isJsonPointer(value: unknown): value is string {
  return typeof value === "string" && JSON_POINTER_RE.test(value);
}

export function isOpaqueId(value: unknown, prefix: string): value is string {
  if (typeof value !== "string") return false;
  if (!value.startsWith(`${prefix}_`)) return false;
  const body = value.slice(prefix.length + 1);
  return body.length > 0 && OPAQUE_ID_BODY_RE.test(body);
}

export function isSha256(value: unknown): value is string {
  return typeof value === "string" && SHA256_RE.test(value);
}

export function retentionDoesNotExceed(
  requested: RetentionPolicyV1,
  consented: RetentionPolicyV1,
): boolean {
  return RETENTION_ORDER[requested] <= RETENTION_ORDER[consented];
}

export function fail<T>(
  code: ProtocolErrorCode,
  path: string,
  message: string,
): ProtocolParseResult<T> {
  return { ok: false, error: { code, path, message } };
}

export function pass<T>(value: T): ProtocolParseResult<T> {
  return { ok: true, value };
}

export type ResearchContextBindingV1 = {
  contextPackId: string;
  contextPackDigest: string;
  topicProposalId?: string;
};
