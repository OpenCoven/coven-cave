function invalidPath(): Error {
  return new Error("Client v1 authority path is not canonical.");
}

export function canonicalClientV1Pathname(pathname: string): string {
  if (
    !pathname.startsWith("/")
    || pathname.includes("\\")
  ) {
    throw invalidPath();
  }
  if (pathname === "/") return pathname;

  const segments = pathname.slice(1).split("/");
  if (segments.some((segment) => segment.length === 0)) {
    throw invalidPath();
  }

  for (const segment of segments) {
    let decoded: string;
    try {
      decoded = decodeURIComponent(segment);
    } catch {
      throw invalidPath();
    }
    if (
      decoded === "."
      || decoded === ".."
      || /%[0-9A-Fa-f]{2}/u.test(decoded)
      || decoded.includes("\\")
      || encodeURIComponent(decoded) !== segment
    ) {
      throw invalidPath();
    }
  }
  return pathname;
}
