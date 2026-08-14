/**
 * Confirmed removal of the session a ChatView is currently displaying —
 * archived, deleted, or a discarded empty voice/compose pre-session. A
 * consumer's `onSessionRemoved` fires from the exact call site that performed
 * the mutation, always immediately before the view navigates away (`onBack`
 * for archive/delete, `onVoiceSessionDiscarded` for a discarded pre-session).
 *
 * Deliberately distinct from `onSessionsChanged`/`onSessionsDeleted`, which
 * also fire for refreshes that have nothing to do with THIS session being
 * removed (a canonical-session reconcile after a stream settles, a *different*
 * thread auto-archiving on reflection, a Board handoff refresh, …). Inferring
 * removal from those firing is unsound; this is the narrow, purpose-built
 * signal instead (cave-rl980 Task 4 review).
 */
export type SessionRemovalReason = "archived" | "deleted" | "discarded";
