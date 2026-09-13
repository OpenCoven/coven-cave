"use client";

/**
 * The post body: one card for a single post, one per post for a thread.
 *
 * Thread cards carry their own controls — split at the cursor, merge down,
 * reorder, remove — because a thread is edited as a sequence, and the
 * alternative (retyping across a boundary) is where posts lose their ending.
 * Each post enforces its own 280; the thread total is a fact in the footer,
 * not a second limit.
 *
 * Attachments render as a dashed slot naming the file rather than a thumbnail.
 * Nothing has been uploaded, and drawing a picture of an image the room does
 * not have would be a claim it cannot make.
 */

import { useRef, type DragEvent } from "react";
import { Button } from "@/components/ui/button";
import { StandardSelect } from "@/components/ui/select";
import { Icon, type IconName } from "@/lib/icon";
import {
  altFromPrompt,
  mediaAffordances,
  X_GENERATE_PLACEHOLDER,
  X_MAX_POLL_OPTIONS,
  X_MEDIA_PRESETS,
  X_MIN_POLL_OPTIONS,
  X_POLL_DURATIONS,
  X_POLL_OPTION_LIMIT,
  X_POST_TYPES,
  xWeightedLength,
  type XPollDuration,
  type XPostBody,
  type XPostDraft,
} from "@/lib/x-comms-model";
import { Segmented } from "./segmented";
import type { XComposerActions, XGenerateState } from "./types";

const MEDIA_KINDS = ["image", "gif", "video"] as const;

function mediaOriginLabel(origin: string | undefined): string {
  if (origin === "generated") return "generated";
  if (origin === "png-to-gif") return "from png";
  if (origin === "upload") return "uploaded";
  return "empty";
}

function mediaOriginTip(origin: string | undefined, prompt?: string): string {
  if (origin === "generated") return `Generated locally · prompt: ${prompt ?? ""}`;
  if (origin === "png-to-gif") return "Converted from the attached PNG · 1 frame · loops";
  if (origin === "upload") return "Uploaded from disk";
  return "Drop a file here";
}

export function PostEditor({
  draft,
  posts,
  caretByPost,
  focusedOption,
  generate,
  actions,
  onFocusOption,
  editable,
}: {
  draft: XPostDraft;
  posts: readonly XPostBody[];
  caretByPost: Record<number, number>;
  focusedOption: string | null;
  generate: XGenerateState | null;
  actions: XComposerActions;
  onFocusOption: (key: string | null) => void;
  editable: boolean;
}) {
  const isThread = draft.type === "thread";
  const limit = draft.type === "dm" ? 10_000 : 280;
  const dragPost = useRef<number | null>(null);
  const dragOption = useRef<string | null>(null);

  return (
    <div className="x-comms-posts" data-thread={isThread ? "true" : "false"}>
      {posts.map((post, index) => {
        const length = xWeightedLength(post.text);
        const over = length > limit;
        const near = !over && limit - length <= 20;
        const counterState = over ? "over" : near ? "near" : "ok";
        const affordances = mediaAffordances(post);
        const caret = caretByPost[index];
        const canSplit =
          post.text.trim().length > 0 && caret != null && caret > 0 && caret < post.text.length;
        const genOpen = generate?.target === index;

        return (
          <article
            key={index}
            className="x-comms-post"
            aria-label={isThread ? `Post ${index + 1} of ${posts.length}` : "Post"}
            draggable={isThread && editable}
            onDragStart={(event: DragEvent) => {
              dragPost.current = index;
              event.dataTransfer.effectAllowed = "move";
            }}
            onDragOver={(event: DragEvent) => {
              if (dragPost.current != null) event.preventDefault();
            }}
            onDrop={(event: DragEvent) => {
              event.preventDefault();
              if (dragPost.current != null) actions.movePost(dragPost.current, index);
              dragPost.current = null;
            }}
          >
            {isThread && (
              <div className="x-comms-post-head">
                <Icon name="ph:dots-six-vertical" width={12} height={12} aria-hidden />
                <span className="x-comms-post-n">
                  {index + 1}/{posts.length}
                </span>
                <span className="x-comms-counter" data-state={counterState}>
                  {length}/{limit}
                </span>
                <span className="x-comms-post-tools">
                  <button
                    type="button"
                    className="x-comms-mini focus-ring"
                    disabled={!canSplit || !editable}
                    title={
                      canSplit
                        ? "Split at the cursor into two posts"
                        : "Place the cursor in the text to split there"
                    }
                    onClick={() => actions.splitPost(index)}
                  >
                    split
                  </button>
                  <button
                    type="button"
                    className="x-comms-mini focus-ring"
                    disabled={index === posts.length - 1 || !editable}
                    title="Merge with the next post"
                    onClick={() => actions.mergePost(index)}
                  >
                    merge ↓
                  </button>
                  <button
                    type="button"
                    className="x-comms-mini focus-ring"
                    data-icon="true"
                    disabled={index === 0 || !editable}
                    aria-label="Move up"
                    title="Move up"
                    onClick={() => actions.movePost(index, index - 1)}
                  >
                    <Icon name="ph:arrow-up" width={12} height={12} aria-hidden />
                  </button>
                  <button
                    type="button"
                    className="x-comms-mini focus-ring"
                    data-icon="true"
                    disabled={index === posts.length - 1 || !editable}
                    aria-label="Move down"
                    title="Move down"
                    onClick={() => actions.movePost(index, index + 1)}
                  >
                    <Icon name="ph:arrow-down" width={12} height={12} aria-hidden />
                  </button>
                  <button
                    type="button"
                    className="x-comms-mini focus-ring"
                    data-icon="true"
                    data-danger="true"
                    disabled={posts.length <= 1 || !editable}
                    aria-label="Remove post"
                    title="Remove post"
                    onClick={() => actions.removePost(index)}
                  >
                    <Icon name="ph:x" width={12} height={12} aria-hidden />
                  </button>
                </span>
              </div>
            )}

            <label className="x-comms-post-body">
              <span className="sr-only">
                {isThread ? `Post ${index + 1} of ${posts.length}` : "Post text"}
              </span>
              <textarea
                className="x-comms-textarea"
                placeholder={
                  index === 0 ? X_POST_TYPES[draft.type].placeholder : "Continue…"
                }
                value={post.text}
                readOnly={!editable}
                // Autosizes to its lines: a fixed box left a dead gap under
                // short drafts that made a finished post read unfinished.
                rows={Math.max(isThread ? 3 : 5, post.text.split("\n").length + 1)}
                onChange={(event) => actions.setPostText(index, event.target.value)}
                onSelect={(event) =>
                  actions.setPostCaret(index, event.currentTarget.selectionStart ?? 0)
                }
              />
            </label>

            {post.media.length > 0 && (
              <div
                className="x-comms-media-grid"
                data-cols={post.media.length <= 1 ? "1" : "2"}
              >
                {post.media.map((item, mediaIndex) => {
                  const missingAlt = !item.alt.trim();
                  return (
                    <div
                      key={mediaIndex}
                      className="x-comms-media"
                      data-needs-alt={missingAlt ? "true" : "false"}
                    >
                      <div className="x-comms-media-head">
                        <span>{item.kind}</span>
                        <span className="x-comms-media-dims">
                          {item.width
                            ? `${item.width}×${item.height}${item.duration ? ` · ${item.duration}` : ""}`
                            : item.kind === "image"
                              ? "up to 5 MB"
                              : item.kind === "gif"
                                ? "up to 15 MB"
                                : "up to 2:20"}
                        </span>
                        <span
                          className="x-comms-origin"
                          title={mediaOriginTip(item.origin, item.prompt)}
                        >
                          {mediaOriginLabel(item.origin)}
                        </span>
                        <span className="x-comms-media-tools">
                          {item.kind === "image" &&
                            affordances.imageCount === 1 &&
                            editable && (
                              <button
                                type="button"
                                className="x-comms-micro focus-ring"
                                title="Convert this PNG to a looping GIF · keeps alt text · still 1 attachment"
                                onClick={() => actions.convertToGif(index, mediaIndex)}
                              >
                                → gif
                              </button>
                            )}
                          {item.origin === "generated" && editable && (
                            <button
                              type="button"
                              className="x-comms-micro focus-ring"
                              title="Reopen the generator with this prompt"
                              onClick={() =>
                                actions.openGenerate({
                                  target: index,
                                  kind: item.kind,
                                  preset: X_MEDIA_PRESETS[item.kind][0].value,
                                  prompt: item.prompt ?? "",
                                  replaceIndex: mediaIndex,
                                })
                              }
                            >
                              regenerate
                            </button>
                          )}
                          <button
                            type="button"
                            className="x-comms-micro focus-ring"
                            data-icon="true"
                            disabled={!editable}
                            aria-label="Remove attachment"
                            onClick={() => actions.removeMedia(index, mediaIndex)}
                          >
                            <Icon name="ph:x" width={11} height={11} aria-hidden />
                          </button>
                        </span>
                      </div>

                      <div
                        className="x-comms-media-slot"
                        style={
                          {
                            "--x-media-ratio": item.width
                              ? `${item.width} / ${item.height}`
                              : "16 / 9",
                            "--x-media-max-h": post.media.length > 1 ? "90px" : "140px",
                          } as React.CSSProperties
                        }
                      >
                        <span>
                          {item.kind}
                          {item.width ? ` · ${item.width}×${item.height}` : " · drop file"}
                          {item.frames ? ` · ${item.frames} frame` : ""}
                          {item.duration ? ` · ${item.duration}` : ""}
                        </span>
                        <span>{item.prompt ?? (item.origin ? "" : "or use +generate")}</span>
                      </div>

                      <div className="x-comms-alt-row">
                        <input
                          className="x-comms-alt-input"
                          data-missing={missingAlt ? "true" : "false"}
                          value={item.alt}
                          readOnly={!editable}
                          placeholder="alt text — required before approval"
                          aria-label="Alt text"
                          title="Describe the image for people who can't see it. Required by room rules."
                          onChange={(event) =>
                            actions.setAlt(index, mediaIndex, event.target.value)
                          }
                        />
                        {item.altAuto && (
                          <span
                            className="x-comms-alt-auto"
                            title="Alt text was written from the prompt. Read it once before approving."
                          >
                            auto · review
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {post.poll && (
              <div className="x-comms-poll">
                <div className="x-comms-poll-head">
                  <span>
                    poll · {post.poll.options.length} of {X_MAX_POLL_OPTIONS} options
                  </span>
                  <span className="x-comms-poll-duration">
                    runs
                    <StandardSelect<XPollDuration>
                      label="Poll duration"
                      value={post.poll.duration}
                      options={[...X_POLL_DURATIONS]}
                      onChange={(next) => actions.setPollDuration(index, next)}
                    />
                  </span>
                  <button
                    type="button"
                    className="x-comms-micro focus-ring"
                    data-icon="true"
                    disabled={!editable}
                    aria-label="Remove poll"
                    onClick={() => actions.removePoll(index)}
                  >
                    <Icon name="ph:x" width={11} height={11} aria-hidden />
                  </button>
                </div>

                {post.poll.options.map((option, optionIndex) => {
                  const key = `${index}:${optionIndex}`;
                  const focused = focusedOption === key;
                  const atLimit = option.length >= X_POLL_OPTION_LIMIT;
                  return (
                    <div
                      key={optionIndex}
                      className="x-comms-poll-option"
                      draggable={editable}
                      onDragStart={(event: DragEvent) => {
                        dragOption.current = key;
                        event.dataTransfer.effectAllowed = "move";
                      }}
                      onDragOver={(event: DragEvent) => {
                        if (dragOption.current?.startsWith(`${index}:`)) event.preventDefault();
                      }}
                      onDrop={(event: DragEvent) => {
                        event.preventDefault();
                        const from = dragOption.current
                          ? Number(dragOption.current.split(":")[1])
                          : null;
                        if (from != null) actions.reorderPollOption(index, from, optionIndex);
                        dragOption.current = null;
                      }}
                    >
                      <span className="x-comms-grip" title="Drag to reorder" aria-hidden>
                        <Icon name="ph:dots-six-vertical" width={12} height={12} aria-hidden />
                      </span>
                      <input
                        className="x-comms-poll-input"
                        data-at-limit={atLimit ? "true" : "false"}
                        value={option}
                        readOnly={!editable}
                        maxLength={X_POLL_OPTION_LIMIT}
                        placeholder={`Option ${optionIndex + 1}`}
                        aria-label={`Option ${optionIndex + 1}`}
                        onChange={(event) =>
                          actions.setPollOption(index, optionIndex, event.target.value)
                        }
                        onFocus={() => onFocusOption(key)}
                        onBlur={() => onFocusOption(null)}
                      />
                      {/* Spelled out, because a bare 21/25 beside a poll option
                          reads as a vote count rather than a length. */}
                      <span
                        className="x-comms-poll-count"
                        data-active={focused ? "true" : "false"}
                        data-at-limit={atLimit ? "true" : "false"}
                        title="Character limit per option"
                      >
                        {option.length}/{X_POLL_OPTION_LIMIT} chars
                      </span>
                      <button
                        type="button"
                        className="x-comms-micro focus-ring"
                        data-icon="true"
                        disabled={post.poll!.options.length <= X_MIN_POLL_OPTIONS || !editable}
                        aria-label="Remove option"
                        title={
                          post.poll!.options.length <= X_MIN_POLL_OPTIONS
                            ? "Polls need at least 2 options"
                            : "Remove option"
                        }
                        onClick={() => actions.removePollOption(index, optionIndex)}
                      >
                        <Icon name="ph:x" width={11} height={11} aria-hidden />
                      </button>
                    </div>
                  );
                })}

                {post.poll.options.length < X_MAX_POLL_OPTIONS ? (
                  <button
                    type="button"
                    className="x-comms-poll-add focus-ring"
                    disabled={!editable}
                    onClick={() => actions.addPollOption(index)}
                  >
                    + add option
                  </button>
                ) : (
                  <span className="x-comms-poll-full">
                    {X_MAX_POLL_OPTIONS} options is X&apos;s maximum
                  </span>
                )}
              </div>
            )}

            <div className="x-comms-post-foot">
              <span className="x-comms-attach-group">
                <button
                  type="button"
                  className="x-comms-chip-button focus-ring"
                  disabled={!affordances.canAddImage || !editable}
                  title={
                    affordances.canAddImage
                      ? "Add image (up to 4) · alt text required"
                      : affordances.reason
                  }
                  onClick={() => actions.addMedia(index, "image")}
                >
                  +image
                </button>
                <button
                  type="button"
                  className="x-comms-chip-button focus-ring"
                  disabled={!affordances.canAddSingle || !editable}
                  title={affordances.canAddSingle ? "Add one" : affordances.reason}
                  onClick={() => actions.addMedia(index, "gif")}
                >
                  +gif
                </button>
                <button
                  type="button"
                  className="x-comms-chip-button focus-ring"
                  disabled={!affordances.canAddSingle || !editable}
                  title={affordances.canAddSingle ? "Add one" : affordances.reason}
                  onClick={() => actions.addMedia(index, "video")}
                >
                  +video
                </button>
                <button
                  type="button"
                  className="x-comms-chip-button focus-ring"
                  data-active={genOpen ? "true" : undefined}
                  aria-expanded={genOpen}
                  disabled={
                    (!affordances.canAddImage && !affordances.canAddSingle) || !editable
                  }
                  title={
                    affordances.canAddImage || affordances.canAddSingle
                      ? "Generate an image, GIF or video for this post · local"
                      : affordances.reason
                  }
                  onClick={() =>
                    genOpen
                      ? actions.closeGenerate()
                      : actions.openGenerate({
                          target: index,
                          kind: "image",
                          preset: "16:9",
                          prompt: "",
                        })
                  }
                >
                  +generate
                </button>
                {draft.type !== "dm" && (
                  <button
                    type="button"
                    className="x-comms-chip-button focus-ring"
                    disabled={!affordances.canAddPoll || !editable}
                    title={
                      affordances.canAddPoll
                        ? "Add poll (2–4 options)"
                        : post.poll
                          ? "One poll per post"
                          : "Media and polls don't mix"
                    }
                    onClick={() => actions.addPoll(index)}
                  >
                    +poll
                  </button>
                )}
              </span>

              <span className="x-comms-media-note">
                {post.poll
                  ? "poll"
                  : post.media.length
                    ? affordances.imageCount
                      ? `${affordances.imageCount}/4 images`
                      : post.media[0].kind
                    : ""}
              </span>

              {!isThread && (
                <span
                  className="x-comms-counter"
                  data-state={counterState}
                  title="Weighted count · links count as 23"
                >
                  {length}/{limit}
                </span>
              )}
            </div>

            {genOpen && generate && (
              <GeneratePanel
                generate={generate}
                post={post}
                actions={actions}
              />
            )}
          </article>
        );
      })}

      {isThread && (
        <button
          type="button"
          className="x-comms-add-post focus-ring"
          disabled={!editable}
          onClick={() => actions.addPost()}
        >
          <Icon name="ph:plus" width={12} height={12} aria-hidden /> add post{" "}
          {posts.length + 1}/{posts.length + 1}
        </button>
      )}
    </div>
  );
}

/**
 * Generation happens locally; the cost lands later, at upload. The panel says
 * both, because "free" and "2 API units" are each half the truth and the half
 * an operator gets surprised by is the second one.
 */
function GeneratePanel({
  generate,
  post,
  actions,
}: {
  generate: XGenerateState;
  post: XPostBody;
  actions: XComposerActions;
}) {
  const preset =
    X_MEDIA_PRESETS[generate.kind].find((item) => item.value === generate.preset) ??
    X_MEDIA_PRESETS[generate.kind][0];
  const canConvert =
    generate.kind === "gif" && post.media.some((item) => item.kind === "image");
  const hint =
    generate.kind === "video"
      ? "one clip per post · captions burned in from alt text · 2:20 max"
      : generate.kind === "gif"
        ? "one gif per post · 15 MB max · alt text still required"
        : "up to 4 images per post · alt text written from the prompt, marked for review";

  return (
    <div className="x-comms-generate" role="region" aria-label="Generate media">
      <div className="x-comms-generate-row">
        <span className="x-comms-legend">Generate</span>
        <Segmented
          ariaLabel="Media kind"
          value={generate.kind}
          options={MEDIA_KINDS}
          onChange={(kind) =>
            actions.updateGenerate({ kind, preset: X_MEDIA_PRESETS[kind][0].value })
          }
        />
        <StandardSelect
          label="Size"
          value={generate.preset}
          options={X_MEDIA_PRESETS[generate.kind].map((item) => ({
            value: item.value,
            label: item.label,
          }))}
          onChange={(value) => actions.updateGenerate({ preset: value })}
        />
        <span
          className="x-comms-hint"
          title="Generation runs locally. Uploading at the slot costs 2 API units per attachment."
        >
          {preset.width}×{preset.height}
          {preset.duration ? ` · ${preset.duration}` : ""} · local · 2 api at upload
        </span>
      </div>

      {canConvert && (
        <div className="x-comms-convert">
          <span>or</span>
          <button
            type="button"
            className="x-comms-chip-button focus-ring"
            onClick={() => {
              const first = post.media.findIndex((item) => item.kind === "image");
              if (first >= 0 && typeof generate.target === "number") {
                actions.convertToGif(generate.target, first);
                actions.closeGenerate();
              }
            }}
          >
            convert the attached png → gif
          </button>
          <span>keeps alt · 1 frame · loops</span>
        </div>
      )}

      <textarea
        className="x-comms-prompt"
        value={generate.prompt}
        rows={2}
        placeholder={X_GENERATE_PLACEHOLDER[generate.kind]}
        aria-label="Prompt"
        onChange={(event) => actions.updateGenerate({ prompt: event.target.value })}
      />

      <div className="x-comms-generate-foot">
        <span className="x-comms-generate-hint">{hint}</span>
        <span className="x-comms-generate-actions">
          <Button variant="ghost" size="xs" onClick={() => actions.closeGenerate()}>
            Cancel
          </Button>
          <Button
            variant="secondary"
            size="xs"
            leadingIcon="ph:sparkle"
            disabled={!generate.prompt.trim()}
            title={
              generate.prompt.trim()
                ? "Generates locally. Nothing uploads until the post's slot."
                : "Write a prompt first"
            }
            onClick={() => actions.runGenerate()}
          >
            {generate.replaceIndex != null ? "Regenerate" : "Generate"}
          </Button>
        </span>
      </div>
    </div>
  );
}

export { altFromPrompt };
export type { IconName };
