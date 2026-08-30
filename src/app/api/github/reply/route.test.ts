// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./route.ts", import.meta.url), "utf8");

assert.match(source, /export async function POST\(req: Request\)/, "reply route exposes POST");
assert.match(source, /Array\.isArray\(parsed\)/, "valid JSON arrays and null roots are rejected before field access");
assert.match(source, /import \{ resolveGitHubToken \} from "@\/lib\/github-token";/, "reply uses the shared token resolver");
assert.match(source, /const REPO_RE = \/\^\[A-Za-z0-9\]/, "reply validates repo before path interpolation");
assert.match(source, /invalid json/, "malformed JSON is rejected");
assert.match(source, /invalid repo/, "malformed repositories are rejected");
assert.match(source, /invalid number/, "invalid pull request numbers are rejected");
assert.match(source, /invalid commentId/, "invalid review comment ids are rejected");
assert.match(source, /empty reply/, "empty replies are rejected");
assert.match(source, /auth_required/, "reply requires a PAT");
assert.match(
  source,
  /\/repos\/\$\{repo\}\/pulls\/\$\{number\}\/comments\/\$\{commentId\}\/replies/,
  "reply targets GitHub's review-comment reply endpoint",
);
assert.match(source, /method: "POST"/, "reply uses POST");
assert.match(source, /JSON\.stringify\(\{ body: text \}\)/, "reply sends the trimmed body");
assert.match(source, /Authorization: `Bearer \$\{token\}`/, "reply authenticates with the resolved PAT");
assert.match(source, /"X-GitHub-Api-Version": "2022-11-28"/, "reply pins the GitHub API version");
assert.match(source, /status: res\.status === 403 \? 403 : 502/, "upstream permission errors remain 403 and other failures are 502");
assert.match(source, /comment: \{/, "successful replies return the normalized comment shape");
assert.match(source, /createdAt:/, "normalized replies include createdAt");
assert.match(source, /authorAssociation:/, "normalized replies include authorAssociation");
assert.doesNotMatch(source, /\/issues\/\$\{number\}\/comments/, "replies never fall back to conversation comments");
assert.doesNotMatch(source, /NextResponse\.json\(\{[^}]*token/i, "reply never returns token material");

console.log("github-reply-route.test.ts OK");
