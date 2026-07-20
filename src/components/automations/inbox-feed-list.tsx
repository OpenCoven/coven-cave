import { useId } from "react";
import { Button } from "@/components/ui/button";
import { StatusIcon } from "@/components/automations/status-icon";
import type { InboxItem } from "@/lib/cave-inbox";
import { repoFromGithubSubTag } from "@/lib/github-sub-tags";
import type { IconName } from "@/lib/icon";
import { Icon } from "@/lib/icon";
import { inboxKindLabel, type InboxFeedGroup } from "@/lib/inbox-feed";
import { relativeTimeSigned } from "@/lib/relative-time";

type FamiliarLabel = (familiarId?: string | null) => string | null;
type ItemAction = (item: InboxItem) => void;
type UnwatchAction = (item: InboxItem, repo: string) => void;

function relativeTime(iso: string | undefined | null): string {
  return iso ? relativeTimeSigned(iso) : "—";
}

function InboxKindBadge({ kind }: { kind: InboxItem["kind"] }) {
  return <span className="shrink-0 rounded px-1.5 py-0.5 text-[length:var(--text-2xs)] font-medium uppercase tracking-wide [background:var(--bg-base)]! [border:1px_solid_var(--border-hairline)]! [color:var(--text-muted)]!">{inboxKindLabel(kind)}</span>;
}

function InboxAction({ icon, label, text, onClick }: { icon: IconName; label: string; text: string; onClick: () => void }) {
  return <Button variant="ghost" size="xs" aria-label={label} onClick={onClick} className="shrink-0 rounded-[var(--radius-control)] px-2 py-1 text-[length:var(--text-xs)] font-medium transition-colors hover:bg-[color-mix(in_oklch,var(--foreground)_10%,transparent)] [color:var(--text-secondary)]!" leadingIcon={icon}><span className="@max-[520px]:hidden">{text}</span></Button>;
}

function InboxFeedRow({ item, selected, selectMode, checked, familiarLabel, onSelect, onToggle, onDone, onSnooze, onDismiss, onUnwatch }: { item: InboxItem; selected: boolean; selectMode: boolean; checked: boolean; familiarLabel: FamiliarLabel; onSelect: ItemAction; onToggle: (id: string) => void; onDone?: ItemAction; onSnooze?: ItemAction; onDismiss?: ItemAction; onUnwatch?: UnwatchAction }) {
  const workspace = familiarLabel(item.familiarId);
  const when = item.firedAt ? `fired ${relativeTime(item.firedAt)}` : item.fireAt ? relativeTime(item.fireAt) : relativeTime(item.updatedAt);
  const resolved = item.status === "done" || item.status === "dismissed";
  const active = selectMode ? checked : selected;
  const activate = () => (selectMode ? onToggle(item.id) : onSelect(item));
  const watchedRepo = repoFromGithubSubTag(item.auto);
  return (
    <li className="flex items-center">
      <button type="button" role={selectMode ? "checkbox" : undefined} aria-checked={selectMode ? checked : undefined} onClick={activate} aria-current={!selectMode && selected ? "true" : undefined} className={`focus-ring-inset automation-list-row group flex min-w-0 flex-1 items-center gap-3 rounded-lg px-2 py-2.5 text-left transition-colors ${active ? "bg-[color-mix(in_oklch,var(--foreground)_6%,transparent)]" : "hover:bg-[color-mix(in_oklch,var(--foreground)_6%,transparent)]"}`}>
        {selectMode ? <span aria-hidden className="flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[5px] border transition-colors" style={{ borderColor: checked ? "var(--accent-presence)" : "var(--border-strong)", background: checked ? "var(--accent-presence)" : "transparent" }}>{checked && <Icon name="ph:check-bold" width={12} className="text-[var(--accent-presence-foreground)]" />}</span> : <StatusIcon item={item} />}
        <span className="flex-1 min-w-0 flex items-center gap-2">
          <span className="text-[length:var(--text-base)] truncate [color:var(--text-primary)]!">{item.title}</span>
          <InboxKindBadge kind={item.kind} />
          {workspace && <span className="shrink-0 text-[length:var(--text-xs)] [color:var(--text-muted)]!">{workspace}</span>}
        </span>
        <span className="shrink-0 text-[length:var(--text-sm)] tabular-nums [color:var(--text-muted)]!">{when}</span>
      </button>
      {!selectMode && !resolved && (onDone || onSnooze || onDismiss || onUnwatch) && <span className="flex shrink-0 items-center gap-0.5 pl-1">
        {onDone && <InboxAction icon="ph:check-bold" label={`Mark ${item.title} done`} text="Done" onClick={() => onDone(item)} />}
        {onSnooze && item.status === "fired" && <InboxAction icon="ph:clock-countdown" label={`Snooze ${item.title} for 1 hour`} text="Snooze 1h" onClick={() => onSnooze(item)} />}
        {onUnwatch && watchedRepo && <InboxAction icon="ph:bell-slash" label={`Unwatch ${watchedRepo} — stop GitHub notifications from it`} text="Unwatch" onClick={() => onUnwatch(item, watchedRepo)} />}
        {onDismiss && <InboxAction icon="ph:x" label={`Dismiss ${item.title}`} text="Dismiss" onClick={() => onDismiss(item)} />}
      </span>}
    </li>
  );
}

function InboxFeedSection({ group, selectedId, selectMode, groupChecked, onToggleGroup, isSelected, onToggle, familiarLabel, onSelect, onDone, onSnooze, onDismiss, onUnwatch }: { group: InboxFeedGroup; selectedId: string | null; selectMode: boolean; groupChecked: boolean; onToggleGroup: (group: InboxFeedGroup) => void; isSelected: (id: string) => boolean; onToggle: (id: string) => void; familiarLabel: FamiliarLabel; onSelect: ItemAction; onDone?: ItemAction; onSnooze?: ItemAction; onDismiss?: ItemAction; onUnwatch?: UnwatchAction }) {
  const headingId = useId();
  if (group.items.length === 0) return null;
  return <section className="mb-6" aria-labelledby={headingId}>
    <div className="flex items-center gap-3 mb-1 rounded-md px-3 py-1.5 [background:color-mix(in_oklch,_var(--bg-base)_86%,_var(--foreground)_14%)]! [border-bottom:1px_solid_var(--border-hairline)]!">
      {selectMode ? <button type="button" role="checkbox" aria-checked={groupChecked} aria-label={`Select every item in ${group.title}`} title={`Select all ${group.items.length} in ${group.title}`} onClick={() => onToggleGroup(group)} className="focus-ring flex h-[var(--space-4)] w-[var(--space-4)] shrink-0 items-center justify-center rounded-[4px] border transition-colors" style={{ borderColor: groupChecked ? "var(--accent-presence)" : "var(--border-strong)", background: groupChecked ? "var(--accent-presence)" : "transparent" }}>{groupChecked && <Icon name="ph:check-bold" width={11} className="text-[var(--accent-presence-foreground)]" aria-hidden />}</button> : null}
      <h3 id={headingId} className="text-[length:var(--text-sm)] font-bold [color:var(--text-primary)]!">{group.title}</h3>
      <span className="rounded px-1.5 py-0.5 text-[length:var(--text-2xs)] font-semibold" style={group.accent ? { background: "color-mix(in oklch, var(--color-warning) 18%, transparent)", color: "var(--color-warning)" } : { background: "var(--bg-raised)", color: "var(--text-muted)" }}>{group.items.length}</span>
    </div>
    <ul aria-labelledby={headingId}>{group.items.map((item) => <InboxFeedRow key={item.id} item={item} selected={selectedId === item.id} selectMode={selectMode} checked={isSelected(item.id)} familiarLabel={familiarLabel} onSelect={onSelect} onToggle={onToggle} onDone={onDone} onSnooze={onSnooze} onDismiss={onDismiss} onUnwatch={onUnwatch} />)}</ul>
  </section>;
}

export function InboxFeedList({ groups, selectedId, selectMode, isSelected, groupSelected, onToggleGroup, onToggle, familiarLabel, onSelect, onDone, onSnooze, onDismiss, onUnwatch }: { groups: InboxFeedGroup[]; selectedId: string | null; selectMode: boolean; isSelected: (id: string) => boolean; groupSelected: (group: InboxFeedGroup) => boolean; onToggleGroup: (group: InboxFeedGroup) => void; onToggle: (id: string) => void; familiarLabel: FamiliarLabel; onSelect: ItemAction; onDone?: ItemAction; onSnooze?: ItemAction; onDismiss?: ItemAction; onUnwatch?: UnwatchAction }) {
  return <>{groups.map((group) => <InboxFeedSection key={group.id} group={group} selectedId={selectedId} selectMode={selectMode} groupChecked={groupSelected(group)} onToggleGroup={onToggleGroup} isSelected={isSelected} onToggle={onToggle} familiarLabel={familiarLabel} onSelect={onSelect} onDone={onDone} onSnooze={onSnooze} onDismiss={onDismiss} onUnwatch={onUnwatch} />)}</>;
}
