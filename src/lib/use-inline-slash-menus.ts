"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { canonicalize, matchSlash, type SlashCommand } from "@/lib/slash-commands";
import { modelSlashOptions } from "@/lib/slash-model";
import type { RuntimeModelOption } from "@/lib/runtime-models";
import { skillCommandMatches, skillSlashOptions, type SkillOption } from "@/lib/slash-skill";
import { promptSlashOptions, type PromptOption } from "@/lib/slash-prompt";
import { BUILTIN_PROMPTS } from "@/lib/prompt-defaults";

/**
 * The composer's inline slash menus: the `/command` listbox (with its Skills
 * group), and the `/model`, `/skill`, `/prompt` argument pickers.
 *
 * Why this exists: the chat composer (chat-view.tsx) and the home composer
 * (home-composer.tsx) each hand-rolled the identical menu machinery — the
 * first-token-only matching rule, the skills/prompts fetches, the roving
 * index that runs from the command list into the Skills group, the shared
 * listbox id behind the textarea's combobox ARIA, Esc-dismiss with
 * typing-reopens, and the ↑↓/Tab/Enter keyboard branches. One implementation
 * keeps the two composers' command surface identical.
 *
 * What a pick *does* stays per-composer, by design, via callbacks:
 * - onPickModel: home toasts, chat appends a system line (both then clear);
 * - onPickSkill: home starts a new chat, chat sends in-thread;
 * - onInsertPrompt: both insert-for-editing (never send) — but with their own
 *   caret/announce plumbing;
 * - onRunCommand: home submits the typed text, chat runs the slash intent;
 * - onNoMatchEnter: home falls through to submit; chat consumes and does
 *   nothing.
 *
 * `handleKeyDown` returns true when it consumed the event. It must NEVER own
 * Enter-send or Esc-cancel — chat's pinned ordering is: @-mention branch →
 * this hook → history recall → IME-guarded Enter-send → Esc busy-cancel.
 */
export function useInlineSlashMenus(opts: {
  text: string;
  setText: (t: string) => void;
  modelHarness: string;
  onPickModel: (id: string) => void;
  onPickSkill: (s: SkillOption) => void;
  onInsertPrompt: (p: PromptOption) => void;
  onRunCommand: (cmd: SlashCommand) => void;
  onNoMatchEnter?: () => void;
}): {
  skills: SkillOption[];
  prompts: PromptOption[];
  slashSuggestions: SlashCommand[];
  skillCommandRows: SkillOption[];
  modelOptions: RuntimeModelOption[] | null;
  skillOptions: SkillOption[] | null;
  promptOptions: PromptOption[] | null;
  modelMenuActive: boolean;
  skillMenuActive: boolean;
  promptMenuActive: boolean;
  menuOpen: boolean;
  slashIdx: number;
  setSlashIdx: (updater: number | ((i: number) => number)) => void;
  slashListboxId: string;
  dismiss: () => void;
  handleKeyDown: (e: KeyboardEvent<HTMLTextAreaElement>) => boolean;
} {
  const { text, setText, modelHarness } = opts;
  // Latest-ref for the pick callbacks (usePausablePoll pattern) so inline
  // arrows at the call site don't churn handleKeyDown's identity per render.
  const cbRef = useRef(opts);
  cbRef.current = opts;

  const [slashIdx, setSlashIdx] = useState(0);
  // Esc hides the menus for the current input; any edit brings them back.
  const [slashDismissed, setSlashDismissed] = useState(false);
  useEffect(() => {
    setSlashIdx(0);
    setSlashDismissed(false);
  }, [text]);

  // Slash suggestions — surface only while the user is still typing the
  // command token (no whitespace yet).
  const slashMatches: SlashCommand[] = useMemo(() => {
    const firstWord = text.trimStart().split(/\s/)[0] ?? "";
    if (!firstWord.startsWith("/") || text.trimStart().includes(" ")) return [];
    return matchSlash(firstWord);
  }, [text]);
  const slashSuggestions: SlashCommand[] = slashDismissed ? [] : slashMatches;

  // Skills for the inline `/skill` / `/skills` picker — fetched once from the
  // local skill scan (Coven skills + ~/.claude/skills).
  const [skills, setSkills] = useState<SkillOption[]>([]);
  useEffect(() => {
    let alive = true;
    fetch("/api/skills/local", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        if (alive && j?.ok && Array.isArray(j.skills)) setSkills(j.skills as SkillOption[]);
      })
      .catch(() => {
        /* offline → no inline skill picker (the command menu still works) */
      });
    return () => {
      alive = false;
    };
  }, []);
  // Prompt templates for the `/prompt` / `/prompts` picker. Seeded with the
  // built-ins so the picker works instantly (and offline); the fetch layers
  // in ~/.coven/prompts files and installed marketplace prompt packs.
  const [prompts, setPrompts] = useState<PromptOption[]>(BUILTIN_PROMPTS);
  useEffect(() => {
    let alive = true;
    fetch("/api/prompts", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        if (alive && j?.ok && Array.isArray(j.prompts)) setPrompts(j.prompts as PromptOption[]);
      })
      .catch(() => {
        /* offline → built-in templates only */
      });
    return () => {
      alive = false;
    };
  }, []);

  // While typing "/model <partial>", the menu shows model options instead of
  // commands (an inline picker). null ⇒ not in /model arg position.
  const modelOptions = useMemo(
    () => (slashDismissed ? null : modelSlashOptions(text, modelHarness)),
    [text, modelHarness, slashDismissed],
  );
  const modelMenuActive = (modelOptions?.length ?? 0) > 0;
  // Inline `/skill` / `/skills` picker — null ⇒ not in a skill-picker position.
  const skillOptions = useMemo(
    () => (slashDismissed ? null : skillSlashOptions(text, skills)),
    [text, skills, slashDismissed],
  );
  const skillMenuActive = (skillOptions?.length ?? 0) > 0;
  // Inline `/prompt` / `/prompts` picker — null ⇒ not in a prompt-picker position.
  const promptOptions = useMemo(
    () => (slashDismissed ? null : promptSlashOptions(text, prompts)),
    [text, prompts, slashDismissed],
  );
  const promptMenuActive = (promptOptions?.length ?? 0) > 0;
  // Skills surfaced directly in the command menu — typing `/revi` finds the
  // code-review skill without the /skill prefix. Same first-token-only rule as
  // slashSuggestions so arg positions never double-render.
  const skillCommandRows: SkillOption[] = useMemo(() => {
    if (slashDismissed) return [];
    const t = text.trimStart();
    const firstWord = t.split(/\s/)[0] ?? "";
    if (!firstWord.startsWith("/") || t.includes(" ")) return [];
    return skillCommandMatches(firstWord, skills);
  }, [text, skills, slashDismissed]);

  // The slash-command, /model, /skill and /prompt pickers are mutually
  // exclusive inline listboxes sharing one listbox id, so the composer's
  // combobox ARIA tracks whichever is open. The id is per-mount — the home
  // and chat composers can be mounted simultaneously.
  const menuOpen = modelMenuActive || skillMenuActive || promptMenuActive || slashSuggestions.length > 0 || skillCommandRows.length > 0;
  const slashListboxId = useId();

  const dismiss = useCallback(() => setSlashDismissed(true), []);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>): boolean => {
      // Escape closes whichever menu is open — the menu footers advertise
      // "esc cancel", and typing re-opens it (slashDismissed resets on text).
      // Callers order this after any higher-precedence branch (chat: the
      // @-mention picker) and before Esc-busy-cancel, so a dismissed menu
      // never costs a live stream.
      if (e.key === "Escape" && menuOpen) {
        e.preventDefault();
        setSlashDismissed(true);
        return true;
      }
      // Inline model picker takes priority when "/model <partial>" is open.
      if (modelMenuActive && modelOptions) {
        const opts = modelOptions;
        if (e.key === "ArrowDown") { e.preventDefault(); setSlashIdx((i) => Math.min(i + 1, opts.length - 1)); return true; }
        if (e.key === "ArrowUp") { e.preventDefault(); setSlashIdx((i) => Math.max(i - 1, 0)); return true; }
        if (e.key === "Tab") { e.preventDefault(); const m = opts[slashIdx]; if (m) setText(`/model ${m.id}`); return true; }
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          const m = opts[slashIdx];
          if (m) cbRef.current.onPickModel(m.id);
          return true;
        }
      }
      // Inline skill picker ("/skill <partial>" or "/skills").
      if (skillMenuActive && skillOptions) {
        const opts = skillOptions;
        if (e.key === "ArrowDown") { e.preventDefault(); setSlashIdx((i) => Math.min(i + 1, opts.length - 1)); return true; }
        if (e.key === "ArrowUp") { e.preventDefault(); setSlashIdx((i) => Math.max(i - 1, 0)); return true; }
        if (e.key === "Tab") { e.preventDefault(); const s = opts[slashIdx]; if (s) setText(`/skill ${s.id}`); return true; }
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          const s = opts[slashIdx];
          if (s) cbRef.current.onPickSkill(s);
          return true;
        }
      }
      // Inline prompt picker ("/prompt <partial>" or "/prompts") — Enter
      // INSERTS the template into the composer for editing, never a start.
      if (promptMenuActive && promptOptions) {
        const opts = promptOptions;
        if (e.key === "ArrowDown") { e.preventDefault(); setSlashIdx((i) => Math.min(i + 1, opts.length - 1)); return true; }
        if (e.key === "ArrowUp") { e.preventDefault(); setSlashIdx((i) => Math.max(i - 1, 0)); return true; }
        if (e.key === "Tab") { e.preventDefault(); const p = opts[slashIdx]; if (p) setText(`/prompt ${p.id}`); return true; }
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          const p = opts[slashIdx];
          if (p) cbRef.current.onInsertPrompt(p);
          return true;
        }
      }
      // Slash-command menu. One roving index across commands, then the Skills
      // group beneath them.
      if (slashSuggestions.length > 0 || skillCommandRows.length > 0) {
        const total = slashSuggestions.length + skillCommandRows.length;
        const skillAt = (i: number): SkillOption | undefined =>
          skillCommandRows[i - slashSuggestions.length];
        if (e.key === "ArrowDown") {
          e.preventDefault();
          setSlashIdx((i) => Math.min(i + 1, total - 1));
          return true;
        }
        if (e.key === "ArrowUp") {
          e.preventDefault();
          setSlashIdx((i) => Math.max(i - 1, 0));
          return true;
        }
        if (e.key === "Tab") {
          e.preventDefault();
          const cmd = slashSuggestions[slashIdx];
          const s = skillAt(slashIdx);
          if (cmd) setText(cmd.name + (cmd.argPlaceholder ? " " : ""));
          else if (s) setText(`/skill ${s.id} `);
          return true;
        }
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          const cmd = slashSuggestions[slashIdx];
          const s = skillAt(slashIdx);
          // If the highlighted command takes an argument and the input isn't
          // the exact command yet, autocomplete first (like Tab) so the user
          // can fill in args; otherwise run the highlighted suggestion.
          if (cmd && cmd.argPlaceholder && canonicalize(text.trim()) !== cmd.name) {
            setText(cmd.name + " ");
          } else if (cmd) {
            cbRef.current.onRunCommand(cmd);
          } else if (s) {
            cbRef.current.onPickSkill(s);
          } else {
            cbRef.current.onNoMatchEnter?.();
          }
          return true;
        }
      }
      return false;
    },
    [
      menuOpen,
      modelMenuActive,
      modelOptions,
      skillMenuActive,
      skillOptions,
      promptMenuActive,
      promptOptions,
      slashSuggestions,
      skillCommandRows,
      slashIdx,
      text,
      setText,
    ],
  );

  return {
    skills,
    prompts,
    slashSuggestions,
    skillCommandRows,
    modelOptions,
    skillOptions,
    promptOptions,
    modelMenuActive,
    skillMenuActive,
    promptMenuActive,
    menuOpen,
    slashIdx,
    setSlashIdx,
    slashListboxId,
    dismiss,
    handleKeyDown,
  };
}
