const MAX_DEPTH = 64;
const MAX_NODE_PROPERTY_BUDGET = 1_000_000;
const MAX_OBJECT_KEYS = 1_024;
const MAX_ARRAY_LENGTH = 1_024;

export class StrictJsonSnapshotError extends Error {
  constructor(message = "Value must be strict accessor-free plain JSON data.") {
    super(message);
    this.name = "StrictJsonSnapshotError";
  }
}

function fail(): never {
  throw new StrictJsonSnapshotError();
}

function freezeJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    for (const entry of value) freezeJson(entry);
    return Object.freeze(value);
  }
  if (value !== null && typeof value === "object") {
    for (const entry of Object.values(value as Record<string, unknown>)) {
      freezeJson(entry);
    }
    return Object.freeze(value);
  }
  return value;
}

export function createStrictJsonSnapshot<T>(input: T): T {
  const ancestors = new WeakSet<object>();
  let budget = 0;

  const consume = (amount: number): void => {
    if (amount > MAX_NODE_PROPERTY_BUDGET - budget) fail();
    budget += amount;
  };

  const visit = (value: unknown, depth: number): unknown => {
    if (depth > MAX_DEPTH) fail();
    if (value === null || typeof value === "string" || typeof value === "boolean") {
      consume(1);
      return value;
    }
    if (typeof value === "number") {
      consume(1);
      if (!Number.isFinite(value)) fail();
      return value;
    }
    if (typeof value !== "object" || ancestors.has(value)) fail();

    let keys: PropertyKey[];
    let isArray: boolean;
    try {
      keys = Reflect.ownKeys(value);
      isArray = Array.isArray(value);
    } catch {
      fail();
    }
    if (keys.some((key) => typeof key === "symbol")) fail();

    if (isArray) {
      let lengthDescriptor: PropertyDescriptor | undefined;
      try {
        lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
      } catch {
        fail();
      }
      if (
        lengthDescriptor === undefined
        || !("value" in lengthDescriptor)
        || !Number.isSafeInteger(lengthDescriptor.value)
        || lengthDescriptor.value < 0
        || lengthDescriptor.value > MAX_ARRAY_LENGTH
      ) {
        fail();
      }
      const length = lengthDescriptor.value as number;
      if (keys.length !== length + 1) fail();
      const keySet = new Set(keys as string[]);
      if (!keySet.has("length")) fail();
      for (let index = 0; index < length; index += 1) {
        if (!keySet.has(String(index))) fail();
      }
      consume(keys.length + 1);

      const descriptors: PropertyDescriptor[] = [];
      for (let index = 0; index < length; index += 1) {
        let descriptor: PropertyDescriptor | undefined;
        try {
          descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        } catch {
          fail();
        }
        if (
          descriptor === undefined
          || !("value" in descriptor)
          || descriptor.enumerable !== true
        ) {
          fail();
        }
        descriptors.push(descriptor);
      }
      let prototype: object | null;
      try {
        prototype = Object.getPrototypeOf(value);
      } catch {
        fail();
      }
      if (prototype !== Array.prototype) fail();

      ancestors.add(value);
      try {
        return descriptors.map((descriptor) => visit(descriptor.value, depth + 1));
      } finally {
        ancestors.delete(value);
      }
    }

    if (keys.length > MAX_OBJECT_KEYS) fail();
    if ((keys as string[]).includes("toJSON")) fail();
    consume(keys.length + 1);
    const descriptors = new Map<string, PropertyDescriptor>();
    for (const key of keys as string[]) {
      let descriptor: PropertyDescriptor | undefined;
      try {
        descriptor = Object.getOwnPropertyDescriptor(value, key);
      } catch {
        fail();
      }
      if (
        descriptor === undefined
        || !("value" in descriptor)
        || descriptor.enumerable !== true
      ) {
        fail();
      }
      descriptors.set(key, descriptor);
    }
    let prototype: object | null;
    try {
      prototype = Object.getPrototypeOf(value);
    } catch {
      fail();
    }
    if (prototype !== Object.prototype && prototype !== null) fail();

    ancestors.add(value);
    try {
      const snapshot = Object.create(null) as Record<string, unknown>;
      for (const [key, descriptor] of descriptors) {
        Object.defineProperty(snapshot, key, {
          configurable: false,
          enumerable: true,
          value: visit(descriptor.value, depth + 1),
          writable: false,
        });
      }
      return snapshot;
    } finally {
      ancestors.delete(value);
    }
  };

  return freezeJson(visit(input, 0)) as T;
}
