/** Inert compatibility response for retired Cave-owned Ask Salem APIs. */
export function salemRetiredResponse(): Response {
  return Response.json(
    { ok: false, code: "salem-retired", error: "Ask Salem has been retired from Cave." },
    { status: 410, headers: { "Cache-Control": "no-store" } },
  );
}
