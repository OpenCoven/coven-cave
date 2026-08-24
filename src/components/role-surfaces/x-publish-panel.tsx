"use client";

/**
 * X publishing, inside Comms Operations.
 *
 * The server side of this landed first (`/api/x/publish`, PR #4823) and had no
 * surface at all, so the only way to post was a hand-written request. This is
 * the room half: draft, confirm the exact wording, publish once, and — the
 * part that cannot be skipped — settle any attempt whose outcome X never
 * confirmed.
 *
 * Three properties this panel is built around, all of them the reason the
 * server is shaped the way it is:
 *
 *  - **Confirmation is bound to wording, not to intent.** The token minted for
 *    a draft covers exactly the text it was minted over. Editing after
 *    confirming drops back to "confirm", visibly, rather than letting an
 *    approval ride from the wording someone read to a later one.
 *
 *    That confirmation is a **modal**, and deliberately so: publishing is the
 *    final irreversible external action this room can take, and the modal is
 *    what makes the review a step rather than a glance at a panel the person
 *    is already scrolling past. It carries the three things someone needs to
 *    approve the act rather than the words — the exact server-returned text,
 *    the account it goes out as, and what is NOT being attached (cave-uajyn).
 *  - **Nothing retries.** A dispatched write with an unknown outcome leaves an
 *    `uncertain` record. This panel holds the whole composer on that, not just
 *    the record — see `composerGate` for why the wider hold is the right one
 *    in front of a person.
 *  - **A refusal is shown, never worked around.** Publishing not granted for
 *    this familiar renders the server's own sentence and nothing else — no
 *    composer underneath to fill in meanwhile.
 *
 *    A missing X connection is deliberately NOT that shape. The route serves
 *    this history without one, so the backlog stays readable after a
 *    disconnect; the panel therefore loads normally and the refusal arrives at
 *    the publish, in the server's own words. Either way there is no local
 *    fallback path, because the point of the grant is that there isn't one.
 */

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { useAnnouncer } from "@/components/ui/live-region";
import { Modal } from "@/components/ui/modal";
import { Icon } from "@/lib/icon";
import { useLatestAsyncData } from "@/lib/use-role-surfaces";
import {
  composerGate,
  publishedPublications,
  unresolvedSummary,
  weightedPostLength,
  X_POST_WEIGHTED_LIMIT,
  type XComposerConfirmation,
  type XPublicationRecord,
} from "@/lib/x-publish-composer";
import { SurfaceError, SurfaceLoading } from "./surface-room";

/**
 * A refusal the server *answered* — publishing not granted for this familiar,
 * or the familiar id refused outright — is data, not a load failure. Throwing
 * it would collapse it into the one fixed message `useLatestAsyncData` shows on
 * error, and the whole value of these refusals is that they say which of
 * several things is wrong. Only an unreachable Cave takes the error path.
 */
type PublicationsState =
  | { ok: true; publications: XPublicationRecord[] }
  | { ok: false; reason: string };

type PublishWire = {
  ok?: boolean;
  error?: string;
  publications?: XPublicationRecord[];
  publication?: XPublicationRecord;
  confirmationToken?: string;
  alreadyPublished?: boolean;
};

const REFUSAL_FALLBACK = "X publishing is not available for this familiar.";

/**
 * One stable empty list. `publications` feeds `useMemo` dependency arrays and
 * an effect, and a fresh `[]` literal on every render would make all three
 * recompute forever.
 */
const NO_PUBLICATIONS: readonly XPublicationRecord[] = [];

/**
 * The store's own shape for a post id. Checked here as well so the person
 * settling an uncertain record is corrected by the field they are typing in —
 * a pasted post URL is the obvious mistake — rather than by a round trip that
 * comes back with the route's generic refusal.
 */
const POST_ID = /^\d+$/;

/**
 * The handle the confirmed post would go out as, or `null` if nothing answered.
 *
 * Never throws. This runs inside the confirmation step, and a connection read
 * that failed must not turn a successfully minted approval into an error —
 * the modal states the unknown instead. The publish itself is still gated by
 * the server's own write preflight, which is where a genuinely missing
 * connection is refused in the server's own words.
 */
async function readConnectedAccount(): Promise<string | null> {
  try {
    const res = await fetch("/api/x/connection", { cache: "no-store" });
    if (!res.ok) return null;
    const json = (await res.json().catch(() => null)) as {
      connected?: unknown;
      account?: { username?: unknown } | null;
    } | null;
    if (!json || json.connected !== true) return null;
    const username = json.account?.username;
    return typeof username === "string" && username !== "" ? username : null;
  } catch {
    return null;
  }
}

async function postPublishAction(body: Record<string, unknown>): Promise<PublishWire> {
  const res = await fetch("/api/x/publish", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  const json = (await res.json().catch(() => null)) as PublishWire | null;
  if (!res.ok || !json?.ok) {
    throw new Error(json?.error?.trim() || "The Cave refused that X action.");
  }
  return json;
}

export function XPublishPanel({ familiarId }: { familiarId: string }) {
  const [text, setText] = useState("");
  const [confirmation, setConfirmation] = useState<XComposerConfirmation | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [postIdDrafts, setPostIdDrafts] = useState<Record<string, string>>({});
  const { announce } = useAnnouncer();
  const noLocationId = useId();

  const load = useCallback(async (): Promise<PublicationsState> => {
    const res = await fetch(
      `/api/x/publish?familiarId=${encodeURIComponent(familiarId)}`,
      { cache: "no-store" },
    );
    const json = (await res.json().catch(() => null)) as PublishWire | null;
    // The Cave failing rather than answering: no envelope at all, or a 5xx.
    // The status is what separates the two, because the route's own internal
    // error DOES carry `{ok: false, error}` — envelope-shaped and 500 — and
    // rendering that as a refusal would report an outage as settled policy.
    if (!json || res.status >= 500) throw new Error("bad response");
    if (res.ok && json.ok) {
      // An `ok` envelope that does not carry the list is a malfunction too.
      // It must not fall through to the refusal branch, where it would read
      // as "publishing is not available for this familiar".
      if (!Array.isArray(json.publications)) throw new Error("bad response");
      return { ok: true, publications: json.publications };
    }
    return { ok: false, reason: json.error?.trim() || REFUSAL_FALLBACK };
  }, [familiarId]);

  const { data, error, reload } = useLatestAsyncData<PublicationsState>({
    scopeKey: familiarId,
    load,
    errorMessage: "Couldn't load X publishing.",
  });

  const publications = useMemo(
    () => (data?.ok ? data.publications : NO_PUBLICATIONS),
    [data],
  );
  const gate = useMemo(
    () => composerGate({ text, confirmation, publications }),
    [text, confirmation, publications],
  );
  const published = useMemo(() => publishedPublications(publications), [publications]);
  const weighted = weightedPostLength(text);

  /**
   * Every action shares one busy/error discipline so no two can interleave,
   * and every action ends with a reload — success or failure.
   *
   * The failure half is the load-bearing one. The action most likely to fail
   * is `publish`, and the record a failed publish leaves behind is exactly the
   * `uncertain` one this panel exists to surface. Reloading only on success
   * would mean the room never learned about it: the composer would stay
   * unheld, the resolve form would never render, and the only way to reach the
   * record would be to leave the room and come back.
   *
   * `busyRef` is what actually makes "no two can interleave" true, rather than
   * merely advertised. The `busy` STATE alone only disables the DOM button —
   * real, but not airtight: a second dispatch reaching this function before
   * React has committed and painted that disabled attribute (a fast repeat
   * click, a held Enter key) would see the stale, not-yet-busy render and run
   * anyway, sending a second `/api/x/publish` request for the same confirmed
   * text. The server's own lock still turns that into `alreadyPublished` or
   * `ambiguous-write` rather than a duplicate post, but the exact-once
   * property this room advertises should not depend on winning that race
   * server-side when refusing the reentrant call costs one synchronous check
   * (cave-uajyn — the design document asks for exactly this: "An in-memory
   * in-flight request map ... prevent[s] a double click from dispatching a
   * second create-post call").
   */
  const busyRef = useRef(false);
  const run = useCallback(async (action: () => Promise<void>) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setActionError(null);
    setNotice(null);
    try {
      await action();
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      setActionError(message);
      announce(message, "assertive");
    } finally {
      await reload({ retainData: true });
      busyRef.current = false;
      setBusy(false);
    }
  }, [announce, reload]);

  const confirm = useCallback(() => run(async () => {
    // Requested together: the account is part of what the confirmation modal
    // asks a person to approve, not a separate fact fetched after the fact.
    // `readConnectedAccount` never throws — a failed read shows as "could not
    // be confirmed" in the modal rather than blocking a mint that otherwise
    // succeeded.
    const [result, account] = await Promise.all([
      postPublishAction({
        action: "draft",
        familiarId,
        text,
        // Reuse this composer's own draft record rather than accumulating one
        // per keystroke-session. Only a record still in `draft` can be reused —
        // the store refuses to edit anything else — and the reconciliation
        // effect below drops the confirmation the moment a reload shows the
        // record has left `draft`, so a settled id is never re-sent here.
        ...(confirmation ? { publicationId: confirmation.publicationId } : {}),
      }),
      readConnectedAccount(),
    ]);
    if (!result.publication || typeof result.confirmationToken !== "string") {
      throw new Error("The Cave did not return a confirmation for that draft.");
    }
    setConfirmation({
      publicationId: result.publication.id,
      text: result.publication.text,
      token: result.confirmationToken,
      account,
    });
    announce("This wording is confirmed. Review it in the dialog, then publish.");
  }), [announce, confirmation, familiarId, run, text]);

  // Withdraws the approval without touching the server: the token stays valid
  // server-side (nothing there knows a person changed their mind), but the
  // room simply stops offering to spend it. Dropping `confirmation` puts the
  // gate back to "confirm", which is what closes the modal AND re-enables
  // "Review this wording" for another look.
  const withdraw = useCallback(() => {
    if (busy) return;
    setConfirmation(null);
  }, [busy]);

  const publish = useCallback(() => run(async () => {
    if (gate.kind !== "publish") return;
    const result = await postPublishAction({
      action: "publish",
      familiarId,
      publicationId: gate.confirmation.publicationId,
      confirmationToken: gate.confirmation.token,
    });
    setText("");
    setConfirmation(null);
    // The store answers `alreadyPublished` when it sent nothing because the
    // post had already gone out — a retried request, or a response that was
    // lost the first time. Saying so is the difference between someone
    // believing they posted twice and knowing they did not.
    const settled = result.alreadyPublished === true
      ? "That post had already gone out. Nothing new was sent."
      : "Posted to X.";
    if (result.alreadyPublished === true) setNotice(settled);
    announce(settled);
  }), [announce, familiarId, gate, run]);

  const resolve = useCallback(
    (publicationId: string, outcome: "published" | "abandoned") => run(async () => {
      const postId = (postIdDrafts[publicationId] ?? "").trim();
      if (outcome === "published" && postId === "") {
        throw new Error("Enter the post's numeric ID from X so the record names what went out.");
      }
      if (outcome === "published" && !POST_ID.test(postId)) {
        throw new Error(
          "A post ID is digits only — the number at the end of the post's address on X.",
        );
      }
      await postPublishAction({
        action: "resolve",
        familiarId,
        publicationId,
        outcome,
        ...(outcome === "published" ? { postId } : {}),
      });
      setPostIdDrafts((current) => {
        const next = { ...current };
        delete next[publicationId];
        return next;
      });
      announce(outcome === "published" ? "Recorded as posted." : "Recorded as not posted.");
    }),
    [announce, familiarId, postIdDrafts, run],
  );

  /**
   * Keep the held approval honest against the store.
   *
   * A confirmation names one record, and every request the composer makes with
   * it — the reused `publicationId` on a re-confirm, the publish itself — is
   * refused the moment that record leaves `draft`. Nothing else clears it: a
   * publish that fails never reaches its own cleanup, and `resolve` settles
   * the record without touching composer state. Left alone the panel would
   * re-send a dead id forever, and nothing could be drafted from this room
   * again without leaving it.
   */
  useEffect(() => {
    if (!confirmation) return;
    const record = publications.find((entry) => entry.id === confirmation.publicationId);
    // Not in the list, or still editable: the approval still means what it says.
    //
    // `!record` deliberately does NOT clear, and it must not be "tightened" to
    // clear once a list has loaded successfully. A confirmation is set before
    // the reload that would fetch the list naming its draft, and in a browser
    // that GET takes real time — so this effect runs, repeatedly, against a
    // list that predates the record. Clearing there would revoke the approval a
    // person had just been given. The residual cost is narrow and self-healing:
    // a record that vanished outright (a quarantined store) leaves the approval
    // naming an id the server 404s until the room is re-entered, which remounts
    // this panel.
    if (!record || record.status === "draft") return;
    setConfirmation(null);
    if (record.status !== "published") return;
    // It went out after all — the response was lost, not the post. Take the
    // wording out of the box rather than leaving it there inviting a second
    // one, and retract the error that reported the lost response as a failure.
    setText((current) => (current === confirmation.text ? "" : current));
    setActionError(null);
    const settled = "That post is recorded as published. Nothing more was sent.";
    setNotice(settled);
    announce(settled);
  }, [announce, confirmation, publications]);

  if (error) {
    return (
      <section className="role-surface-section">
        <div className="role-surface-section-head">
          <h3>X publishing</h3>
        </div>
        <SurfaceError
          title={error}
          hint="Check the Cave connection, then retry."
          onRetry={() => void reload()}
        />
      </section>
    );
  }

  if (data == null) {
    return (
      <section className="role-surface-section">
        <div className="role-surface-section-head">
          <h3>X publishing</h3>
        </div>
        <SurfaceLoading label="Loading X publishing…" />
      </section>
    );
  }

  // A refusal ends the panel. There is deliberately no composer underneath it
  // to fill in "while you sort that out" — the grant is the whole gate.
  if (!data.ok) {
    return (
      <section className="role-surface-section">
        <div className="role-surface-section-head">
          <h3>X publishing</h3>
        </div>
        <p className="role-surface-notice role-surface-notice--warn">
          <Icon name="ph:lock-simple" width={13} height={13} aria-hidden />
          {data.reason}
        </p>
      </section>
    );
  }

  return (
    <section className="role-surface-section">
      <div className="role-surface-section-head">
        <h3>X publishing</h3>
        <span className="role-surface-tag">one post, one confirmation</span>
      </div>

      {gate.kind === "resolve-first" && (
        <div className="role-surface-notices">
          {gate.unresolved.map((publication) => (
            <div
              key={publication.id}
              className="role-surface-notice role-surface-notice--error"
            >
              <p>
                <Icon name="ph:warning-diamond" width={13} height={13} aria-hidden />
                {unresolvedSummary(publication)}
              </p>
              <pre className="role-surface-content">{publication.text}</pre>
              <p className="role-surface-hint">
                Open the account on X and look. Nothing else can be published from this
                room until this is settled — publishing again could post it twice.
              </p>
              <label className="role-surface-field">
                <span className="role-surface-field-label">Post ID, if it did go out</span>
                <input
                  value={postIdDrafts[publication.id] ?? ""}
                  onChange={(event) =>
                    setPostIdDrafts((current) => ({
                      ...current,
                      [publication.id]: event.target.value,
                    }))
                  }
                  inputMode="numeric"
                  placeholder="1234567890123456789"
                />
              </label>
              <div className="role-surface-btn-row">
                <button
                  type="button"
                  className="role-surface-chip focus-ring"
                  disabled={busy}
                  onClick={() => void resolve(publication.id, "published")}
                >
                  It posted
                </button>
                <button
                  type="button"
                  className="role-surface-chip focus-ring"
                  disabled={busy}
                  onClick={() => void resolve(publication.id, "abandoned")}
                >
                  It did not post
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <label className="role-surface-field">
        <span className="role-surface-field-label">Post text</span>
        {/*
          `role-surface-field` styles `input` and `select` only, so a textarea
          under it carries its own class or it renders with no border, no
          background, no padding and — the part that matters — no focus ring.
          `role-surface-notes` is the rooms' textarea style (the Message box
          below in this same canvas, and the Scribe draft body, are its only
          other users); `--short` is the 90px modifier that matches `rows`
          here, because this box sits above that one rather than replacing it.
        */}
        <textarea
          className="role-surface-notes role-surface-notes--short"
          value={text}
          onChange={(event) => setText(event.target.value)}
          rows={4}
          placeholder="What this familiar should post…"
          disabled={gate.kind === "resolve-first"}
        />
      </label>

      {/*
        `role-surface-metric-warn` sets a colour and nothing else — everywhere
        else in the rooms it is added to a base class, not swapped for one. Used
        as a replacement the counter would change size the moment it went over.
      */}
      <p
        className={`role-surface-metric${
          weighted > X_POST_WEIGHTED_LIMIT ? " role-surface-metric-warn" : ""
        }`}
      >
        {weighted} / {X_POST_WEIGHTED_LIMIT} weighted characters
        {weighted > X_POST_WEIGHTED_LIMIT
          ? " — over the standard limit. X will refuse it unless this account is entitled to more."
          : ""}
      </p>

      {/*
        Neither of these carries `role="alert"`. Both are announced through
        `useAnnouncer` at the moment they are set, which is the room's idiom
        and the reliable one — a live region that mounts already holding its
        text is not guaranteed to be spoken at all.
      */}
      {actionError && (
        <p className="role-surface-notice role-surface-notice--error">{actionError}</p>
      )}

      {notice && <p className="role-surface-notice">{notice}</p>}

      <div className="role-surface-btn-row">
        <button
          type="button"
          className="role-surface-chip focus-ring"
          disabled={busy || gate.kind !== "confirm"}
          onClick={() => void confirm()}
        >
          Review this wording
        </button>
      </div>

      {/*
        The confirmation modal — the final, irreversible external action gets
        a modal rather than an inline notice a person could scroll past. It is
        the only place "Publish to X" appears: the dispatch action lives here,
        not in the row above, so publishing is always a deliberate second step
        after "Review this wording" rather than a second click on a button
        that was already on screen.
      */}
      {gate.kind === "publish" && (
        <Modal
          open
          onClose={withdraw}
          dismissOnEscape={!busy}
          dismissOnBackdrop={!busy}
          ariaLabel="Confirm X post"
          ariaDescribedBy={noLocationId}
          footerActions={(
            <>
              <button
                type="button"
                className="role-surface-chip focus-ring"
                disabled={busy}
                onClick={withdraw}
              >
                Cancel
              </button>
              <button
                type="button"
                className="role-surface-chip role-surface-chip--accent focus-ring"
                disabled={busy}
                onClick={() => void publish()}
              >
                Publish to X
              </button>
            </>
          )}
        >
          <p className="role-surface-notice">
            <Icon name="ph:seal-check" width={13} height={13} aria-hidden />
            This exact text is confirmed. Publishing sends it once.
          </p>
          <pre className="role-surface-content">{gate.confirmation.text}</pre>
          <p className="role-surface-hint">
            {gate.confirmation.account
              ? <>Posting as <strong>@{gate.confirmation.account}</strong>.</>
              : "The connected account could not be confirmed."}
          </p>
          <p className="role-surface-metric">
            {weightedPostLength(gate.confirmation.text)} / {X_POST_WEIGHTED_LIMIT} weighted characters
          </p>
          <p id={noLocationId} className="role-surface-hint">No location will be added.</p>
        </Modal>
      )}

      {published.length > 0 && (
        <ul className="role-surface-list">
          {published.map((publication) => (
            <li key={publication.id} className="role-surface-list-row">
              <span className="role-surface-memory-excerpt">{publication.text}</span>
              <span className="role-surface-tag">{publication.postId ?? "posted"}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
