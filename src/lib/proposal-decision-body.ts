type DecisionBody = { expectedRevision?: unknown; note?: unknown };

export type ProposalDecisionBodyResult =
  | { ok: true; expectedRevision: string | undefined; note: string | undefined }
  | { ok: false; error: "invalid json body" | "invalid expectedRevision" | "invalid note" };

export function parseProposalDecisionBody(rawBody: string): ProposalDecisionBodyResult {
  let body: DecisionBody = {};
  if (rawBody.trim() !== "") {
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawBody);
    } catch {
      return { ok: false, error: "invalid json body" };
    }
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      body = parsed as DecisionBody;
    }
  }

  const expectedRevision = body.expectedRevision;
  if (
    expectedRevision !== undefined &&
    (typeof expectedRevision !== "string" || !/^[0-9a-f]{64}$/.test(expectedRevision))
  ) {
    return { ok: false, error: "invalid expectedRevision" };
  }
  if ("note" in body && body.note !== null && typeof body.note !== "string") {
    return { ok: false, error: "invalid note" };
  }

  return {
    ok: true,
    expectedRevision,
    note: typeof body.note === "string" ? body.note : undefined,
  };
}
