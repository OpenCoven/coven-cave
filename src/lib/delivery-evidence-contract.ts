export const DELIVERY_EVIDENCE_HEADER = "Completion evidence contract:";

export function buildPromptWithDeliveryEvidenceContract(prompt: string): string {
  const text = prompt.trim();
  const contract = [
    DELIVERY_EVIDENCE_HEADER,
    "- Do not infer completion from plans, progress narration, or intent.",
    "- A requested research brief, report, synthesis, or other persistent file is complete only after the artifact exists and the final response gives its exact absolute path inside the runtime boundary.",
    "- A requested remote action is complete only when the final response gives a checkable URL, object ID, ref, message ID, or receipt.",
    "- If the answer itself is the deliverable, provide the completed answer; planning or progress text is not delivery.",
    "- Before the final response, classify each requested deliverable as verified with exact evidence, incomplete, or blocked.",
  ].join("\n");
  return text ? `${contract}\n\nTask and supplied context:\n${text}` : contract;
}
