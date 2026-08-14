import assert from "node:assert/strict";
import test from "node:test";
import {
  buildPromptWithDeliveryEvidenceContract,
  DELIVERY_EVIDENCE_HEADER,
} from "./delivery-evidence-contract.ts";

test("completion evidence requires persistent research paths and remote receipts", () => {
  const prompt = buildPromptWithDeliveryEvidenceContract("Research storage engines.");
  assert.ok(prompt.startsWith(DELIVERY_EVIDENCE_HEADER));
  assert.match(prompt, /research brief, report, synthesis/i);
  assert.match(prompt, /exact absolute path inside the runtime boundary/i);
  assert.match(prompt, /URL, object ID, ref, message ID, or receipt/i);
  assert.match(prompt, /verified with exact evidence, incomplete, or blocked/i);
  assert.ok(prompt.endsWith("Research storage engines."));
});

test("an inline answer remains valid delivery evidence", () => {
  const prompt = buildPromptWithDeliveryEvidenceContract("Explain the result inline.");
  assert.match(prompt, /If the answer itself is the deliverable, provide the completed answer/);
});
