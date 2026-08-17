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

function assertPairedUtf16Surrogates(value: string, path: string): void {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const nextCodeUnit = value.charCodeAt(index + 1);
      if (index + 1 >= value.length || nextCodeUnit < 0xdc00 || nextCodeUnit > 0xdfff) {
        throw createCanonicalJsonError(path, "unpaired UTF-16 surrogate is not allowed");
      }
      index += 1;
    } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      throw createCanonicalJsonError(path, "unpaired UTF-16 surrogate is not allowed");
    }
  }
}

function assertCanonicalJson(value: unknown, path = "$", stack = new WeakSet<object>()): void {
  if (typeof value === "string") {
    assertPairedUtf16Surrogates(value, path);
    return;
  }
  if (value === null || typeof value === "boolean") return;
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
    const propertyPath = jsonPathForProperty(path, key);
    assertPairedUtf16Surrogates(key, propertyPath);
    assertCanonicalJson(value[key], propertyPath, stack);
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
