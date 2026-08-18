import { createHash } from "node:crypto";

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

function assertNoProxyObjects(value: unknown): void {
  if (typeof value !== "object" || value === null) return;
  if (typeof globalThis.structuredClone !== "function") {
    throw createCanonicalJsonError("$", "standard structured clone support is required");
  }

  try {
    globalThis.structuredClone(value);
  } catch (error) {
    if (
      typeof error === "object"
      && error !== null
      && "name" in error
      && error.name === "DataCloneError"
    ) {
      throw createCanonicalJsonError("$", "Proxy objects are not allowed");
    }
    throw error;
  }
}

function isPlainJsonObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
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

function isCanonicalArrayIndex(key: string): boolean {
  if (!/^(?:0|[1-9]\d*)$/.test(key)) return false;
  const index = Number(key);
  return Number.isInteger(index) && index >= 0 && index < 0xffffffff;
}

function copyCanonicalJsonValueAtPath(
  value: unknown,
  path: string,
  seen: WeakSet<object>,
  traversedObjects: object[],
): unknown {
  if (typeof value === "string") {
    assertPairedUtf16Surrogates(value, path);
    return value;
  }
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw createCanonicalJsonError(path, "non-finite numbers are not allowed");
    }
    return value;
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
    if (Object.getPrototypeOf(value) !== Array.prototype) {
      throw createCanonicalJsonError(path, "arrays must use exact Array.prototype");
    }
    if (seen.has(value)) {
      throw createCanonicalJsonError(path, "cyclic or repeated object references are not allowed");
    }
    seen.add(value);
    traversedObjects.push(value);

    const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
    if (
      !lengthDescriptor
      || !Object.hasOwn(lengthDescriptor, "value")
      || lengthDescriptor.enumerable
      || lengthDescriptor.configurable
      || !lengthDescriptor.writable
    ) {
      throw createCanonicalJsonError(path, "arrays must have the standard length property");
    }
    const length = lengthDescriptor.value;
    if (
      typeof length !== "number"
      || !Number.isInteger(length)
      || length < 0
      || length >= 0x100000000
    ) {
      throw createCanonicalJsonError(path, "arrays must have a valid length");
    }

    const entries: Array<{
      descriptor: PropertyDescriptor;
      index: number;
      key: string;
    }> = [];
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key === "symbol") {
        throw createCanonicalJsonError(path, "symbol-keyed own properties are not allowed");
      }
      if (key === "length") continue;
      const propertyPath = jsonPathForProperty(path, key);
      if (!isCanonicalArrayIndex(key)) {
        throw createCanonicalJsonError(propertyPath, "arrays may not have extra string properties");
      }
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor) {
        throw createCanonicalJsonError(propertyPath, "array index descriptor is missing");
      }
      if (!descriptor.enumerable) {
        throw createCanonicalJsonError(propertyPath, "array indices must be enumerable");
      }
      if (!Object.hasOwn(descriptor, "value")) {
        throw createCanonicalJsonError(propertyPath, "array indices must be data properties");
      }
      entries.push({ descriptor, index: Number(key), key });
    }
    entries.sort((left, right) => left.index - right.index);
    for (let expectedIndex = 0; expectedIndex < entries.length; expectedIndex += 1) {
      if (entries[expectedIndex].index !== expectedIndex) {
        throw createCanonicalJsonError(
          jsonPathForIndex(path, expectedIndex),
          "sparse array holes are not allowed",
        );
      }
    }
    if (entries.length !== length) {
      throw createCanonicalJsonError(
        jsonPathForIndex(path, entries.length),
        "sparse array holes are not allowed",
      );
    }

    const copy = new Array<unknown>(length);
    for (const entry of entries) {
      Object.defineProperty(copy, entry.key, {
        value: copyCanonicalJsonValueAtPath(
          entry.descriptor.value,
          jsonPathForIndex(path, entry.index),
          seen,
          traversedObjects,
        ),
        enumerable: true,
        configurable: true,
        writable: true,
      });
    }
    return copy;
  }
  if (!isPlainJsonObject(value)) {
    throw createCanonicalJsonError(path, "only JSON objects and arrays are allowed");
  }
  if (seen.has(value)) {
    throw createCanonicalJsonError(path, "cyclic or repeated object references are not allowed");
  }
  seen.add(value);
  traversedObjects.push(value);

  const copy = Object.create(null) as Record<string, unknown>;
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key === "symbol") {
      throw createCanonicalJsonError(path, "symbol-keyed own properties are not allowed");
    }
    const propertyPath = jsonPathForProperty(path, key);
    assertPairedUtf16Surrogates(key, propertyPath);
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor) {
      throw createCanonicalJsonError(propertyPath, "property descriptor is missing");
    }
    if (!descriptor.enumerable) {
      throw createCanonicalJsonError(propertyPath, "non-enumerable own properties are not allowed");
    }
    if (!Object.hasOwn(descriptor, "value")) {
      throw createCanonicalJsonError(propertyPath, "accessor properties are not allowed");
    }
    Object.defineProperty(copy, key, {
      value: copyCanonicalJsonValueAtPath(
        descriptor.value,
        propertyPath,
        seen,
        traversedObjects,
      ),
      enumerable: true,
      configurable: true,
      writable: true,
    });
  }
  return copy;
}

export function copyCanonicalJsonValue<T>(value: T): T {
  const traversedObjects: object[] = [];
  const copy = copyCanonicalJsonValueAtPath(
    value,
    "$",
    new WeakSet<object>(),
    traversedObjects,
  ) as T;
  for (const traversedObject of traversedObjects) {
    assertNoProxyObjects(traversedObject);
  }
  return copy;
}

export function copyCanonicalJson(value: unknown): unknown {
  return copyCanonicalJsonValue(value);
}

function stringifyJsonPrimitive(value: string | number): string {
  const serialized = JSON.stringify(value);
  if (typeof serialized !== "string") {
    throw new TypeError("Value at $ is not canonical JSON: serialization failed");
  }
  return serialized;
}

function serializeCanonicalJson(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "string" || typeof value === "number") {
    return stringifyJsonPrimitive(value);
  }
  if (Array.isArray(value)) {
    const entries: string[] = [];
    for (let index = 0; index < value.length; index += 1) {
      entries.push(serializeCanonicalJson(value[index]));
    }
    return `[${entries.join(",")}]`;
  }

  const object = value as Record<string, unknown>;
  const entries: string[] = [];
  for (const key of Object.keys(object).sort()) {
    entries.push(`${stringifyJsonPrimitive(key)}:${serializeCanonicalJson(object[key])}`);
  }
  return `{${entries.join(",")}}`;
}

export function canonicalJson(value: unknown): string {
  return serializeCanonicalJson(copyCanonicalJsonValue(value));
}

export function sha256Digest(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

export function digestProtocolObject(value: unknown): string {
  if (!isPlainJsonObject(value)) {
    throw new TypeError("digestProtocolObject expects a JSON record");
  }
  const copy = copyCanonicalJsonValue(value);
  Reflect.deleteProperty(copy, "digest");
  return sha256Digest(serializeCanonicalJson(copy));
}
