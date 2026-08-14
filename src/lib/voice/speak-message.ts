import { isLocalTtsVoiceName } from "./local-tts.ts";

/**
 * Speaking a chat reply out loud.
 *
 * The familiar studio's voice preview (familiar-studio-brain-tab) already picks
 * an engine and plays a blob, but it only ever synthesizes ONE fixed sample
 * sentence. Reading a real reply has a constraint that preview doesn't: the
 * engine has to accept arbitrary text. Only two of our routes do —
 * `/api/voice/local/tts` and `/api/voice/elevenlabs/tts`. `/api/voice/preview`
 * returns a canned sample and cannot voice a message, so every other provider
 * (openai, or nothing configured) falls back to the browser's own synthesizer,
 * which speaks arbitrary text with no network and no key.
 */

/** Longest reply we'll synthesize in one go. */
export const SPEAK_MAX_CHARS = 4_000;

export type FamiliarVoice = {
  provider?: string | null;
  name?: string | null;
  model?: string | null;
};

export type SpeechPlan =
  | { engine: "local"; voiceName: string }
  | { engine: "elevenlabs"; voiceId: string; modelId?: string }
  | { engine: "system"; voiceName?: string };

/**
 * `local` and `familiar` both mean "this machine's neural voice" — the studio
 * treats them interchangeably, so we match that rather than inventing a third
 * spelling. A local provider whose voice name isn't a known Piper voice means
 * the familiar is pointed at a system voice, not a neural one.
 */
export function resolveSpeechPlan(voice: FamiliarVoice): SpeechPlan {
  const provider = (voice.provider ?? "").trim().toLowerCase();
  const name = (voice.name ?? "").trim();
  const model = (voice.model ?? "").trim();

  if ((provider === "local" || provider === "familiar") && isLocalTtsVoiceName(name)) {
    return { engine: "local", voiceName: name };
  }
  if (provider === "elevenlabs" && name) {
    return model ? { engine: "elevenlabs", voiceId: name, modelId: model } : { engine: "elevenlabs", voiceId: name };
  }
  // openai has no arbitrary-text route, and an unset provider has nothing to
  // call — both land on the platform synthesizer.
  return name && provider !== "elevenlabs" ? { engine: "system", voiceName: name } : { engine: "system" };
}

/** The POST a plan turns into, or null for the system synthesizer. */
export function speechRequestFor(
  plan: SpeechPlan,
  text: string,
): { url: string; body: Record<string, string> } | null {
  if (plan.engine === "local") {
    return { url: "/api/voice/local/tts", body: { text, voiceName: plan.voiceName } };
  }
  if (plan.engine === "elevenlabs") {
    return {
      url: "/api/voice/elevenlabs/tts",
      body: plan.modelId
        ? { text, voiceId: plan.voiceId, modelId: plan.modelId }
        : { text, voiceId: plan.voiceId },
    };
  }
  return null;
}

/**
 * Markdown read aloud is unlistenable — fences become "backtick backtick
 * backtick", link syntax becomes punctuation soup. Strip to prose and drop the
 * parts that carry no spoken meaning. Code blocks are announced rather than
 * read: hearing a whole function is worse than hearing that one is there.
 */
export function stripMarkdownForSpeech(raw: string): string {
  let text = raw;

  // Fenced code → a short spoken placeholder.
  text = text.replace(/```[\s\S]*?```/g, " (code block) ");
  text = text.replace(/~~~[\s\S]*?~~~/g, " (code block) ");

  // Citation footnote definitions and markers (see renderCitedBody).
  text = text.replace(/^\[\^[^\]]+\]:.*$/gm, "");
  text = text.replace(/\[\^([^\]]+)\]/g, "");

  // Images before links, so alt text doesn't survive as a bare word.
  text = text.replace(/!\[[^\]]*\]\([^)]*\)/g, " ");
  text = text.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");

  // Inline code, emphasis, strikethrough — keep the words, drop the markers.
  text = text.replace(/`([^`]+)`/g, "$1");
  text = text.replace(/(\*\*|__)(.*?)\1/g, "$2");
  text = text.replace(/(\*|_)(.*?)\1/g, "$2");
  text = text.replace(/~~(.*?)~~/g, "$1");

  // Headings, quotes, list bullets, horizontal rules, table pipes. These use
  // [ \t] rather than \s for the indent and trailing gap: \s matches newlines,
  // so `\s{0,3}` at a line start would reach back over a preceding blank line
  // and delete it, silently welding two paragraphs together.
  text = text.replace(/^[ \t]{0,3}#{1,6}[ \t]+/gm, "");
  text = text.replace(/^[ \t]{0,3}>[ \t]?/gm, "");
  text = text.replace(/^[ \t]{0,3}[-*+][ \t]+/gm, "");
  text = text.replace(/^[ \t]{0,3}\d+\.[ \t]+/gm, "");
  text = text.replace(/^[ \t]{0,3}([-*_][ \t]*){3,}$/gm, " ");
  text = text.replace(/\|/g, " ");

  // Collapse the whitespace all of the above leaves behind, including the
  // spaces stranded at line edges when a block was replaced or a marker cut.
  text = text.replace(/[ \t]+/g, " ");
  text = text.replace(/[ \t]+\n/g, "\n");
  text = text.replace(/\n[ \t]+/g, "\n");
  text = text.replace(/\n{3,}/g, "\n\n");

  return text.trim();
}

/** Prepare a reply for synthesis: strip markdown, then cap the length. */
export function speechTextFor(raw: string, maxChars = SPEAK_MAX_CHARS): string {
  const stripped = stripMarkdownForSpeech(raw);
  if (stripped.length <= maxChars) return stripped;
  // Cut on a sentence boundary when one is near the cap, so playback doesn't
  // stop mid-word.
  const head = stripped.slice(0, maxChars);
  const lastStop = Math.max(head.lastIndexOf(". "), head.lastIndexOf("\n"));
  return (lastStop > maxChars * 0.6 ? head.slice(0, lastStop + 1) : head).trim();
}
