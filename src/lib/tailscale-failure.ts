export type TailscaleFailureKind =
  | "pairing-secret"
  | "not-installed"
  | "signed-out"
  | "not-running"
  | "serve-failed"
  | "unknown";

export function classifyTailscaleFailureKind(raw: string): TailscaleFailureKind {
  const text = raw.toLowerCase();

  if (text.includes("pnpm dev") || text.includes("access token") || text.includes("pairing secret")) {
    return "pairing-secret";
  }
  if (text.includes("tailscale") && (text.includes("not installed") || text.includes("cli not found"))) {
    return "not-installed";
  }
  if (text.includes("tailscale") && (text.includes("signed out") || text.includes("logged out"))) {
    return "signed-out";
  }
  if (
    text.includes("tailscale") &&
    (text.includes("not connected") ||
      text.includes("not running") ||
      text.includes("stopped") ||
      text.includes("unreachable"))
  ) {
    return "not-running";
  }
  if (/\bserve\b/.test(text)) {
    return "serve-failed";
  }
  return "unknown";
}
