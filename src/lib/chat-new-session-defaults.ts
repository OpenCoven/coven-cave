// New-session defaults (Chat.dc.html 2b — "Save as default").
//
// Without this, a brand-new chat infers its project from `recentProjectRoot`
// (the most recent chat's project — see resolveChatProjectSelection). That is a
// decent guess and a poor commitment: one throwaway chat in the wrong repo and
// every new session starts there. "Save as default" pins the current selection
// instead, so the inference only applies until you have an opinion.
//
// Scope is the project, and ONLY the project — a stable id rather than a root,
// so a moved checkout keeps resolving.
//
// Two things deliberately excluded:
//   • branch — not a preference at all. It is the checkout's real state, changed
//     by switching or creating a worktree, so "defaulting" it would either lie
//     or mutate the repo at session start.
//   • model  — deferred, not forgotten (cave-x0k78). The model subsystem carries
//     override SCOPE semantics (runtime-default vs next-message), a pending
//     familiar model, and a usage-plan refresh; a persisted default has to pick
//     a scope, and picking wrong silently fights the familiar's own model. That
//     is its own change, not a field on this record. Storing it here without
//     consuming it would make the promise decorative, which is worse than not
//     making it.
//
// Same shape as chat-composer-prefs: one versioned key, a `defaults()` fallback,
// and a reader that accepts only recognized values so stale or hand-edited
// storage cannot wedge the composer.

const NEW_SESSION_DEFAULTS_KEY = "cave:chat:new-session-defaults:v1";

export type ChatNewSessionDefaults = {
  /** Project id, or null to keep inferring from the most recent chat. */
  projectId: string | null;
};

export function newSessionDefaults(): ChatNewSessionDefaults {
  return { projectId: null };
}

/** A stored value is only honoured while it still names something real — a
 *  deleted project resolves back to the inference rather than pinning a new
 *  session to something that no longer exists. */
export function readNewSessionDefaults(
  storage: Pick<Storage, "getItem"> | null,
  known?: { projectIds?: readonly string[] },
): ChatNewSessionDefaults {
  if (!storage) return newSessionDefaults();
  try {
    const raw = storage.getItem(NEW_SESSION_DEFAULTS_KEY);
    if (!raw) return newSessionDefaults();
    const parsed = JSON.parse(raw) as Partial<Record<keyof ChatNewSessionDefaults, unknown>>;
    const projectId = typeof parsed.projectId === "string" && parsed.projectId ? parsed.projectId : null;
    return {
      projectId:
        projectId && (!known?.projectIds || known.projectIds.includes(projectId)) ? projectId : null,
    };
  } catch {
    // Corrupt JSON is the same as "no opinion" — never a thrown boot.
    return newSessionDefaults();
  }
}

export function writeNewSessionDefaults(
  storage: Pick<Storage, "setItem"> | null,
  value: ChatNewSessionDefaults,
): void {
  if (!storage) return;
  try {
    storage.setItem(NEW_SESSION_DEFAULTS_KEY, JSON.stringify({
      projectId: value.projectId ?? null,
    }));
  } catch {
    /* private mode / quota — the selection still applies to THIS session */
  }
}

export function clearNewSessionDefaults(storage: Pick<Storage, "removeItem"> | null): void {
  if (!storage) return;
  try {
    storage.removeItem(NEW_SESSION_DEFAULTS_KEY);
  } catch {
    /* nothing actionable */
  }
}

/** True when the saved default already matches what is selected — the button
 *  says "Saved" rather than inviting a no-op click. */
export function newSessionDefaultsMatch(
  saved: ChatNewSessionDefaults,
  current: { projectId: string | null },
): boolean {
  return saved.projectId === (current.projectId ?? null);
}
