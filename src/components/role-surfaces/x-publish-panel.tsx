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
 *  - **Nothing retries.** A dispatched write with an unknown outcome leaves an
 *    `uncertain` record. This panel holds the whole composer on that, not just
 *    the record — see `composerGate` for why the wider hold is the right one
 *    in front of a person.
 *  - **A refusal is shown, never worked around.** Publishing disabled for this
 *    familiar, or no connected account, renders the server's own sentence and
 *    nothing else. There is no local fallback path, because the point of the
 *    grant is that there isn't one.
 */

import { useCallback, useMemo, useState } from "react";
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
 * A refusal the server *answered* — publishing not granted, no connected
 * account — is data, not a load failure. Throwing it would collapse it into
 * the one fixed message `useLatestAsyncData` shows on error, and the whole
 * value of these refusals is that they say which of several things is wrong.
 * Only an unreachable Cave takes the error path.
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
  const [postIdDrafts, setPostIdDrafts] = useState<Record<string, string>>({});

  const load = useCallback(async (): Promise<PublicationsState> => {
    const res = await fetch(
      `/api/x/publish?familiarId=${encodeURIComponent(familiarId)}`,
      { cache: "no-store" },
    );
    const json = (await res.json().catch(() => null)) as PublishWire | null;
    if (res.ok && json?.ok && Array.isArray(json.publications)) {
      return { ok: true, publications: json.publications };
    }
    // A 5xx with no JSON envelope is the Cave failing, not answering.
    if (res.status >= 500 || !json) throw new Error("bad response");
    return { ok: false, reason: json.error?.trim() || REFUSAL_FALLBACK };
  }, [familiarId]);

  const { data, error, reload } = useLatestAsyncData<PublicationsState>({
    scopeKey: familiarId,
    load,
    errorMessage: "Couldn't load X publishing.",
  });

  const publications = data?.ok ? data.publications : [];
  const gate = useMemo(
    () => composerGate({ text, confirmation, publications }),
    [text, confirmation, publications],
  );
  const published = useMemo(() => publishedPublications(publications), [publications]);
  const weighted = weightedPostLength(text);

  /** Every action shares one busy/error discipline so no two can interleave. */
  const run = useCallback(async (action: () => Promise<void>) => {
    setBusy(true);
    setActionError(null);
    try {
      await action();
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }, []);

  const confirm = useCallback(() => run(async () => {
    const result = await postPublishAction({
      action: "draft",
      familiarId,
      text,
      // Reuse this composer's own draft record rather than accumulating one
      // per keystroke-session; the store rejects editing anything that is not
      // still a draft, so a settled record can never be rewritten this way.
      ...(confirmation ? { publicationId: confirmation.publicationId } : {}),
    });
    if (!result.publication || typeof result.confirmationToken !== "string") {
      throw new Error("The Cave did not return a confirmation for that draft.");
    }
    setConfirmation({
      publicationId: result.publication.id,
      text: result.publication.text,
      token: result.confirmationToken,
    });
    await reload({ retainData: true });
  }), [confirmation, familiarId, reload, run, text]);

  const publish = useCallback(() => run(async () => {
    if (gate.kind !== "publish") return;
    await postPublishAction({
      action: "publish",
      familiarId,
      publicationId: gate.confirmation.publicationId,
      confirmationToken: gate.confirmation.token,
    });
    setText("");
    setConfirmation(null);
    await reload({ retainData: true });
  }), [familiarId, gate, reload, run]);

  const resolve = useCallback(
    (publicationId: string, outcome: "published" | "abandoned") => run(async () => {
      const postId = (postIdDrafts[publicationId] ?? "").trim();
      if (outcome === "published" && postId === "") {
        throw new Error("Enter the post's numeric ID from X so the record names what went out.");
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
      await reload({ retainData: true });
    }),
    [familiarId, postIdDrafts, reload, run],
  );

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
              <p className="role-surface-notes role-surface-notes--short">{publication.text}</p>
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
        <textarea
          value={text}
          onChange={(event) => setText(event.target.value)}
          rows={4}
          placeholder="What this familiar should post…"
          disabled={gate.kind === "resolve-first"}
        />
      </label>

      <p className={weighted > X_POST_WEIGHTED_LIMIT ? "role-surface-metric-warn" : "role-surface-metric"}>
        {weighted} / {X_POST_WEIGHTED_LIMIT} weighted characters
        {weighted > X_POST_WEIGHTED_LIMIT
          ? " — over the standard limit. X will refuse it unless this account is entitled to more."
          : ""}
      </p>

      {gate.kind === "publish" && (
        <div className="role-surface-notice">
          <p>
            <Icon name="ph:seal-check" width={13} height={13} aria-hidden />
            This exact text is confirmed. Publishing sends it once.
          </p>
          <p className="role-surface-notes role-surface-notes--short">{gate.confirmation.text}</p>
        </div>
      )}

      {actionError && (
        <p className="role-surface-notice role-surface-notice--error" role="alert">
          {actionError}
        </p>
      )}

      <div className="role-surface-btn-row">
        <button
          type="button"
          className="role-surface-chip focus-ring"
          disabled={busy || gate.kind !== "confirm"}
          onClick={() => void confirm()}
        >
          Review this wording
        </button>
        <button
          type="button"
          className="role-surface-chip role-surface-chip--accent focus-ring"
          disabled={busy || gate.kind !== "publish"}
          onClick={() => void publish()}
        >
          Publish to X
        </button>
      </div>

      {published.length > 0 && (
        <ul className="role-surface-list">
          {published.map((publication) => (
            <li key={publication.id} className="role-surface-list-row">
              <span className="role-surface-notes role-surface-notes--short">
                {publication.text}
              </span>
              <span className="role-surface-tag">{publication.postId ?? "posted"}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
