/**
 * Shared JSON clone helpers for Client v1 envelope builders.
 *
 * contract.ts and responses.ts previously carried byte-identical local copies
 * of these two helpers (cave-vqljb). Both builders need the same guarantee —
 * cloning must preserve the original prototype and must survive an own
 * `__proto__` payload key, which a plain spread or `JSON.parse(JSON.stringify)`
 * cannot do. Keeping one reviewed implementation here means a future change to
 * clone semantics is reviewed once instead of drifting between two copies.
 */

/**
 * Assigns `value` onto `target[key]` through `Object.defineProperty` so an own
 * `__proto__` data key is stored as a plain enumerable property instead of
 * mutating the object's prototype.
 */
export function defineEnumerableValue(
  target: Record<string, unknown>,
  key: string,
  value: unknown,
): void {
  Object.defineProperty(target, key, {
    configurable: true,
    enumerable: true,
    value,
    writable: true,
  });
}

/**
 * Deep-clones a JSON-ish value, preserving the prototype of non-array objects
 * and enumerability semantics. Scalar values are returned as-is.
 */
export function cloneClientV1JsonValue<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((entry) => cloneClientV1JsonValue(entry)) as T;
  }
  if (value === null || typeof value !== "object") {
    return value;
  }

  const clone = Object.create(Object.getPrototypeOf(value)) as Record<string, unknown>;
  for (const [key, entry] of Object.entries(value)) {
    defineEnumerableValue(clone, key, cloneClientV1JsonValue(entry));
  }
  return clone as T;
}
