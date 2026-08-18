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

const SENSITIVE_EXTENSION_KEY_RE = new RegExp(
  `(?:${SENSITIVE_EXTENSION_KEY_PATTERN})|(?:${SENSITIVE_EXTENSION_VARIANT_KEY_PATTERN})`,
);
const NO_DECLARED_FIELDS: ReadonlySet<string> = new Set();

export function isSensitiveExtensionKey(key: string): boolean {
  return SENSITIVE_EXTENSION_KEY_RE.test(key);
}

function childPath(path: string, key: string): string {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key)
    ? `${path}.${key}`
    : `${path}[${JSON.stringify(key)}]`;
}

export function validateSafeExtensionKeys(
  value: unknown,
  path: string,
  declaredFields: ReadonlySet<string> = NO_DECLARED_FIELDS,
): ProtocolParseResult<void> {
  if (Array.isArray(value)) {
    for (const [index, entry] of value.entries()) {
      const nested = validateSafeExtensionKeys(entry, `${path}[${index}]`);
      if (!nested.ok) return nested;
    }
    return pass(undefined);
  }
  if (!isRecord(value)) return pass(undefined);

  for (const key of Object.keys(value)) {
    if (declaredFields.has(key)) continue;
    const keyPath = childPath(path, key);
    if (isSensitiveExtensionKey(key)) {
      return fail(
        "semantic_conflict",
        keyPath,
        `Sensitive protocol extensions must not contain ${key}`,
      );
    }
    const nested = validateSafeExtensionKeys(value[key], keyPath);
    if (!nested.ok) return nested;
  }
  return pass(undefined);
}
