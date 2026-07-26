export const REDACTED_SECRET = "[redacted]";

const SECRET_KEY_PATTERN =
  /(?:^|_)(?:api[_-]?key|auth|authorization|bearer|client[_-]?secret|cookie|credential|jwt|oauth|pass(?:word)?|private[_-]?key|refresh[_-]?token|secret|session|token)(?:$|_)/i;

const WHOLE_SECRET_PATTERNS: RegExp[] = [
  /\bBearer\s+[A-Za-z0-9._~+/=-]{20,}\b/gi,
  /\bsk-or-v1-[A-Za-z0-9_-]{32,}\b/g,
  /\b(?:sk|rk)-(?:proj-)?[A-Za-z0-9_-]{20,}\b/g,
  /\bsk-ant-[A-Za-z0-9_-]{20,}\b/g,
  /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]{20,}\b/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g,
  /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/g,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
  /\b[A-Za-z0-9+/]{32,}={0,2}\b/g,
];

export function redactSecretText(text: string): string {
  let next = text;
  for (const pattern of WHOLE_SECRET_PATTERNS) {
    next = next.replace(pattern, REDACTED_SECRET);
  }
  next = next.replace(
    /([?&](?:access_token|api_key|auth|key|password|secret|token)=)[^&#\s]+/gi,
    `$1${REDACTED_SECRET}`,
  );
  next = next.replace(
    /\b((?:api[_-]?key|authorization|client[_-]?secret|password|secret|token)\s*[:=]\s*)("[^"]+"|'[^']+'|[^\s,;]+)/gi,
    `$1${REDACTED_SECRET}`,
  );
  next = next.replace(/\b(https?:\/\/[^:/\s]+:)[^@\s/]+(@)/gi, `$1${REDACTED_SECRET}$2`);
  return next;
}

export function redactSecretsDeep<T>(value: T): T {
  return redactValue(value, undefined) as T;
}

function redactValue(value: unknown, key: string | undefined): unknown {
  if (key && SECRET_KEY_PATTERN.test(key)) return REDACTED_SECRET;

  if (typeof value === "string") return redactSecretText(value);
  if (Array.isArray(value)) return value.map((item) => redactValue(item, undefined));
  if (!value || typeof value !== "object") return value;

  const out: Record<string, unknown> = {};
  for (const [childKey, childValue] of Object.entries(value)) {
    out[childKey] = redactValue(childValue, childKey);
  }
  return out;
}
