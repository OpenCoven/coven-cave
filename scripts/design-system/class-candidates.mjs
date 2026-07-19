const RAW_TEXT_RE = /^text-\[(?:length:)?([0-9]+(?:\.[0-9]+)?)px\](\/.+)?$/;
const HEX_COLOR_RE = /#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{4}|[0-9a-f]{3})(?![0-9a-f])/i;

function utilityStart(candidate) {
  let depth = 0;
  let quote = "";
  let escaped = false;
  let lastColon = -1;
  for (let index = 0; index < candidate.length; index += 1) {
    const char = candidate[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (quote) {
      if (char === quote) quote = "";
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }
    if (char === "[") depth += 1;
    else if (char === "]") depth = Math.max(0, depth - 1);
    else if (char === ":" && depth === 0) lastColon = index;
  }
  return lastColon + 1;
}

export function parseClassCandidate(candidate) {
  const start = utilityStart(candidate);
  const variants = candidate.slice(0, start);
  let utility = candidate.slice(start);
  const prefixImportant = utility.startsWith("!");
  const suffixImportant = utility.endsWith("!");
  if (prefixImportant) utility = utility.slice(1);
  if (suffixImportant) utility = utility.slice(0, -1);
  return { variants, utility, prefixImportant, suffixImportant };
}

export function formatClassCandidate(parts, utility) {
  return `${parts.variants}${parts.prefixImportant ? "!" : ""}${utility}${parts.suffixImportant ? "!" : ""}`;
}

export function transformClassCandidates(value, transform) {
  let output = "";
  let start = 0;
  let depth = 0;
  let quote = "";
  let escaped = false;

  for (let index = 0; index <= value.length; index += 1) {
    const char = value[index];
    if (index === value.length || (/\s/.test(char) && depth === 0 && !quote)) {
      const candidate = value.slice(start, index);
      output += transform(candidate, parseClassCandidate(candidate));
      if (index < value.length) output += char;
      start = index + 1;
      continue;
    }
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (quote) {
      if (char === quote) quote = "";
      continue;
    }
    if (char === "'" || char === '"') quote = char;
    else if (char === "[") depth += 1;
    else if (char === "]") depth = Math.max(0, depth - 1);
  }
  return output;
}

export function isRenderColorUtility(utility) {
  if (/(?:^|-)content-\[/.test(utility)) return false;
  return (
    /^(?:text|bg|border(?:-[trblxyse])?|divide|fill|stroke|shadow|drop-shadow|ring(?:-offset)?|outline|caret|accent|decoration|placeholder|from|via|to)-\[/.test(
      utility,
    ) ||
    /^\[(?:[a-z-]*color|fill|stroke|background(?:-color)?|border(?:-[a-z]+)?):/.test(
      utility,
    )
  );
}

export function stripUrlPayloads(value) {
  let output = "";
  let cursor = 0;
  while (cursor < value.length) {
    const match = /url\(/gi.exec(value.slice(cursor));
    if (!match) return output + value.slice(cursor);
    const start = cursor + match.index;
    output += value.slice(cursor, start) + "url()";
    let index = start + match[0].length;
    let quote = "";
    let escaped = false;
    for (; index < value.length; index += 1) {
      const char = value[index];
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === "\\") {
        escaped = true;
        continue;
      }
      if (quote) {
        if (char === quote) quote = "";
        continue;
      }
      if (char === "'" || char === '"') {
        quote = char;
        continue;
      }
      if (char === ")") {
        index += 1;
        break;
      }
    }
    cursor = index;
  }
  return output;
}

export function rawPxTextUtility(utility) {
  const match = RAW_TEXT_RE.exec(utility);
  return match ? { px: match[1], modifier: match[2] ?? "" } : null;
}

export function firstRawPxTextCandidate(value) {
  let found = null;
  transformClassCandidates(value, (candidate, parts) => {
    if (!found && rawPxTextUtility(parts.utility)) found = candidate;
    return candidate;
  });
  return found;
}

export function firstRenderHexColor(value) {
  let found = null;
  transformClassCandidates(value, (candidate, parts) => {
    if (!found && isRenderColorUtility(parts.utility)) {
      const match = HEX_COLOR_RE.exec(stripUrlPayloads(parts.utility));
      if (match) found = match[0];
    }
    return candidate;
  });
  return found;
}
