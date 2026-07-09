"use client";

import { useMemo, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent } from "react";
import { Icon } from "@/lib/icon";
import { FamiliarAvatar } from "@/components/familiar-avatar";
import { useFamiliarStudio } from "@/lib/familiar-studio-context";
import { computePresence, REMOTE_HARNESSES } from "@/lib/presence";
import { Popover } from "@/components/ui/popover";
import { setFamiliarOrder } from "@/lib/cave-familiar-order";
import {
  DndContext, PointerSensor, KeyboardSensor, useSensor, useSensors, closestCenter,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext, useSortable, arrayMove, sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { ResolvedFamiliar } from "@/lib/familiar-resolve";
import type { SessionRow } from "@/lib/types";

type Presence = { label: string; dot: string };

type Props = {
  familiars: ResolvedFamiliar[];
  activeFamiliarId?: string | null;
  /** The multiselect scope (empty/undefined = single-select behavior). When it
   *  holds ≥2 ids every member row reads selected and the trigger summarizes
   *  the count. */
  selectedFamiliarIds?: ReadonlySet<string>;
  sessions: SessionRow[];
  responseNeeded?: Set<string>;
  /** `null` scopes to "All familiars". `opts.multi` (row checkbox or ⌘/Ctrl
   *  click) toggles the id in the multiselect scope instead of replacing it. */
  onSelectFamiliar: (id: string | null, opts?: { multi?: boolean }) => void;
  /** Menu placement relative to the trigger. Defaults to "bottom-start" (the
   *  left-edge sidebar home); the mobile top bar passes "bottom-end" since its
   *  trigger sits at the right edge. */
  placement?: "bottom-start" | "bottom-end" | "top-start" | "top-end";
  /** Shows the current familiar name beside the avatar on surfaces with room. */
  labeled?: boolean;
};

/**
 * The single familiar control in the top bar — an account-profile-style button
 * that previews the active familiar and opens a menu to switch scope, jump into
 * a familiar's profile (Studio), create, manage, or reorder. Replaces the older
 * horizontal sidebar dock; presence + reply signals are preserved in the menu
 * and surfaced as a dot on the collapsed trigger.
 */
export function FamiliarSwitcher({
  familiars,
  activeFamiliarId,
  selectedFamiliarIds,
  sessions,
  responseNeeded,
  onSelectFamiliar,
  placement = "bottom-start",
  labeled = false,
}: Props) {
  const { openFamiliarStudio, openFamiliarStudioListView } = useFamiliarStudio();
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [reordering, setReordering] = useState(false);

  const active = useMemo(
    () => familiars.find((f) => f.id === activeFamiliarId) ?? null,
    [familiars, activeFamiliarId],
  );
  // Multiselect scope: with ≥2 members the menu reads as a multiselector
  // (member rows checked, trigger summarizes the count); otherwise the single
  // active familiar drives the checked row.
  const multiScope = selectedFamiliarIds && selectedFamiliarIds.size >= 2 ? selectedFamiliarIds : null;
  const isScoped = (id: string) => (multiScope ? multiScope.has(id) : id === activeFamiliarId);
  /** Row activation: the checkbox zone (or ⌘/Ctrl-click) toggles membership and
   *  keeps the menu open for more picks; a plain click solo-selects and closes. */
  const pickFamiliar = (id: string, e: ReactMouseEvent) => {
    const multi =
      e.metaKey || e.ctrlKey ||
      Boolean((e.target as HTMLElement).closest(".familiar-switcher__checkbox"));
    onSelectFamiliar(id, { multi });
    if (!multi) setOpen(false);
  };

  // Familiars are daemon-owned — there is no cave-side create. "New familiar"
  // routes to onboarding (the canonical create flow) via the window-event bus
  // the Workspace listens on (see `cave:onboarding-open`).
  const fireCreateFamiliar = () => {
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("cave:onboarding-open"));
    }
  };

  const anyNeedsReply = useMemo(() => {
    if (!responseNeeded || responseNeeded.size === 0) return false;
    return familiars.some((f) => responseNeeded.has(f.id));
  }, [familiars, responseNeeded]);

  const presenceFor = (f: ResolvedFamiliar, needsReply: boolean): Presence =>
    computePresence({
      familiar: f,
      sessions,
      needsReply,
      isRemoteHarness: f.harness ? REMOTE_HARNESSES.has(f.harness) : false,
    });

  const q = query.trim().toLowerCase();
  const matches = (f: ResolvedFamiliar) =>
    !q || f.display_name.toLowerCase().includes(q) || (f.role ?? "").toLowerCase().includes(q);
  const filtered = familiars.filter(matches);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const familiarIds = useMemo(() => familiars.map((f) => f.id), [familiars]);
  function handleDragEnd(event: DragEndEvent) {
    const { active: dragged, over } = event;
    if (!over || dragged.id === over.id) return;
    const oldIndex = familiarIds.indexOf(String(dragged.id));
    const newIndex = familiarIds.indexOf(String(over.id));
    if (oldIndex < 0 || newIndex < 0) return;
    setFamiliarOrder(arrayMove(familiarIds, oldIndex, newIndex));
  }

  // Trigger copy: a ≥2 multiselect summarizes the scope; otherwise the single
  // active familiar (or the All scope) names the control.
  const triggerText = multiScope
    ? `${multiScope.size} familiars`
    : active
      ? active.display_name
      : "All familiars";
  const triggerLabel = multiScope
    ? `Switch familiar — scope: ${multiScope.size} familiars`
    : active
      ? `Switch familiar — current: ${active.display_name}`
      : "Switch familiar — scope: all familiars";

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={`familiar-switcher__trigger focus-ring${labeled ? " familiar-switcher__trigger--labeled" : ""}`}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={triggerLabel}
        title={triggerText}
        style={active && !multiScope ? ({ ["--familiar-accent" as string]: active.color } as CSSProperties) : undefined}
      >
        {active && !multiScope ? (
          <FamiliarAvatar familiar={active} size="sm" />
        ) : (
          <Icon name="ph:sparkle" width={14} aria-hidden />
        )}
        {labeled ? <span className="familiar-switcher__trigger-label">{triggerText}</span> : null}
        {labeled ? <Icon name="ph:caret-up-down-bold" width={10} className="familiar-switcher__trigger-caret" aria-hidden /> : null}
        {anyNeedsReply ? <span className="familiar-switcher__unread" aria-hidden /> : null}
      </button>

      <Popover
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) setReordering(false);
        }}
        anchorRef={triggerRef}
        placement={placement}
        minWidth={264}
        className="familiar-switcher__popover"
        ariaLabel="Switch familiar"
      >
        <div className="familiar-switcher" role="dialog" aria-label="Familiars">
          {/* Header: the current scope + a path straight into its full profile. */}
          <div className="familiar-switcher__header">
            <span className="familiar-switcher__header-id">
              {active ? (
                <>
                  <FamiliarAvatar familiar={active} size="md" />
                  <span className="familiar-switcher__header-text">
                    <span className="familiar-switcher__header-name">{active.display_name}</span>
                    {active.role ? (
                      <span className="familiar-switcher__header-role">{active.role}</span>
                    ) : null}
                  </span>
                </>
              ) : (
                <>
                  <span className="familiar-switcher__all-glyph" aria-hidden>
                    <Icon name="ph:sparkle" width={14} />
                  </span>
                  <span className="familiar-switcher__header-text">
                    <span className="familiar-switcher__header-name">All familiars</span>
                    <span className="familiar-switcher__header-role">{familiars.length} in your coven</span>
                  </span>
                </>
              )}
            </span>
            {active ? (
              <button
                type="button"
                className="familiar-switcher__edit"
                onClick={() => { openFamiliarStudio(active.id, "identity"); setOpen(false); }}
              >
                <Icon name="ph:pencil-simple" width={12} aria-hidden /> Edit profile
              </button>
            ) : null}
          </div>

          {familiars.length > 6 ? (
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter familiars…"
              aria-label="Filter familiars"
              className="familiar-switcher__search focus-ring-inset"
            />
          ) : null}

          {reordering ? (
            <DndContext id="familiar-switcher" sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
              <SortableContext items={familiarIds} strategy={verticalListSortingStrategy}>
                <ul className="familiar-switcher__list" aria-label="Reorder familiars">
                  {familiars.map((f) => (
                    <SortableFamiliarRow key={f.id} familiar={f} />
                  ))}
                </ul>
              </SortableContext>
            </DndContext>
          ) : (
            <ul
              className="familiar-switcher__list"
              role="listbox"
              aria-label="Switch familiar"
              aria-multiselectable="true"
              data-multi={multiScope ? "true" : undefined}
            >
              <li>
                <button
                  type="button"
                  role="option"
                  aria-selected={!multiScope && activeFamiliarId == null}
                  className={`familiar-switcher__option${!multiScope && activeFamiliarId == null ? " is-active" : ""}`}
                  onClick={() => { onSelectFamiliar(null); setOpen(false); }}
                >
                  <span className="familiar-switcher__all-glyph" aria-hidden>
                    <Icon name="ph:sparkle" width={13} />
                  </span>
                  <span className="familiar-switcher__option-name">All familiars</span>
                  {!multiScope && activeFamiliarId == null ? <Icon name="ph:check" width={12} aria-hidden /> : null}
                </button>
              </li>

              {filtered.map((f) => {
                const isActive = isScoped(f.id);
                const needsReply = responseNeeded?.has(f.id) ?? false;
                const presence = presenceFor(f, needsReply);
                return (
                  <li key={f.id} className="familiar-switcher__row">
                    <button
                      type="button"
                      role="option"
                      aria-selected={isActive}
                      className={`familiar-switcher__option${isActive ? " is-active" : ""}`}
                      style={{ ["--familiar-accent" as string]: f.color } as CSSProperties}
                      onClick={(e) => pickFamiliar(f.id, e)}
                      title={`${f.display_name} · ${presence.label} · click switches, checkbox or ⌘-click multi-selects`}
                    >
                      {/* Checkbox zone — clicking it toggles this familiar in the
                          multiselect scope and keeps the menu open. */}
                      <span className={`familiar-switcher__checkbox${isActive ? " is-checked" : ""}`} aria-hidden>
                        {isActive ? <Icon name="ph:check" width={10} /> : null}
                      </span>
                      <span className="familiar-switcher__avatar">
                        <FamiliarAvatar familiar={f} size="sm" />
                        <span className={`familiar-switcher__presence ${presence.dot}`} aria-hidden />
                      </span>
                      <span className="familiar-switcher__option-name">{f.display_name}</span>
                      {f.role ? <span className="familiar-switcher__option-meta">{f.role}</span> : null}
                      {needsReply ? <span className="familiar-switcher__option-unread" aria-hidden /> : null}
                    </button>
                    <button
                      type="button"
                      className="familiar-switcher__gear"
                      aria-label={`Edit ${f.display_name}`}
                      title="Edit profile"
                      onClick={() => { openFamiliarStudio(f.id, "identity"); setOpen(false); }}
                    >
                      <Icon name="ph:gear-six" width={12} aria-hidden />
                    </button>
                  </li>
                );
              })}
              {query.trim() && filtered.length === 0 ? (
                <li className="familiar-switcher__empty" role="presentation">
                  No familiars match “{query.trim()}”.
                </li>
              ) : null}
            </ul>
          )}

          <div className="familiar-switcher__foot">
            {reordering ? (
              <button
                type="button"
                className="familiar-switcher__foot-btn familiar-switcher__foot-btn--pri"
                onClick={() => setReordering(false)}
              >
                <Icon name="ph:check" width={11} aria-hidden /> Done
              </button>
            ) : (
              <>
                {/* Summoning gets top billing — the dashed invitation opens the
                    summoning circle; roster housekeeping sits quieter below. */}
                <button
                  type="button"
                  className="familiar-switcher__summon focus-ring"
                  onClick={() => { fireCreateFamiliar(); setOpen(false); }}
                >
                  <Icon name="ph:magic-wand-fill" width={13} aria-hidden /> Summon familiar
                </button>
                <div className="familiar-switcher__foot-row">
                  <button
                    type="button"
                    className="familiar-switcher__foot-btn"
                    onClick={() => { openFamiliarStudioListView(); setOpen(false); }}
                  >
                    <Icon name="ph:list-bullets" width={11} aria-hidden /> Manage
                  </button>
                  <button
                    type="button"
                    className="familiar-switcher__foot-btn"
                    onClick={() => setReordering(true)}
                  >
                    <Icon name="ph:dots-six-vertical" width={11} aria-hidden /> Reorder
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </Popover>
    </>
  );
}

function SortableFamiliarRow({ familiar }: { familiar: ResolvedFamiliar }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: familiar.id,
  });
  const style: CSSProperties = {
    transform: CSS.Translate.toString(transform),
    transition,
    ["--familiar-accent" as string]: familiar.color,
  } as CSSProperties;
  return (
    <li ref={setNodeRef} style={style} className="familiar-switcher__sortable" data-dragging={isDragging || undefined}>
      <button
        type="button"
        className="familiar-switcher__option familiar-switcher__option--drag"
        {...attributes}
        {...listeners}
        aria-label={`Drag to reorder ${familiar.display_name}`}
      >
        <Icon name="ph:dots-six-vertical" width={12} className="familiar-switcher__grip" aria-hidden />
        <span className="familiar-switcher__avatar">
          <FamiliarAvatar familiar={familiar} size="sm" />
        </span>
        <span className="familiar-switcher__option-name">{familiar.display_name}</span>
      </button>
    </li>
  );
}
