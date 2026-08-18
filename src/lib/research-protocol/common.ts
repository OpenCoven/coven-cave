import { types as nodeUtilTypes } from "node:util";

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
  String.raw`^\d{4}-(?:(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d|(?:(?:01|03|05|07|08|10|12)-31|(?:04|06|09|11)-30|02-(?:28|29))T23:59:60)(?:\.\d{1,9})?Z$`;
const UTC_TIMESTAMP_RE = new RegExp(UTC_TIMESTAMP_PATTERN);
const JSON_POINTER_RE = /^(?:$|\/(?:[^~/]|~0|~1)*(?:\/(?:[^~/]|~0|~1)*)*)$/;
const PRINTABLE_ASCII_PROPERTY_NAME_RE = /^[\u0020-\u007e]*$/;
const arrayIsArrayIntrinsic = Array.isArray;
const arrayPrototypeIntrinsic = Array.prototype;
const objectPrototypeIntrinsic = Object.prototype;
const getPrototypeOfIntrinsic = Object.getPrototypeOf;
const getOwnPropertyDescriptorIntrinsic = Object.getOwnPropertyDescriptor;
const defineOwnPropertyIntrinsic = Object.defineProperty;
const reflectOwnKeysIntrinsic = Reflect.ownKeys;
const reflectApplyIntrinsic = Reflect.apply;
const objectHasOwnIntrinsic = Object.hasOwn;
const isProxyIntrinsic = nodeUtilTypes.isProxy;
const objectToStringIntrinsic = Object.prototype.toString;
const symbolToStringTagIntrinsic = Symbol.toStringTag;
const urlHrefGetterIntrinsic = getOwnPropertyDescriptorIntrinsic(
  URL.prototype,
  "href",
)!.get!;
type IntrinsicObjectBrandCheck = (value: unknown) => boolean;
const intrinsicObjectBrandChecks = Object.values(nodeUtilTypes).filter(
  (check): check is IntrinsicObjectBrandCheck =>
    typeof check === "function" && check !== isProxyIntrinsic,
);
const EXISTING_NORMALIZED_SENSITIVE_KEY_FAMILIES = [
  "excerpt",
  "privateexcerpt",
  "rawexcerpt",
  "text",
  "content",
  "blob",
  "filename",
  "localpath",
  "filepath",
  "path",
  "credential",
  "secret",
  "objectkey",
  "storagekey",
  "bucketkey",
  "deletedcontent",
] as const;
export const ADDITIONAL_NORMALIZED_SENSITIVE_KEY_FAMILIES = [
  "privatetext",
  "privatecontent",
  "providerapikey",
  "apikey",
  "password",
  "accesstoken",
  "refreshtoken",
  "authtoken",
  "bearertoken",
  "authorization",
  "authheader",
] as const;
export const FORBIDDEN_NORMALIZED_SENSITIVE_KEY_FAMILIES = [
  ...EXISTING_NORMALIZED_SENSITIVE_KEY_FAMILIES,
  ...ADDITIONAL_NORMALIZED_SENSITIVE_KEY_FAMILIES,
] as const;
const FORBIDDEN_NORMALIZED_SENSITIVE_KEY_FAMILY_SET = new Set<string>(
  FORBIDDEN_NORMALIZED_SENSITIVE_KEY_FAMILIES,
);
const SENSITIVE_KEY_SCHEMA_SEPARATOR = "[^A-Za-z0-9]*";

function portableCaseInsensitiveSensitiveFamilyPattern(family: string): string {
  const letters = Array.from(
    family,
    (letter) => `[${letter.toUpperCase()}${letter}]`,
  );
  return `${letters.join(SENSITIVE_KEY_SCHEMA_SEPARATOR)}(?:${SENSITIVE_KEY_SCHEMA_SEPARATOR}[Ss])?`;
}

export const ADDITIONAL_SENSITIVE_PROPERTY_NAME_PATTERN =
  `^${SENSITIVE_KEY_SCHEMA_SEPARATOR}(?:${
    ADDITIONAL_NORMALIZED_SENSITIVE_KEY_FAMILIES
      .map(portableCaseInsensitiveSensitiveFamilyPattern)
      .join("|")
  })${SENSITIVE_KEY_SCHEMA_SEPARATOR}$`;

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
  const lastDayOfMonth = daysInMonth[month - 1]!;
  return day >= 1
    && day <= lastDayOfMonth
    && (second !== 60 || day === lastDayOfMonth);
}

export function compareUtcTimestamps(left: string, right: string): number {
  if (!isUtcTimestamp(left) || !isUtcTimestamp(right)) {
    throw new TypeError("UTC timestamp comparison requires valid UTC RFC 3339 timestamps");
  }

  const leftSecond = left.slice(0, 19);
  const rightSecond = right.slice(0, 19);
  if (leftSecond !== rightSecond) {
    return leftSecond < rightSecond ? -1 : 1;
  }

  const leftFraction = (left[19] === "." ? left.slice(20, -1) : "").padEnd(9, "0");
  const rightFraction = (right[19] === "." ? right.slice(20, -1) : "").padEnd(9, "0");
  return leftFraction < rightFraction ? -1 : leftFraction > rightFraction ? 1 : 0;
}

const SECONDS_PER_HOUR = 3_600;
const DAYS_BEFORE_MONTH = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];

function daysBeforeUtcYear(year: number): number {
  return 365 * year
    + Math.floor((year + 3) / 4)
    - Math.floor((year + 99) / 100)
    + Math.floor((year + 399) / 400);
}

function utcTimestampParts(
  value: string,
  leapSecondBound: "anchor" | "deadline",
): { wholeSeconds: number; nanoseconds: number } {
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  const hour = Number(value.slice(11, 13));
  const minute = Number(value.slice(14, 16));
  const parsedSecond = Number(value.slice(17, 19));
  const leapDay = month > 2 && year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const dayIndex = daysBeforeUtcYear(year)
    + DAYS_BEFORE_MONTH[month - 1]!
    + (leapDay ? 1 : 0)
    + day
    - 1;
  const second = parsedSecond === 60 && leapSecondBound === "anchor"
    ? 59
    : parsedSecond;
  const wholeSeconds = dayIndex * 86_400 + hour * SECONDS_PER_HOUR + minute * 60 + second;
  const fraction = value[19] === "." ? value.slice(20, -1) : "";
  return {
    wholeSeconds,
    nanoseconds: Number(fraction.padEnd(9, "0") || "0"),
  };
}

/**
 * Uses proleptic-Gregorian UTC days of exactly 86,400 seconds. For accepted
 * `23:59:60` syntax, the anchor is floored to `23:59:59` and a deadline is
 * rounded up to the following civil second, preserving its fractional digits.
 * This asymmetric rule may shorten a leap-second window but cannot lengthen it.
 */
export function isUtcTimestampAtMostHoursAfter(
  timestamp: string,
  anchor: string,
  hours: number,
): boolean {
  if (!isUtcTimestamp(timestamp) || !isUtcTimestamp(anchor)) {
    throw new TypeError("UTC duration comparison requires valid UTC RFC 3339 timestamps");
  }
  if (!Number.isSafeInteger(hours) || hours < 0) {
    throw new RangeError("UTC duration comparison requires non-negative whole safe-integer hours");
  }

  const deadline = utcTimestampParts(timestamp, "deadline");
  const start = utcTimestampParts(anchor, "anchor");
  const boundarySeconds = start.wholeSeconds + hours * SECONDS_PER_HOUR;
  return deadline.wholeSeconds < boundarySeconds
    || (
      deadline.wholeSeconds === boundarySeconds
      && deadline.nanoseconds <= start.nanoseconds
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

function normalizeSensitiveExtensionKey(key: string): string {
  return key.normalize("NFKC").replaceAll(/[^A-Za-z0-9]/g, "").toLowerCase();
}

function isForbiddenNormalizedSensitiveKey(key: string): boolean {
  return FORBIDDEN_NORMALIZED_SENSITIVE_KEY_FAMILY_SET.has(key)
    || (
      key.endsWith("s")
      && FORBIDDEN_NORMALIZED_SENSITIVE_KEY_FAMILY_SET.has(key.slice(0, -1))
    );
}

/**
 * Recursively guards metadata-only extension objects against private-content
 * aliases. Declared callers choose where this stricter boundary applies.
 */
export function validateSensitiveExtensionKeys(
  value: unknown,
  path: string,
  objectLabel = "Sensitive manifest objects",
): ProtocolParseResult<void> {
  if (Array.isArray(value)) {
    for (const [index, entry] of value.entries()) {
      const nested = validateSensitiveExtensionKeys(
        entry,
        `${path}[${index}]`,
        objectLabel,
      );
      if (!nested.ok) return nested;
    }
    return pass(undefined);
  }
  if (!isRecord(value)) return pass(undefined);

  for (const key of Object.keys(value)) {
    const keyPath = childPath(path, key);
    if (
      !PRINTABLE_ASCII_PROPERTY_NAME_RE.test(key)
      || key.normalize("NFKC") !== key
    ) {
      return fail(
        "semantic_conflict",
        keyPath,
        `${objectLabel} property names must be printable ASCII and NFKC-stable`,
      );
    }
    if (isForbiddenNormalizedSensitiveKey(normalizeSensitiveExtensionKey(key))) {
      return fail(
        "semantic_conflict",
        keyPath,
        `${objectLabel} must not contain ${key}`,
      );
    }
    const nested = validateSensitiveExtensionKeys(value[key], keyPath, objectLabel);
    if (!nested.ok) return nested;
  }
  return pass(undefined);
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

function isCanonicalArrayIndex(key: string): boolean {
  if (!/^(?:0|[1-9]\d*)$/.test(key)) return false;
  const index = Number(key);
  return Number.isInteger(index) && index >= 0 && index < 0xffffffff;
}

export function snapshotProtocolArrayElements(
  value: unknown,
  path: string,
  label: string,
): ProtocolParseResult<readonly unknown[]> {
  if (typeof value !== "object" || value === null) {
    return fail("invalid_type", path, `${label} must be an array`);
  }
  if (isProxyIntrinsic(value)) {
    return fail("invalid_value", path, `${label} must be an ordinary array`);
  }
  if (!arrayIsArrayIntrinsic(value)) {
    return fail("invalid_type", path, `${label} must be an array`);
  }
  if (getPrototypeOfIntrinsic(value) !== arrayPrototypeIntrinsic) {
    return fail("invalid_value", path, `${label} must use the standard Array prototype`);
  }

  const lengthDescriptor = getOwnPropertyDescriptorIntrinsic(value, "length");
  if (
    !lengthDescriptor
    || !objectHasOwnIntrinsic(lengthDescriptor, "value")
    || lengthDescriptor.enumerable
    || lengthDescriptor.configurable
  ) {
    return fail("invalid_value", path, `${label} must have the standard length property`);
  }
  const length = lengthDescriptor.value;
  if (
    typeof length !== "number"
    || !Number.isInteger(length)
    || length < 0
    || length >= 0x100000000
  ) {
    return fail("invalid_value", path, `${label} must have a valid array length`);
  }

  let indexedKeyCount = 0;
  for (const key of reflectOwnKeysIntrinsic(value)) {
    if (typeof key === "symbol") {
      return fail("invalid_value", path, `${label} must not have symbol properties`);
    }
    if (key === "length") continue;
    if (!isCanonicalArrayIndex(key) || Number(key) >= length) {
      return fail("invalid_value", path, `${label} must not have extra properties`);
    }
    indexedKeyCount += 1;
  }
  if (indexedKeyCount !== length) {
    return fail("invalid_value", path, `${label} must not contain sparse holes`);
  }

  const snapshot = new Array<unknown>(length);
  for (let index = 0; index < length; index += 1) {
    const descriptor = getOwnPropertyDescriptorIntrinsic(value, String(index));
    if (
      !descriptor
      || !descriptor.enumerable
      || !objectHasOwnIntrinsic(descriptor, "value")
    ) {
      return fail(
        "invalid_value",
        path,
        `${label} indices must be enumerable data properties`,
      );
    }
    defineOwnPropertyIntrinsic(snapshot, index, {
      value: descriptor.value,
      enumerable: true,
      configurable: true,
      writable: true,
    });
  }
  return pass(snapshot);
}

export function snapshotProtocolObjectProperties(
  value: unknown,
  path: string,
  label: string,
): ProtocolParseResult<Record<string, unknown>> {
  if (typeof value !== "object" || value === null) {
    return fail("invalid_type", path, `${label} must be an object`);
  }
  if (isProxyIntrinsic(value)) {
    return fail("invalid_value", path, `${label} must be an ordinary object`);
  }
  if (arrayIsArrayIntrinsic(value)) {
    return fail("invalid_type", path, `${label} must be an object`);
  }
  const prototype = getPrototypeOfIntrinsic(value);
  if (prototype !== objectPrototypeIntrinsic && prototype !== null) {
    return fail("invalid_value", path, `${label} must be an ordinary object`);
  }

  for (let index = 0; index < intrinsicObjectBrandChecks.length; index += 1) {
    if (intrinsicObjectBrandChecks[index]!(value)) {
      return fail("invalid_value", path, `${label} must be an ordinary object`);
    }
  }
  try {
    reflectApplyIntrinsic(urlHrefGetterIntrinsic, value, []);
    return fail("invalid_value", path, `${label} must be an ordinary object`);
  } catch {
    // The captured URL getter throws for every non-URL receiver.
  }

  const properties: Array<readonly [string, PropertyDescriptor]> = [];
  for (const key of reflectOwnKeysIntrinsic(value)) {
    if (typeof key === "symbol") {
      return fail("invalid_value", path, `${label} must not have symbol properties`);
    }
    const descriptor = getOwnPropertyDescriptorIntrinsic(value, key);
    if (
      !descriptor
      || !objectHasOwnIntrinsic(descriptor, "value")
    ) {
      return fail(
        "invalid_value",
        path,
        `${label} fields must be enumerable data properties`,
      );
    }
    properties.push([key, descriptor]);
  }

  if (
    prototype === objectPrototypeIntrinsic
    && getOwnPropertyDescriptorIntrinsic(
      objectPrototypeIntrinsic,
      symbolToStringTagIntrinsic,
    ) !== undefined
  ) {
    return fail("invalid_value", path, `${label} must be an ordinary object`);
  }
  if (
    reflectApplyIntrinsic(objectToStringIntrinsic, value, [])
      !== "[object Object]"
  ) {
    return fail("invalid_value", path, `${label} must be an ordinary object`);
  }

  const snapshot = Object.create(null) as Record<string, unknown>;
  for (const [key, descriptor] of properties) {
    if (!descriptor.enumerable) {
      return fail(
        "invalid_value",
        path,
        `${label} fields must be enumerable data properties`,
      );
    }
    defineOwnPropertyIntrinsic(snapshot, key, {
      value: descriptor.value,
      enumerable: true,
      configurable: true,
      writable: true,
    });
  }
  return pass(snapshot);
}

function toOrdinaryJsonValue(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) {
    const copy = new Array<unknown>(value.length);
    for (let index = 0; index < value.length; index += 1) {
      Object.defineProperty(copy, index, {
        value: toOrdinaryJsonValue(value[index]),
        enumerable: true,
        configurable: true,
        writable: true,
      });
    }
    return copy;
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
