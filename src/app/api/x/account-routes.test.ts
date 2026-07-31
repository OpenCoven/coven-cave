import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const connection = readFileSync(new URL("./connection/route.ts", import.meta.url), "utf8");
const start = readFileSync(new URL("./oauth/start/route.ts", import.meta.url), "utf8");

assert.match(connection, /export async function GET\(req: Request\)/);
assert.match(connection, /export async function DELETE\(req: Request\)/);
assert.match(connection, /rejectNonLocalRequest\(req\)/g);
assert.match(connection, /xCredentialService\.getConnectionStatus\(\)/);
assert.match(connection, /xOAuthService\.flowStatus\(\)/);
assert.match(connection, /oauthFlowId/);
assert.match(connection, /oauthOutcome/);
assert.match(connection, /xOAuthService\.cancelAll\(\)/);
assert.match(connection, /xCredentialService\.disconnect\(\)/);
assert.match(connection, /\{ ok: true \}/);
assert.doesNotMatch(connection, /accessToken|refreshToken/);

assert.match(start, /export async function POST\(req: Request\)/);
assert.match(start, /rejectNonLocalRequest\(req\)/);
assert.match(start, /readJsonBody<XOAuthStartBody>\(req, MAX_BODY_BYTES\)/);
assert.match(start, /capability !== "research" && capability !== "publish"/);
assert.match(start, /flowId/);
assert.match(start, /xOAuthService\.start\(\{ capability, flowId \}\)/);
assert.match(start, /export async function DELETE\(req: Request\)/);
assert.match(start, /xOAuthService\.cancel\(flowId\)/);
assert.doesNotMatch(start, /xOAuthService\.cancel\(\)/);

console.log("account-routes.test.ts: ok");
