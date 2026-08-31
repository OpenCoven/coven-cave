#!/usr/bin/env node

import { pathToFileURL } from "node:url";

const HUMAN_EMAIL_RE = /^([0-9]+)\+([A-Za-z0-9-]+)@users\.noreply\.github\.com$/;
const CO_AUTHOR_PREFIX_RE = /^\s*Co-authored-by:/i;
const CO_AUTHOR_RE = /^\s*Co-authored-by:\s+(.+?)\s+<([^<>]+)>\s*$/i;
const AI_LOGIN_RE =
  /^(copilot|github-copilot|copilot-swe-agent|chatgpt|gpt-[0-9][a-z0-9.-]*|openai|anthropic|codex|cursor|aider|devin-ai|gemini-ai|grok|xai|meta-ai|mistral-ai|qwen-ai|deepseek-ai|kimi-ai|codeium|windsurf|sourcegraph-cody)$/i;
const AI_IDENTITY_RE =
  /(?:^|[^a-z0-9])(copilot|claude|chatgpt|gpt(?:-[0-9][a-z0-9.-]*)?|openai|anthropic|codex|cursor|aider|devin|gemini|grok|xai|llama|metaai|mistral|qwen|deepseek|kimi|codeium|windsurf|cody)(?:[^a-z0-9]|$)/i;
const AI_FOOTER_RE =
  /(?:generated|authored|written|assisted|made|powered)\s+(?:with|by).*?(?:copilot|claude|chatgpt|gpt(?:-[0-9][a-z0-9.-]*)?|openai|anthropic|codex|cursor|aider|devin|gemini|grok|xai|llama|metaai|mistral|qwen|deepseek|kimi|codeium|windsurf|cody)/i;

function fail(message) {
  throw new Error(`pr-squash-message: ${message}`);
}

function parseCoAuthor(line) {
  if (!CO_AUTHOR_PREFIX_RE.test(line)) return null;

  const match = CO_AUTHOR_RE.exec(line);
  if (!match) fail(`malformed Co-authored-by trailer: ${line.trim()}`);

  const name = match[1].trim();
  const email = match[2].trim();
  if (!name) fail(`malformed Co-authored-by trailer: ${line.trim()}`);
  const emailMatch = HUMAN_EMAIL_RE.exec(email);

  if (!emailMatch) {
    if (AI_IDENTITY_RE.test(`${name} ${email}`)) return { kind: "ai" };
    fail(
      `Co-authored-by trailers must use a numeric GitHub no-reply identity: ${line.trim()}`,
    );
  }
  if (AI_LOGIN_RE.test(emailMatch[2])) return { kind: "ai" };

  return {
    kind: "human",
    emailKey: email.toLowerCase(),
    trailer: `Co-authored-by: ${name} <${email}>`,
  };
}

function cleanBody(body, humanTrailers) {
  const kept = [];
  for (const line of String(body ?? "").replace(/\r\n?/g, "\n").split("\n")) {
    const coAuthor = parseCoAuthor(line);
    if (coAuthor?.kind === "human") {
      humanTrailers.set(coAuthor.emailKey, coAuthor.trailer);
      continue;
    }
    if (coAuthor?.kind === "ai" || AI_FOOTER_RE.test(line)) continue;
    kept.push(line);
  }
  return kept.join("\n").trim();
}

export function prepareSquashMessage(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    fail("expected a JSON object on stdin");
  }

  const subject = String(input.title ?? "").replace(/\s+/g, " ").trim();
  if (!subject) fail("pull request title is required");

  const humanTrailers = new Map();
  const body = cleanBody(input.body, humanTrailers);
  const commits = Array.isArray(input.commits) ? input.commits : [];
  for (const commit of commits) {
    cleanBody(commit?.messageBody, humanTrailers);
  }

  const trailers = [...humanTrailers.values()];
  return {
    subject,
    body: [body, trailers.join("\n")].filter(Boolean).join("\n\n"),
  };
}

async function main() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const input = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  process.stdout.write(`${JSON.stringify(prepareSquashMessage(input))}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
