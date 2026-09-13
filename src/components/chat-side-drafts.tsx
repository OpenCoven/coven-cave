"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Modal } from "@/components/ui/modal";
import type { Turn } from "@/lib/chat-turn-state";
import type {
  sideConversationService, BranchExpectation, BringBackInput, CreateSideInput,
  SideLifecycleInput, SideOperationReceipt, SideScope,
} from "@/lib/server/chat-side-conversations";
import "@/styles/chat-side-drafts.css";

type Listing = Awaited<ReturnType<typeof sideConversationService.list>>;
type Detail = Awaited<ReturnType<typeof sideConversationService.get>>;
type MutationResult = { conversation: Detail["conversation"] | null; receipt: SideOperationReceipt };
type Pending = {
  url: string; method: "POST" | "PATCH";
  body: CreateSideInput | SideLifecycleInput | BringBackInput;
  kind: "create" | "lifecycle" | "bring-back";
};
type Review = { target: BranchExpectation; source: BranchExpectation; turnIds: string[]; text: string };
type RememberedDraft = {
  listing: Listing | null; detail: Detail | null; creating: boolean;
  mode: "fresh" | "selected-messages"; selected: string[]; draft: string;
  review: Review | null; confirmed: boolean; receipt: SideOperationReceipt | null;
  pending: Pending | null; error: string | null;
};
const rememberedDrafts = new Map<string, RememberedDraft>();
const collection = "/api/chat/side-conversations";
const button = "chat-side-drafts__button focus-ring";

export function ReviewedSideExcerpt({ text, sourceSessionId }: { text: string; sourceSessionId: string }) {
  return <blockquote className="chat-side-drafts__quote">
    <span className="chat-side-drafts__notice">Reviewed excerpt from a retained side draft</span>
    <p>{text}</p>
    <span className="chat-side-drafts__receipt">{sourceSessionId}</span>
  </blockquote>;
}

async function readSide<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...init });
  const value: T & { ok?: boolean; error?: string; code?: string } = await response.json();
  if (!response.ok || value.ok !== true) {
    throw new Error(value.code === "target_generation_active"
      ? "This chat has an active or unsettled send. Bring back is unavailable until it is reconciled."
      : response.status === 409
      ? "The source or destination changed. Reload and review again; nothing was silently rebased."
      : value.code === "project_scope_unverified"
        ? "This chat has no verified local project. Retained side drafts are unavailable here."
        : value.error ?? `Side drafts are unavailable (${response.status}).`);
  }
  return value;
}

export function ChatSideDrafts({ sourceId, scope, turns, parentBusy, onImported }: {
  sourceId?: string; scope: SideScope; turns: readonly Turn[]; parentBusy: boolean; onImported: () => void;
}) {
  const scopeKey = sourceId ? JSON.stringify([sourceId, scope.parentSessionId, scope.familiarId, scope.projectId]) : null;
  const remembered = useRef(scopeKey ? rememberedDrafts.get(scopeKey) : undefined).current;
  const [open, setOpen] = useState(false);
  const [listing, setListing] = useState<Listing | null>(remembered?.listing ?? null);
  const [detail, setDetail] = useState<Detail | null>(remembered?.detail ?? null);
  const [creating, setCreating] = useState(remembered?.creating ?? false);
  const [mode, setMode] = useState<"fresh" | "selected-messages">(remembered?.mode ?? "fresh");
  const [selected, setSelected] = useState<string[]>(remembered?.selected ?? []);
  const [draft, setDraft] = useState(remembered?.draft ?? "");
  const [review, setReview] = useState<Review | null>(remembered?.review ?? null);
  const [confirmed, setConfirmed] = useState(remembered?.confirmed ?? false);
  const [discardConfirmed, setDiscardConfirmed] = useState(false);
  const [receipt, setReceipt] = useState<SideOperationReceipt | null>(remembered?.receipt ?? null);
  const [pending, setPending] = useState<Pending | null>(remembered?.pending ?? null);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(remembered?.error ?? null);
  const mounted = useRef(true);
  const inFlight = useRef(false);
  const query = new URLSearchParams(scope).toString();
  const choices = useMemo(() => (detail?.conversation.turns ?? turns)
    .filter((turn) => turn.role === "user" || turn.role === "assistant").slice(-100), [detail, turns]);
  const side = detail?.conversation.sideConversation;
  const disabled = working || parentBusy || pending !== null;
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  useEffect(() => {
    if (!scopeKey) return;
    if (!creating && !selected.length && !draft && !review && !pending) {
      rememberedDrafts.delete(scopeKey);
      return;
    }
    rememberedDrafts.set(scopeKey, {
      listing, detail, creating, mode, selected, draft, review, confirmed, receipt, pending, error,
    });
  }, [scopeKey, listing, detail, creating, mode, selected, draft, review, confirmed, receipt, pending, error]);

  async function action(work: () => Promise<void>) {
    if (inFlight.current) return;
    inFlight.current = true;
    setWorking(true);
    setError(null);
    try { await work(); }
    catch (cause) {
      if (mounted.current) setError(cause instanceof Error ? cause.message : "Side draft operation failed.");
    } finally {
      inFlight.current = false;
      if (mounted.current) setWorking(false);
    }
  }
  async function reload(after?: string) {
    const next = await readSide<Listing>(`${collection}?${query}${after ? `&after=${encodeURIComponent(after)}` : ""}`);
    if (mounted.current) setListing((previous) => after && previous
      ? { ...next, conversations: [...previous.conversations, ...next.conversations] } : next);
    return next;
  }
  async function select(id: string) {
    const next = await readSide<Detail>(`${collection}/${encodeURIComponent(id)}?${query}`);
    if (!next.conversation.sideConversation) throw new Error("This record is not a retained side draft.");
    if (mounted.current) {
      setDetail(next); setCreating(false); setReview(null); setSelected([]); setDraft("");
      setConfirmed(false); setDiscardConfirmed(false);
    }
    return next;
  }
  async function submit(operation: Pending) {
    if (parentBusy) throw new Error("Wait for this chat's current reply before changing side drafts.");
    setPending(operation);
    const result = await readSide<MutationResult>(operation.url, {
      method: operation.method, headers: { "Content-Type": "application/json" },
      body: JSON.stringify(operation.body),
    });
    if (!mounted.current) return;
    setPending(null); setReceipt(result.receipt); setReview(null); setConfirmed(false); setDraft(""); setSelected([]);
    if (operation.kind === "bring-back") onImported();
    else if (result.conversation) await select(result.conversation.sessionId);
    else { setDetail(null); setSelected([]); }
    await reload();
  }
  function lifecycle(kind: SideLifecycleInput["action"]) {
    if (!detail || !side || disabled) return;
    const body: SideLifecycleInput = {
      operationId: crypto.randomUUID(), scope, expectedGeneration: side.generation, action: kind,
      ...(kind === "save-draft" ? { draftText: draft } : {}),
    };
    void action(() => submit({ url: `${collection}/${encodeURIComponent(detail.conversation.sessionId)}`, method: "PATCH", body, kind: "lifecycle" }));
  }
  async function prepareReview() {
    if (!detail) return;
    const id = detail.conversation.sessionId;
    const [source, target] = await Promise.all([
      readSide<Detail>(`${collection}/${encodeURIComponent(id)}?${query}`),
      readSide<Listing>(`${collection}?${query}`),
    ]);
    if (!mounted.current) return;
    const chosen = selected.map((id) => source.conversation.turns.find((turn) => turn.id === id));
    if (chosen.some((turn) => !turn)) throw new Error("Selected content is unavailable. Reload and select it again.");
    setReview({ source: source.branch, target: target.parent, turnIds: [...selected], text: chosen.map((turn) => turn!.text).join("\n\n") });
    setConfirmed(false);
  }
  function toggle(id: string) {
    setSelected((previous) => previous.includes(id) ? previous.filter((value) => value !== id) : [...previous, id]);
  }
  const sourceSelection = (
    <div className="chat-side-drafts__field">
      <span>Select messages ({selected.length}/32). Showing the latest 100 messages.</span>
      <div className="chat-side-drafts__list">
        {choices.map((turn) => (
          <label key={turn.id} className="chat-side-drafts__source">
            <input type="checkbox" checked={selected.includes(turn.id)}
              disabled={disabled || (!selected.includes(turn.id) && selected.length >= 32)}
              onChange={() => toggle(turn.id)} />
            <span>{turn.role}: {turn.text.slice(0, 240)}{turn.text.length > 240 ? "..." : ""}</span>
          </label>
        ))}
      </div>
    </div>
  );
  return (
    <div className="chat-side-drafts">
      <button type="button" className={button} aria-haspopup="dialog" aria-expanded={open}
        onClick={() => { setOpen(true); if (!listing) void action(() => reload().then(() => {})); }}>
        Retained side drafts
      </button>
      <span>Separate notes. Familiar execution and Temporary are unavailable.</span>
      <Modal open={open} onClose={() => setOpen(false)} breadcrumb={["This chat", "Retained side drafts"]}
        dismissOnBackdrop={!working} dismissOnEscape={!working}>
        <div className="chat-side-drafts__body" aria-busy={working}>
          <p className="chat-side-drafts__notice">
            These notes stay in Cave, separate from this chat. No familiar runs here. Context choices record
            a selection only; identity, memory, tools, and runtime isolation have not been admitted.
          </p>
          <p className="chat-side-drafts__receipt">Parent: {scope.parentSessionId} / Project: {scope.projectId}</p>
          {pending || review || draft ? <p className="chat-side-drafts__notice">
            Unfinished notes and reviews survive navigation in this window, not reload.
            After an uncertain save, inspect the parent before starting another import.
          </p> : null}
          {error ? <p role="alert">{error}</p> : null}
          {receipt ? <p role="status" className="chat-side-drafts__receipt">
            {receipt.kind} recorded: {receipt.operationId}{receipt.turnId ? ` / ${receipt.turnId}` : ""}.
            {receipt.kind === "bring-back" && receipt.removed ? " Historical receipt reconciled. The excerpt was removed; this retry did not restore it." : ""}
            {receipt.kind === "discard" ? " Cave transcript removed; reviewed imports and external copies may remain." : ""}
          </p> : null}
          {pending ? (
            <div className="chat-side-drafts__field">
              <p>The result may already be stored. Retry sends the same operation and exact text, not a second write.</p>
              <button type="button" className={button} disabled={working || parentBusy} onClick={() => void action(() => submit(pending))}>Retry same request</button>
              <button type="button" className={button} disabled={working}
                onClick={() => { setPending(null); setReview(null); setCreating(false); void action(() => reload().then(() => {})); }}>
                Leave pending request and reload records
              </button>
            </div>
          ) : null}
          {!detail && !creating ? (
            <>
              <div className="chat-side-drafts__actions">
                <button type="button" className={button} disabled={disabled || !listing}
                  onClick={() => { setCreating(true); setSelected([]); setDraft(""); setReceipt(null); }}>
                  New retained draft
                </button>
                <button type="button" className={button} disabled={disabled} onClick={() => void action(() => reload().then(() => {}))}>Reload records</button>
              </div>
              <div className="chat-side-drafts__list">
                {listing?.conversations.map((row) => <button type="button" className={button} key={row.sessionId} disabled={disabled}
                  onClick={() => void action(() => select(row.sessionId).then(() => {}))}>
                  {row.title ?? "Retained side draft"} / {row.sideConversation.presentation}{row.sideConversation.keptSeparately ? " / kept separately" : ""}
                </button>)}
                {listing && !listing.conversations.length ? <p>No retained side drafts in this chat.</p> : null}
              </div>
              {listing?.nextCursor ? <button type="button" className={button} disabled={disabled}
                onClick={() => void action(() => reload(listing.nextCursor!).then(() => {}))}>More side drafts</button> : null}
            </>
          ) : null}
          {creating ? (
            <>
              <label className="chat-side-drafts__field">Optional history selection
                <select value={mode} disabled={disabled} onChange={(event) => { setMode(event.target.value === "fresh" ? "fresh" : "selected-messages"); setSelected([]); }}>
                  <option value="fresh">No parent history (not a Fresh runtime)</option>
                  <option value="selected-messages">Selected parent messages</option>
                </select>
              </label>
              {mode === "selected-messages" ? sourceSelection : null}
              <label className="chat-side-drafts__field">First note (optional)
                <textarea value={draft} disabled={disabled} onChange={(event) => setDraft(event.target.value)} />
              </label>
              <button type="button" className={button} disabled={disabled || !listing || (mode === "selected-messages" && !selected.length)}
                onClick={() => {
                  if (!listing) return;
                  const body: CreateSideInput = { operationId: crypto.randomUUID(), scope,
                    expectedParent: { revision: listing.parent.revision, activeLeafId: listing.parent.activeLeafId },
                    context: { mode, turnIds: mode === "fresh" ? [] : selected }, retention: "retained",
                    ...(draft.trim() ? { draftText: draft } : {}) };
                  void action(() => submit({ url: collection, method: "POST", body, kind: "create" }));
                }}>Create retained draft</button>
            </>
          ) : null}
          {detail && side && !review ? (
            <>
              <p>{side.presentation === "closed" ? "Closed" : "Open"} retained draft / {side.contextSelection.snapshot.length} frozen source references / Context not admitted</p>
              {sourceSelection}
              <label className="chat-side-drafts__field">Add a note
                <textarea value={draft} disabled={disabled || side.presentation !== "open"} onChange={(event) => setDraft(event.target.value)} />
              </label>
              <div className="chat-side-drafts__actions">
                <button type="button" className={button} disabled={disabled || !draft.trim() || side.presentation !== "open"} onClick={() => lifecycle("save-draft")}>Save note</button>
                <button type="button" className={button} disabled={disabled || !selected.length || Boolean(draft.trim())} onClick={() => void action(prepareReview)}>Review Bring back</button>
                <button type="button" className={button} disabled={disabled || Boolean(draft.trim())} onClick={() => lifecycle(side.presentation === "open" ? "close" : "reopen")}>{side.presentation === "open" ? "Close draft" : "Reopen draft"}</button>
                <button type="button" className={button} disabled={disabled || side.keptSeparately || Boolean(draft.trim())} onClick={() => lifecycle("keep-separately")}>Keep separately</button>
              </div>
              <label className="chat-side-drafts__source">
                <input type="checkbox" checked={discardConfirmed} disabled={disabled} onChange={(event) => setDiscardConfirmed(event.target.checked)} />
                Remove this Cave transcript. Reviewed imports, operation receipts, and external copies may remain.
              </label>
              <button type="button" className={button} disabled={disabled || !discardConfirmed || Boolean(draft.trim())} onClick={() => lifecycle("discard")}>Discard Cave side draft</button>
            </>
          ) : null}
          {review && detail ? (
            <>
              <p>Bring back only the text below to {scope.parentSessionId}. It will be a quoted note, not an instruction, approval, or familiar answer.</p>
              <label className="chat-side-drafts__field">Reviewed excerpt
                <textarea value={review.text} disabled={disabled} onChange={(event) => { setReview({ ...review, text: event.target.value }); setConfirmed(false); }} />
              </label>
              <label className="chat-side-drafts__source"><input type="checkbox" checked={confirmed} disabled={disabled} onChange={(event) => setConfirmed(event.target.checked)} />I reviewed this exact text and destination.</label>
              <button type="button" className={button} disabled={disabled || !confirmed || !review.text.trim()} onClick={() => {
                const body: BringBackInput = { operationId: crypto.randomUUID(), scope, targetSessionId: scope.parentSessionId,
                  expectedTarget: { revision: review.target.revision, activeLeafId: review.target.activeLeafId },
                  expectedSource: review.source, sourceTurnIds: review.turnIds, reviewedText: review.text };
                void action(() => submit({ url: `${collection}/${encodeURIComponent(detail.conversation.sessionId)}/bring-back`, method: "POST", body, kind: "bring-back" }));
              }}>Bring back reviewed text</button>
            </>
          ) : null}
          {(creating || detail) && !pending ? <button type="button" className={button} disabled={working || Boolean(draft.trim())}
            onClick={() => { setDetail(null); setCreating(false); setReview(null); setSelected([]); }}>Back to side drafts</button> : null}
        </div>
      </Modal>
    </div>
  );
}
