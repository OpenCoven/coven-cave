"use client";

/**
 * What the draft will look like where it lands: a timeline card, a DM bubble,
 * or an article page. Rendered locally from the draft — no request, nothing
 * posted, and the header says so, because a faithful preview is exactly the
 * thing that could be mistaken for a published post.
 *
 * Media renders as a frame quoting its alt text rather than a picture. That is
 * partly honesty (there is no file) and partly the point: missing alt text
 * blocks approval, so the review pass is where it has to be visible.
 */

import { Icon } from "@/lib/icon";
import {
  clockLabel,
  countWords,
  handleOf,
  limitFor,
  shippedPosts,
  slotLabel,
  X_POLL_DURATIONS,
  xWeightedLength,
  type XArticleDraft,
  type XDraft,
  type XPostDraft,
} from "@/lib/x-comms-model";
import { X_ACCOUNT } from "./fixtures";

function mediaCaption(kind: string, width: number | undefined, height: number | undefined, duration: string | undefined, alt: string): string {
  const dims = width ? ` · ${width}×${height}` : "";
  const dur = duration ? ` · ${duration}` : "";
  return `${kind}${dims}${dur} · ${alt ? `alt: ${alt}` : "alt: missing — blocks approval"}`;
}

export function Preview({ draft, now }: { draft: XDraft; now: number }) {
  const note =
    draft.kind === "article"
      ? "as an X Article"
      : draft.type === "dm"
        ? "as a direct message"
        : draft.type === "thread"
          ? `as a ${draft.posts.length}-post thread`
          : `as a ${draft.type} on the timeline`;

  return (
    <div className="x-comms-preview">
      <div className="x-comms-preview-head">
        <span>preview</span>
        <span>·</span>
        <span className="x-comms-preview-note">{note}</span>
        <span className="x-comms-preview-tail">rendered locally · not posted</span>
      </div>
      <div className="x-comms-preview-stage">
        {draft.kind === "article" ? (
          <ArticlePreview draft={draft} />
        ) : draft.type === "dm" ? (
          <DmPreview draft={draft} />
        ) : (
          <TimelinePreview draft={draft} now={now} />
        )}
      </div>
    </div>
  );
}

function TimelinePreview({ draft, now }: { draft: XPostDraft; now: number }) {
  const posts = shippedPosts(draft);
  const isThread = draft.type === "thread";
  const limit = limitFor(draft);
  const handle = handleOf(draft) || "@…";

  return (
    <div className="x-comms-timeline">
      {posts.map((post, index) => {
        const length = xWeightedLength(post.text);
        return (
          <div key={index} className="x-comms-tweet">
            <span className="x-comms-tweet-gutter">
              <span className="x-comms-tweet-avatar" aria-hidden>
                {X_ACCOUNT.initial}
              </span>
              {isThread && index < posts.length - 1 && (
                <span className="x-comms-tweet-thread-line" aria-hidden />
              )}
            </span>
            <div className="x-comms-tweet-main">
              <div className="x-comms-tweet-head">
                <strong>{X_ACCOUNT.displayName}</strong>
                <span className="x-comms-tweet-handle">
                  {X_ACCOUNT.handle} ·{" "}
                  {draft.scheduledAt ? slotLabel(now, draft.scheduledAt) : "now"}
                </span>
                <span
                  className="x-comms-tweet-counter"
                  data-over={length > limit ? "true" : "false"}
                >
                  {isThread ? `${index + 1}/${posts.length} · ` : ""}
                  {length}/{limit}
                </span>
              </div>

              {draft.type === "reply" && index === 0 && (
                <span className="x-comms-tweet-handle">
                  Replying to <span>{handle}</span>
                </span>
              )}

              <p className="x-comms-tweet-text">{post.text || "(empty post)"}</p>

              {post.media.length > 0 && (
                <div
                  className="x-comms-tweet-media"
                  data-cols={post.media.length <= 1 ? "1" : "2"}
                >
                  {post.media.map((item, mediaIndex) => (
                    <div
                      key={mediaIndex}
                      className="x-comms-tweet-media-cell"
                      data-missing-alt={item.alt ? "false" : "true"}
                      style={
                        {
                          "--x-media-ratio":
                            post.media.length > 1
                              ? "1 / 1"
                              : item.width
                                ? `${item.width} / ${item.height}`
                                : "16 / 9",
                        } as React.CSSProperties
                      }
                    >
                      <span>
                        {mediaCaption(item.kind, item.width, item.height, item.duration, item.alt)}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {post.poll && (
                <div className="x-comms-tweet-poll">
                  {post.poll.options.map((option, optionIndex) => (
                    <div key={optionIndex} className="x-comms-tweet-poll-option">
                      <span>{option || "(option)"}</span>
                      <span>0%</span>
                    </div>
                  ))}
                  <span className="x-comms-trend-vol">
                    0 votes ·{" "}
                    {X_POLL_DURATIONS.find((entry) => entry.value === post.poll?.duration)?.label}{" "}
                    left
                  </span>
                </div>
              )}

              {draft.type === "quote" && index === 0 && (
                <div className="x-comms-tweet-quote">
                  <div className="x-comms-tweet-head">
                    <span className="x-comms-tweet-avatar" aria-hidden />
                    <strong>{handle}</strong>
                    <span className="x-comms-tweet-handle">· quoted post</span>
                  </div>
                  <span className="x-comms-tweet-handle">
                    {draft.target.replace(/^https:\/\//, "")}
                  </span>
                </div>
              )}

              {/* Dashes, not zeroes: the post has no metrics because it has
                  not been posted, and a row of 0s would read as a flop. */}
              <div className="x-comms-tweet-actions">
                <span>reply —</span>
                <span>repost —</span>
                <span>like —</span>
                <span>views —</span>
                <span>
                  <Icon name="ph:bookmark-simple" width={13} height={13} aria-hidden />
                  <Icon name="ph:arrow-square-out" width={13} height={13} aria-hidden />
                </span>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function DmPreview({ draft }: { draft: XPostDraft }) {
  return (
    <div className="x-comms-dm">
      <span className="x-comms-trend-vol">dm → {draft.target || "@…"}</span>
      <p className="x-comms-dm-bubble">{draft.posts[0]?.text || "(empty message)"}</p>
      <span className="x-comms-trend-vol">now · not sent</span>
    </div>
  );
}

function ArticlePreview({ draft }: { draft: XArticleDraft }) {
  const words = countWords(draft.body);
  const blocks = (draft.body || "(empty article)")
    .split(/(\[img:\d+\])/)
    .filter((chunk) => chunk.trim().length > 0);

  return (
    <div className="x-comms-article-preview">
      <span className="x-comms-trend-vol">
        article · {words.toLocaleString()} words · {Math.max(1, Math.round(words / 200))} min
      </span>
      <h4>{draft.title || "(untitled)"}</h4>
      <div className="x-comms-article-byline">
        <span className="x-comms-avatar" aria-hidden>
          {X_ACCOUNT.initial}
        </span>
        <strong>{X_ACCOUNT.displayName}</strong>
        <span className="x-comms-tweet-handle">{X_ACCOUNT.handle}</span>
      </div>

      {draft.cover && (
        <div
          className="x-comms-tweet-media-cell"
          data-missing-alt={draft.cover.alt ? "false" : "true"}
        >
          <span>
            {draft.cover.alt
              ? `cover · alt: ${draft.cover.alt}`
              : "cover · alt: missing — blocks approval"}
          </span>
        </div>
      )}

      {blocks.map((chunk, index) => {
        const marker = chunk.match(/^\[img:(\d+)\]$/);
        if (!marker) {
          return <p key={index}>{chunk.replace(/^\n+|\n+$/g, "")}</p>;
        }
        const image = draft.inline.find((item) => String(item.n) === marker[1]);
        return (
          <figure key={index} className="x-comms-figure">
            <div
              className="x-comms-tweet-media-cell"
              data-missing-alt={image?.alt ? "false" : "true"}
            >
              <span>
                {image
                  ? image.alt
                    ? `${chunk} · alt: ${image.alt}`
                    : `${chunk} · alt: missing — blocks approval`
                  : `${chunk} · no image`}
              </span>
            </div>
          </figure>
        );
      })}
    </div>
  );
}

export { clockLabel };
