#!/usr/bin/env node
import { readFileSync } from "node:fs";

const PATTERNS = [
  ["OpenRouter API key", /sk-or-v1-[A-Za-z0-9_-]{32,}/g],
  ["AWS access key", /AKIA[0-9A-Z]{16}/g],
  ["AWS secret access key", /aws_secret_access_key\s*[:=]\s*["']?[A-Za-z0-9/+=]{30,}/gi],
  ["GitHub PAT", /(?:gh[pousr]_[A-Za-z0-9_]{30,}|github_pat_[A-Za-z0-9_]{20,})/g],
  ["Slack token", /xox[abprs]-[A-Za-z0-9-]{10,}/g],
  ["Stripe secret", /sk_(?:live|test)_[A-Za-z0-9]{20,}/g],
  ["OpenAI key", /sk-(?:proj-)?[A-Za-z0-9_-]{32,}/g],
  ["Anthropic key", /sk-ant-[A-Za-z0-9_-]{20,}/g],
  ["Google API key", /AIza[0-9A-Za-z_-]{30,}/g],
  ["Telegram bot token", /(?:^|[^0-9])[0-9]{8,11}:[A-Za-z0-9_-]{30,}/g],
  ["Bearer token", /Bearer\s+[A-Za-z0-9_.-]{16,}/gi],
  ["PEM private key", /BEGIN (?:(?:RSA|EC|OPENSSH|DSA|PGP|ENCRYPTED) )?PRIVATE KEY/g],
  [
    "password or token assignment",
    /(?:password|passwd|secret|api[_-]?key|access[_-]?token)\s*[:=]\s*["'][^"'\s]{8,}["']/gi,
  ],
  ["private Tailscale Serve host", /[A-Za-z0-9-]+\.[A-Za-z0-9-]+\.ts\.net(?::[0-9]+)?/g],
];

const SAFE_TAILSCALE_RE = /(?:^|[.])example\.ts\.net|<[^>]+>\.ts\.net|\*\.ts\.net/;

function usage() {
  console.error("usage: node scripts/secret-preflight.mjs [--stdin] [--label LABEL] [file ...]");
}

function parseArgs(argv) {
  const files = [];
  let stdin = false;
  let label = "secret preflight";

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--stdin") {
      stdin = true;
    } else if (arg === "--label") {
      const next = argv[i + 1];
      if (!next) {
        usage();
        process.exit(2);
      }
      label = next;
      i += 1;
    } else if (arg === "--help" || arg === "-h") {
      usage();
      process.exit(0);
    } else if (arg.startsWith("-")) {
      console.error(`unknown option: ${arg}`);
      usage();
      process.exit(2);
    } else {
      files.push(arg);
    }
  }

  if (!stdin && files.length === 0) {
    usage();
    process.exit(2);
  }

  return { files, stdin, label };
}

function readStdin() {
  return readFileSync(0, "utf8");
}

function lineForOffset(text, offset) {
  let line = 1;
  for (let i = 0; i < offset; i += 1) {
    if (text.charCodeAt(i) === 10) line += 1;
  }
  return line;
}

function scanText(source, text) {
  const hits = [];

  for (const [name, pattern] of PATTERNS) {
    pattern.lastIndex = 0;
    for (const match of text.matchAll(pattern)) {
      const value = match[0];
      if (name === "private Tailscale Serve host" && SAFE_TAILSCALE_RE.test(value)) continue;
      hits.push({ name, source, line: lineForOffset(text, match.index ?? 0) });
      if (hits.length >= 20) return hits;
    }
  }

  return hits;
}

const { files, stdin, label } = parseArgs(process.argv.slice(2));
const documents = [];
if (stdin) documents.push({ source: "stdin", text: readStdin() });
for (const file of files) {
  documents.push({ source: file, text: readFileSync(file, "utf8") });
}

const hits = documents.flatMap((doc) => scanText(doc.source, doc.text));
if (hits.length > 0) {
  console.error(`[secret-preflight blocked] ${label} contains possible secrets:`);
  for (const hit of hits.slice(0, 10)) {
    console.error(`  - ${hit.name} at ${hit.source}:${hit.line}`);
  }
  console.error("Secret values are intentionally not printed. Remove or redact them before sending/committing.");
  process.exit(1);
}

console.error(`[secret-preflight] ok (${documents.length} input${documents.length === 1 ? "" : "s"} scanned)`);
