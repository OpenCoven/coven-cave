import { createHash } from "node:crypto";
import canonicalize from "canonicalize";

import { isRecord } from "./common.ts";

function jsonPathForProperty(path: string, key: string): string {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key)
    ? `${path}.${key}`
    : `${path}[${JSON.stringify(key)}]`;
}

function jsonPathForIndex(path: string, index: number): string {
  return `${path}[${index}]`;
}

function createCanonicalJsonError(path: string, reason: string): TypeError {
  return new TypeError(`Value at ${path} is not canonical JSON: ${reason}`);
}

function isPlainJsonObject(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertCanonicalJson(value: unknown, path = "$", stack = new WeakSet<object>()): void {
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw createCanonicalJsonError(path, "non-finite numbers are not allowed");
    }
    return;
  }
  if (typeof value === "undefined") {
    throw createCanonicalJsonError(path, "undefined is not allowed");
  }
  if (typeof value === "bigint") {
    throw createCanonicalJsonError(path, "bigint is not allowed");
  }
  if (typeof value === "function") {
    throw createCanonicalJsonError(path, "functions are not allowed");
  }
  if (typeof value === "symbol") {
    throw createCanonicalJsonError(path, "symbols are not allowed");
  }
  if (Array.isArray(value)) {
    if (stack.has(value)) {
      throw createCanonicalJsonError(path, "cyclic structures are not allowed");
    }
    stack.add(value);
    for (const [index, entry] of value.entries()) {
      assertCanonicalJson(entry, jsonPathForIndex(path, index), stack);
    }
    stack.delete(value);
    return;
  }
  if (!isPlainJsonObject(value)) {
    throw createCanonicalJsonError(path, "only JSON objects and arrays are allowed");
  }
  if (stack.has(value)) {
    throw createCanonicalJsonError(path, "cyclic structures are not allowed");
  }
  stack.add(value);
  for (const key of Object.keys(value)) {
    assertCanonicalJson(value[key], jsonPathForProperty(path, key), stack);
  }
  stack.delete(value);
}

export function canonicalJson(value: unknown): string {
  assertCanonicalJson(value);
  const serialized = canonicalize(value);
  if (typeof serialized !== "string") {
    throw new TypeError("Value at $ is not canonical JSON: canonicalization failed");
  }
  return serialized;
}

export function sha256Digest(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

export function digestProtocolObject(value: unknown): string {
  if (!isRecord(value) || !isPlainJsonObject(value)) {
    throw new TypeError("digestProtocolObject expects a JSON record");
  }
  const copy: Record<string, unknown> = { ...value };
  delete copy.digest;
  return sha256Digest(canonicalJson(copy));
}
