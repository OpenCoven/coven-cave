import { copyCanonicalJsonValue } from "./digest.ts";

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
export const UTC_TIMESTAMP_PATTERN =
  String.raw`^(?:(?:\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d)|(?:1972-(?:06-30|12-31)|197[3-9]-12-31|198[1235]-06-30|198[79]-12-31|1990-12-31|199[2347]-06-30|199[58]-12-31|200[58]-12-31|201[25]-06-30|2016-12-31)T23:59:60)(?:\.\d{1,9})?Z$`;
const UTC_TIMESTAMP_RE = new RegExp(UTC_TIMESTAMP_PATTERN);
const JSON_POINTER_RE = /^(?:$|\/(?:[^~/]|~0|~1)*(?:\/(?:[^~/]|~0|~1)*)*)$/;

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isUtcTimestamp(value: unknown): value is string {
  if (typeof value !== "string") return false;
  if (!UTC_TIMESTAMP_RE.test(value)) return false;

  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  const hour = Number(value.slice(11, 13));
  const minute = Number(value.slice(14, 16));
  const second = Number(value.slice(17, 19));
  if (
    month < 1 ||
    month > 12 ||
    hour > 23 ||
    minute > 59 ||
    second > 60 ||
    (second === 60 && (hour !== 23 || minute !== 59))
  ) {
    return false;
  }

  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [
    31,
    leapYear ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ];
  return day >= 1 && day <= daysInMonth[month - 1]!;
}

export function compareUtcTimestamps(left: string, right: string): -1 | 0 | 1 {
  if (!isUtcTimestamp(left) || !isUtcTimestamp(right)) {
    throw new TypeError("compareUtcTimestamps requires valid UTC RFC 3339 timestamps");
  }

  const components = (value: string): readonly number[] => {
    const fractionStart = value.indexOf(".");
    const fraction =
      fractionStart === -1
        ? 0
        : Number(value.slice(fractionStart + 1, -1).padEnd(9, "0"));
    return [
      Number(value.slice(0, 4)),
      Number(value.slice(5, 7)),
      Number(value.slice(8, 10)),
      Number(value.slice(11, 13)),
      Number(value.slice(14, 16)),
      Number(value.slice(17, 19)),
      fraction,
    ];
  };

  const leftComponents = components(left);
  const rightComponents = components(right);
  for (let index = 0; index < leftComponents.length; index += 1) {
    if (leftComponents[index]! < rightComponents[index]!) return -1;
    if (leftComponents[index]! > rightComponents[index]!) return 1;
  }
  return 0;
}

const POSITIVE_LEAP_SECOND_EFFECTIVE_TIMESTAMPS = [
  "1972-07-01T00:00:00Z",
  "1973-01-01T00:00:00Z",
  "1974-01-01T00:00:00Z",
  "1975-01-01T00:00:00Z",
  "1976-01-01T00:00:00Z",
  "1977-01-01T00:00:00Z",
  "1978-01-01T00:00:00Z",
  "1979-01-01T00:00:00Z",
  "1980-01-01T00:00:00Z",
  "1981-07-01T00:00:00Z",
  "1982-07-01T00:00:00Z",
  "1983-07-01T00:00:00Z",
  "1985-07-01T00:00:00Z",
  "1988-01-01T00:00:00Z",
  "1990-01-01T00:00:00Z",
  "1991-01-01T00:00:00Z",
  "1992-07-01T00:00:00Z",
  "1993-07-01T00:00:00Z",
  "1994-07-01T00:00:00Z",
  "1996-01-01T00:00:00Z",
  "1997-07-01T00:00:00Z",
  "1999-01-01T00:00:00Z",
  "2006-01-01T00:00:00Z",
  "2009-01-01T00:00:00Z",
  "2012-07-01T00:00:00Z",
  "2015-07-01T00:00:00Z",
  "2017-01-01T00:00:00Z",
] as const;
const DAYS_BEFORE_MONTH = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334] as const;

export function utcTimestampToProtocolNanoseconds(value: string): bigint {
  if (!isUtcTimestamp(value)) {
    throw new TypeError(
      "utcTimestampToProtocolNanoseconds requires a valid UTC RFC 3339 timestamp",
    );
  }

  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  const hour = Number(value.slice(11, 13));
  const minute = Number(value.slice(14, 16));
  const second = Number(value.slice(17, 19));
  const fractionStart = value.indexOf(".");
  const fraction =
    fractionStart === -1
      ? BigInt(0)
      : BigInt(value.slice(fractionStart + 1, -1).padEnd(9, "0"));
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const leapYearsBeforeYear =
    Math.floor((year + 3) / 4) -
    Math.floor((year + 99) / 100) +
    Math.floor((year + 399) / 400);
  const daysBeforeYear = 365 * year + leapYearsBeforeYear;
  const daysBeforeDate =
    daysBeforeYear +
    DAYS_BEFORE_MONTH[month - 1]! +
    (leapYear && month > 2 ? 1 : 0) +
    day -
    1;
  const nominalSeconds =
    BigInt(daysBeforeDate) * BigInt(86_400) +
    BigInt(hour * 3_600 + minute * 60 + second);
  const completedLeapSeconds = POSITIVE_LEAP_SECOND_EFFECTIVE_TIMESTAMPS.filter(
    (effectiveAt) => compareUtcTimestamps(value, effectiveAt) >= 0,
  ).length;
  return (
    (nominalSeconds + BigInt(completedLeapSeconds)) * BigInt(1_000_000_000) +
    fraction
  );
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

function toOrdinaryJsonValue(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) {
    return value.map((entry) => toOrdinaryJsonValue(entry));
  }

  const copy: Record<string, unknown> = {};
  for (const key of Object.keys(value)) {
    Object.defineProperty(copy, key, {
      value: toOrdinaryJsonValue((value as Record<string, unknown>)[key]),
      enumerable: true,
      configurable: true,
      writable: true,
    });
  }
  return copy;
}

export function copyProtocolJsonValue<T>(
  value: T,
  path = "$",
): ProtocolParseResult<T> {
  try {
    return pass(toOrdinaryJsonValue(copyCanonicalJsonValue(value)) as T);
  } catch {
    return fail(
      "invalid_value",
      path,
      "Protocol value must contain only canonical JSON data",
    );
  }
}

export type ResearchContextBindingV1 = {
  contextPackId: string;
  contextPackDigest: string;
  topicProposalId?: string;
} & UnknownFields;

function childPath(path: string, key: string): string {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key)
    ? `${path}.${key}`
    : `${path}[${JSON.stringify(key)}]`;
}

function hasOwn(record: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function parseObject(value: unknown, path: string): ProtocolParseResult<Record<string, unknown>> {
  if (!isRecord(value)) {
    return fail("invalid_type", path, "Expected an object");
  }
  return pass(value);
}

function parseRequiredField(
  record: Record<string, unknown>,
  key: string,
  path: string,
): ProtocolParseResult<unknown> {
  if (!hasOwn(record, key)) {
    return fail("missing_field", childPath(path, key), `Missing required field ${key}`);
  }
  return pass(record[key]);
}

function parseOpaqueIdentifier(
  value: unknown,
  prefix: string,
  path: string,
  label: string,
): ProtocolParseResult<string> {
  if (typeof value !== "string") {
    return fail("invalid_type", path, `${label} must be a string`);
  }
  if (!isOpaqueId(value, prefix)) {
    return fail("invalid_value", path, `${label} must match ${prefix}_...`);
  }
  return pass(value);
}

function parseSha256(value: unknown, path: string, label: string): ProtocolParseResult<string> {
  if (typeof value !== "string") {
    return fail("invalid_type", path, `${label} must be a string`);
  }
  if (!isSha256(value)) {
    return fail("invalid_value", path, `${label} must be a lowercase SHA-256 digest`);
  }
  return pass(value);
}

export function parseResearchContextBindingV1(
  value: unknown,
  path: string,
): ProtocolParseResult<ResearchContextBindingV1> {
  const wireValue = copyProtocolJsonValue(value, path);
  if (!wireValue.ok) return wireValue;

  const object = parseObject(wireValue.value, path);
  if (!object.ok) return object;

  const contextPackIdField = parseRequiredField(object.value, "contextPackId", path);
  if (!contextPackIdField.ok) return contextPackIdField;
  const contextPackId = parseOpaqueIdentifier(
    contextPackIdField.value,
    "ctx",
    childPath(path, "contextPackId"),
    "contextPackId",
  );
  if (!contextPackId.ok) return contextPackId;

  const contextPackDigestField = parseRequiredField(object.value, "contextPackDigest", path);
  if (!contextPackDigestField.ok) return contextPackDigestField;
  const contextPackDigest = parseSha256(
    contextPackDigestField.value,
    childPath(path, "contextPackDigest"),
    "contextPackDigest",
  );
  if (!contextPackDigest.ok) return contextPackDigest;

  let topicProposalId: string | undefined;
  if (hasOwn(object.value, "topicProposalId")) {
    const parsedTopicProposalId = parseOpaqueIdentifier(
      object.value.topicProposalId,
      "proposal",
      childPath(path, "topicProposalId"),
      "topicProposalId",
    );
    if (!parsedTopicProposalId.ok) return parsedTopicProposalId;
    topicProposalId = parsedTopicProposalId.value;
  }

  return pass({
    ...object.value,
    contextPackId: contextPackId.value,
    contextPackDigest: contextPackDigest.value,
    ...(typeof topicProposalId === "string" ? { topicProposalId } : {}),
  });
}
