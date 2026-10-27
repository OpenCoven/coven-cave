// The Cave-local automations domain: inbox reminders and scheduled chat. This
// is the server's activation switch for those workers (#6295), distinct from
// the daemon-owned Coven Automations routines and from room visibility, which
// is a UI gate and not a lifecycle control.
//
// Disabling the domain pauses admitted work with its intent retained: the
// workers own no timer and admit no pass, stored reminders and scheduled sends
// stay exactly as written, and their routes keep serving the data for
// recovery, backup, export and privacy operations. Re-enabling starts one owner
// whose first pass delivers what became due in the meantime, once; records
// already marked fired or claimed are never replayed.
export type AutomationsDomain = {
  enabled: boolean;
  reason: "enabled" | "disabled";
};

export function resolveAutomationsDomain(setting?: string | null): AutomationsDomain {
  const value = setting?.trim().toLowerCase();
  const enabled = value !== "0" && value !== "false" && value !== "off";
  return { enabled, reason: enabled ? "enabled" : "disabled" };
}

/** Read when a worker starts; a changed setting takes effect at the next start. */
export function automationsDomain(): AutomationsDomain {
  return resolveAutomationsDomain(process.env.COVEN_CAVE_AUTOMATIONS_ENABLED);
}
