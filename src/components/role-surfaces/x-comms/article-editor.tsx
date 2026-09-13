"use client";

/**
 * The long-form half. An X Article is a different shape from a post — a title,
 * a cover, a body with images placed in it — but the same approval flow, and
 * the room says so rather than making it look like a separate pipeline.
 *
 * Inline images are placed as an `[img:n]` marker at the cursor rather than
 * embedded in the text. The marker is visible, movable and deletable with
 * ordinary text editing, and the card beside it tracks whether its marker is
 * still in the body — an image the operator cut out of the body is exactly the
 * thing that would otherwise upload silently.
 */

import { Button } from "@/components/ui/button";
import { Icon } from "@/lib/icon";
import {
  X_GENERATE_PLACEHOLDER,
  type XArticleDraft,
} from "@/lib/x-comms-model";
import type { XComposerActions, XGenerateState } from "./types";

export function ArticleEditor({
  draft,
  generate,
  actions,
  editable,
}: {
  draft: XArticleDraft;
  generate: XGenerateState | null;
  actions: XComposerActions;
  editable: boolean;
}) {
  const articleGenOpen =
    generate != null && (generate.target === "cover" || generate.target === "inline");

  return (
    <>
      <div className="x-comms-well-head">
        <div className="x-comms-well-head-row">
          <span className="x-comms-legend">Article</span>
          <span className="x-comms-hint">long-form · same approval flow as posts</span>
        </div>
        <label
          className="x-comms-article-title"
          data-missing={draft.title.trim() ? "false" : "true"}
        >
          <span className="x-comms-target-label">title</span>
          <input
            value={draft.title}
            readOnly={!editable}
            placeholder="Article title…"
            aria-label="Article title"
            onChange={(event) => actions.setArticleTitle(event.target.value)}
          />
        </label>
      </div>

      <div className="x-comms-article-media">
        <div
          className="x-comms-media"
          data-needs-alt={draft.cover && !draft.cover.alt.trim() ? "true" : "false"}
        >
          <div className="x-comms-media-head">
            <span>cover</span>
            <span className="x-comms-media-dims">1200×675 · shows on the timeline card</span>
            {draft.cover && editable && (
              <span className="x-comms-media-tools">
                <button
                  type="button"
                  className="x-comms-micro focus-ring"
                  onClick={() =>
                    actions.openGenerate({
                      target: "cover",
                      kind: "image",
                      preset: "16:9",
                      prompt: draft.cover?.prompt ?? "",
                    })
                  }
                >
                  regenerate
                </button>
                <button
                  type="button"
                  className="x-comms-micro focus-ring"
                  data-icon="true"
                  aria-label="Remove cover"
                  onClick={() => actions.removeCover()}
                >
                  <Icon name="ph:x" width={11} height={11} aria-hidden />
                </button>
              </span>
            )}
          </div>

          {draft.cover ? (
            <>
              <div className="x-comms-media-slot">
                <span>image · 1200×675 · generated</span>
                <span>{draft.cover.prompt}</span>
              </div>
              <div className="x-comms-alt-row">
                <input
                  className="x-comms-alt-input"
                  data-missing={draft.cover.alt.trim() ? "false" : "true"}
                  value={draft.cover.alt}
                  readOnly={!editable}
                  placeholder="alt text — required before approval"
                  aria-label="Cover alt text"
                  onChange={(event) => actions.setCoverAlt(event.target.value)}
                />
                {draft.cover.altAuto && <span className="x-comms-alt-auto">auto · review</span>}
              </div>
            </>
          ) : (
            <button
              type="button"
              className="x-comms-add-post focus-ring"
              disabled={!editable}
              onClick={() =>
                actions.openGenerate({
                  target: "cover",
                  kind: "image",
                  preset: "16:9",
                  prompt: "",
                })
              }
            >
              <Icon name="ph:sparkle" width={11} height={11} aria-hidden />
              generate cover · 1200×675
            </button>
          )}
        </div>

        <div className="x-comms-article-inline-action">
          <button
            type="button"
            className="x-comms-chip-button focus-ring"
            disabled={!editable}
            title="Generates a 1600×900 image and drops an [img:n] marker where your cursor is in the body"
            onClick={() =>
              actions.openGenerate({
                target: "inline",
                kind: "image",
                preset: "16:9",
                prompt: "",
              })
            }
          >
            <Icon name="ph:sparkle" width={11} height={11} aria-hidden />
            inline image at cursor
          </button>
          <span className="x-comms-generate-hint">
            {draft.inline.length} inline · 1600×900 each
          </span>
        </div>
      </div>

      {articleGenOpen && generate && (
        <div className="x-comms-generate" role="region" aria-label="Generate image">
          <div className="x-comms-generate-row">
            <span className="x-comms-legend">
              {generate.target === "cover" ? "Generate cover" : "Generate inline image"}
            </span>
            <span className="x-comms-generate-hint">
              {generate.target === "cover"
                ? "1200×675 · 16:9"
                : "1600×900 · 16:9 · placed at the cursor"}
            </span>
            <span className="x-comms-hint">local · 2 api at upload</span>
          </div>
          <textarea
            className="x-comms-prompt"
            value={generate.prompt}
            rows={2}
            placeholder={X_GENERATE_PLACEHOLDER.image}
            aria-label="Prompt"
            onChange={(event) => actions.updateGenerate({ prompt: event.target.value })}
          />
          <div className="x-comms-generate-foot">
            <span className="x-comms-generate-hint">
              alt text is written from the prompt and marked for review
            </span>
            <span className="x-comms-generate-actions">
              <Button variant="ghost" size="xs" onClick={() => actions.closeGenerate()}>
                Cancel
              </Button>
              <Button
                variant="secondary"
                size="xs"
                leadingIcon="ph:sparkle"
                disabled={!generate.prompt.trim()}
                onClick={() => actions.runGenerate()}
              >
                Generate
              </Button>
            </span>
          </div>
        </div>
      )}

      {draft.inline.length > 0 && (
        <div className="x-comms-inline-grid">
          {draft.inline.map((image, index) => {
            const token = `[img:${image.n}]`;
            const placed = draft.body.includes(token);
            return (
              <div
                key={image.n}
                className="x-comms-inline-card"
                data-needs-alt={image.alt.trim() ? "false" : "true"}
              >
                <div className="x-comms-media-head">
                  <span>{token}</span>
                  <span className="x-comms-media-dims">1600×900</span>
                  {/* An image whose marker was cut out of the body would
                      otherwise upload silently at the slot. */}
                  <span
                    className="x-comms-inline-placed"
                    data-placed={placed ? "true" : "false"}
                  >
                    {placed ? "placed" : "not in body"}
                  </span>
                  <button
                    type="button"
                    className="x-comms-micro focus-ring"
                    data-icon="true"
                    disabled={!editable}
                    aria-label="Remove inline image"
                    onClick={() => actions.removeInline(index)}
                  >
                    <Icon name="ph:x" width={11} height={11} aria-hidden />
                  </button>
                </div>
                <span className="x-comms-generate-hint" title={image.prompt}>
                  {image.prompt}
                </span>
                <div className="x-comms-alt-row">
                  <input
                    className="x-comms-alt-input"
                    data-missing={image.alt.trim() ? "false" : "true"}
                    value={image.alt}
                    readOnly={!editable}
                    placeholder="alt text — required"
                    aria-label="Alt text"
                    onChange={(event) => actions.setInlineAlt(index, event.target.value)}
                  />
                  {image.altAuto && <span className="x-comms-alt-auto">auto</span>}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <label className="x-comms-article-body">
        <span className="sr-only">Article body</span>
        <textarea
          placeholder="Write the article… place images with the button above; they appear as [img:1] where your cursor is."
          value={draft.body}
          readOnly={!editable}
          onChange={(event) => actions.setArticleBody(event.target.value)}
          onSelect={(event) =>
            actions.setArticleCaret(event.currentTarget.selectionStart ?? 0)
          }
        />
      </label>
    </>
  );
}
