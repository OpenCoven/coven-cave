const PATTERNS: Array<{ name: string; re: RegExp }> = [
  { name: "openai", re: /sk-(?:proj-)?[A-Za-z0-9_\-]{20,}/g },
  { name: "anthropic", re: /sk-ant-[A-Za-z0-9_\-]{20,}/g },
  { name: "github_pat", re: /gh[pousr]_[A-Za-z0-9]{30,}/g },
  { name: "aws_access_key", re: /AKIA[0-9A-Z]{12,}/g },
  { name: "aws_secret", re: /(?<=aws_secret_access_key\s*[:=]\s*['"]?)[A-Za-z0-9/+=]{30,}/gi },
  { name: "google_api", re: /AIza[0-9A-Za-z_\-]{30,}/g },
  { name: "slack_token", re: /xox[abprs]-[A-Za-z0-9\-]{10,}/g },
  { name: "stripe_secret", re: /sk_(?:live|test)_[A-Za-z0-9]{20,}/g },
  { name: "bearer", re: /(?<=Bearer\s)[A-Za-z0-9_\-]{16,}/gi },
  { name: "jwt", re: /eyJ[A-Za-z0-9_\-]{8,}\.eyJ[A-Za-z0-9_\-]{8,}\.[A-Za-z0-9_\-]{8,}/g },
  { name: "private_key_block", re: /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/g },
  { name: "password_assignment", re: /(?<=(?:password|passwd|secret|token|api_key)\s*[:=]\s*['"])[^'"\n]{6,}(?=['"])/gi },
  { name: "env_secret_line", re: /(?<=^[A-Z][A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD|API|PRIVATE)[A-Z0-9_]*\s*=\s*)['"]?[^'"\n#]{8,}['"]?/gm },
  { name: "tg_bot_token", re: /\b\d{8,11}:[A-Za-z0-9_\-]{30,}\b/g },
];

export type RedactResult = {
  text: string;
  redactions: Record<string, number>;
};

export function redact(input: string): RedactResult {
  let out = input;
  const redactions: Record<string, number> = {};
  for (const { name, re } of PATTERNS) {
    out = out.replace(re, () => {
      redactions[name] = (redactions[name] ?? 0) + 1;
      return `[REDACTED:${name}]`;
    });
  }
  return { text: out, redactions };
}

export function countRedactions(redactions: Record<string, number>): number {
  return Object.values(redactions).reduce((acc, n) => acc + n, 0);
}
