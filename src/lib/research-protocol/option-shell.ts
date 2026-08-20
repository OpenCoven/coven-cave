import { types as nodeUtilTypes } from "node:util";

import {
  fail,
  pass,
  type ProtocolParseResult,
} from "./common.ts";

const arrayIsArray = Array.isArray;
const arrayPrototype = Array.prototype;
const objectPrototype = Object.prototype;
const getPrototypeOf = Object.getPrototypeOf;
const getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const defineProperty = Object.defineProperty;
const ownKeys = Reflect.ownKeys;
const apply = Reflect.apply;
const hasOwn = Object.hasOwn;
const isProxy = nodeUtilTypes.isProxy;
const objectToString = Object.prototype.toString;

type BrandProbe = (value: object) => "match" | "non-match" | "failure";

function canStructuredCloneWithoutUserCode(value: object): boolean {
  const seen = new WeakSet<object>();
  const pending = [value];
  while (pending.length > 0) {
    const current = pending.pop()!;
    if (seen.has(current)) continue;
    seen.add(current);
    if (isProxy(current)) return false;

    const isArray = arrayIsArray(current);
    const prototype = getPrototypeOf(current);
    if (
      isArray
        ? prototype !== arrayPrototype
        : prototype !== objectPrototype && prototype !== null
    ) {
      return false;
    }
    if (nodeIntrinsicBrandChecks.some((check) => check(current))) return false;

    for (const key of ownKeys(current)) {
      if (isArray && key === "length") continue;
      if (typeof key === "symbol") return false;
      const descriptor = getOwnPropertyDescriptor(current, key);
      if (
        !descriptor ||
        !descriptor.enumerable ||
        !hasOwn(descriptor, "value")
      ) {
        return false;
      }
      const propertyValue = descriptor.value;
      if (
        typeof propertyValue === "function" ||
        typeof propertyValue === "symbol"
      ) {
        return false;
      }
      if (typeof propertyValue === "object" && propertyValue !== null) {
        pending.push(propertyValue);
      }
    }
  }
  return true;
}

function dataProperty(object: object, key: PropertyKey): unknown {
  const descriptor = getOwnPropertyDescriptor(object, key);
  return descriptor && hasOwn(descriptor, "value")
    ? descriptor.value
    : undefined;
}

function receiverProbe(
  container: object,
  constructorName: string,
  memberName: PropertyKey,
  memberKind: "get" | "value",
): BrandProbe | undefined {
  const Constructor = dataProperty(container, constructorName);
  if (typeof Constructor !== "function") return undefined;
  const prototype = dataProperty(Constructor, "prototype");
  if (typeof prototype !== "object" || prototype === null) return undefined;
  const member = getOwnPropertyDescriptor(prototype, memberName)?.[memberKind];
  if (typeof member !== "function") return undefined;
  return (value) => {
    try {
      apply(member, value, []);
      return "match";
    } catch (error) {
      return error instanceof TypeError ? "non-match" : "failure";
    }
  };
}

function argumentProbe(
  container: object,
  constructorName: string,
  memberName: PropertyKey,
): BrandProbe | undefined {
  const Constructor = dataProperty(container, constructorName);
  if (typeof Constructor !== "function") return undefined;
  const member = dataProperty(Constructor, memberName);
  if (typeof member !== "function") return undefined;
  return (value) => {
    try {
      apply(member, Constructor, [value]);
      return "match";
    } catch (error) {
      return error instanceof TypeError ? "non-match" : "failure";
    }
  };
}

function webBrandProbes(): readonly BrandProbe[] {
  const probes: BrandProbe[] = [];
  for (const [constructorName, memberName, memberKind] of [
    ["URL", "href", "get"],
    ["URLSearchParams", "entries", "value"],
    ["Request", "method", "get"],
    ["Response", "status", "get"],
    ["Headers", "entries", "value"],
    ["FormData", "entries", "value"],
    ["Blob", "size", "get"],
    ["File", "name", "get"],
    ["AbortController", "signal", "get"],
    ["AbortSignal", "aborted", "get"],
    ["ReadableStream", "locked", "get"],
    ["WritableStream", "locked", "get"],
    ["TransformStream", "readable", "get"],
    ["TextEncoder", "encoding", "get"],
    ["TextDecoder", "encoding", "get"],
    ["DOMException", "name", "get"],
  ] as const) {
    const probe = receiverProbe(
      globalThis,
      constructorName,
      memberName,
      memberKind,
    );
    if (probe) probes.push(probe);
  }
  const intl = dataProperty(globalThis, "Intl");
  if (typeof intl === "object" && intl !== null) {
    for (const constructorName of [
      "Collator",
      "DateTimeFormat",
      "DisplayNames",
      "DurationFormat",
      "ListFormat",
      "NumberFormat",
      "PluralRules",
      "RelativeTimeFormat",
      "Segmenter",
    ]) {
      const probe = receiverProbe(
        intl,
        constructorName,
        "resolvedOptions",
        "value",
      );
      if (probe) probes.push(probe);
    }
  }
  const webAssembly = dataProperty(globalThis, "WebAssembly");
  if (typeof webAssembly === "object" && webAssembly !== null) {
    const moduleProbe = argumentProbe(webAssembly, "Module", "exports");
    if (moduleProbe) probes.push(moduleProbe);
    for (const [constructorName, memberName] of [
      ["Instance", "exports"],
      ["Memory", "buffer"],
      ["Table", "length"],
      ["Global", "value"],
    ] as const) {
      const probe = receiverProbe(
        webAssembly,
        constructorName,
        memberName,
        "get",
      );
      if (probe) probes.push(probe);
    }
  }
  const structuredClone = dataProperty(globalThis, "structuredClone");
  if (typeof structuredClone === "function") {
    let dataCloneErrorPrototype: object | undefined;
    try {
      apply(structuredClone, undefined, [webBrandProbes]);
    } catch (error) {
      if (typeof error === "object" && error !== null) {
        dataCloneErrorPrototype = getPrototypeOf(error);
      }
    }
    if (dataCloneErrorPrototype) {
      probes.push((value) => {
        if (!canStructuredCloneWithoutUserCode(value)) return "failure";
        try {
          apply(structuredClone, undefined, [value]);
        } catch (error) {
          return typeof error === "object" &&
            error !== null &&
            getPrototypeOf(error) === dataCloneErrorPrototype
            ? "match"
            : "failure";
        }
        return "non-match";
      });
    }
  }
  return probes;
}

const webIntrinsicBrandProbes = webBrandProbes();
const nodeIntrinsicBrandChecks = Object.values(nodeUtilTypes).filter(
  (check): check is (value: unknown) => boolean =>
    typeof check === "function" && check !== isProxy,
);

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
  if (isProxy(value)) {
    return fail("invalid_value", path, `${label} must be an ordinary array`);
  }
  if (!arrayIsArray(value)) {
    return fail("invalid_type", path, `${label} must be an array`);
  }
  if (getPrototypeOf(value) !== arrayPrototype) {
    return fail("invalid_value", path, `${label} must use the standard Array prototype`);
  }

  const lengthDescriptor = getOwnPropertyDescriptor(value, "length");
  const length = lengthDescriptor?.value;
  if (
    !lengthDescriptor ||
    !hasOwn(lengthDescriptor, "value") ||
    lengthDescriptor.enumerable ||
    lengthDescriptor.configurable ||
    typeof length !== "number" ||
    !Number.isInteger(length) ||
    length < 0 ||
    length >= 0x100000000
  ) {
    return fail("invalid_value", path, `${label} must have a valid array length`);
  }

  let indexedKeyCount = 0;
  for (const key of ownKeys(value)) {
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
    const descriptor = getOwnPropertyDescriptor(value, String(index));
    if (
      !descriptor ||
      !descriptor.enumerable ||
      !hasOwn(descriptor, "value")
    ) {
      return fail(
        "invalid_value",
        path,
        `${label} indices must be enumerable data properties`,
      );
    }
    defineProperty(snapshot, index, {
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
  if (isProxy(value)) {
    return fail("invalid_value", path, `${label} must be an ordinary object`);
  }
  if (arrayIsArray(value)) {
    return fail("invalid_type", path, `${label} must be an object`);
  }
  const prototype = getPrototypeOf(value);
  if (prototype !== objectPrototype && prototype !== null) {
    return fail("invalid_value", path, `${label} must be an ordinary object`);
  }
  if (
    nodeIntrinsicBrandChecks.some((check) => check(value)) ||
    apply(objectToString, value, []) !== "[object Object]"
  ) {
    return fail("invalid_value", path, `${label} must be an ordinary object`);
  }
  for (const probe of webIntrinsicBrandProbes) {
    if (probe(value) !== "non-match") {
      return fail("invalid_value", path, `${label} must be an ordinary object`);
    }
  }

  const properties: Array<readonly [string, PropertyDescriptor]> = [];
  for (const key of ownKeys(value)) {
    if (typeof key === "symbol") {
      return fail("invalid_value", path, `${label} must not have symbol properties`);
    }
    const descriptor = getOwnPropertyDescriptor(value, key);
    if (
      !descriptor ||
      !descriptor.enumerable ||
      !hasOwn(descriptor, "value")
    ) {
      return fail(
        "invalid_value",
        path,
        `${label} fields must be enumerable data properties`,
      );
    }
    properties.push([key, descriptor]);
  }

  const snapshot = Object.create(null) as Record<string, unknown>;
  for (const [key, descriptor] of properties) {
    defineProperty(snapshot, key, {
      value: descriptor.value,
      enumerable: true,
      configurable: true,
      writable: true,
    });
  }
  return pass(snapshot);
}
