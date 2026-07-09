"use client";

/**
 * RoleSurfaceHost — the generic renderer for registered Role Surfaces.
 *
 * The workspace hands it a surface id (parsed from the generic
 * `surface:<id>` mode) plus the shared context; the host looks the surface up
 * in the registry, applies its contributions (keyboard shortcuts, toolbar
 * actions, status indicators, notifications, commands) and renders it inside
 * the room chrome. The Cave shell never branches on a specific role — every
 * role-specific behavior lives behind this one component.
 */

import { Component, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Icon, CAVE_ICON_SIZE } from "@/lib/icon";
import {
  getRoleSurface,
  matchesShortcutCombo,
  type RoleSurface,
  type RoleSurfaceContext,
  type RoleSurfaceContribution,
} from "@/lib/role-surfaces";

/** A broken surface must never take the shell down with it. */
class SurfaceErrorBoundary extends Component<
  { surfaceTitle: string; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (this.state.failed) {
      return (
        <div className="role-surface-unavailable" role="alert">
          <Icon name="ph:warning" width={20} height={20} aria-hidden />
          <p>{this.props.surfaceTitle} hit an error and was unloaded.</p>
        </div>
      );
    }
    return this.props.children;
  }
}

function StatusDot({ tone }: { tone: "ok" | "busy" | "warn" | "muted" }) {
  return <span className={`role-surface-status-dot role-surface-status-dot--${tone}`} aria-hidden />;
}

export function RoleSurfaceHost({
  surfaceId,
  context,
  visibleSurfaces,
  rolesLoaded,
  onLeave,
}: {
  surfaceId: string;
  context: RoleSurfaceContext | null;
  visibleSurfaces: readonly RoleSurface[];
  rolesLoaded: boolean;
  /** Navigate away when the room isn't available (wrong familiar, unknown id). */
  onLeave: () => void;
}) {
  const surface = getRoleSurface(surfaceId);
  const available = surface != null && context != null && visibleSurfaces.some((s) => s.id === surface.id);

  const contributions: RoleSurfaceContribution | null = useMemo(() => {
    if (!surface || !context || !available) return null;
    try {
      return surface.getContributions?.(context) ?? null;
    } catch {
      return null;
    }
  }, [surface, context, available]);

  // Contributed keyboard shortcuts, active only while the room is open.
  const shortcutsRef = useRef(contributions?.keyboardShortcuts);
  shortcutsRef.current = contributions?.keyboardShortcuts;
  const contextRef = useRef(context);
  contextRef.current = context;
  useEffect(() => {
    if (!available) return;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && /^(input|textarea|select)$/i.test(target.tagName)) return;
      const ctx = contextRef.current;
      if (!ctx) return;
      for (const shortcut of shortcutsRef.current ?? []) {
        if (matchesShortcutCombo(e, shortcut.combo)) {
          e.preventDefault();
          shortcut.run(ctx);
          return;
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [available]);

  const [commandsOpen, setCommandsOpen] = useState(false);

  if (!context) {
    return (
      <div className="role-surface-unavailable">
        <Icon name="ph:user-circle" width={22} height={22} aria-hidden />
        <p>Role surfaces are rooms built for one familiar at a time.</p>
        <p className="role-surface-unavailable-hint">Choose a familiar to enter their rooms.</p>
      </div>
    );
  }

  if (!available) {
    // While role manifests are still loading, hold judgment quietly instead of
    // flashing "unavailable" for a room that's about to resolve.
    if (!rolesLoaded) return <div className="role-surface-unavailable" aria-busy="true" />;
    return (
      <div className="role-surface-unavailable">
        <Icon name="ph:door-open" width={22} height={22} aria-hidden />
        <p>
          {surface
            ? `${context.activeFamiliar.display_name} doesn't hold the ${surface.role} role, so this room stays closed.`
            : "This room doesn't exist."}
        </p>
        <button type="button" className="role-surface-chip focus-ring" onClick={onLeave}>
          Back to the Cave
        </button>
      </div>
    );
  }

  const notifications = contributions?.notifications ?? [];
  const statusIndicators = contributions?.statusIndicators ?? [];
  const toolbarActions = contributions?.toolbarActions ?? [];
  const commands = contributions?.commands ?? [];

  return (
    <div className="role-surface-host">
      <header className="role-surface-header">
        <span className="role-surface-header-title">
          <Icon name={surface.iconName} width={CAVE_ICON_SIZE.sidePanelNav} height={CAVE_ICON_SIZE.sidePanelNav} aria-hidden />
          <h2>{surface.title}</h2>
          <span className="role-surface-header-role">{surface.role}</span>
        </span>
        <span className="role-surface-header-status">
          {statusIndicators.map((indicator) => (
            <span key={indicator.id} className="role-surface-status" title={indicator.detail}>
              <StatusDot tone={indicator.tone} />
              {indicator.label}
            </span>
          ))}
        </span>
        <span className="role-surface-header-actions">
          {toolbarActions.map((action) => (
            <button
              key={action.id}
              type="button"
              className="role-surface-chip focus-ring"
              title={action.title}
              onClick={() => action.run(context)}
            >
              {action.iconName && <Icon name={action.iconName} width={14} height={14} aria-hidden />}
              {action.title}
            </button>
          ))}
          {commands.length > 0 && (
            <span className="role-surface-commands">
              <button
                type="button"
                className="role-surface-chip focus-ring"
                aria-expanded={commandsOpen}
                aria-haspopup="menu"
                onClick={() => setCommandsOpen((open) => !open)}
              >
                <Icon name="ph:list" width={14} height={14} aria-hidden />
                Commands
              </button>
              {commandsOpen && (
                <span className="role-surface-commands-menu" role="menu">
                  {commands.map((command) => (
                    <button
                      key={command.id}
                      type="button"
                      role="menuitem"
                      className="role-surface-command focus-ring-inset"
                      onClick={() => {
                        setCommandsOpen(false);
                        command.run(context);
                      }}
                    >
                      <span>{command.title}</span>
                      {command.hint && <span className="role-surface-command-hint">{command.hint}</span>}
                    </button>
                  ))}
                </span>
              )}
            </span>
          )}
        </span>
      </header>
      {notifications.length > 0 && (
        <div className="role-surface-notices">
          {notifications.map((notice) => (
            <p key={notice.id} className={`role-surface-notice role-surface-notice--${notice.level}`}>
              {notice.message}
            </p>
          ))}
        </div>
      )}
      <div className="role-surface-body">
        <SurfaceErrorBoundary surfaceTitle={surface.title}>{surface.render(context)}</SurfaceErrorBoundary>
      </div>
    </div>
  );
}
