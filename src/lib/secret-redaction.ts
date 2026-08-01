export const REDACTED_SECRET = "[redacted]";

const SECRET_TERMINAL_WORDS = new Set([
  "auth",
  "authorization",
  "bearer",
  "cookie",
  "credential",
  "credentials",
  "jwt",
  "oauth",
  "pass",
  "password",
  "secret",
  "token",
]);

// "session" is deliberately NOT a terminal word (cave-3ww55). A session
// IDENTIFIER is a foreign key, not a credential, and treating it as one made
// `sessionId` unreadable: findSelfReport compared a redacted value and could
// never match, and appendSelfReport redacted before writing, so reports were
// persisted with the link to their session destroyed. A session TOKEN is still
// a credential — these pairs and the terminal words below keep every
// secret-bearing form covered.
const SECRET_TERMINAL_PAIRS = new Set([
  "api:key",
  "auth:token",
  "client:secret",
  "private:key",
  "refresh:token",
  "secret:key",
  "session:cookie",
  "session:credential",
  "session:credentials",
  "session:key",
  "session:secret",
  "session:token",
]);

const SECRET_KEY_MARKERS = new Set(["api", "auth", "client", "private", "secret", "session"]);

const AUTHORIZATION_SCHEMES = new Set([
  "basic",
  "bearer",
  "digest",
  "negotiate",
  "ntlm",
]);

const SAFE_SECRET_TRAILING_WORDS = new Set([
  "count",
  "duration",
  "length",
  "limit",
  "total",
  "usage",
]);

const MAX_ASSIGNMENT_NESTING = 64;
const MAX_REDACTION_DEPTH = 64;
const MAX_REDACTION_ENTRIES = 4_096;
const MAX_REDACTION_STRING_BYTES = 256 * 1_024;

const WHOLE_SECRET_PATTERNS: RegExp[] = [
  /\bBearer\s+[A-Za-z0-9._~+/=-]{20,}\b/gi,
  /\bsk-or-v1-[A-Za-z0-9_-]{32,}\b/g,
  /\b(?:sk|rk)-(?:proj-)?[A-Za-z0-9_-]{20,}\b/g,
  /\bsk-ant-[A-Za-z0-9_-]{20,}\b/g,
  /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]{20,}\b/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g,
  /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/g,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
  /\b[A-Za-z0-9+/]{32,}={0,2}\b/g,
];

export function redactSecretText(text: string): string {
  const jsonRedaction = redactJsonText(text);
  if (jsonRedaction !== undefined) return jsonRedaction;
  return redactSecretTextPlain(text);
}

function redactSecretTextPlain(text: string): string {
  let next = text;
  for (const pattern of WHOLE_SECRET_PATTERNS) {
    next = next.replace(pattern, REDACTED_SECRET);
  }
  next = next.replace(
    /([?&](?:access_token|api_key|auth|key|password|secret|token)=)[^&#\s]+/gi,
    `$1${REDACTED_SECRET}`,
  );
  next = redactSecretAssignments(next);
  next = next.replace(/\b(https?:\/\/[^:/\s]+:)[^@\s/]+(@)/gi, `$1${REDACTED_SECRET}$2`);
  return next;
}

export function redactSecretsDeep<T>(value: T): T {
  let result: unknown;
  const ancestors = new WeakSet<object>();
  const budget = { entries: 0, stringBytes: 0 };
  const stack: RedactionFrame[] = [
    {
      kind: "visit",
      value,
      depth: 0,
      assign: (next) => {
        result = next;
        return true;
      },
    },
  ];

  while (stack.length > 0) {
    const frame = stack.pop()!;
    if (frame.kind === "serialize") {
      try {
        if (!frame.assign(JSON.stringify(frame.holder.value) ?? JSON.stringify(REDACTED_SECRET))) {
          return REDACTED_SECRET as T;
        }
      } catch {
        if (!frame.assign(JSON.stringify(REDACTED_SECRET))) return REDACTED_SECRET as T;
      }
      continue;
    }
    if (frame.kind === "exit") {
      ancestors.delete(frame.value);
      continue;
    }

    if (frame.key && isSecretKey(frame.key)) {
      if (!frame.assign(REDACTED_SECRET)) return REDACTED_SECRET as T;
      continue;
    }

    if (typeof frame.value === "string") {
      if (!consumeStringBytes(frame.value, budget)) return REDACTED_SECRET as T;
      const decoded = decodeJsonValue(frame.value);
      if (decoded) {
        if (frame.depth >= MAX_REDACTION_DEPTH) return REDACTED_SECRET as T;
        const holder: { value?: unknown } = {};
        stack.push({ kind: "serialize", holder, assign: frame.assign });
        stack.push({
          kind: "visit",
          value: decoded.value,
          depth: frame.depth + 1,
          assign: (next) => {
            holder.value = next;
            return true;
          },
        });
        continue;
      }
      if (!frame.assign(redactSecretTextPlain(frame.value))) return REDACTED_SECRET as T;
      continue;
    }

    if (frame.value === null || typeof frame.value !== "object") {
      if (typeof frame.value === "function") return REDACTED_SECRET as T;
      if (!frame.assign(frame.value)) return REDACTED_SECRET as T;
      continue;
    }

    if (frame.depth > MAX_REDACTION_DEPTH || ancestors.has(frame.value)) {
      return REDACTED_SECRET as T;
    }

    const container = readContainer(frame.value, budget);
    if (!container || !frame.assign(container.output)) return REDACTED_SECRET as T;

    ancestors.add(frame.value);
    stack.push({ kind: "exit", value: frame.value });
    for (let index = container.children.length - 1; index >= 0; index -= 1) {
      const child = container.children[index]!;
      stack.push({
        kind: "visit",
        value: child.value,
        key: child.key,
        depth: frame.depth + 1,
        assign: child.assign,
      });
    }
  }

  return result as T;
}

interface RedactionBudget {
  entries: number;
  stringBytes: number;
}

interface RedactionChild {
  key: string;
  value: unknown;
  assign: (value: unknown) => boolean;
}

interface RedactionContainer {
  output: object;
  children: RedactionChild[];
}

type RedactionFrame =
  | {
      kind: "visit";
      value: unknown;
      key?: string;
      depth: number;
      assign: (value: unknown) => boolean;
    }
  | { kind: "exit"; value: object }
  | {
      kind: "serialize";
      holder: { value?: unknown };
      assign: (value: unknown) => boolean;
    };

function redactJsonText(text: string): string | undefined {
  const decoded = decodeJsonValue(text);
  if (!decoded) return undefined;

  const redacted = redactSecretsDeep(decoded.value);
  try {
    return JSON.stringify(redacted) ?? JSON.stringify(REDACTED_SECRET);
  } catch {
    return JSON.stringify(REDACTED_SECRET);
  }
}

function decodeJsonValue(value: string): { value: unknown } | undefined {
  try {
    return { value: JSON.parse(value) };
  } catch {
    return undefined;
  }
}

function readContainer(value: object, budget: RedactionBudget): RedactionContainer | undefined {
  try {
    const prototype = Object.getPrototypeOf(value);
    const keys = Reflect.ownKeys(value);

    if (Array.isArray(value)) {
      if (prototype !== Array.prototype) return undefined;
      const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
      if (!lengthDescriptor || !("value" in lengthDescriptor)) return undefined;
      const length = lengthDescriptor.value;
      if (
        typeof length !== "number" ||
        !Number.isSafeInteger(length) ||
        length < 0 ||
        length > MAX_REDACTION_ENTRIES - budget.entries
      ) {
        return undefined;
      }
      if (keys.length - 1 > MAX_REDACTION_ENTRIES - budget.entries) return undefined;

      budget.entries += length;
      const output: unknown[] = new Array(length);
      const children: RedactionChild[] = [];
      for (const key of keys) {
        if (key === "length") continue;
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (!descriptor) return undefined;
        if (!descriptor.enumerable) continue;
        if (typeof key !== "string" || !("value" in descriptor)) return undefined;
        if (!isArrayIndex(key, length)) {
          if (budget.entries >= MAX_REDACTION_ENTRIES) return undefined;
          budget.entries += 1;
        }
        if (!consumeStringBytes(key, budget)) return undefined;
        children.push({
          key,
          value: descriptor.value,
          assign: (next) => defineEnumerableValue(output, key, next),
        });
      }
      return { output, children };
    }

    if (prototype !== Object.prototype && prototype !== null) return undefined;
    if (keys.length > MAX_REDACTION_ENTRIES - budget.entries) return undefined;
    budget.entries += keys.length;

    const output: Record<string, unknown> =
      prototype === null ? Object.create(null) : {};
    const children: RedactionChild[] = [];
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor) return undefined;
      if (!descriptor.enumerable) continue;
      if (typeof key !== "string" || !("value" in descriptor)) return undefined;
      if (!consumeStringBytes(key, budget)) return undefined;
      children.push({
        key,
        value: descriptor.value,
        assign: (next) => defineEnumerableValue(output, key, next),
      });
    }
    return { output, children };
  } catch {
    return undefined;
  }
}

function defineEnumerableValue(target: object, key: string, value: unknown): boolean {
  try {
    Object.defineProperty(target, key, {
      configurable: true,
      enumerable: true,
      value,
      writable: true,
    });
    return true;
  } catch {
    return false;
  }
}

function isArrayIndex(key: string, length: number): boolean {
  const index = Number(key);
  return Number.isInteger(index) && index >= 0 && index < length && String(index) === key;
}

function consumeStringBytes(value: string, budget: RedactionBudget): boolean {
  let bytes = budget.stringBytes;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x7f) {
      bytes += 1;
    } else if (code <= 0x7ff) {
      bytes += 2;
    } else if (
      code >= 0xd800 &&
      code <= 0xdbff &&
      index + 1 < value.length &&
      value.charCodeAt(index + 1) >= 0xdc00 &&
      value.charCodeAt(index + 1) <= 0xdfff
    ) {
      bytes += 4;
      index += 1;
    } else {
      bytes += 3;
    }
    if (bytes > MAX_REDACTION_STRING_BYTES) return false;
  }
  budget.stringBytes = bytes;
  return true;
}

function isSecretKey(key: string): boolean {
  const words = normalizeKeyWords(key).map(normalizeSecretWord);
  if (words.length === 0) return false;

  // A key that is exactly `session` still redacts. Dropping "session" from the
  // terminal words (cave-3ww55) was about qualified identifiers like sessionId;
  // a bare `session=…` in a log line is as likely to be the token itself as
  // anything, and nothing else in this file would catch it.
  if (words.length === 1 && words[0] === "session") return true;

  for (let index = 1; index < words.length; index += 1) {
    if (SECRET_TERMINAL_PAIRS.has(`${words[index - 1]}:${words[index]}`)) return true;
    if (
      words[index] === "key" &&
      words.slice(0, index).some((word) => SECRET_KEY_MARKERS.has(word))
    ) {
      return true;
    }
  }

  const secretIndex = words.findIndex((word) => SECRET_TERMINAL_WORDS.has(word));
  if (secretIndex === -1) return false;
  if (secretIndex === words.length - 1) return true;
  return !words.slice(secretIndex + 1).every((word) => SAFE_SECRET_TRAILING_WORDS.has(word));
}

function normalizeSecretWord(word: string): string {
  if (word === "keys") return "key";
  if (word === "passwords") return "password";
  if (word === "secrets") return "secret";
  if (word === "tokens") return "token";
  return word;
}

function normalizeKeyWords(key: string): string[] {
  const words: string[] = [];
  let word = "";

  const flush = () => {
    if (!word) return;
    words.push(word.toLowerCase());
    word = "";
  };

  for (let index = 0; index < key.length; index += 1) {
    const char = key[index]!;
    if (!isAsciiLetter(char) && !isAsciiDigit(char)) {
      flush();
      continue;
    }

    if (
      word &&
      isAsciiUpper(char) &&
      (isAsciiLower(key[index - 1]) ||
        isAsciiDigit(key[index - 1]) ||
        (isAsciiUpper(key[index - 1]) && isAsciiLower(key[index + 1])))
    ) {
      flush();
    }
    word += char;
  }
  flush();
  return words;
}

function redactSecretAssignments(text: string): string {
  const chunks: string[] = [];
  let copiedThrough = 0;
  let index = 0;

  while (index < text.length) {
    const assignment = readAssignment(text, index);
    if (!assignment) {
      index += 1;
      continue;
    }

    if (!isSecretKey(assignment.key)) {
      index = assignment.keyEnd;
      continue;
    }

    const valueEnd = scanAssignmentValue(
      text,
      assignment.valueStart,
      assignment.key,
      assignment.separator,
    );
    chunks.push(text.slice(copiedThrough, assignment.valueStart), REDACTED_SECRET);
    copiedThrough = valueEnd;
    index = valueEnd;
  }

  if (chunks.length === 0) return text;
  chunks.push(text.slice(copiedThrough));
  return chunks.join("");
}

interface Assignment {
  key: string;
  keyEnd: number;
  separator: "=" | ":";
  valueStart: number;
}

function readAssignment(text: string, start: number): Assignment | undefined {
  const first = text[start];
  if (!first) return undefined;

  let key = "";
  let keyEnd = start;
  let quoted = false;

  if (first === '"' || first === "'") {
    quoted = true;
    const quote = first;
    let index = start + 1;
    while (index < text.length) {
      const char = text[index]!;
      if (char === "\\") {
        if (index + 1 >= text.length) return undefined;
        key += text[index + 1];
        index += 2;
        continue;
      }
      if (char === quote) {
        keyEnd = index + 1;
        break;
      }
      key += char;
      index += 1;
    }
    if (keyEnd === start) return undefined;
  } else {
    if (!isAsciiLetter(first) || isAssignmentKeyChar(text[start - 1])) return undefined;
    let index = start;
    while (isAssignmentKeyChar(text[index])) {
      key += text[index];
      index += 1;
    }
    keyEnd = index;
  }

  let separator = keyEnd;
  while (isHorizontalWhitespace(text[separator])) separator += 1;
  const separatorChar = text[separator];
  if (separatorChar !== "=" && separatorChar !== ":") return undefined;
  if (!quoted && separatorChar === ":" && text.slice(Math.max(0, start - 2), start) === "//") {
    return undefined;
  }

  let valueStart = separator + 1;
  while (isHorizontalWhitespace(text[valueStart])) valueStart += 1;
  if (text[valueStart] === "\r" || text[valueStart] === "\n") {
    if (separatorChar === ":") {
      let nextLineStart = valueStart;
      if (text[nextLineStart] === "\r") nextLineStart += 1;
      if (text[nextLineStart] === "\n") nextLineStart += 1;
      let indentedValueStart = nextLineStart;
      while (isHorizontalWhitespace(text[indentedValueStart])) indentedValueStart += 1;
      if (indentedValueStart > nextLineStart) valueStart = indentedValueStart;
    } else {
      let multilineValueStart = valueStart;
      while (isWhitespace(text[multilineValueStart])) multilineValueStart += 1;
      if (
        text[multilineValueStart] === "{" ||
        text[multilineValueStart] === "[" ||
        isAuthorizationKey(key)
      ) {
        valueStart = multilineValueStart;
      }
    }
  }
  return { key, keyEnd, separator: separatorChar, valueStart };
}

function scanAssignmentValue(
  text: string,
  start: number,
  key: string,
  separator: "=" | ":",
): number {
  if (separator === ":") {
    const first = text[start];
    if (
      isAuthorizationKey(key) ||
      (first !== '"' && first !== "'" && first !== "`" && first !== "{" && first !== "[")
    ) {
      return scanColonTextValue(text, start);
    }
  }

  const authorizationEnd = isAuthorizationKey(key)
    ? scanAuthorizationCredential(text, start)
    : undefined;
  if (authorizationEnd !== undefined) return authorizationEnd;

  let index = start;

  while (index < text.length) {
    const char = text[index]!;
    if (char === "{" || char === "[") {
      index = scanBalancedValue(text, index);
      if (index >= text.length) return text.length;
      continue;
    }
    if (char === "$" && text[index + 1] === "(") {
      index = scanCommandSubstitution(text, index);
      if (index >= text.length) return text.length;
      continue;
    }
    if (char === "`") {
      const quoteEnd = scanBacktickValue(text, index);
      if (quoteEnd === -1) return text.length;
      index = quoteEnd;
      continue;
    }
    if (char === '"' || char === "'") {
      const quoteEnd = scanQuotedValue(text, index, char);
      if (quoteEnd === -1) return text.length;
      index = quoteEnd;
      continue;
    }
    if (char === "\\") {
      index = Math.min(text.length, index + 2);
      continue;
    }
    if (isAssignmentDelimiter(char)) return index;
    index += 1;
  }
  return text.length;
}

function scanColonTextValue(text: string, start: number): number {
  let end = scanLineEnd(text, start);

  while (end < text.length) {
    let nextLine = end;
    if (text[nextLine] === "\r") nextLine += 1;
    if (text[nextLine] === "\n") nextLine += 1;
    if (nextLine === end) return end;

    let contentStart = nextLine;
    while (isHorizontalWhitespace(text[contentStart])) contentStart += 1;
    if (contentStart === nextLine) return end;
    end = scanLineEnd(text, contentStart);
  }

  return end;
}

function scanLineEnd(text: string, start: number): number {
  let end = start;
  while (end < text.length && text[end] !== "\r" && text[end] !== "\n") end += 1;
  return end;
}

function scanAuthorizationCredential(text: string, start: number): number | undefined {
  let schemeEnd = start;
  while (
    isAsciiLetter(text[schemeEnd]) ||
    isAsciiDigit(text[schemeEnd]) ||
    text[schemeEnd] === "-"
  ) {
    schemeEnd += 1;
  }
  if (schemeEnd === start) return undefined;
  if (!AUTHORIZATION_SCHEMES.has(text.slice(start, schemeEnd).toLowerCase())) {
    return undefined;
  }

  let credentialStart = schemeEnd;
  while (isHorizontalWhitespace(text[credentialStart])) credentialStart += 1;
  if (credentialStart === schemeEnd) return undefined;
  if (credentialStart >= text.length) return text.length;

  const first = text[credentialStart]!;
  if (first === '"' || first === "'") {
    const quoteEnd = scanQuotedValue(text, credentialStart, first);
    return quoteEnd === -1 ? text.length : quoteEnd;
  }
  if (first === "`") {
    const quoteEnd = scanBacktickValue(text, credentialStart);
    return quoteEnd === -1 ? text.length : quoteEnd;
  }

  let credentialEnd = credentialStart;
  while (
    credentialEnd < text.length &&
    !isAuthorizationCredentialDelimiter(text[credentialEnd]!)
  ) {
    credentialEnd += 1;
  }
  return credentialEnd === credentialStart ? text.length : credentialEnd;
}

function scanQuotedValue(text: string, start: number, quote: string): number {
  let index = start + 1;
  while (index < text.length) {
    const char = text[index]!;
    if (char === "\\") {
      index = Math.min(text.length, index + 2);
      continue;
    }
    if (char === quote) return index + 1;
    index += 1;
  }
  return -1;
}

function scanBacktickValue(text: string, start: number): number {
  let index = start + 1;
  while (index < text.length) {
    const char = text[index]!;
    if (char === "\\") {
      index = Math.min(text.length, index + 2);
      continue;
    }
    if (char === "`") return index + 1;
    index += 1;
  }
  return -1;
}

function scanCommandSubstitution(text: string, start: number): number {
  let depth = 1;
  let index = start + 2;

  while (index < text.length) {
    const char = text[index]!;
    if (char === '"' || char === "'") {
      const quoteEnd = scanQuotedValue(text, index, char);
      if (quoteEnd === -1) return text.length;
      index = quoteEnd;
      continue;
    }
    if (char === "`") {
      const quoteEnd = scanBacktickValue(text, index);
      if (quoteEnd === -1) return text.length;
      index = quoteEnd;
      continue;
    }
    if (char === "\\") {
      index = Math.min(text.length, index + 2);
      continue;
    }
    if (char === "$" && text[index + 1] === "(") {
      if (depth >= MAX_ASSIGNMENT_NESTING) return text.length;
      depth += 1;
      index += 2;
      continue;
    }
    if (char === "(") {
      if (depth >= MAX_ASSIGNMENT_NESTING) return text.length;
      depth += 1;
      index += 1;
      continue;
    }
    if (char === ")") {
      depth -= 1;
      index += 1;
      if (depth === 0) return index;
      continue;
    }
    index += 1;
  }
  return text.length;
}

function scanBalancedValue(text: string, start: number): number {
  const closers: string[] = [];
  let index = start;

  while (index < text.length) {
    const char = text[index]!;
    if (char === '"' || char === "'") {
      const quoteEnd = scanQuotedValue(text, index, char);
      if (quoteEnd === -1) return text.length;
      index = quoteEnd;
      continue;
    }
    if (char === "\\") {
      index = Math.min(text.length, index + 2);
      continue;
    }
    if (char === "{" || char === "[") {
      if (closers.length >= MAX_ASSIGNMENT_NESTING) return text.length;
      closers.push(char === "{" ? "}" : "]");
      index += 1;
      continue;
    }
    if (char === "}" || char === "]") {
      if (closers.pop() !== char) return text.length;
      index += 1;
      if (closers.length === 0) return index;
      continue;
    }
    index += 1;
  }
  return text.length;
}

function isAssignmentKeyChar(char: string | undefined): boolean {
  return Boolean(char && (isAsciiLetter(char) || isAsciiDigit(char) || char === "_" || char === "-"));
}

function isAssignmentDelimiter(char: string): boolean {
  return " \t\r\n\f\v,;|&<>()}]".includes(char);
}

function isAuthorizationCredentialDelimiter(char: string): boolean {
  return isWhitespace(char) || ",;|&<>".includes(char);
}

function isHorizontalWhitespace(char: string | undefined): boolean {
  return char === " " || char === "\t";
}

function isWhitespace(char: string | undefined): boolean {
  return Boolean(char && " \t\r\n\f\v".includes(char));
}

function isAuthorizationKey(key: string): boolean {
  return normalizeKeyWords(key).at(-1) === "authorization";
}

function isAsciiLetter(char: string | undefined): boolean {
  return isAsciiLower(char) || isAsciiUpper(char);
}

function isAsciiLower(char: string | undefined): boolean {
  return Boolean(char && char >= "a" && char <= "z");
}

function isAsciiUpper(char: string | undefined): boolean {
  return Boolean(char && char >= "A" && char <= "Z");
}

function isAsciiDigit(char: string | undefined): boolean {
  return Boolean(char && char >= "0" && char <= "9");
}
