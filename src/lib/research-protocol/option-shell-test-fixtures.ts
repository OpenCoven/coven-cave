type ObjectFactory = readonly [label: string, create: () => object];
type IntegrityOperation = readonly [
  label: string,
  apply: (value: object) => object,
];

const nonExtensibleIntegrityOperations: readonly IntegrityOperation[] = [
  ["preventExtensions", Object.preventExtensions],
  ["sealed", Object.seal],
  ["frozen", Object.freeze],
];

function availableWebObjectFactories(): ObjectFactory[] {
  const factories: ObjectFactory[] = [];

  if (typeof URLSearchParams === "function") {
    factories.push([
      "URLSearchParams",
      () => new URLSearchParams("topic=research"),
    ]);
  }
  if (typeof Headers === "function") {
    factories.push(["Headers", () => new Headers({ accept: "text/plain" })]);
  }
  if (typeof Request === "function") {
    factories.push([
      "Request",
      () => new Request("https://example.com/research"),
    ]);
  }
  if (typeof Response === "function") {
    factories.push(["Response", () => new Response(null, { status: 204 })]);
  }
  if (typeof FormData === "function") {
    factories.push(["FormData", () => new FormData()]);
  }
  if (typeof Blob === "function") {
    factories.push(["Blob", () => new Blob(["research"])]);
  }
  if (typeof File === "function") {
    factories.push([
      "File",
      () => new File(["research"], "research.txt"),
    ]);
  }
  if (typeof AbortController === "function") {
    factories.push(["AbortController", () => new AbortController()]);
  }
  if (typeof AbortSignal === "function" && typeof AbortController === "function") {
    factories.push(["AbortSignal", () => new AbortController().signal]);
  }
  if (typeof ReadableStream === "function") {
    factories.push(["ReadableStream", () => new ReadableStream()]);
  }
  if (typeof WritableStream === "function") {
    factories.push(["WritableStream", () => new WritableStream()]);
  }
  if (typeof TransformStream === "function") {
    factories.push(["TransformStream", () => new TransformStream()]);
  }
  if (typeof TextEncoder === "function") {
    factories.push(["TextEncoder", () => new TextEncoder()]);
  }
  if (typeof TextDecoder === "function") {
    factories.push(["TextDecoder", () => new TextDecoder()]);
  }
  if (typeof DOMException === "function") {
    factories.push([
      "DOMException",
      () => new DOMException("research", "DataError"),
    ]);
  }

  if (typeof Intl === "object" && Intl !== null) {
    const intl = Intl as unknown as Record<string, unknown>;
    const intlFormatters: ReadonlyArray<
      readonly [name: string, args: readonly unknown[]]
    > = [
      ["Collator", []],
      ["DateTimeFormat", []],
      ["DisplayNames", [["en"], { type: "language" }]],
      ["DurationFormat", []],
      ["ListFormat", []],
      ["NumberFormat", []],
      ["PluralRules", []],
      ["RelativeTimeFormat", []],
      ["Segmenter", []],
    ];
    for (const [name, args] of intlFormatters) {
      const Constructor = intl[name];
      if (typeof Constructor === "function") {
        factories.push([
          `Intl.${name}`,
          () => Reflect.construct(Constructor, [...args]) as object,
        ]);
      }
    }
  }

  if (typeof WebAssembly === "object") {
    const emptyModule = () =>
      new WebAssembly.Module(
        Uint8Array.of(0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00),
      );
    if (typeof WebAssembly.Module === "function") {
      factories.push(["WebAssembly.Module", emptyModule]);
    }
    if (
      typeof WebAssembly.Module === "function"
      && typeof WebAssembly.Instance === "function"
    ) {
      factories.push([
        "WebAssembly.Instance",
        () => new WebAssembly.Instance(emptyModule()),
      ]);
    }
    if (typeof WebAssembly.Memory === "function") {
      factories.push([
        "WebAssembly.Memory",
        () => new WebAssembly.Memory({ initial: 1 }),
      ]);
    }
    if (typeof WebAssembly.Table === "function") {
      factories.push([
        "WebAssembly.Table",
        () => new WebAssembly.Table({ element: "externref", initial: 0 }),
      ]);
    }
    if (typeof WebAssembly.Global === "function") {
      factories.push([
        "WebAssembly.Global",
        () => new WebAssembly.Global({ value: "i32" }, 0),
      ]);
    }
  }

  return factories;
}

export function spoofedWebOptionShells(
  properties: Readonly<Record<string, unknown>>,
): Array<readonly [label: string, value: object]> {
  const values: Array<readonly [string, object]> = [];
  for (const [label, create] of availableWebObjectFactories()) {
    for (const prototype of [Object.prototype, null]) {
      const value = create();
      Object.setPrototypeOf(value, prototype);
      Object.assign(value, properties);
      values.push([
        `${label} with ${prototype === null ? "null" : "Object"} prototype`,
        value,
      ]);
    }
  }
  return values;
}

export function nonExtensibleSpoofedFetchOptionShells(
  properties: Readonly<Record<string, unknown>>,
): Array<readonly [label: string, value: object]> {
  const values: Array<readonly [string, object]> = [];
  const fetchFamily = new Set(["Headers", "Request", "Response", "FormData"]);
  for (const [label, create] of availableWebObjectFactories()) {
    if (!fetchFamily.has(label)) continue;
    for (const prototype of [Object.prototype, null]) {
      for (const [integrityLabel, applyIntegrity] of nonExtensibleIntegrityOperations) {
        const value = create();
        Object.setPrototypeOf(value, prototype);
        Object.assign(value, properties);
        applyIntegrity(value);
        values.push([
          `${integrityLabel} ${label} with ${
            prototype === null ? "null" : "Object"
          } prototype`,
          value,
        ]);
      }
    }
  }
  return values;
}

export function nonExtensibleOrdinaryOptionShells(
  properties: Readonly<Record<string, unknown>>,
): Array<readonly [label: string, value: object]> {
  const values: Array<readonly [string, object]> = [];
  for (const prototype of [Object.prototype, null]) {
    for (const [integrityLabel, applyIntegrity] of nonExtensibleIntegrityOperations) {
      const value = Object.assign(Object.create(prototype), properties) as object;
      applyIntegrity(value);
      values.push([
        `${integrityLabel} ordinary ${
          prototype === null ? "null" : "Object"
        } prototype`,
        value,
      ]);
    }
  }
  return values;
}
