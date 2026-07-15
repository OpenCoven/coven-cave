import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// Modern-Apple polish pass (cave-v6eq): six optimization vectors across the
// chat interface and the shared chrome every surface reuses.
//   1. Haptics — cached, prepare()d generators (no per-tap allocation/latency)
//   2. Streaming scroll — never yank a reader who scrolled up; flash-free open
//   3. Composer — glassmorphic capsule field with a focus accent halo
//   4. Bubbles — accent-gradient user bubble w/ luminance-aware foreground,
//      theme-tracking assistant bubble
//   5. Indicators — PhaseAnimator waves that respect Reduce Motion
//   6. Press states — GlassPressStyle on the shared glass controls

const read = (p) => readFile(new URL(`../${p}`, import.meta.url), "utf8");
const haptics = await read("apps/ios/CovenCave/CovenCave/Haptics.swift");
const chatView = await read("apps/ios/CovenCave/CovenCave/Views/ChatView.swift");
const bubble = await read("apps/ios/CovenCave/CovenCave/Views/MessageBubble.swift");
const theme = await read("apps/ios/CovenCave/CovenCave/Theme/Theme.swift");
const chrome = await read("apps/ios/CovenCave/CovenCave/Theme/ChatChrome.swift");

// ── 1. Haptics: cached generators, kept prepared ─────────────────────────────
assert.match(
  haptics,
  /private static var impacts: \[UIImpactFeedbackGenerator\.FeedbackStyle: UIImpactFeedbackGenerator\]/,
  "impact generators should be cached per style, not allocated per tap",
);
assert.match(
  haptics,
  /generator\.impactOccurred\(\)\s*\n\s*generator\.prepare\(\)/,
  "the impact generator should be re-prepared after firing so the Taptic Engine stays primed",
);
assert.match(
  haptics,
  /notifier\.notificationOccurred\(\.success\)\s*\n\s*notifier\.prepare\(\)/,
  "the notification generator should be shared and re-prepared",
);
assert.doesNotMatch(
  haptics,
  /static func tap[\s\S]{0,120}?UIImpactFeedbackGenerator\(style: style\)\.impactOccurred/,
  "tap() must not allocate a throwaway generator per call",
);

// ── 2. Streaming scroll: reader position is sacred ───────────────────────────
assert.match(
  chatView,
  /onChange\(of: thread\.messages\.last\?\.text\) \{ _, _ in\s*\n\s*guard atBottom else \{ return \}/,
  "token streaming must only auto-scroll while the reader is parked at the bottom",
);
assert.match(
  chatView,
  /onChange\(of: thread\.messages\.count\) \{ _, _ in\s*\n\s*guard atBottom \|\| thread\.messages\.last\?\.role == \.user else \{ return \}/,
  "a new message auto-reveals only at the bottom, or when it's the user's own send",
);
assert.match(
  chatView,
  /\.defaultScrollAnchor\(\.bottom, for: \.initialOffset\)/,
  "the transcript should open anchored at the latest message (no post-layout jump)",
);

// ── 3. Composer: glass capsule + focus halo ──────────────────────────────────
assert.match(
  chatView,
  /\.glassFill\(\.control, in: Capsule\(\)\)\s*\n\s*\.overlay\(Capsule\(\)\.strokeBorder/,
  "the composer field should be a frosted .control capsule, not a bare hairline",
);
assert.match(
  chatView,
  /\.accentGlow\(active: composerFocused \|\| dictation\.isRecording\)/,
  "the focused composer earns the accent halo (the design language's active cue)",
);

// ── 4. Bubbles: gradient + luminance-aware contrast + themed assistant ───────
assert.match(
  theme,
  /var accentForeground: Color \{[\s\S]{0,400}?0\.299 \* r \+ 0\.587 \* g \+ 0\.114 \* b/,
  "ChromePalette.accentForeground should pick black/white text from accent brightness",
);
assert.match(
  theme,
  /var accentGradient: LinearGradient/,
  "ChromePalette should expose the soft vertical accent gradient for filled surfaces",
);
assert.match(
  bubble,
  /if isUser \{ return AnyShapeStyle\(chrome\.accentGradient\) \}/,
  "the user bubble should use the accent gradient wash",
);
assert.match(
  bubble,
  /return AnyShapeStyle\(chrome\.bgRaised\)/,
  "the assistant bubble should sit on the theme's raised surface",
);
assert.match(
  bubble,
  /foregroundStyle\(isUser \? chrome\.accentForeground : Color\.primary\)/,
  "user-bubble text must use the luminance-aware accent foreground, not hard-coded white",
);
assert.match(
  chatView,
  /\.transition\(\.asymmetric\([\s\S]{0,160}?insertion: \.opacity\.combined\(with: \.scale\(scale: 0\.9\d, anchor: \.bottom\)\)/,
  "new bubbles should rise-and-fade in rather than popping",
);
assert.match(
  chatView,
  /\.animation\(reduceMotion \? nil : \.spring\(duration: 0\.3\), value: thread\.messages\.count\)/,
  "bubble insertion animates on count changes and honours Reduce Motion",
);

// ── 5. Indicators: PhaseAnimator waves, Reduce Motion fallback ───────────────
assert.match(
  bubble,
  /struct TypingIndicator: View \{[\s\S]{0,700}?PhaseAnimator\(\[0, 1, 2\]\)/,
  "the typing indicator should be a PhaseAnimator stagger wave",
);
assert.match(
  bubble,
  /struct StreamingDot: View \{[\s\S]{0,500}?PhaseAnimator\(\[0\.2, 1\.0\]\)/,
  "the streaming dot should breathe via PhaseAnimator",
);
const indicatorGuards = bubble.match(
  /accessibilityReduceMotion\) private var reduceMotion/g,
);
assert.ok(
  (indicatorGuards?.length ?? 0) >= 2,
  "both indicators must read Reduce Motion and fall back to static dots",
);
assert.doesNotMatch(
  bubble,
  /repeatForever/,
  "no unguarded repeat-forever animations in the transcript",
);

// ── 6. Press states: shared GlassPressStyle across the chrome ────────────────
assert.match(chrome, /struct GlassPressStyle: ButtonStyle/, "the pressed-state style is shared chrome");
assert.match(
  chrome,
  /scaleEffect\(reduceMotion \? 1 : \(configuration\.isPressed \? scale : 1\)\)/,
  "the press dip collapses to a dim under Reduce Motion",
);
for (const [component, pattern] of [
  ["CircularIconButton", /struct CircularIconButton: View[\s\S]{0,900}?\.buttonStyle\(\.glassPress\)/],
  ["PillSelector", /struct PillSelector<Leading: View>: View[\s\S]{0,1400}?\.buttonStyle\(\.glassPress\)/],
  ["FloatingActionMenu", /struct FloatingActionMenu: View[\s\S]{0,1600}?\.buttonStyle\(GlassPressStyle\(scale: 0\.98\)\)/],
  ["DrawerRow", /struct DrawerRow: View[\s\S]{0,1600}?\.buttonStyle\(GlassPressStyle\(scale: 0\.98\)\)/],
  ["EmptyChatSuggestionRow", /struct EmptyChatSuggestionRow: View[\s\S]{0,1300}?\.buttonStyle\(GlassPressStyle\(scale: 0\.98\)\)/],
]) {
  assert.match(chrome, pattern, `${component} should answer touches with the press style`);
}
assert.match(
  bubble,
  /struct SuggestionPills: View[\s\S]*?\.buttonStyle\(GlassPressStyle\(scale: 0\.98\)\)/,
  "suggestion pills should answer touches with the press style",
);

console.log("ios-modern-polish: ok");
