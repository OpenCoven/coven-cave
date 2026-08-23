import assert from "node:assert/strict";

import {
  RESEARCH_MEDIA_TICKET_PARAM,
  isValidResearchMediaTicketRequest,
  signResearchMediaTicket,
  verifyResearchMediaTicket,
} from "./research-media-ticket.ts";

const secret = "research-media-ticket-test-secret";
const familiarId = "rida";
const generationId = "gen_123";
const now = 1_800_000_000_000;

const ticket = await signResearchMediaTicket({
  secret,
  familiarId,
  generationId,
  expiresAt: now + 60_000,
  nonce: "nonceA",
});

{
  const result = await verifyResearchMediaTicket(ticket, secret, { familiarId, generationId }, now);
  assert.equal(result.ok, true);
  assert.equal(result.expiresAt, now + 60_000);
}

{
  const result = await verifyResearchMediaTicket(ticket, secret, { familiarId, generationId: "other" }, now);
  assert.deepEqual(result, { ok: false, reason: "scope" });
}

{
  const result = await verifyResearchMediaTicket(ticket, "other-secret", { familiarId, generationId }, now);
  assert.deepEqual(result, { ok: false, reason: "signature" });
}

{
  const expired = await signResearchMediaTicket({
    secret,
    familiarId,
    generationId,
    expiresAt: now - 1,
    nonce: "nonceExpired",
  });
  const result = await verifyResearchMediaTicket(expired, secret, { familiarId, generationId }, now);
  assert.deepEqual(result, { ok: false, reason: "expired" });
}

{
  const url = new URL("http://127.0.0.1:43123/api/research/generations/media");
  url.searchParams.set("familiarId", familiarId);
  url.searchParams.set("id", generationId);
  url.searchParams.set(RESEARCH_MEDIA_TICKET_PARAM, ticket);
  assert.equal(await isValidResearchMediaTicketRequest(new Request(url), secret), true);
  assert.equal(await isValidResearchMediaTicketRequest(new Request(url, { method: "HEAD" }), secret), true);
  assert.equal(await isValidResearchMediaTicketRequest(new Request(url, { method: "POST" }), secret), false);
  url.pathname = "/api/research/generations";
  assert.equal(await isValidResearchMediaTicketRequest(new Request(url), secret), false);
}

console.log("research-media-ticket.test.ts: ok");
