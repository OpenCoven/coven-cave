"use client";

import Link from "next/link";
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type ReactNode,
} from "react";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/error-state";
import { IconButton } from "@/components/ui/icon-button";
import { useAnnouncer } from "@/components/ui/live-region";
import { StandardSelect } from "@/components/ui/select";
import { settingsGroupId } from "@/components/ui/settings-group";
import { TextArea } from "@/components/ui/text-area";
import { TextInput } from "@/components/ui/text-input";
import { extractNextPaths } from "@/lib/next-paths";
import { FAMILIAR_IMAGE_ACCEPT, prepareFamiliarImage } from "@/lib/familiar-image-upload";
import { useResolvedFamiliars } from "@/lib/familiar-resolve";
import { streamFamiliarText } from "@/lib/familiar-stream";
import { hasLegacySvgUserAvatar } from "@/lib/legacy-svg-avatar-hint";
import { Icon } from "@/lib/icon";
import { openExternalUrl } from "@/lib/open-external";
import {
  PROFILE_LINK_SITES,
  PROFILE_PERSONALITY_AXES,
  PROFILE_TYPE_GROUPS,
  PROFILE_TYPE_NAMES,
  buildProfileBioPrompt,
  compactProfileLinkDrafts,
  legacyProfileName,
  mbtiAdaptation,
  mbtiCode,
  profileCompletion,
  profileLinkDraft,
  profileLinkValue,
  seedPersonalityAxes,
  type ProfileLinkDraft,
  type ProfileLinkSite,
} from "@/lib/settings-profile-form";
import type { Familiar } from "@/lib/types";
import { useArmedConfirm } from "@/lib/use-armed-confirm";
import { useMinuteTick } from "@/lib/use-minute-tick";
import {
  removeUserProfileAvatar,
  saveUserProfile,
  uploadUserProfileAvatar,
  useUserProfile,
  userAvatarUrl,
  type UserProfileSnapshot,
} from "@/lib/user-profile";
import {
  MBTI_TYPES,
  PROFILE_LIMITS,
  type MbtiType,
  type ProfileLink,
  type ProfilePersonality,
  type ProfilePersonalityAxes,
  type UserProfilePatch,
} from "@/lib/user-profile-shared";
import "@/styles/settings-profile.css";

const PROFILE_IMAGE_ACCEPT = FAMILIAR_IMAGE_ACCEPT
  .split(",")
  .filter((mime) => mime !== "image/svg+xml")
  .join(",");
const PROFILE_BIO_GUIDE_MAX = 280;
const SYSTEM_TIMEZONE_VALUE = "__system__";
const PRONOUN_PRESETS = [
  { value: "she / her", label: "she" },
  { value: "he / him", label: "he" },
  { value: "they / them", label: "they" },
] as const;

type ProfileForm = {
  firstName: string;
  lastName: string;
  nickname: string;
  pronouns: string;
  bio: string;
  timezone: string;
  personality: ProfilePersonality | null;
  links: ProfileLinkDraft[];
};

type PreparedProfileImage = {
  dataUrl: string;
  mime: string;
  downsized?: boolean;
};

type PendingAvatar =
  | { kind: "keep" }
  | { kind: "upload"; image: PreparedProfileImage }
  | { kind: "remove" };

function systemTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

function supportedTimezones(systemTz: string): string[] {
  const supportedValuesOf = (
    Intl as typeof Intl & { supportedValuesOf?: (key: "timeZone") => string[] }
  ).supportedValuesOf;
  if (typeof supportedValuesOf !== "function") return [systemTz, "UTC"];
  try {
    return supportedValuesOf("timeZone");
  } catch {
    return [systemTz, "UTC"];
  }
}

function emptyForm(): ProfileForm {
  return {
    firstName: "",
    lastName: "",
    nickname: "",
    pronouns: "",
    bio: "",
    timezone: "",
    personality: null,
    links: [],
  };
}

function cloneForm(form: ProfileForm): ProfileForm {
  return JSON.parse(JSON.stringify(form)) as ProfileForm;
}

function formFromSnapshot(snapshot: UserProfileSnapshot): ProfileForm {
  const profile = snapshot.profile;
  const hasStructuredName = Boolean(profile.firstName || profile.lastName || profile.nickname);
  return {
    firstName: profile.firstName ?? (hasStructuredName ? "" : profile.name ?? ""),
    lastName: profile.lastName ?? "",
    nickname: profile.nickname ?? "",
    pronouns: profile.pronouns ?? "",
    bio: profile.bio ?? "",
    timezone: profile.timezone ?? "",
    personality: profile.personality ?? null,
    links: (profile.links ?? []).map((link, index) => profileLinkDraft(link, String(index + 1))),
  };
}

function normalizedForm(form: ProfileForm): ProfileForm {
  return {
    ...form,
    firstName: form.firstName.trim(),
    lastName: form.lastName.trim(),
    nickname: form.nickname.trim(),
    pronouns: form.pronouns.trim(),
    bio: form.bio.trim(),
    links: form.links.map((link) => ({
      ...link,
      user: link.user.trim(),
      label: link.label.trim(),
      url: link.url.trim(),
    })),
  };
}

function fullName(form: ProfileForm): string {
  return [form.firstName, form.lastName].map((part) => part.trim()).filter(Boolean).join(" ");
}

function displayName(form: ProfileForm): string {
  return form.nickname.trim() || fullName(form);
}

function initials(form: ProfileForm): string {
  return (displayName(form) || "?")
    .split(/\s+/)
    .map((word) => word[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function httpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function storedLinks(
  drafts: ProfileLinkDraft[],
): { ok: true; links: ProfileLink[] } | { ok: false; error: string } {
  const links: ProfileLink[] = [];
  for (const draft of drafts) {
    const blank = draft.site === "custom"
      ? !draft.label.trim() && !draft.url.trim()
      : !draft.user.trim();
    if (blank) continue;
    const value = profileLinkValue(draft);
    if (!value) {
      return { ok: false, error: "Each custom link needs both a label and a URL." };
    }
    if (!httpUrl(value.url)) {
      return { ok: false, error: `${value.label} needs a valid http(s) URL.` };
    }
    links.push(value);
  }
  return { ok: true, links };
}

function zoneClock(now: number, timeZone: string): {
  time: string;
  meridiem: string;
  date: string;
} {
  try {
    const timeParts = new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      minute: "2-digit",
      timeZone,
    }).formatToParts(new Date(now));
    return {
      time: timeParts
        .filter((part) => part.type === "hour" || part.type === "literal" || part.type === "minute")
        .map((part) => part.value)
        .join("")
        .trim(),
      meridiem: timeParts.find((part) => part.type === "dayPeriod")?.value ?? "",
      date: new Intl.DateTimeFormat("en-US", {
        weekday: "short",
        month: "short",
        day: "numeric",
        timeZone,
      }).format(new Date(now)).toUpperCase(),
    };
  } catch {
    return { time: "—", meridiem: "", date: "" };
  }
}

function profilePatch(form: ProfileForm, links: ProfileLink[]): UserProfilePatch {
  return {
    name: legacyProfileName(displayName(form)),
    firstName: form.firstName || null,
    lastName: form.lastName || null,
    nickname: form.nickname || null,
    pronouns: form.pronouns || null,
    bio: form.bio || null,
    timezone: form.timezone || null,
    personality: form.personality,
    links: links.length ? links : null,
  };
}

function isMbtiType(value: string): value is MbtiType {
  return (MBTI_TYPES as readonly string[]).includes(value);
}

export function ProfileSection() {
  const snapshot = useUserProfile();
  const { announce } = useAnnouncer();
  const baseId = useId();
  const hydratedRef = useRef(false);
  const nextLinkIdRef = useRef(1);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const nameEditRef = useRef<HTMLInputElement>(null);
  const percentEditRef = useRef<HTMLInputElement>(null);
  const saveCommandRef = useRef<() => void>(() => {});
  const bioAbortRef = useRef<AbortController | null>(null);
  const savedBadgeTimerRef = useRef<number | null>(null);
  const avatarRemoveConfirm = useArmedConfirm();

  const systemTz = useMemo(systemTimezone, []);
  const timezoneOptions = useMemo(() => {
    const zones = [...new Set([systemTz, "UTC", ...supportedTimezones(systemTz)])];
    return [
      { value: SYSTEM_TIMEZONE_VALUE, label: `System (${systemTz})` },
      ...zones.map((zone) => ({ value: zone, label: zone })),
    ];
  }, [systemTz]);

  const [form, setForm] = useState<ProfileForm>(emptyForm);
  const [savedForm, setSavedForm] = useState<ProfileForm>(emptyForm);
  const [pendingAvatar, setPendingAvatar] = useState<PendingAvatar>({ kind: "keep" });
  const [preparingAvatar, setPreparingAvatar] = useState(false);
  const [saving, setSaving] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [legacySvgAvatar, setLegacySvgAvatar] = useState(false);
  const [cardOpen, setCardOpen] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [customPronoun, setCustomPronoun] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(true);
  const [tuningOpen, setTuningOpen] = useState(false);
  const [editingAxis, setEditingAxis] = useState<keyof ProfilePersonalityAxes | null>(null);
  const [percentDraft, setPercentDraft] = useState("");
  const [armedLinkId, setArmedLinkId] = useState<string | null>(null);
  const minuteTick = useMinuteTick();
  const now = useMemo(() => Date.now(), [minuteTick]);
  const [rawFamiliars, setRawFamiliars] = useState<Familiar[]>([]);
  const familiars = useResolvedFamiliars(rawFamiliars);
  const [familiarLoadState, setFamiliarLoadState] = useState<"loading" | "ready" | "error">("loading");
  const [familiarLoadNonce, setFamiliarLoadNonce] = useState(0);
  const [drafterId, setDrafterId] = useState("");
  const [drafting, setDrafting] = useState(false);
  const [previousBio, setPreviousBio] = useState("");
  const [draftNote, setDraftNote] = useState("");

  useEffect(() => {
    if (!snapshot || hydratedRef.current) return;
    const next = formFromSnapshot(snapshot);
    setForm(next);
    setSavedForm(cloneForm(next));
    setCustomPronoun(
      Boolean(next.pronouns)
      && !PRONOUN_PRESETS.some((preset) => preset.value === next.pronouns),
    );
    setPickerOpen(!next.personality);
    setTuningOpen(Boolean(next.personality?.tuned));
    nextLinkIdRef.current = next.links.length + 1;
    hydratedRef.current = true;
  }, [snapshot]);

  useEffect(() => {
    if (snapshot?.avatar.present || pendingAvatar.kind === "upload") {
      setLegacySvgAvatar(false);
      return;
    }
    let cancelled = false;
    void hasLegacySvgUserAvatar().then((hasSvg) => {
      if (!cancelled) setLegacySvgAvatar(hasSvg);
    });
    return () => {
      cancelled = true;
    };
  }, [pendingAvatar.kind, snapshot?.avatar.present]);

  useEffect(() => {
    if (!editingName) return;
    nameEditRef.current?.focus();
    nameEditRef.current?.select();
  }, [editingName]);

  useEffect(() => {
    if (editingAxis === null) return;
    percentEditRef.current?.focus();
    percentEditRef.current?.select();
  }, [editingAxis]);

  useEffect(() => {
    const controller = new AbortController();
    setFamiliarLoadState("loading");
    void fetch("/api/familiars", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(`Failed to load familiars (${response.status})`);
        const data = (await response.json()) as { ok?: boolean; familiars?: Familiar[] };
        if (!data.ok || !Array.isArray(data.familiars)) {
          throw new Error("Familiars response was invalid");
        }
        if (controller.signal.aborted) return;
        setRawFamiliars(data.familiars);
        setFamiliarLoadState("ready");
      })
      .catch(() => {
        if (!controller.signal.aborted) setFamiliarLoadState("error");
      });
    return () => controller.abort();
  }, [familiarLoadNonce]);

  useEffect(() => {
    if (drafterId && familiars.some((familiar) => familiar.id === drafterId)) return;
    setDrafterId(familiars[0]?.id ?? "");
  }, [drafterId, familiars]);

  useEffect(() => {
    if (armedLinkId === null) return;
    const timeout = window.setTimeout(() => setArmedLinkId(null), 4_000);
    return () => window.clearTimeout(timeout);
  }, [armedLinkId]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        saveCommandRef.current();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    return () => {
      bioAbortRef.current?.abort();
      if (savedBadgeTimerRef.current) window.clearTimeout(savedBadgeTimerRef.current);
    };
  }, []);

  const disabled = !snapshot;
  const formDirty = JSON.stringify(form) !== JSON.stringify(savedForm);
  const avatarDirty = pendingAvatar.kind !== "keep";
  const dirty = formDirty || avatarDirty;
  const currentZone = form.timezone || systemTz;
  const clock = zoneClock(now, currentZone);
  const effectiveType = mbtiCode(form.personality);
  const linksResult = storedLinks(form.links);
  const liveLinks = linksResult.ok ? linksResult.links : [];
  const avatarSrc = pendingAvatar.kind === "upload"
    ? pendingAvatar.image.dataUrl
    : pendingAvatar.kind === "remove"
      ? null
      : userAvatarUrl(snapshot);
  const avatarPresent = pendingAvatar.kind === "upload"
    || (pendingAvatar.kind === "keep" && Boolean(snapshot?.avatar.present));
  const completion = profileCompletion({
    displayName: displayName(form),
    pronouns: form.pronouns,
    avatar: avatarPresent,
    bio: form.bio,
    links: liveLinks.length,
  });
  const headerMeta = [
    form.pronouns.trim(),
    currentZone,
    effectiveType,
    `${liveLinks.length} ${liveLinks.length === 1 ? "link" : "links"}`,
  ].filter(Boolean).join(" · ");
  const drafter = familiars.find((familiar) => familiar.id === drafterId) ?? null;

  async function onAvatarFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setPreparingAvatar(true);
    setError(null);
    try {
      const image = await prepareFamiliarImage(file);
      setPendingAvatar({ kind: "upload", image });
      avatarRemoveConfirm.disarm();
      announce(
        image.downsized
          ? "Portrait ready to save. The image was downsized for Cave."
          : "Portrait ready to save.",
      );
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Could not read image.";
      setError(message);
      announce(message, "assertive");
    } finally {
      setPreparingAvatar(false);
    }
  }

  function stageAvatarRemoval() {
    avatarRemoveConfirm.trigger(() => {
      setPendingAvatar({ kind: "remove" });
      announce("Portrait removal ready to save.");
    });
  }

  function discard() {
    const restored = cloneForm(savedForm);
    setForm(restored);
    setPendingAvatar({ kind: "keep" });
    setCustomPronoun(
      Boolean(restored.pronouns)
      && !PRONOUN_PRESETS.some((preset) => preset.value === restored.pronouns),
    );
    setPickerOpen(!restored.personality);
    setTuningOpen(Boolean(restored.personality?.tuned));
    setDraftNote("");
    setError(null);
    setJustSaved(false);
    avatarRemoveConfirm.disarm();
    announce("Unsaved profile changes discarded.");
  }

  async function save() {
    if (!snapshot || !dirty || saving) return;
    const next = normalizedForm(form);
    const nextLinks = storedLinks(next.links);
    if (!nextLinks.ok) {
      setError(nextLinks.error);
      announce(nextLinks.error, "assertive");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      if (formDirty) {
        const result = await saveUserProfile(profilePatch(next, nextLinks.links));
        if (!result.ok) {
          setError(result.reason);
          announce(result.reason, "assertive");
          return;
        }
        const persistedForm = {
          ...next,
          links: compactProfileLinkDrafts(next.links),
        };
        setForm(persistedForm);
        setSavedForm(cloneForm(persistedForm));
      }

      if (pendingAvatar.kind === "upload") {
        const result = await uploadUserProfileAvatar({
          dataUrl: pendingAvatar.image.dataUrl,
          mime: pendingAvatar.image.mime,
        });
        if (!result.ok) {
          setError(result.reason);
          announce(result.reason, "assertive");
          return;
        }
        setPendingAvatar({ kind: "keep" });
      } else if (pendingAvatar.kind === "remove") {
        const result = await removeUserProfileAvatar();
        if (!result.ok) {
          setError(result.reason);
          announce(result.reason, "assertive");
          return;
        }
        setPendingAvatar({ kind: "keep" });
      }

      setJustSaved(true);
      if (savedBadgeTimerRef.current) window.clearTimeout(savedBadgeTimerRef.current);
      savedBadgeTimerRef.current = window.setTimeout(() => setJustSaved(false), 2_400);
      announce("Profile saved.");
    } finally {
      setSaving(false);
    }
  }

  saveCommandRef.current = () => {
    void save();
  };

  function patchForm(patch: Partial<ProfileForm>) {
    setForm((current) => ({ ...current, ...patch }));
    setJustSaved(false);
  }

  function pickPronouns(value: string) {
    setCustomPronoun(false);
    patchForm({ pronouns: form.pronouns === value ? "" : value });
  }

  function chooseType(type: MbtiType) {
    if (effectiveType === type) {
      patchForm({ personality: null });
      setPickerOpen(true);
      setTuningOpen(false);
      return;
    }
    patchForm({
      personality: { type, tuned: false, axes: seedPersonalityAxes(type) },
    });
    setPickerOpen(false);
    setTuningOpen(false);
  }

  function flipPersonalityAxis(index: number) {
    const personality = form.personality;
    if (!personality) return;
    const axis = PROFILE_PERSONALITY_AXES[index];
    if (personality.tuned) {
      patchForm({
        personality: {
          ...personality,
          axes: {
            ...personality.axes,
            [axis.key]: 100 - personality.axes[axis.key],
          },
        },
      });
      return;
    }
    const code = personality.type.split("");
    code[index] = code[index] === axis.a ? axis.b : axis.a;
    const nextType = code.join("");
    if (!isMbtiType(nextType)) return;
    patchForm({
      personality: {
        type: nextType,
        tuned: false,
        axes: seedPersonalityAxes(nextType),
      },
    });
  }

  function toggleTuning() {
    const personality = form.personality;
    if (!personality) return;
    if (personality.tuned) {
      const type = mbtiCode(personality);
      if (!isMbtiType(type)) return;
      patchForm({ personality: { ...personality, type, tuned: false } });
      setTuningOpen(false);
      return;
    }
    patchForm({
      personality: {
        ...personality,
        tuned: true,
        axes: seedPersonalityAxes(personality.type),
      },
    });
    setTuningOpen(true);
  }

  function setPersonalityAxis(key: keyof ProfilePersonalityAxes, value: number) {
    if (!form.personality) return;
    patchForm({
      personality: {
        ...form.personality,
        axes: { ...form.personality.axes, [key]: value },
      },
    });
  }

  function commitExactPercent(index: number) {
    const personality = form.personality;
    const axis = PROFILE_PERSONALITY_AXES[index];
    if (!personality || !axis) {
      setEditingAxis(null);
      return;
    }
    const parsed = Number.parseInt(percentDraft, 10);
    if (!Number.isNaN(parsed)) {
      const percent = Math.max(0, Math.min(100, parsed));
      const letter = effectiveType[index];
      setPersonalityAxis(axis.key, letter === axis.a ? 100 - percent : percent);
    }
    setEditingAxis(null);
  }

  function updateLink(id: string, patch: Partial<ProfileLinkDraft>) {
    patchForm({
      links: form.links.map((link) => link.id === id ? { ...link, ...patch } : link),
    });
  }

  function addLink() {
    if (form.links.length >= PROFILE_LIMITS.links) return;
    const id = String(nextLinkIdRef.current++);
    patchForm({
      links: [...form.links, { id, site: "github", user: "", label: "", url: "" }],
    });
  }

  function removeLink(id: string) {
    if (armedLinkId !== id) {
      setArmedLinkId(id);
      announce("Press remove again to confirm.");
      return;
    }
    setArmedLinkId(null);
    patchForm({ links: form.links.filter((link) => link.id !== id) });
    announce("Link removed from the draft.");
  }

  async function draftBio() {
    if (!drafter || drafting) return;
    const currentLinks = storedLinks(form.links);
    if (!currentLinks.ok) {
      setError(currentLinks.error);
      announce(currentLinks.error, "assertive");
      return;
    }
    const controller = new AbortController();
    bioAbortRef.current?.abort();
    bioAbortRef.current = controller;
    setDrafting(true);
    setError(null);
    const priorBio = form.bio;
    try {
      const result = await streamFamiliarText({
        familiarId: drafter.id,
        prompt: buildProfileBioPrompt({
          familiarName: drafter.display_name,
          firstName: form.firstName,
          lastName: form.lastName,
          nickname: form.nickname,
          pronouns: form.pronouns,
          timezone: currentZone,
          personality: form.personality,
          links: currentLinks.links,
        }),
        permissionMode: "read",
        origin: "enhance",
        signal: controller.signal,
      });
      const text = extractNextPaths(result.text).visible
        .trim()
        .replace(/^["“]|["”]$/g, "")
        .slice(0, PROFILE_LIMITS.bio);
      if (result.error || !text) {
        throw new Error(result.error || `${drafter.display_name} did not return a bio.`);
      }
      setPreviousBio(priorBio);
      patchForm({ bio: text });
      setDraftNote(
        `Drafted by ${drafter.display_name} from your name, type, timezone, and links.`,
      );
      announce(`Bio drafted by ${drafter.display_name}.`);
    } catch (cause) {
      if (controller.signal.aborted) return;
      const message = cause instanceof Error ? cause.message : "Could not draft the bio.";
      setError(message);
      announce(message, "assertive");
    } finally {
      if (bioAbortRef.current === controller) bioAbortRef.current = null;
      setDrafting(false);
    }
  }

  return (
    <section className="settings-profile" aria-labelledby={`${baseId}-title`}>
      <h2 id={`${baseId}-title`} className="sr-only">Profile</h2>

      <header className="settings-profile__hero">
        <button
          type="button"
          className="settings-profile__hero-avatar focus-ring"
          onClick={() => setCardOpen((open) => !open)}
          aria-expanded={cardOpen}
          aria-controls={`${baseId}-profile-card`}
          title={cardOpen ? "Hide profile card" : "Show profile card"}
        >
          {avatarSrc ? <img src={avatarSrc} alt="" /> : <span aria-hidden="true">{initials(form)}</span>}
        </button>
        <div className="settings-profile__hero-copy">
          <p className="settings-profile__eyebrow">SETTINGS · PROFILE</p>
          {editingName ? (
            <TextInput
              ref={nameEditRef}
              className="settings-profile__hero-name-input focus-ring-inset"
              defaultValue={displayName(form)}
              aria-label="Display name"
              maxLength={PROFILE_LIMITS.nickname}
              onChange={(event) => patchForm({ nickname: event.target.value })}
              onBlur={() => setEditingName(false)}
              onKeyDown={(event) => {
                if (event.nativeEvent.isComposing) return;
                if (event.key === "Enter" || event.key === "Escape") {
                  event.preventDefault();
                  setEditingName(false);
                }
              }}
            />
          ) : (
            <h3>
              <button
                type="button"
                className="settings-profile__hero-name focus-ring"
                title="Double-click to rename"
                aria-label={`Rename profile display name: ${displayName(form) || "User profile"}`}
                onDoubleClick={() => setEditingName(true)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    setEditingName(true);
                  }
                }}
              >
                {displayName(form) || "User profile"}
              </button>
            </h3>
          )}
          <p className="settings-profile__meta">{headerMeta}</p>
        </div>
        <div className="settings-profile__hero-status">
          {justSaved && !dirty ? (
            <span className="settings-profile__saved">
              <Icon name="ph:check" aria-hidden />
              Saved
            </span>
          ) : null}
          <div className="settings-profile__completion">
            <span>{completion.filled}/{completion.total} complete</span>
            <progress
              aria-label="Profile completion"
              max={completion.total}
              value={completion.filled}
            />
          </div>
        </div>
      </header>

      {cardOpen ? (
        <aside
          id={`${baseId}-profile-card`}
          className="settings-profile__preview"
          aria-label="Profile card preview"
        >
          <div className="settings-profile__preview-avatar">
            {avatarSrc ? <img src={avatarSrc} alt="" /> : <span aria-hidden="true">{initials(form)}</span>}
          </div>
          <div className="settings-profile__preview-copy">
            <div className="settings-profile__preview-name">
              <strong>{displayName(form) || "Unnamed operator"}</strong>
              <span>{[form.pronouns, currentZone].filter(Boolean).join(" · ")}</span>
            </div>
            <p className={form.bio.trim() ? "" : "is-placeholder"}>
              {form.bio.trim() || "No bio yet — familiars will default to a neutral voice."}
            </p>
            <div className="settings-profile__preview-links">
              {liveLinks.map((link) => <span key={`${link.label}:${link.url}`}>{link.label}</span>)}
            </div>
          </div>
          <IconButton
            icon="ph:x"
            size="sm"
            aria-label="Close profile card"
            onClick={() => setCardOpen(false)}
          />
        </aside>
      ) : null}

      {disabled ? (
        <p className="settings-profile__notice">
          Daemon offline — profile unavailable.
        </p>
      ) : null}
      {error ? (
        <p className="settings-profile__notice settings-profile__notice--danger" role="alert">
          {error}
        </p>
      ) : null}

      <div className="settings-profile__body">
        <section
          id={settingsGroupId("Identity")}
          data-settings-group
          className="settings-profile__section"
          aria-labelledby={`${baseId}-identity`}
        >
          <ProfileSectionHeading id={`${baseId}-identity`} label="IDENTITY" />
          <div className="settings-profile__identity">
            <div className="settings-profile__portrait reveal-scope">
              <div className="settings-profile__portrait-image">
                {avatarSrc ? (
                  <img src={avatarSrc} alt="Current portrait preview" />
                ) : (
                  <span>
                    <strong aria-hidden="true">{initials(form)}</strong>
                    <small>No portrait</small>
                  </span>
                )}
              </div>
              <div className="settings-profile__portrait-actions reveal-on-hover">
                <Button
                  variant="secondary"
                  size="sm"
                  leadingIcon="ph:camera"
                  disabled={disabled || preparingAvatar || saving}
                  onClick={() => fileInputRef.current?.click()}
                >
                  {preparingAvatar ? "Preparing…" : "Upload"}
                </Button>
                {pendingAvatar.kind === "remove" ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={saving}
                    onClick={() => setPendingAvatar({ kind: "keep" })}
                  >
                    Keep
                  </Button>
                ) : avatarPresent ? (
                  <Button
                    variant="danger-ghost"
                    size="sm"
                    disabled={saving}
                    onClick={stageAvatarRemoval}
                  >
                    {avatarRemoveConfirm.armed ? "Really remove?" : "Remove"}
                  </Button>
                ) : null}
              </div>
              <label className="sr-only" htmlFor={`${baseId}-avatar`}>Upload portrait</label>
              <input
                ref={fileInputRef}
                id={`${baseId}-avatar`}
                type="file"
                accept={PROFILE_IMAGE_ACCEPT}
                disabled={disabled || preparingAvatar || saving}
                onChange={onAvatarFile}
                className="sr-only"
              />
            </div>

            <div className="settings-profile__identity-fields">
              <p className="settings-profile__field-title">Name &amp; pronouns</p>
              <div className="settings-profile__name-row">
                <label className="settings-profile__input-field">
                  <span className="settings-profile__input-label">First name</span>
                  <TextInput
                    value={form.firstName}
                    maxLength={PROFILE_LIMITS.firstName}
                    disabled={disabled || saving}
                    onChange={(event) => patchForm({ firstName: event.target.value })}
                    placeholder="e.g., Valentina"
                    aria-label="First name"
                  />
                </label>
                <label className="settings-profile__input-field">
                  <span className="settings-profile__input-label">Last name</span>
                  <TextInput
                    value={form.lastName}
                    maxLength={PROFILE_LIMITS.lastName}
                    disabled={disabled || saving}
                    onChange={(event) => patchForm({ lastName: event.target.value })}
                    placeholder="e.g., Alexander"
                    aria-label="Last name"
                  />
                </label>
                <label className="settings-profile__input-field">
                  <span className="settings-profile__input-label">Nickname <small>Optional</small></span>
                  <TextInput
                    value={form.nickname}
                    maxLength={PROFILE_LIMITS.nickname}
                    disabled={disabled || saving}
                    onChange={(event) => patchForm({ nickname: event.target.value })}
                    placeholder="e.g., Val"
                    aria-label="Nickname"
                  />
                </label>
                <div className="settings-profile__pronouns" aria-label="Pronouns">
                  {PRONOUN_PRESETS.map((preset) => (
                    <button
                      key={preset.value}
                      type="button"
                      className="focus-ring"
                      aria-pressed={!customPronoun && form.pronouns === preset.value}
                      title={preset.value}
                      disabled={disabled || saving}
                      onClick={() => pickPronouns(preset.value)}
                    >
                      {preset.label}
                    </button>
                  ))}
                  <button
                    type="button"
                    className="focus-ring"
                    aria-pressed={customPronoun}
                    aria-label="Write custom pronouns"
                    title="Write your own"
                    disabled={disabled || saving}
                    onClick={() => setCustomPronoun(true)}
                  >
                    <Icon name="ph:pencil-simple" aria-hidden />
                  </button>
                </div>
                {customPronoun ? (
                  <label className="settings-profile__custom-pronouns">
                    <span className="sr-only">Custom pronouns</span>
                    <TextInput
                      autoFocus
                      value={form.pronouns}
                      maxLength={PROFILE_LIMITS.pronouns}
                      disabled={disabled || saving}
                      onChange={(event) => patchForm({ pronouns: event.target.value })}
                      placeholder="ze / hir"
                      aria-label="Custom pronouns"
                    />
                  </label>
                ) : null}
              </div>
              <p className="settings-profile__hint">
                PNG, JPEG, or WebP — hover the portrait to upload or remove.
              </p>
              {legacySvgAvatar ? (
                <p className="settings-profile__hint">
                  Your previous avatar was an SVG, which can no longer be used — re-upload it as PNG, JPEG, or WebP.
                </p>
              ) : null}
            </div>
          </div>
        </section>

        <section
          id={settingsGroupId("Context")}
          data-settings-group
          className="settings-profile__section"
          aria-labelledby={`${baseId}-context`}
        >
          <ProfileSectionHeading id={`${baseId}-context`} label="CONTEXT" />
          <div className="settings-profile__context">
            <article className="settings-profile__clock">
              <div>
                <span>TIMEZONE</span>
                <span>{clock.date}</span>
              </div>
              <p>
                <strong>{clock.time}</strong>
                <span>{clock.meridiem}</span>
              </p>
              <small>Familiars receive this timezone in your profile context.</small>
            </article>

            <article className="settings-profile__bio">
              <header>
                <span>BIO</span>
                <div className="settings-profile__bio-actions">
                  <StandardSelect
                    label="Bio drafting familiar"
                    value={drafterId}
                    onChange={setDrafterId}
                    options={familiars.map((familiar) => ({
                      value: familiar.id,
                      label: familiar.display_name,
                      detail: familiar.role,
                    }))}
                    placeholder={familiarLoadState === "loading"
                      ? "Loading familiars…"
                      : familiarLoadState === "ready" && familiars.length === 0
                        ? "No familiars available"
                        : "Choose familiar"}
                    className="settings-profile__select settings-profile__select--compact"
                    disabled={disabled || saving || drafting || familiars.length === 0}
                  />
                  <Button
                    variant="secondary"
                    size="xs"
                    leadingIcon="ph:sparkle"
                    loading={drafting}
                    disabled={disabled || saving || !drafter}
                    onClick={() => void draftBio()}
                  >
                    {drafting
                      ? "Drafting…"
                      : form.bio.trim()
                        ? `Redraft with ${drafter?.display_name ?? "familiar"}`
                        : `Draft with ${drafter?.display_name ?? "familiar"}`}
                  </Button>
                </div>
              </header>
              {familiarLoadState === "error" ? (
                <ErrorState
                  compact
                  headline="Couldn’t load familiars"
                  subtitle="Bio drafting is unavailable until the roster reconnects."
                  actions={(
                    <Button
                      variant="secondary"
                      size="xs"
                      onClick={() => setFamiliarLoadNonce((nonce) => nonce + 1)}
                    >
                      Retry
                    </Button>
                  )}
                />
              ) : null}
              <div className="settings-profile__bio-editor">
                <TextArea
                  rows={4}
                  value={form.bio}
                  maxLength={PROFILE_LIMITS.bio}
                  disabled={disabled || saving || drafting}
                  onChange={(event) => {
                    patchForm({ bio: event.target.value });
                    setDraftNote("");
                  }}
                  placeholder="Product designer. Terse over polite. Ship the small thing first."
                  aria-label="Bio"
                />
                <span className={form.bio.length > PROFILE_BIO_GUIDE_MAX ? "is-over" : ""}>
                  {form.bio.length} / {PROFILE_BIO_GUIDE_MAX}
                </span>
              </div>
              <footer>Shapes how familiars write for you.</footer>
              {draftNote ? (
                <div className="settings-profile__draft-note">
                  <span>{draftNote}</span>
                  <button
                    type="button"
                    className="focus-ring"
                    onClick={() => {
                      patchForm({ bio: previousBio });
                      setDraftNote("");
                      announce("Bio draft undone.");
                    }}
                  >
                    Undo
                  </button>
                </div>
              ) : null}
            </article>
          </div>

          <div className="settings-profile__timezone-select">
            <label htmlFor={`${baseId}-timezone`}>TIMEZONE</label>
            <StandardSelect
              id={`${baseId}-timezone`}
              label="Timezone"
              value={form.timezone || SYSTEM_TIMEZONE_VALUE}
              onChange={(value) => patchForm({
                timezone: value === SYSTEM_TIMEZONE_VALUE ? "" : value,
              })}
              options={timezoneOptions}
              className="settings-profile__select"
              disabled={disabled || saving}
            />
          </div>
        </section>

        <section
          id={settingsGroupId("Personality")}
          data-settings-group
          className="settings-profile__section"
          aria-labelledby={`${baseId}-personality`}
        >
          <ProfileSectionHeading id={`${baseId}-personality`} label="PERSONALITY" detail="MBTI" />
          <div className="settings-profile__personality">
            <div className="settings-profile__personality-top">
              <div>
                <strong>Type</strong>
                <span>Shapes tone, not content</span>
              </div>
              <button
                type="button"
                className="settings-profile__picker-toggle focus-ring"
                aria-expanded={pickerOpen}
                onClick={() => setPickerOpen((open) => !open)}
                disabled={disabled || saving}
              >
                <Icon name="ph:caret-down" aria-hidden />
                {form.personality ? "Change type" : "Choose your type"}
              </button>
              {form.personality ? (
                <div className="settings-profile__type-tiles">
                  {PROFILE_PERSONALITY_AXES.map((axis, index) => {
                    const letter = effectiveType[index];
                    const value = form.personality!.axes[axis.key];
                    const percent = letter === axis.a ? 100 - value : value;
                    return editingAxis === axis.key ? (
                      <div
                        key={axis.key}
                        className="settings-profile__type-tile is-editing"
                      >
                        <strong>{letter}</strong>
                        <input
                          ref={percentEditRef}
                          type="number"
                          min="0"
                          max="100"
                          className="settings-profile__type-percent-input focus-ring-inset"
                          value={percentDraft}
                          aria-label={`Percent for ${axis.aWord} to ${axis.bWord}`}
                          onChange={(event) => setPercentDraft(event.target.value)}
                          onBlur={() => commitExactPercent(index)}
                          onClick={(event) => event.stopPropagation()}
                          onKeyDown={(event) => {
                            event.stopPropagation();
                            if (event.key === "Enter") {
                              event.preventDefault();
                              commitExactPercent(index);
                            } else if (event.key === "Escape") {
                              event.preventDefault();
                              setEditingAxis(null);
                            }
                          }}
                        />
                      </div>
                    ) : (
                      <button
                        key={axis.key}
                        type="button"
                        className="settings-profile__type-tile focus-ring"
                        title={`Switch to ${letter === axis.a ? axis.bWord : axis.aWord}`}
                        disabled={disabled || saving}
                        onClick={() => flipPersonalityAxis(index)}
                      >
                        <strong>{letter}</strong>
                        {form.personality?.tuned ? (
                          <span
                            title="Double-click to set exactly"
                            onClick={(event) => event.stopPropagation()}
                            onDoubleClick={(event) => {
                              event.stopPropagation();
                              setPercentDraft(String(Math.round(percent)));
                              setEditingAxis(axis.key);
                            }}
                          >
                            {Math.round(percent)}%
                          </span>
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              ) : (
                <button
                  type="button"
                  className="settings-profile__personality-test focus-ring"
                  onClick={() => openExternalUrl("https://www.16personalities.com/free-personality-test")}
                >
                  <Icon name="ph:sparkle" aria-hidden />
                  Take the 12-minute test
                  <Icon name="ph:arrow-square-out" aria-hidden />
                </button>
              )}
            </div>

            {pickerOpen ? (
              <div className="settings-profile__type-picker">
                {PROFILE_TYPE_GROUPS.map((group) => (
                  <div key={group.name}>
                    <span>{group.name.toUpperCase()}</span>
                    <div>
                      {group.codes.map((type) => (
                        <button
                          key={type}
                          type="button"
                          className="focus-ring"
                          aria-pressed={effectiveType === type}
                          title={PROFILE_TYPE_NAMES[type]}
                          disabled={disabled || saving}
                          onClick={() => chooseType(type)}
                        >
                          {type}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            ) : null}

            {form.personality ? (
              <>
                <div className="settings-profile__type-summary">
                  <strong>{PROFILE_TYPE_NAMES[effectiveType as MbtiType]} · {effectiveType}</strong>
                  <span>{mbtiAdaptation(effectiveType)}</span>
                  <button
                    type="button"
                    className="focus-ring"
                    aria-expanded={tuningOpen}
                    disabled={disabled || saving}
                    onClick={toggleTuning}
                  >
                    <Icon name="ph:caret-down" aria-hidden />
                    {form.personality.tuned ? "Hide axes" : "Fine-tune axes"}
                  </button>
                </div>

                {form.personality.tuned && tuningOpen ? (
                  <div className="settings-profile__axes">
                    {PROFILE_PERSONALITY_AXES.map((axis) => {
                      const value = form.personality!.axes[axis.key];
                      const towardB = value >= 50;
                      return (
                        <label key={axis.key}>
                          <span className={!towardB ? "is-active" : ""}>{axis.a}</span>
                          <input
                            type="range"
                            min="0"
                            max="100"
                            step="1"
                            value={value}
                            disabled={disabled || saving}
                            aria-label={`${axis.aWord} to ${axis.bWord}`}
                            onChange={(event) => setPersonalityAxis(axis.key, Number(event.target.value))}
                          />
                          <span className={towardB ? "is-active" : ""}>{axis.b}</span>
                          <output>
                            {Math.round(towardB ? value : 100 - value)}%
                          </output>
                        </label>
                      );
                    })}
                  </div>
                ) : null}
              </>
            ) : null}
          </div>
        </section>

        <section
          id={settingsGroupId("Links")}
          data-settings-group
          className="settings-profile__section"
          aria-labelledby={`${baseId}-links`}
        >
          <ProfileSectionHeading
            id={`${baseId}-links`}
            label="LINKS"
            detail={String(form.links.length)}
            action={(
              <Button
                variant="ghost"
                size="xs"
                leadingIcon="ph:plus"
                disabled={disabled || saving || form.links.length >= PROFILE_LIMITS.links}
                onClick={addLink}
              >
                Add link
              </Button>
            )}
          />
          <div className="settings-profile__links">
            {form.links.map((link) => {
              const site = PROFILE_LINK_SITES.find((candidate) => candidate.value === link.site)
                ?? PROFILE_LINK_SITES.at(-1)!;
              const stored = profileLinkValue(link);
              const invalid = link.site === "custom"
                && Boolean(link.url.trim())
                && !httpUrl(link.url.trim());
              return (
                <div className="settings-profile__link-row reveal-scope" key={link.id}>
                  <span className={invalid ? "settings-profile__link-mark is-invalid" : "settings-profile__link-mark"}>
                    {site.monogram}
                  </span>
                  <StandardSelect<ProfileLinkSite>
                    label="Link type"
                    value={link.site}
                    onChange={(value) => updateLink(link.id, { site: value })}
                    options={PROFILE_LINK_SITES.map((option) => ({
                      value: option.value,
                      label: option.label,
                    }))}
                    className="settings-profile__select"
                    disabled={disabled || saving}
                  />
                  {link.site === "custom" ? (
                    <div className="settings-profile__custom-link">
                      <label className="settings-profile__input-field">
                        <span className="settings-profile__input-label">Link label</span>
                        <TextInput
                          value={link.label}
                          maxLength={PROFILE_LIMITS.linkLabel}
                          disabled={disabled || saving}
                          onChange={(event) => updateLink(link.id, { label: event.target.value })}
                          placeholder="e.g., Portfolio"
                          aria-label="Link label"
                        />
                      </label>
                      <label className="settings-profile__input-field">
                        <span className="settings-profile__input-label">Link URL</span>
                        <TextInput
                          value={link.url}
                          maxLength={PROFILE_LIMITS.linkUrl}
                          disabled={disabled || saving}
                          onChange={(event) => updateLink(link.id, { url: event.target.value })}
                          placeholder="e.g., https://example.com"
                          inputMode="url"
                          aria-label="Link URL"
                          aria-invalid={invalid || undefined}
                          aria-describedby={invalid ? `${baseId}-link-${link.id}-url-error` : undefined}
                        />
                        {invalid ? (
                          <span
                            id={`${baseId}-link-${link.id}-url-error`}
                            className="settings-profile__field-error"
                          >
                            Enter a complete http(s) URL.
                          </span>
                        ) : null}
                      </label>
                    </div>
                  ) : (
                    <label className="settings-profile__preset-link">
                      <span>{site.prefix}</span>
                      <TextInput
                        value={link.user}
                        maxLength={PROFILE_LIMITS.linkUrl}
                        disabled={disabled || saving}
                        onChange={(event) => updateLink(link.id, { user: event.target.value })}
                        placeholder={site.placeholder}
                        aria-label={`${site.label} username`}
                      />
                    </label>
                  )}
                  <div className="settings-profile__link-actions reveal-on-hover">
                    <IconButton
                      icon="ph:arrow-square-out"
                      size="sm"
                      aria-label="Open link"
                      disabled={!stored || !httpUrl(stored.url)}
                      onClick={() => {
                        if (stored && httpUrl(stored.url)) {
                          openExternalUrl(stored.url);
                        }
                      }}
                    />
                    <IconButton
                      icon={armedLinkId === link.id ? "ph:check" : "ph:trash"}
                      size="sm"
                      danger
                      aria-label={armedLinkId === link.id ? "Confirm remove link" : "Remove link"}
                      disabled={disabled || saving}
                      onClick={() => removeLink(link.id)}
                    />
                  </div>
                </div>
              );
            })}
            {form.links.length === 0 ? (
              <p className="settings-profile__links-empty">
                No links yet. Socials, portfolios, and references familiars can cite.
              </p>
            ) : null}
          </div>
        </section>
      </div>

      <footer className="settings-profile__actions">
        <span className="settings-profile__shortcut">⌘S save</span>
        <span className="settings-profile__action-meta">
          {[currentZone, effectiveType, `${liveLinks.length} links`].filter(Boolean).join(" · ")}
        </span>
        <span className={dirty ? "settings-profile__save-state is-dirty" : "settings-profile__save-state"}>
          {saving ? "Saving…" : dirty ? "Unsaved changes" : "All changes saved"}
        </span>
        <div>
          <Button
            variant="ghost"
            size="sm"
            disabled={!dirty || saving}
            onClick={discard}
          >
            Discard
          </Button>
          <Button
            variant="primary"
            size="sm"
            loading={saving}
            disabled={disabled || !dirty}
            onClick={() => void save()}
          >
            Save changes
          </Button>
        </div>
      </footer>

      <Link className="settings-profile__card-link focus-ring" href="/profile">
        View profile card →
      </Link>
    </section>
  );
}

function ProfileSectionHeading({
  id,
  label,
  detail,
  action,
}: {
  id: string;
  label: string;
  detail?: string;
  action?: ReactNode;
}) {
  return (
    <div className="settings-profile__section-heading">
      <h3 id={id}>{label}</h3>
      {detail ? <span>{detail}</span> : null}
      <span aria-hidden="true" />
      {action}
    </div>
  );
}
