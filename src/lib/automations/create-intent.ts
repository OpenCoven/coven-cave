import type { CodexAutomation } from "../codex-automations-types.ts";

export type AutomationCreateFields = {
  name: string; prompt: string; rrule: string; familiars: string[]; cwds: string[]; tags: string[]; model: string;
  start: "paused" | "active";
};
export type AutomationCreateSession = { pending?: { input: string; body: string } };
export type AutomationCreateResult =
  | { kind: "failed"; message: string }
  | { kind: "created" | "resolved"; automation: CodexAutomation };

/** Keep the exact draft request until its outcome is known. The server's two
 * non-running steps reconcile with the same keys after a lost response. */
export async function createWithStableIntent(input: AutomationCreateFields, session: AutomationCreateSession): Promise<AutomationCreateResult> {
  if (!session.pending) {
    const { start: _start, ...fields } = input;
    session.pending = { input: JSON.stringify(input), body: JSON.stringify({ ...fields,
      id: `cron-${crypto.randomUUID()}`, adoptionKey: `cave-create:${crypto.randomUUID()}`,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone }) };
  }
  const pending = session.pending;
  try {
    const res = await fetch("/api/codex-automations", { method: "POST", headers: { "content-type": "application/json" }, body: pending.body });
    const json = await res.json().catch(() => null);
    if (!res.ok || json?.ok !== true) {
      if (res.status >= 400 && res.status < 500 && json?.uncertain !== true) delete session.pending;
      return { kind: "failed", message: typeof json?.error === "string" ? json.error : "Creation is unconfirmed. Create again to retry the original request." };
    }
    if (json.automation?.id !== JSON.parse(pending.body).id || json.automation?.status !== "PAUSED") {
      return { kind: "failed", message: "The created definition could not be confirmed paused. Retry the original request and review its state." };
    }
    delete session.pending;
    return { kind: pending.input === JSON.stringify(input) ? "created" : "resolved", automation: json.automation };
  } catch {
    return { kind: "failed", message: "Creation may have reached Coven. Create again to retry the original request with the same ID." };
  }
}
