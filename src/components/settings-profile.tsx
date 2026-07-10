"use client";

import { useEffect, useId, useMemo, useRef, useState, type ChangeEvent, type FocusEvent, type ReactNode } from "react";
import { SettingsOverview } from "@/components/settings-overview";
import { SettingsGroup } from "@/components/ui/settings-group";
import { Button } from "@/components/ui/button";
import { useAnnouncer } from "@/components/ui/live-region";
import { useArmedConfirm } from "@/lib/use-armed-confirm";
import { FAMILIAR_IMAGE_ACCEPT, prepareFamiliarImage } from "@/lib/familiar-image-upload";
import { Icon } from "@/lib/icon";
import {
  removeUserProfileAvatar,
  saveUserProfile,
  uploadUserProfileAvatar,
  useUserProfile,
  userAvatarUrl,
  userDisplayName,
  type UserProfileSnapshot,
} from "@/lib/user-profile";
import { PROFILE_LIMITS, type ProfileLink, type UserProfilePatch } from "@/lib/user-profile-shared";
import { hasLegacySvgUserAvatar } from "@/lib/legacy-svg-avatar-hint";

const PROFILE_IMAGE_ACCEPT = FAMILIAR_IMAGE_ACCEPT
  .split(",")
  .filter((mime) => mime !== "image/svg+xml")
  .join(",");

type TextField = "name" | "pronouns" | "bio";

function systemTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "local time";
}

function supportedTimezones(systemTz: string): string[] {
  const supportedValuesOf = (Intl as typeof Intl & { supportedValuesOf?: (key: "timeZone") => string[] })
    .supportedValuesOf;
  if (typeof supportedValuesOf === "function") {
    try {
      return supportedValuesOf("timeZone");
    } catch {
      return [systemTz].filter(Boolean);
    }
  }
  return [systemTz].filter(Boolean);
}

function profileValue(snapshot: UserProfileSnapshot | null, field: TextField | "timezone"): string {
  return snapshot?.profile[field] ?? "";
}

function normalizeLinks(links: ProfileLink[]): ProfileLink[] {
  return links.map((link) => ({ label: link.label.trim(), url: link.url.trim() }));
}

function linksMatch(left: ProfileLink[] | undefined, right: ProfileLink[]): boolean {
  return JSON.stringify(normalizeLinks(left ?? [])) === JSON.stringify(normalizeLinks(right));
}

function avatarInitial(snapshot: UserProfileSnapshot | null): string {
  const display = userDisplayName(snapshot?.profile);
  // "You" is the unnamed fallback, not a name — let the icon branch render.
  if (display === "You") return "";
  return display.trim().charAt(0).toUpperCase();
}

export function ProfileSection() {
  const snapshot = useUserProfile();
  const { announce } = useAnnouncer();
  const hydratedRef = useRef(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const baseId = useId();
  const systemTz = useMemo(systemTimezone, []);
  const timezoneOptions = useMemo(() => supportedTimezones(systemTz), [systemTz]);

  const [name, setName] = useState("");
  const [pronouns, setPronouns] = useState("");
  const [bio, setBio] = useState("");
  const [timezone, setTimezone] = useState("");
  const [links, setLinks] = useState<ProfileLink[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [linkHint, setLinkHint] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [avatarBusy, setAvatarBusy] = useState(false);
  // One-click removals with no undo → two-step (cave-5lsj). Links arm per-row.
  const avatarRemoveConfirm = useArmedConfirm();
  const [armedLinkIndex, setArmedLinkIndex] = useState<number | null>(null);
  useEffect(() => {
    if (armedLinkIndex === null) return;
    const t = window.setTimeout(() => setArmedLinkIndex(null), 4000);
    return () => window.clearTimeout(t);
  }, [armedLinkIndex]);
  const [legacySvgAvatar, setLegacySvgAvatar] = useState(false);
  useEffect(() => {
    if (snapshot?.avatar.present) {
      setLegacySvgAvatar(false);
      return;
    }
    let cancelled = false;
    void hasLegacySvgUserAvatar().then((hasSvg) => {
      if (!cancelled) setLegacySvgAvatar(hasSvg);
    });
    return () => { cancelled = true; };
  }, [snapshot?.avatar.present]);

  useEffect(() => {
    if (!snapshot || hydratedRef.current) return;
    setName(snapshot.profile.name ?? "");
    setPronouns(snapshot.profile.pronouns ?? "");
    setBio(snapshot.profile.bio ?? "");
    setTimezone(snapshot.profile.timezone ?? "");
    setLinks(snapshot.profile.links ?? []);
    hydratedRef.current = true;
  }, [snapshot]);

  const disabled = !snapshot;
  const avatarSrc = userAvatarUrl(snapshot);

  async function savePatch(patch: UserProfilePatch, success: string, savingKey: string) {
    setError(null);
    setSaving(savingKey);
    const result = await saveUserProfile(patch);
    setSaving(null);
    if (!result.ok) {
      setError(result.reason);
      announce(result.reason, "assertive");
      return false;
    }
    announce(success);
    return true;
  }

  async function saveTextField(field: TextField, value: string) {
    if (!snapshot) return;
    const next = value.trim();
    if (next === profileValue(snapshot, field)) return;
    if (field === "name") setName(next);
    if (field === "pronouns") setPronouns(next);
    if (field === "bio") setBio(next);
    await savePatch({ [field]: next === "" ? null : next }, "Profile saved.", field);
  }

  async function saveTimezone(next: string) {
    setTimezone(next);
    if (!snapshot || next === profileValue(snapshot, "timezone")) return;
    await savePatch({ timezone: next === "" ? null : next }, "Timezone saved.", "timezone");
  }

  async function onAvatarFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setAvatarBusy(true);
    setError(null);
    try {
      const prepared = await prepareFamiliarImage(file);
      const result = await uploadUserProfileAvatar(prepared);
      if (!result.ok) {
        setError(result.reason);
        announce(result.reason, "assertive");
        return;
      }
      announce(prepared.downsized ? "Profile image updated. Image was downsized for Cave." : "Profile image updated.");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not read image.";
      setError(message);
      announce(message, "assertive");
    } finally {
      setAvatarBusy(false);
    }
  }

  async function removeAvatar() {
    setAvatarBusy(true);
    setError(null);
    try {
      const result = await removeUserProfileAvatar();
      if (!result.ok) {
        setError(result.reason);
        announce(result.reason, "assertive");
        return;
      }
      announce("Profile image removed.");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not remove image.";
      setError(message);
      announce(message, "assertive");
    } finally {
      setAvatarBusy(false);
    }
  }

  function updateLink(index: number, patch: Partial<ProfileLink>) {
    setLinks((current) => current.map((link, i) => (i === index ? { ...link, ...patch } : link)));
  }

  async function saveLinks(nextLinks = links) {
    if (!snapshot) return;
    // Fully-blank rows (a fresh "Add link") don't block saving the rest —
    // only rows with exactly one filled field are incomplete.
    const normalized = normalizeLinks(nextLinks).filter((link) => link.label || link.url);
    const incomplete = normalized.some((link) => !link.label || !link.url);
    if (incomplete) {
      setLinkHint("Each link needs both a label and a URL before it can be saved.");
      return;
    }
    setLinkHint(null);
    if (linksMatch(snapshot.profile.links, normalized)) return;
    await savePatch({ links: normalized.length ? normalized : null }, "Profile links saved.", "links");
  }

  async function removeLink(index: number) {
    const next = links.filter((_, i) => i !== index);
    setLinks(next);
    await saveLinks(next);
  }

  const bioNearLimit = bio.length >= PROFILE_LIMITS.bio * 0.9;

  return (
    <section className="max-w-none space-y-6" aria-labelledby={`${baseId}-title`}>
      <h2 id={`${baseId}-title`} className="sr-only">Profile</h2>
      <SettingsOverview section="profile" />

      {disabled ? (
        <p className="rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-raised)] px-4 py-3 text-[12px] text-[var(--text-muted)]">
          Daemon offline — profile unavailable.
        </p>
      ) : null}

      {error ? (
        <p className="rounded-xl border border-[var(--color-danger)] bg-[color-mix(in_oklch,var(--color-danger)_12%,transparent)] px-4 py-3 text-[12px] text-[var(--color-danger)]">
          {error}
        </p>
      ) : null}

      <SettingsGroup label="Identity" description="The name and pronouns familiars use for you.">
        <div className="grid gap-4 px-4 py-4 md:grid-cols-2">
          <ProfileField label="Display name" htmlFor={`${baseId}-name`} hint={saving === "name" ? "Saving…" : undefined}>
            <input
              id={`${baseId}-name`}
              value={name}
              maxLength={PROFILE_LIMITS.name}
              disabled={disabled}
              onChange={(event) => setName(event.target.value)}
              onBlur={() => void saveTextField("name", name)}
              className="focus-ring w-full rounded-md border border-[var(--border-hairline)] bg-[var(--bg-base)] px-3 py-2 text-[13px] text-[var(--text-primary)] disabled:opacity-50"
            />
          </ProfileField>

          <ProfileField label="Pronouns" htmlFor={`${baseId}-pronouns`} hint={saving === "pronouns" ? "Saving…" : undefined}>
            <input
              id={`${baseId}-pronouns`}
              value={pronouns}
              maxLength={PROFILE_LIMITS.pronouns}
              disabled={disabled}
              onChange={(event) => setPronouns(event.target.value)}
              onBlur={() => void saveTextField("pronouns", pronouns)}
              className="focus-ring w-full rounded-md border border-[var(--border-hairline)] bg-[var(--bg-base)] px-3 py-2 text-[13px] text-[var(--text-primary)] disabled:opacity-50"
            />
          </ProfileField>
        </div>
      </SettingsGroup>

      <SettingsGroup label="Image" description="The profile image that appears beside your operator profile.">
        <div className="flex flex-wrap items-center gap-4 px-4 py-4">
          <div className="flex h-24 w-24 items-center justify-center overflow-hidden rounded-3xl border border-[var(--border-hairline)] bg-[var(--bg-base)] text-[28px] font-semibold text-[var(--text-secondary)]">
            {avatarSrc ? (
              <img src={avatarSrc} alt="" className="h-full w-full object-cover" />
            ) : avatarInitial(snapshot) ? (
              <span aria-hidden="true">{avatarInitial(snapshot)}</span>
            ) : (
              <Icon name="ph:user" width={34} aria-hidden={true} />
            )}
          </div>
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap gap-2">
              <label htmlFor={`${baseId}-avatar`} className="sr-only">Upload profile image</label>
              <input
                ref={fileInputRef}
                id={`${baseId}-avatar`}
                type="file"
                accept={PROFILE_IMAGE_ACCEPT}
                disabled={disabled || avatarBusy}
                onChange={onAvatarFile}
                className="sr-only"
              />
              <Button
                variant="secondary"
                size="sm"
                disabled={disabled || avatarBusy}
                onClick={() => fileInputRef.current?.click()}
              >
                {avatarBusy ? "Updating…" : "Upload image"}
              </Button>
              {snapshot?.avatar.present ? (
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={avatarBusy}
                  onClick={() => avatarRemoveConfirm.trigger(() => void removeAvatar())}
                >
                  {avatarRemoveConfirm.armed ? "Really remove?" : "Remove"}
                </Button>
              ) : null}
            </div>
            <p className="text-[11px] text-[var(--text-muted)]">PNG, JPEG, or WebP. Large files are downsized before upload.</p>
            {legacySvgAvatar ? (
              <p className="text-[11px] text-[var(--text-muted)]">
                Your previous avatar was an SVG, which can no longer be used — re-upload it as PNG, JPEG, or WebP.
              </p>
            ) : null}
          </div>
        </div>
      </SettingsGroup>

      <SettingsGroup label="Details" description="Context that helps familiars adapt their voice and schedules.">
        <div className="grid gap-4 px-4 py-4">
          <ProfileField label="Timezone" htmlFor={`${baseId}-timezone`} hint={saving === "timezone" ? "Saving…" : undefined}>
            <select
              id={`${baseId}-timezone`}
              value={timezone}
              disabled={disabled}
              onChange={(event) => void saveTimezone(event.target.value)}
              className="focus-ring w-full rounded-md border border-[var(--border-hairline)] bg-[var(--bg-base)] px-3 py-2 text-[13px] text-[var(--text-primary)] disabled:opacity-50"
            >
              <option value="">System ({systemTz})</option>
              {timezoneOptions.map((tz) => (
                <option key={tz} value={tz}>{tz}</option>
              ))}
            </select>
          </ProfileField>

          <ProfileField
            label="Bio"
            htmlFor={`${baseId}-bio`}
            hint={bioNearLimit ? `${bio.length}/${PROFILE_LIMITS.bio}` : saving === "bio" ? "Saving…" : undefined}
          >
            <textarea
              id={`${baseId}-bio`}
              value={bio}
              maxLength={PROFILE_LIMITS.bio}
              disabled={disabled}
              rows={5}
              onChange={(event) => setBio(event.target.value)}
              onBlur={() => void saveTextField("bio", bio)}
              className="focus-ring min-h-28 w-full resize-y rounded-md border border-[var(--border-hairline)] bg-[var(--bg-base)] px-3 py-2 text-[13px] text-[var(--text-primary)] disabled:opacity-50"
            />
          </ProfileField>
        </div>
      </SettingsGroup>

      <SettingsGroup label="Links" description="Socials, portfolios, and references familiars can cite.">
        <div className="grid gap-3 px-4 py-4">
          {links.length === 0 ? (
            <p className="text-[12px] text-[var(--text-muted)]">No links yet.</p>
          ) : null}
          {links.map((link, index) => {
            const labelId = `${baseId}-link-${index}-label`;
            const urlId = `${baseId}-link-${index}-url`;
            const rowIncomplete = Boolean((link.label.trim() || link.url.trim()) && (!link.label.trim() || !link.url.trim()));
            return (
              <div
                key={index}
                className="grid gap-2 rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-base)] p-3 md:grid-cols-[1fr_2fr_auto]"
                onBlur={(event: FocusEvent<HTMLDivElement>) => {
                  if (!event.currentTarget.contains(event.relatedTarget as Node | null)) void saveLinks();
                }}
              >
                <ProfileField label="Label" htmlFor={labelId}>
                  <input
                    id={labelId}
                    value={link.label}
                    maxLength={PROFILE_LIMITS.linkLabel}
                    disabled={disabled}
                    onChange={(event) => updateLink(index, { label: event.target.value })}
                    className="focus-ring w-full rounded-md border border-[var(--border-hairline)] bg-[var(--bg-raised)] px-3 py-2 text-[13px] text-[var(--text-primary)] disabled:opacity-50"
                  />
                </ProfileField>
                <ProfileField label="URL" htmlFor={urlId}>
                  <input
                    id={urlId}
                    value={link.url}
                    maxLength={PROFILE_LIMITS.linkUrl}
                    disabled={disabled}
                    inputMode="url"
                    onChange={(event) => updateLink(index, { url: event.target.value })}
                    className="focus-ring w-full rounded-md border border-[var(--border-hairline)] bg-[var(--bg-raised)] px-3 py-2 text-[13px] text-[var(--text-primary)] disabled:opacity-50"
                  />
                </ProfileField>
                <div className="flex items-end">
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={disabled}
                    onClick={() => {
                      if (armedLinkIndex === index) {
                        setArmedLinkIndex(null);
                        void removeLink(index);
                      } else {
                        setArmedLinkIndex(index);
                      }
                    }}
                  >
                    {armedLinkIndex === index ? "Really remove?" : "Remove"}
                  </Button>
                </div>
                {rowIncomplete ? (
                  <p className="text-[11px] text-[var(--color-danger)] md:col-span-3">Add both fields to save this link.</p>
                ) : null}
              </div>
            );
          })}
          {linkHint ? <p className="text-[11px] text-[var(--color-danger)]">{linkHint}</p> : null}
          <div>
            <Button
              variant="secondary"
              size="sm"
              disabled={disabled || links.length >= PROFILE_LIMITS.links}
              onClick={() => setLinks((current) => [...current, { label: "", url: "" }])}
            >
              Add link
            </Button>
            {saving === "links" ? <span className="ml-3 text-[11px] text-[var(--text-muted)]">Saving…</span> : null}
          </div>
        </div>
      </SettingsGroup>
    </section>
  );
}

function ProfileField({
  label,
  htmlFor,
  hint,
  children,
}: {
  label: string;
  htmlFor: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="grid gap-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={htmlFor} className="text-[12px] font-medium text-[var(--text-secondary)]">
          {label}
        </label>
        {hint ? <span className="text-[11px] text-[var(--text-muted)]">{hint}</span> : null}
      </div>
      {children}
    </div>
  );
}
