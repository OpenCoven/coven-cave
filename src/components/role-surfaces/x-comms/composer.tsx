"use client";

/**
 * The well: whatever is being written, plus the two things that decide whether
 * it can ship — the local notes line and the constraint footer.
 *
 * The footer is the part worth reading twice. Every room rule is a chip with a
 * pass/fail dot and its source in the tooltip, so the rules are legible before
 * they block rather than only at the moment of refusal. `/tone` guides how
 * Echo redrafts and never rewrites what the operator typed; `/thread` converts
 * a post into a thread without losing what is already there.
 */

import { useRef, useState, type KeyboardEvent } from "react";
import { Button } from "@/components/ui/button";
import { Icon } from "@/lib/icon";
import {
  countWords,
  isEditable,
  limitFor,
  ruleChips,
  shippedPosts,
  X_POST_TYPE_ORDER,
  X_POST_TYPES,
  X_REPLY_PERMISSIONS,
  X_TARGET_RULES,
  X_TONES,
  xWeightedLength,
  type XDraft,
  type XPostType,
  type XReplyPermission,
  type XTone,
} from "@/lib/x-comms-model";
import { ArticleEditor } from "./article-editor";
import { PostEditor } from "./post-editor";
import { Segmented } from "./segmented";
import type { XComposerActions, XGenerateState } from "./types";

export function Composer({
  draft,
  caretByPost,
  focusedOption,
  generate,
  actions,
  onFocusOption,
}: {
  draft: XDraft;
  caretByPost: Record<number, number>;
  focusedOption: string | null;
  generate: XGenerateState | null;
  actions: XComposerActions;
  onFocusOption: (key: string | null) => void;
}) {
  const editable = isEditable(draft);
  const isArticle = draft.kind === "article";
  const rules = ruleChips(draft);
  const posts = shippedPosts(draft);
  const limit = limitFor(draft);
  const totalLength = posts.reduce((sum, post) => sum + xWeightedLength(post.text), 0);
  const overAny = posts.some((post) => xWeightedLength(post.text) > limit);
  const targetRule = draft.kind === "post" ? X_TARGET_RULES[draft.type] : undefined;
  const targetInvalid =
    targetRule != null && draft.kind === "post" && draft.target.length > 0 && !targetRule.isValid(draft.target);

  const total = isArticle
    ? `${countWords(draft.body)} words`
    : draft.kind === "post" && draft.type === "thread"
      ? `${posts.length} posts · ${totalLength} chars`
      : `${totalLength}/${limit}`;

  return (
    <div className="x-comms-well" data-fill={isArticle ? "true" : "false"}>
      {isArticle ? (
        <ArticleEditor
          draft={draft}
          generate={generate}
          actions={actions}
          editable={editable}
        />
      ) : (
        <>
          <div className="x-comms-well-head">
            <div className="x-comms-well-head-row">
              <span className="x-comms-legend">Post type</span>
              <Segmented<XPostType>
                ariaLabel="Post type"
                value={draft.type}
                options={X_POST_TYPE_ORDER}
                onChange={(next) => actions.setType(next)}
                equalWidth
              />
              <span className="x-comms-hint">{X_POST_TYPES[draft.type].note}</span>
            </div>

            {targetRule && (
              <label
                className="x-comms-target"
                data-invalid={targetInvalid ? "true" : "false"}
                title={targetRule.format}
              >
                <span className="x-comms-row-icon">
                  <Icon
                    name={targetRule.icon as "ph:at"}
                    width={13}
                    height={13}
                    aria-hidden
                  />
                </span>
                <span className="x-comms-target-label">{targetRule.label}</span>
                <input
                  className="x-comms-bare-input"
                  value={draft.target}
                  readOnly={!editable}
                  placeholder={targetRule.placeholder}
                  aria-label={targetRule.label}
                  aria-invalid={targetInvalid}
                  onChange={(event) => actions.setTarget(event.target.value)}
                />
              </label>
            )}

            {targetInvalid && targetRule && (
              <div className="x-comms-target-warning" role="status" aria-live="polite">
                <span>
                  <Icon name="ph:warning" width={13} height={13} aria-hidden />
                </span>
                <span>{targetRule.whenInvalid}</span>
                <Button variant="ghost" size="xs" onClick={() => actions.setTarget("")}>
                  Clear
                </Button>
              </div>
            )}

            {["post", "thread", "quote"].includes(draft.type) && (
              <div className="x-comms-well-head-row">
                <span className="x-comms-target-label">who can reply</span>
                {/* Four short labels fit; a select would hide the current value,
                    which is the one thing this control exists to show. */}
                <Segmented<XReplyPermission>
                  ariaLabel="Who can reply"
                  value={draft.replyPermission}
                  options={X_REPLY_PERMISSIONS}
                  onChange={(next) => actions.setPermission(next)}
                />
              </div>
            )}
          </div>

          <PostEditor
            draft={draft}
            posts={posts}
            caretByPost={caretByPost}
            focusedOption={focusedOption}
            generate={generate}
            actions={actions}
            onFocusOption={onFocusOption}
            editable={editable}
          />
        </>
      )}

      <label className="x-comms-notes">
        <span
          className="x-comms-notes-label"
          title="Working notes. Stored locally with the draft; never sent to X."
        >
          notes · local only
        </span>
        <input
          value={draft.notes}
          placeholder="context for future you — never posted"
          aria-label="Notes, local only"
          onChange={(event) => actions.setNotes(event.target.value)}
        />
      </label>

      <div className="x-comms-constraints">
        <span title="room rules · ward.toml 0.3.1">›</span>
        <span className="x-comms-rule-list">
          {rules.map((rule) => (
            <span
              key={rule.label}
              className="x-comms-rule"
              data-passing={rule.passing ? "true" : "false"}
              title={rule.tip}
            >
              <span className="x-comms-rule-dot" aria-hidden />
              {rule.label}
              {/* Pass/fail is named as well as coloured. */}
              <span className="sr-only">{rule.passing ? " passing" : " failing"}</span>
            </span>
          ))}
        </span>

        <span className="x-comms-constraint-tail">
          {draft.kind === "post" && (
            <button
              type="button"
              className="x-comms-slash focus-ring"
              disabled={!editable}
              title={
                draft.type === "thread"
                  ? "Add another post to the thread"
                  : "Convert to a thread and add a second post. Nothing is lost."
              }
              onClick={() => actions.setType("thread-append")}
            >
              <span>/thread</span>
              <span className="x-comms-slash-value">
                {draft.type === "thread" ? `${draft.posts.length} posts · add` : "split"}
              </span>
            </button>
          )}

          <ToneMenu tone={draft.tone} onSelect={(tone) => actions.setTone(tone)} />

          <span
            className="x-comms-total"
            data-over={overAny ? "true" : "false"}
            title={
              draft.kind === "post" && draft.type === "thread"
                ? "Thread total · each post has its own 280"
                : "Weighted count · links count as 23"
            }
          >
            {total}
          </span>
        </span>
      </div>
    </div>
  );
}

/**
 * Tone is a radio menu rather than a segmented control: five options with
 * descriptions do not fit in a footer, and the description is the part that
 * stops "formal" and "neutral" from being guesses.
 */
function ToneMenu({
  tone,
  onSelect,
}: {
  tone: XTone;
  onSelect: (tone: XTone) => void;
}) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const items = [
      ...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]'),
    ];
    const index = items.indexOf(document.activeElement as HTMLButtonElement);
    const go = (next: number) => {
      event.preventDefault();
      items[(next + items.length) % items.length]?.focus();
    };
    if (event.key === "ArrowDown") go(index + 1);
    else if (event.key === "ArrowUp") go(index - 1);
    else if (event.key === "Home") go(0);
    else if (event.key === "End") go(items.length - 1);
    else if (event.key === "Escape") {
      event.stopPropagation();
      setOpen(false);
    }
  };

  return (
    <span className="x-comms-tone">
      <button
        type="button"
        className="x-comms-slash focus-ring"
        aria-haspopup="menu"
        aria-expanded={open}
        title="Tone guides Echo's wording when it redrafts. Doesn't rewrite what you typed."
        onClick={() => setOpen((value) => !value)}
      >
        <span>/tone</span>
        <span className="x-comms-slash-value">{tone}</span>
      </button>
      {open && (
        <div
          ref={menuRef}
          role="menu"
          aria-label="Tone"
          className="x-comms-menu x-comms-menu--anchored"
          onKeyDown={onKeyDown}
        >
          <span className="x-comms-menu-label">tone · guides Echo&apos;s wording</span>
          {X_TONES.map((entry) => (
            <button
              key={entry.value}
              type="button"
              role="menuitemradio"
              aria-checked={entry.value === tone}
              className="x-comms-menu-item focus-ring"
              onClick={() => {
                onSelect(entry.value);
                setOpen(false);
              }}
            >
              <span className="x-comms-menu-check">
                <Icon name="ph:check" width={12} height={12} aria-hidden />
              </span>
              <span>{entry.value.charAt(0).toUpperCase() + entry.value.slice(1)}</span>
              <span className="x-comms-menu-desc">{entry.description}</span>
            </button>
          ))}
        </div>
      )}
    </span>
  );
}
