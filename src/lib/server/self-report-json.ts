function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export function stripSelfReportJsonFence(raw: string): string {
  let text = raw.trim();

  if (text.startsWith("```")) {
    let body = text.slice(3);
    if (body.slice(0, 4).toLowerCase() === "json") {
      body = body.slice(4);
    }
    text = body.trimStart();
  }

  if (text.endsWith("```")) {
    text = text.slice(0, -3).trimEnd();
  }

  return text;
}

function firstBalancedObject(text: string): string | null {
  let start = -1;
  let bracketDepth = 0;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (start === -1) {
      // A suggestion-only response is not a report. Once inside the report,
      // marker text is ordinary JSON string content and must stay untouched.
      if (text.startsWith("<coven:next-paths>", index)) return null;
      if (character === "[") bracketDepth += 1;
      else if (character === "]") bracketDepth = Math.max(0, bracketDepth - 1);
      else if (character === '"') inString = true;
      else if (character === "{") {
        // Skip balanced bracketed prose, but never promote an array element
        // into the top-level report, even when its array is incomplete.
        if (bracketDepth > 0) return null;
        start = index;
        depth = 1;
      }
      continue;
    }
    if (character === '"') inString = true;
    else if (character === "{") depth += 1;
    else if (character === "}") {
      depth -= 1;
      if (depth === 0) return text.slice(start, index + 1);
    }
  }
  return null;
}

// These lexical repairs preserve complete values. They never supply missing
// keys, colons, quotes, values, or closing delimiters; JSON.parse still validates
// the entire first balanced candidate after repair.
function repairObjectSyntax(text: string): string {
  const tokens: Array<{ start: number; end: number; text: string; string: boolean }> = [];
  let index = 0;
  while (index < text.length) {
    if (/[ \t\r\n]/.test(text[index])) {
      index += 1;
      continue;
    }
    const start = index;
    const isString = text[index] === '"';
    let token = text[index++];
    if (isString) {
      let escaped = false;
      while (index < text.length) {
        const character = text[index++];
        if (!escaped && character.charCodeAt(0) < 0x20) {
          token += `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`;
        } else {
          token += character;
        }
        if (escaped) escaped = false;
        else if (character === "\\") escaped = true;
        else if (character === '"') break;
      }
      // Reject incomplete strings and invalid escapes rather than repairing
      // quotes or guessing what the model intended to write.
      JSON.parse(token);
    } else if (!"{}[],:".includes(token)) {
      while (index < text.length && !/[ \t\r\n{}\[\],:"]/.test(text[index])) {
        token += text[index++];
      }
    }
    tokens.push({ start, end: index, text: token, string: isString });
  }

  const containers: string[] = [];
  const pieces: string[] = [];
  let end = 0;
  for (let position = 0; position < tokens.length; position += 1) {
    const token = tokens[position];
    const previous = tokens[position - 1];
    const next = tokens[position + 1];
    pieces.push(text.slice(end, token.start));
    const inObject = containers.at(-1) === "{";
    if (inObject && token.string && previous?.string &&
      tokens[position - 2]?.text === ":" && next?.text === ":") {
      pieces.push(",");
    }
    const previousIsValue = previous && (previous.string ||
      previous.text === "}" || previous.text === "]" ||
      /^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)$/.test(previous.text));
    const trailingObjectComma = inObject && token.text === "," &&
      next?.text === "}" && previousIsValue;
    if (!trailingObjectComma) pieces.push(token.text);
    if (!token.string) {
      if (token.text === "{" || token.text === "[") containers.push(token.text);
      else if (token.text === "}" || token.text === "]") containers.pop();
    }
    end = token.end;
  }
  pieces.push(text.slice(end));
  return pieces.join("");
}

export function parseSelfReportJsonObject(raw: string): Record<string, unknown> {
  const text = stripSelfReportJsonFence(raw);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    const object = firstBalancedObject(text);
    if (object === null) throw error;
    // Parse only the first candidate; malformed reports must not fall through
    // to a nested or later object that happens to be valid JSON.
    try {
      parsed = JSON.parse(object);
    } catch {
      parsed = JSON.parse(repairObjectSyntax(object));
    }
  }
  if (!isRecord(parsed)) throw new Error("response was not an object");
  return parsed;
}
