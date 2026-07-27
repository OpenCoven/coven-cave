import path from "node:path";

export function isPathWithinRoot(root, candidate) {
  const relative = path.relative(root, candidate);
  return (
    relative === "" ||
    (relative !== ".." &&
      !relative.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relative))
  );
}

export function classifyMemoryOpenProbe(result) {
  if (
    result?.kind === "exit" &&
    result.code === 0 &&
    result.signal === null
  ) {
    return "available";
  }

  const output = [result?.stdout, result?.stderr]
    .filter((value) => typeof value === "string")
    .join("\n");
  const recognizedUnsupportedCommand =
    result?.kind === "exit" &&
    result.code === 2 &&
    result.signal === null &&
    (/\b(?:unknown|unrecognized)\s+(?:subcommand|command)\s+['"`]?(?:memory|open)\b/i.test(
      output,
    ) ||
      (/^error: unexpected argument 'open' found\r?$/m.test(output) &&
        /^Usage: coven memory(?:\s|$)/m.test(output)));

  return recognizedUnsupportedCommand ? "missing" : "failed";
}

export function parseStandaloneLaunchUrl(output) {
  const match = /(?:^|\n)Coven Memory: ([^\r\n]+)/.exec(output);
  if (!match) return null;

  const emitted = match[1];
  const loopback =
    /^http:\/\/(?:127\.0\.0\.1|\[::1\]):([1-9]\d{0,4})\/$/.exec(
      emitted,
    );
  if (!loopback || Number(loopback[1]) > 65_535) {
    throw new Error("invalid standalone launch URL");
  }

  let url;
  try {
    url = new URL(emitted);
  } catch {
    throw new Error("invalid standalone launch URL");
  }
  if (
    url.protocol !== "http:" ||
    (url.hostname !== "127.0.0.1" && url.hostname !== "[::1]") ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new Error("invalid standalone launch URL");
  }
  return url;
}
