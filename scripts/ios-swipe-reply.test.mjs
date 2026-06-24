import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (p) => readFile(new URL(`../apps/ios/CovenCave/CovenCave/Views/${p}`, import.meta.url), "utf8");

const bubble = await read("MessageBubble.swift");
// MessageBubble exposes a reply closure, a right-swipe gesture, and a menu item.
assert.match(bubble, /var onReply: \(\(DisplayMessage\) -> Void\)\? = nil/, "MessageBubble should expose onReply");
assert.match(bubble, /private var replySwipe: some Gesture/, "MessageBubble should define the reply swipe gesture");
assert.match(bubble, /DragGesture\(minimumDistance: 24\)/, "reply swipe should be a horizontal drag");
assert.match(
  bubble,
  /abs\(value\.translation\.width\) > abs\(value\.translation\.height\)/,
  "the swipe should only track clearly-horizontal drags (so scrolling is unaffected)",
);
assert.match(bubble, /\.simultaneousGesture\(replySwipe\)/, "the swipe runs alongside the scroll view");
assert.match(bubble, /Label\("Reply", systemImage: "arrowshape\.turn\.up\.left"\)/, "Reply should also be in the context menu");

const chat = await read("ChatView.swift");
// ChatView holds the reply state, shows a banner, and prepends the quote.
assert.match(chat, /@State private var replyingTo: DisplayMessage\?/, "ChatView should track the message being replied to");
assert.match(chat, /onReply: \{ beginReply\(\$0\) \}/, "ChatView should wire the bubble's onReply");
assert.match(chat, /func replyBanner\(_ message: DisplayMessage\)/, "ChatView should render a reply banner");
assert.match(
  chat,
  /let outgoing = replyingTo\.map \{ replyQuote\(\$0\) \+ text \} \?\? text/,
  "send() should prepend the quote when replying",
);
assert.match(chat, /"Replying to \\\(replyAuthor\(message\)\):\\n\\\(quoted\)\\n\\n"/, "replyQuote should build a Markdown quote");

console.log("ios-swipe-reply: ok");
