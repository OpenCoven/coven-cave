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
  "session",
  "token",
]);

const SECRET_TERMINAL_PAIRS = new Set([
  "api:key",
  "auth:token",
  "client:secret",
  "private:key",
  "refresh:token",
]);

const MAX_ASSIGNMENT_NESTING = 64;

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
  return redactValue(value, undefined) as T;
}

function redactValue(value: unknown, key: string | undefined): unknown {
  if (key && isSecretKey(key)) return REDACTED_SECRET;

  if (typeof value === "string") return redactSecretText(value);
  if (Array.isArray(value)) return value.map((item) => redactValue(item, undefined));
  if (!value || typeof value !== "object") return value;

  const out: Record<string, unknown> = {};
  for (const [childKey, childValue] of Object.entries(value)) {
    out[childKey] = redactValue(childValue, childKey);
  }
  return out;
}

function isSecretKey(key: string): boolean {
  const words = normalizeKeyWords(key);
  const last = words.at(-1);
  if (!last) return false;
  if (SECRET_TERMINAL_WORDS.has(last)) return true;
  if (words.length < 2) return false;
  return SECRET_TERMINAL_PAIRS.has(`${words.at(-2)}:${last}`);
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

    const valueEnd = scanAssignmentValue(text, assignment.valueStart);
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
  return { key, keyEnd, valueStart };
}

function scanAssignmentValue(text: string, start: number): number {
  let index = start;

  if (text[index] === "{" || text[index] === "[") {
    index = scanBalancedValue(text, index);
    if (index >= text.length) return text.length;
  }

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
    if (isAssignmentDelimiter(char)) return index;
    index += 1;
  }
  return text.length;
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

function isHorizontalWhitespace(char: string | undefined): boolean {
  return char === " " || char === "\t";
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
