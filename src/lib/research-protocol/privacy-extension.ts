import {
  fail,
  isRecord,
  pass,
  type ProtocolParseResult,
} from "./common.ts";

const SENSITIVE_WORD_SEQUENCES = [
  ["prompt"],
  ["excerpt"],
  ["text"],
  ["content"],
  ["blob"],
  ["filename"],
  ["path"],
  ["credential"],
  ["secret"],
  ["local", "path"],
  ["file", "path"],
  ["object", "key"],
  ["object", "store", "key"],
  ["storage", "key"],
  ["bucket", "key"],
  ["deleted", "content"],
] as const;
const SENSITIVE_PREFIXES = ["private", "privacy", "raw"] as const;
const EXTENSION_SUFFIXES = [
  "value",
  "values",
  "data",
  "field",
  "fields",
  "item",
  "items",
  "list",
  "map",
  "metadata",
  "hint",
  "hints",
  "ref",
  "refs",
] as const;
const DANGEROUS_COMPONENTS = [
  "object",
  "store",
  "storage",
  "bucket",
  "key",
] as const;
const DANGEROUS_PATH_SEQUENCES = [
  ["object", "key"],
  ["object", "store", "key"],
  ["store", "key"],
  ["storage", "key"],
  ["bucket", "key"],
] as const;
const DANGEROUS_PATH_COMPONENTS = new Set<string>(DANGEROUS_COMPONENTS);
const ASCII_PROPERTY_NAME_RE = /^[\u0000-\u007f]*$/;

function caseInsensitiveWord(word: string): string {
  return [...word]
    .map((character) => `[${character}${character.toUpperCase()}]`)
    .join("");
}

function sequencePattern(
  words: readonly string[],
  separator: string,
): string {
  return words.map(caseInsensitiveWord).join(separator);
}

const TOKEN_PATTERN = SENSITIVE_WORD_SEQUENCES
  .map((words) => `${sequencePattern(words, "[_.-]*")}[sS]?`)
  .join("|");
const CAMEL_TOKEN_PATTERN = SENSITIVE_WORD_SEQUENCES
  .map((words) => {
    const compact = words.join("");
    return `${compact[0]!.toUpperCase()}${caseInsensitiveWord(compact.slice(1))}[sS]?`;
  })
  .join("|");
const UPPER_TOKEN_PATTERN = SENSITIVE_WORD_SEQUENCES
  .map((words) => `${words.join("").toUpperCase()}S?`)
  .join("|");
const PREFIX_PATTERN = SENSITIVE_PREFIXES.map(caseInsensitiveWord).join("|");
const SUFFIX_PATTERN = EXTENSION_SUFFIXES.map(caseInsensitiveWord).join("|");
const DANGEROUS_COMPONENT_PATTERN = DANGEROUS_COMPONENTS
  .map(caseInsensitiveWord)
  .join("|");
const COMPACT_TOKEN_PATTERN = SENSITIVE_WORD_SEQUENCES
  .map((words) => `${sequencePattern(words, "")}[sS]?`)
  .join("|");

export const SENSITIVE_EXTENSION_KEY_PATTERN =
  `(?:` +
  `(?:^|[_.-])(?:${TOKEN_PATTERN})(?:$|[_.-]|[A-Z0-9])|` +
  `(?:^|[_.-]|[a-z0-9])(?:${CAMEL_TOKEN_PATTERN})(?:$|[_.-]|[A-Z0-9])|` +
  `(?:^|[_.-]|[a-z0-9])(?:${UPPER_TOKEN_PATTERN})(?:$|[_.-]|[A-Za-z0-9])` +
  `)`;

export const SENSITIVE_EXTENSION_VARIANT_KEY_PATTERN =
  `^(?:(?:${PREFIX_PATTERN})[_.-]*)?` +
  `(?:${TOKEN_PATTERN})` +
  `(?:[_.-]*(?:${SUFFIX_PATTERN}))?$`;

export const SENSITIVE_EXTENSION_COMPONENT_KEY_PATTERN =
  `^(?:${DANGEROUS_COMPONENT_PATTERN})[sS]?$`;

export const SENSITIVE_EXTENSION_COMPOUND_KEY_PATTERN =
  `^(?:(?:${PREFIX_PATTERN})[_.-]*)?` +
  `(?:${COMPACT_TOKEN_PATTERN})` +
  `(?:${caseInsensitiveWord("payload")})[sS]?$`;

const SENSITIVE_EXTENSION_KEY_RE = new RegExp(
  `(?:${SENSITIVE_EXTENSION_KEY_PATTERN})|` +
    `(?:${SENSITIVE_EXTENSION_VARIANT_KEY_PATTERN})|` +
    `(?:${SENSITIVE_EXTENSION_COMPOUND_KEY_PATTERN})`,
);
const NO_DECLARED_FIELDS: ReadonlySet<string> = new Set();

export function isSensitiveExtensionKey(key: string): boolean {
  return SENSITIVE_EXTENSION_KEY_RE.test(key.normalize("NFKC"));
}

function childPath(path: string, key: string): string {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key)
    ? `${path}.${key}`
    : `${path}[${JSON.stringify(key)}]`;
}

function extensionPathComponents(key: string): string[] {
  return key
    .normalize("NFKC")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .split(/[^A-Za-z0-9]+/)
    .filter((component) => component.length > 0)
    .map((component) => component.toLowerCase())
    .map((component) => {
      if (
        component.endsWith("s") &&
        DANGEROUS_PATH_COMPONENTS.has(component.slice(0, -1))
      ) {
        return component.slice(0, -1);
      }
      return component;
    });
}

function hasDangerousPathSuffix(components: readonly string[]): boolean {
  return DANGEROUS_PATH_SEQUENCES.some((sequence) => {
    if (sequence.length > components.length) return false;
    const offset = components.length - sequence.length;
    return sequence.every(
      (component, index) => components[offset + index] === component,
    );
  });
}

function validateSafeExtensionKeysAtPath(
  value: unknown,
  path: string,
  declaredFields: ReadonlySet<string>,
  extensionPath: readonly string[],
): ProtocolParseResult<void> {
  if (Array.isArray(value)) {
    for (const [index, entry] of value.entries()) {
      const nested = validateSafeExtensionKeysAtPath(
        entry,
        `${path}[${index}]`,
        NO_DECLARED_FIELDS,
        extensionPath,
      );
      if (!nested.ok) return nested;
    }
    return pass(undefined);
  }
  if (!isRecord(value)) return pass(undefined);

  for (const key of Object.keys(value)) {
    if (declaredFields.has(key)) continue;
    const keyPath = childPath(path, key);
    const normalizedKey = key.normalize("NFKC");
    const nestedExtensionPath = [
      ...extensionPath,
      ...extensionPathComponents(normalizedKey),
    ];
    if (
      isSensitiveExtensionKey(normalizedKey) ||
      !ASCII_PROPERTY_NAME_RE.test(key) ||
      hasDangerousPathSuffix(nestedExtensionPath)
    ) {
      return fail(
        "semantic_conflict",
        keyPath,
        `Sensitive protocol extensions must not contain ${key}`,
      );
    }
    const nested = validateSafeExtensionKeysAtPath(
      value[key],
      keyPath,
      NO_DECLARED_FIELDS,
      nestedExtensionPath,
    );
    if (!nested.ok) return nested;
  }
  return pass(undefined);
}

export function validateSafeExtensionKeys(
  value: unknown,
  path: string,
  declaredFields: ReadonlySet<string> = NO_DECLARED_FIELDS,
): ProtocolParseResult<void> {
  return validateSafeExtensionKeysAtPath(value, path, declaredFields, []);
}
