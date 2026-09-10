import { writeFileSync } from 'node:fs';
import { icon, page } from './lib.mjs';

const CODY = 'oklch(0.74 0.12 205)';
const NOVA = 'oklch(0.74 0.12 325)';
const SALEM = 'oklch(0.74 0.12 85)';
const CC_TILE = 'oklch(0.74 0.12 265)';

const fam = (initial, tone, size = 16, dot = null) =>
  `<span class="fam" style="--fa: ${size}px; --tone: ${tone};">${initial}${dot ? `<span class="fam__dot" style="background: ${dot};"></span>` : ''}</span>`;
const tile = (text, tone = CC_TILE, size = 20) =>
  `<span class="project-avatar" style="--pa-size: ${size}px; --tile: ${tone};">${text}</span>`;
const label = (text, style = '') => `<div class="spec-label" style="margin-bottom: 8px; ${style}">${text}</div>`;

function write(name, html) {
  writeFileSync(name, html);
  console.log('wrote', name, html.length);
}

/* ───────────────────────── Main: decisions ───────────────────────── */
{
  const card = (n, title, rule, bullets, receipt) => `
    <div style="display: flex; flex-direction: column; gap: 12px; padding: 20px; border: 1px solid var(--border-hairline); border-radius: var(--radius-card); background: var(--bg-raised);">
      <div style="display: flex; align-items: baseline; gap: 10px;">
        <span class="mono" style="font-size: 11px; font-weight: 600; letter-spacing: 0.12em; color: var(--accent-presence);">${n}</span>
        <span style="font-size: 16px; font-weight: 600; letter-spacing: -0.01em;">${title}</span>
      </div>
      <p style="margin: 0; font-family: var(--font-serif); font-style: italic; font-size: 16px; line-height: 1.35; color: var(--text-primary);">${rule}</p>
      <ul style="margin: 0; padding-left: 16px; display: flex; flex-direction: column; gap: 6px; font-size: 12px; line-height: 1.45; color: var(--text-secondary);">
        ${bullets.map((b) => `<li>${b}</li>`).join('')}
      </ul>
      <div class="mono" style="margin-top: auto; display: flex; flex-direction: column; gap: 2px; font-size: 10px; color: var(--text-muted); line-height: 1.5; overflow-wrap: anywhere;">${receipt.split(' · ').map((r) => `<span>${r}</span>`).join('')}</div>
    </div>`;
  const step = (n, text) => `
    <div style="display: flex; align-items: flex-start; gap: 10px; flex: 1 1 0; min-width: 0;">
      <span class="mono" style="display: grid; place-items: center; width: 22px; height: 22px; flex: none; border-radius: 999px; background: color-mix(in oklch, var(--accent-presence) 14%, transparent); color: var(--accent-presence); font-size: 11px; font-weight: 600;">${n}</span>
      <span style="font-size: 12px; line-height: 1.45; color: var(--text-secondary);">${text}</span>
    </div>`;
  write('Main.dc.html', page({
    title: 'Decisions', width: 960, height: 1000, bg: 'var(--bg-base)',
    body: `
    <div style="display: flex; flex-direction: column; gap: 24px; padding: 40px 44px;">
      <div class="eyebrow">Design review · 2026-09-02 · Coven Cave</div>
      <div style="display: flex; flex-direction: column; gap: 10px;">
        <h1 style="margin: 0; font-family: var(--font-serif); font-weight: 500; font-size: 30px; line-height: 1.15; letter-spacing: -0.01em;">Where work lives, who does it, and where it runs</h1>
        <p style="margin: 0; max-width: 760px; font-size: 13px; line-height: 1.55; color: var(--text-secondary);">Three linked decisions. Each keeps one thing separate from the others: the project is a place, the familiar is an actor, and a host is where the place is served from.</p>
      </div>
      <div style="display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 16px;">
        ${card('01', 'Context', 'Project chooses the workspace. Crew chooses who. One acting familiar executes.', [
          'Both axes stay global. Project is the primary scope; familiar scope is the crew inside it, remembered per project.',
          'Stage 1 has shipped: the rail switcher, the acting-familiar gate, and the Home pilot.',
          'Stage 2 makes Chat, Tasks, Queue, Calendar and Code follow the shell project. A historical chat overrides visibly and never moves the shell.',
          'Global surfaces say they ignore the project. Deep links resolve project before familiar.',
        ], 'src/lib/workspace-context.ts · src/components/workspace-context-switcher.tsx · docs/superpowers/specs/2026-08-18-project-primary-hybrid-navigation-design.md')}
        ${card('02', 'Projects', 'A project is a folder. Git is a capability it may have, not a type it is.', [
          'Any local directory remains the identity, one project per root. No separate entity or route for GitHub repositories.',
          'Two intakes into one registry: Choose a folder, or Clone from GitHub.',
          'A default home at ~/Coven/projects/&lt;owner&gt;/&lt;repo&gt;, created lazily and changeable in Settings. Registering elsewhere stays allowed.',
          'The registry gains a host field, local by default. This is the same extension SSH and sandboxes need.',
        ], 'src/lib/cave-projects-types.ts · src/lib/server/project-paths.ts · src/lib/project-organizations.ts')}
        ${card('03', 'Cloud sandbox', 'A sandbox is a host. A project can live on a host. A familiar may default to one.', [
          'Daytona joins as a fifth vessel in the Summoning Circle and as a host in the chat host chip.',
          'Reuse the SSH transport: mint a short-lived sandbox token and run the existing remote command.',
          'One sandbox per project, auto-stop after idle, auto-archive later. Cost is a receipt the operator can always see.',
          'Bring your own key first. Metered credits need a broker and an account, a separate service and a later decision.',
        ], 'src/lib/familiar-runtime.ts · src/lib/chat-hosts.ts · src/app/api/hosts/route.ts · marketplace/plugins/daytona')}
      </div>
      <div style="display: flex; flex-direction: column; gap: 12px; padding: 16px 20px; border: 1px solid var(--border-hairline); border-radius: var(--radius-card); background: color-mix(in oklch, var(--accent-presence) 5%, transparent);">
        <div class="spec-label">Build order</div>
        <div style="display: flex; gap: 20px;">
          ${step('1', 'Stage 2 of the context model: Chat, Tasks, Queue, Calendar and Code adopt the shell project.')}
          ${step('2', 'Projects folder, Clone from GitHub, and the host field on the registry.')}
          ${step('3', 'Cloud sandbox vessel behind a Settings toggle, bring-your-own-key only.')}
          ${step('4', 'Credits broker: a separate service and a separate decision, after 3 shows use.')}
        </div>
      </div>
    </div>`,
  }));
}

/* ───────────────────────── ContextRail ───────────────────────── */
{
  const navRow = (ic, text, count = '', active = false) => `
    <div class="nav-row${active ? ' nav-row--active' : ''}">${icon(ic, 16)}<span>${text}</span>${count ? `<span class="nav-row__count">${count}</span>` : ''}</div>`;
  const railExpanded = (projectTrigger, crewTrigger, counts) => `
    <div class="shell-nav" style="height: 520px;">
      <div class="rail-header">
        ${projectTrigger}
        ${crewTrigger}
        <div class="rail-new">${icon('note-pencil', 16, 'color: var(--text-secondary);')}<span>New chat</span><span class="rail-new__kbd">⌘N</span></div>
      </div>
      ${navRow('house', 'Home')}
      ${navRow('chat-circle-dots', 'Chat', '', true)}
      ${navRow('kanban', 'Tasks', counts[0])}
      ${navRow('calendar-blank', 'Calendar', counts[1])}
      ${navRow('code', 'Code')}
      <div class="nav-eyebrow">Rooms</div>
      ${navRow('terminal-window', 'Coding Desk')}
      ${navRow('list-checks', 'Review Deck')}
      <div style="flex: 1;"></div>
      ${navRow('gear-six', 'Settings')}
    </div>`;
  const projectTrigger = `<div class="ctx-trigger">${tile('CC')}<span class="ctx-trigger__label">Coven Cave</span>${icon('caret-up-down', 10, 'color: var(--text-muted);')}</div>`;
  const crewTrigger = `<div class="ctx-trigger ctx-trigger--crew"><span class="all-glyph">${icon('sparkle', 11)}</span><span class="ctx-trigger__label">Project crew</span>${icon('caret-up-down', 10, 'color: var(--text-muted);')}</div>`;
  const allProjectsTrigger = `<div class="ctx-trigger">${icon('squares-four', 16, 'color: var(--text-secondary);')}<span class="ctx-trigger__label">All projects</span>${icon('caret-up-down', 10, 'color: var(--text-muted);')}</div>`;
  const allFamiliarsTrigger = `<div class="ctx-trigger ctx-trigger--crew"><span class="all-glyph">${icon('sparkle', 11)}</span><span class="ctx-trigger__label">All familiars</span>${icon('caret-up-down', 10, 'color: var(--text-muted);')}</div>`;
  const railCollapsed = `
    <div class="shell-nav shell-nav--rail" style="height: 520px; background: var(--bg-panel);">
      <div class="rail-header" style="padding: 0; align-items: center;">
        <div class="rail-square" style="border-color: var(--border-strong);">${tile('CC')}</div>
        <div class="rail-square"><span class="all-glyph">${icon('sparkle', 11)}</span></div>
        <div class="rail-square" style="border-color: color-mix(in oklch, var(--accent-presence) 24%, var(--border-hairline)); background: color-mix(in oklch, var(--accent-presence) 9%, transparent);">${icon('note-pencil', 16)}</div>
      </div>
      <div class="rail-square" style="border-color: transparent; background: transparent;">${icon('house', 16)}</div>
      <div class="rail-square" style="border-color: transparent; background: color-mix(in oklch, var(--accent-presence) 12%, transparent); color: var(--text-primary);">${icon('chat-circle-dots', 16)}</div>
      <div class="rail-square" style="border-color: transparent; background: transparent;">${icon('kanban', 16)}</div>
      <div class="rail-square" style="border-color: transparent; background: transparent;">${icon('calendar-blank', 16)}</div>
      <div class="rail-square" style="border-color: transparent; background: transparent;">${icon('code', 16)}</div>
    </div>`;
  write('ContextRail.dc.html', page({
    title: 'Context rail', width: 880, height: 660, bg: 'var(--shell-floor)',
    body: `
    <div class="menu-bar" style="border-bottom: 1px solid var(--border-hairline);">
      <div style="display: flex; align-items: center; gap: 4px; color: var(--text-secondary);">${icon('caret-left', 12)}${icon('caret-right', 12)}</div>
      <div class="titlebar-ctx">
        <span class="titlebar-chip">${tile('CC', CC_TILE, 16)}<span>Coven Cave</span>${icon('caret-up-down', 10, 'color: var(--text-muted);')}</span>
        <span class="titlebar-chip"><span class="all-glyph">${icon('sparkle', 11)}</span><span>Project crew</span>${icon('caret-up-down', 10, 'color: var(--text-muted);')}</span>
      </div>
      <div style="flex: 1;"></div>
      <div class="menu-search">${icon('magnifying-glass', 12)}<span>Search</span><span class="mono" style="margin-left: auto; font-size: 10px;">⌘K</span></div>
      <div style="flex: 1;"></div>
      <div style="display: flex; align-items: center; gap: 8px; color: var(--text-secondary);">${icon('tray', 14)}${icon('gear-six', 14)}</div>
    </div>
    <div style="display: flex; gap: 40px; padding: 20px 24px 0; align-items: flex-start;">
      <div>${label('Project selected · crew reconciled')}${railExpanded(projectTrigger, crewTrigger, ['12', '3'])}</div>
      <div>${label('All projects · operator overview')}${railExpanded(allProjectsTrigger, allFamiliarsTrigger, ['31', '7'])}</div>
      <div>${label('Collapsed')}${railCollapsed}</div>
    </div>`,
  }));
}

/* ───────────────────────── ProjectPicker ───────────────────────── */
{
  const row = (name, root, access, tone, active = false) => `
    <div class="picker-row${active ? ' picker-row--active' : ''}">${tile(name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase(), tone)}
      <span class="picker-option"><span class="picker-heading"><span class="picker-name">${name}</span><span class="picker-access">${access}</span></span><span class="picker-root">${root}</span></span>
      ${active ? icon('check', 12, 'color: var(--text-primary);') : ''}
    </div>`;
  const item = (ic, text, muted = false, trailing = '') => `<div class="ui-popover-item${muted ? ' ui-popover-item--muted' : ''}"><span class="ui-popover-item__icon">${icon(ic, 13)}</span><span style="flex: 1;">${text}</span>${trailing}</div>`;
  write('ProjectPicker.dc.html', page({
    title: 'Project picker', width: 340, height: 700, bg: 'var(--shell-floor)',
    body: `
    <div style="padding: 20px 20px 0;">
      ${label('Project row · open')}
      <div class="ctx-trigger ctx-trigger--open" style="width: 228px;">${tile('CC')}<span class="ctx-trigger__label">Coven Cave</span>${icon('caret-up-down', 10, 'color: var(--text-muted);')}</div>
      <div class="ui-popover" style="width: 300px; margin-top: 6px;">
        <div class="ui-popover-body">
          <div class="picker-filter">Filter projects…</div>
          <div class="ui-popover-label">Project</div>
          ${item('squares-four', 'All projects')}
          <div class="ui-popover-label">Recent</div>
          ${row('Coven Cave', '~/Coven/projects/OpenCoven/coven-cave', 'Full', CC_TILE, true)}
          ${row('Coven CLI', '~/Coven/projects/OpenCoven/coven-cli', 'Full', 'oklch(0.74 0.12 145)')}
          <div class="ui-popover-separator"></div>
          <div class="ui-popover-label">Cody's projects</div>
          ${row('OpenKnot', '~/Documents/GitHub/OpenKnots/openknot', 'Read', 'oklch(0.74 0.12 25)')}
          <div class="ui-popover-separator"></div>
          <div class="ui-popover-label">All projects</div>
          ${row('Notes', '~/Notes', 'Full', 'oklch(0.74 0.12 85)')}
          ${item('caret-down', 'Show 4 more projects')}
          <div class="ui-popover-separator"></div>
          ${item('folder-plus', 'Add project…')}
          ${item('github-logo', 'Clone from GitHub…')}
          ${item('gear-six', 'Manage projects…')}
        </div>
      </div>
    </div>`,
  }));
}

/* ───────────────────────── CrewPicker ───────────────────────── */
{
  const opt = (initial, tone, name, meta, opts = {}) => `
    <div class="fs-option${opts.active ? ' fs-option--active' : ''}${opts.hover ? ' fs-option--hover' : ''}" style="--familiar-accent: ${tone};">
      <span class="fs-checkbox${opts.checked ? ' fs-checkbox--checked' : ''}${opts.hover || opts.checked ? '' : ' fs-checkbox--hidden'}">${opts.checked ? icon('check', 9) : ''}</span>
      ${fam(initial, tone, 16, opts.dot)}
      <span class="fs-name">${name}</span>
      <span class="fs-meta">${meta}</span>
      ${opts.unread ? '<span class="fs-unread"></span>' : ''}
      ${opts.active ? icon('check', 12) : ''}
    </div>`;
  const item = (ic, text) => `<div class="ui-popover-item"><span class="ui-popover-item__icon">${icon(ic, 13)}</span><span>${text}</span></div>`;
  write('CrewPicker.dc.html', page({
    title: 'Crew picker', width: 320, height: 600, bg: 'var(--shell-floor)',
    body: `
    <div style="padding: 20px 20px 0;">
      ${label('Crew row · open · Coven Cave')}
      <div class="ctx-trigger ctx-trigger--crew ctx-trigger--open" style="width: 228px;"><span class="all-glyph">${icon('sparkle', 11)}</span><span class="ctx-trigger__label">Project crew</span>${icon('caret-up-down', 10, 'color: var(--text-muted);')}</div>
      <div class="ui-popover" style="width: 264px; margin-top: 6px;">
        <div class="fs-header">
          <span class="all-glyph" style="width: 22px; height: 22px; border-radius: 7px;">${icon('sparkle', 13)}</span>
          <span class="fs-header__text"><span class="fs-header__name">Project crew</span><span class="fs-header__role">3 with access to Coven Cave</span></span>
        </div>
        <div class="fs-list">
          <div class="fs-option fs-option--active"><span class="all-glyph">${icon('sparkle', 11)}</span><span class="fs-name">Project crew</span>${icon('check', 12)}</div>
          ${opt('C', CODY, 'Cody', 'Coding · online', { hover: true, dot: 'var(--color-success)' })}
          ${opt('N', NOVA, 'Nova', 'Orchestration', { dot: 'var(--color-success)' })}
          ${opt('S', SALEM, 'Salem', 'Research · needs reply', { dot: 'var(--color-warning)', unread: true })}
        </div>
        <div class="ui-popover-separator" style="margin: 0 6px;"></div>
        <div class="ui-popover-body">
          <div class="caption" style="padding: 4px 10px 6px;">Echo and Astra have no access to Coven Cave. They stay out of this list until you grant it.</div>
          ${item('list-checks', 'Select multiple')}
          ${item('lock-simple', 'Manage project access…')}
          ${item('user-circle', 'Open Familiar Studio…')}
        </div>
      </div>
    </div>`,
  }));
}

/* ───────────────────────── ActingFamiliarGate ───────────────────────── */
{
  const choice = (initial, tone, name, meta) => `
    <div class="ui-btn ui-btn--ghost ui-btn--full" style="height: 36px; gap: 10px;">${fam(initial, tone, 16, 'var(--color-success)')}<span style="color: var(--text-primary);">${name}</span><span class="caption" style="margin-left: auto;">${meta}</span></div>`;
  write('ActingFamiliarGate.dc.html', page({
    title: 'Acting familiar gate', width: 600, height: 480, bg: 'var(--bg-base)',
    body: `
    <div class="ui-modal-backdrop" style="position: absolute; inset: 0;">
      <div class="ui-modal">
        <div class="ui-modal-header"><span>New chat</span><span class="ui-modal-header__sep">›</span><strong>Choose familiar</strong><span class="ui-modal-close">${icon('x', 14)}</span></div>
        <div class="ui-modal-body" style="gap: 8px;">
          <div class="caption" style="margin-bottom: 4px;">Coven Cave has three familiars with access. Choose who acts on this chat. The crew stays as it is.</div>
          ${choice('C', CODY, 'Cody', 'Coding · online')}
          ${choice('N', NOVA, 'Nova', 'Orchestration')}
          ${choice('S', SALEM, 'Salem', 'Research')}
        </div>
        <div class="ui-modal-footer"><span class="ui-btn ui-btn--secondary">Cancel</span></div>
      </div>
    </div>`,
  }));
}

/* ───────────────────────── SurfaceAdapters ───────────────────────── */
{
  const chip = (ic, text, extra = '') => `<span class="ctx-chip ${extra}"><span class="ctx-chip__lead">${icon(ic, 12)}</span><span class="ctx-chip__text">${text}</span>${icon('caret-down', 10, 'color: var(--text-muted); opacity: 0.7;')}</span>`;
  const panel = (inner) => `<div style="border: 1px solid var(--border-hairline); border-radius: var(--radius-card); background: var(--bg-raised); overflow: hidden;">${inner}</div>`;
  write('SurfaceAdapters.dc.html', page({
    title: 'Surface adapters', width: 760, height: 600, bg: 'var(--bg-base)',
    body: `
    <div style="display: flex; flex-direction: column; gap: 22px; padding: 24px;">
      <div>
        ${label('Chat · a historical chat rooted elsewhere · override stays visible, shell stays put')}
        ${panel(`
          <div style="display: flex; align-items: center; gap: 12px; padding: 12px 16px 8px;">
            <span style="font-family: var(--font-serif); font-size: 17px; line-height: 1.2;">Reducing branch churn in the worktree sweep</span>
            <span style="margin-left: auto; display: inline-flex; align-items: center; gap: 6px; font-size: 11px; color: var(--text-secondary);">${fam('C', CODY, 16)}Cody</span>
          </div>
          <div class="chat-context-row" style="gap: 4px;">
            ${chip('folder', 'OpenKnot')}${chip('git-branch', 'main +3')}
            <span class="ctx-chip ctx-chip--override" style="margin-left: auto;">${icon('warning', 12, 'color: var(--color-warning);')}<span class="ctx-chip__text">Runs in OpenKnot, not the workspace</span></span>
            <span class="ui-btn ui-btn--xs ui-btn--secondary">Switch workspace</span>
          </div>`)}
      </div>
      <div>
        ${label('Tasks · follows the shell project · the filter is the workspace, not a local pick')}
        ${panel(`
          <div style="display: flex; align-items: center; gap: 10px; padding: 12px 16px;">
            <span style="font-size: 16px; font-weight: 600;">Tasks</span>
            <span style="display: inline-flex; align-items: center; gap: 6px; height: 24px; padding: 0 8px 0 4px; border-radius: 999px; border: 1px solid var(--border-hairline); background: var(--bg-subtle); font-size: 12px;">${tile('CC', CC_TILE, 16)}Coven Cave<span class="caption">· 12 open</span></span>
            <span class="caption">Workspace project</span>
            <span class="rail-new" style="margin-left: auto; width: auto; min-height: 26px; padding: 0 10px; font-size: 12px;">${icon('plus', 12)}<span>New task</span></span>
          </div>
          <div style="display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; padding: 0 16px 14px;">
            ${['Ready · 4', 'In progress · 5', 'Review · 3'].map((h) => `<div style="padding: 8px 10px; border: 1px dashed var(--border-hairline); border-radius: var(--radius-control);"><span class="spec-label">${h}</span></div>`).join('')}
          </div>`)}
      </div>
      <div>
        ${label('Marketplace · global · the shell says it is not filtering, instead of half-filtering')}
        ${panel(`
          <div style="display: flex; align-items: center; gap: 12px; padding: 12px 16px;">
            <div class="titlebar-ctx" style="opacity: 0.58;">
              <span class="titlebar-chip">${tile('CC', CC_TILE, 16)}<span>Coven Cave</span>${icon('caret-up-down', 10, 'color: var(--text-muted);')}</span>
              <span class="titlebar-chip"><span class="all-glyph">${icon('sparkle', 11)}</span><span>Project crew</span>${icon('caret-up-down', 10, 'color: var(--text-muted);')}</span>
            </div>
            <span class="caption">Marketplace isn't filtered by project.</span>
            <span style="margin-left: auto; font-size: 16px; font-weight: 600;">Marketplace</span>
          </div>`)}
      </div>
      <div>
        ${label('Deep link · project resolves first, familiar only if eligible')}
        ${panel(`
          <div style="display: flex; flex-direction: column; gap: 8px; padding: 12px 16px;">
            <span class="mono" style="font-size: 12px; color: var(--text-primary);">covencave://open?mode=chat&amp;project=cc-2f1&amp;familiar=cody</span>
            <span class="caption">An ineligible or missing familiar lands on Project crew. A missing project lands on All projects. Nothing is substituted silently.</span>
          </div>`)}
      </div>
    </div>`,
  }));
}

/* ───────────────────────── MobileNewChat ───────────────────────── */
{
  const row = (labelText, value, extra = '') => `
    <div style="display: flex; align-items: center; gap: 12px; min-height: 48px; padding: 0 16px; border-bottom: 1px solid var(--border-hairline);">
      <span style="font-size: 16px;">${labelText}</span>
      <span style="margin-left: auto; display: inline-flex; align-items: center; gap: 8px; font-size: 16px; color: var(--text-secondary);">${extra}${value}${icon('caret-right', 12, 'color: var(--text-muted);')}</span>
    </div>`;
  write('MobileNewChat.dc.html', page({
    title: 'Mobile new chat', width: 390, height: 844, bg: 'var(--bg-base)',
    body: `
    <div style="height: 54px;"></div>
    <div style="display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; padding: 0 16px; height: 44px;">
      <span style="font-size: 17px; color: var(--accent-presence);">Cancel</span>
      <span style="font-size: 17px; font-weight: 600;">New chat</span>
      <span></span>
    </div>
    <div style="display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 28px 16px 24px;">
      ${fam('C', CODY, 56, 'var(--color-success)')}
      <span style="font-size: 22px; font-weight: 600; letter-spacing: -0.01em;">Cody</span>
      <span style="font-size: 13px; color: var(--text-muted);">Coding · online</span>
    </div>
    <div style="padding: 0 16px; display: flex; flex-direction: column; gap: 22px;">
      <div>
        <div style="border: 1px solid var(--border-hairline); border-radius: var(--radius-card); background: var(--bg-raised); overflow: hidden;">
          ${row('Project', 'Coven Cave', tile('CC', CC_TILE, 20))}
          <div style="display: flex; align-items: center; gap: 12px; min-height: 48px; padding: 0 16px;">
            <span style="font-size: 16px;">Access</span><span style="margin-left: auto; font-size: 16px; color: var(--text-secondary);">Full</span>
          </div>
        </div>
        <div class="caption" style="padding: 8px 16px 0; font-size: 12px;">Fixed for this chat. Start another chat to use a different project.</div>
      </div>
      <div style="border: 1px solid var(--border-hairline); border-radius: var(--radius-card); background: var(--bg-raised); overflow: hidden;">
        ${row('Runs on', 'Sandbox · coven-cave', '<span class="host-dot host-dot--online"></span>')}
        <div style="display: flex; align-items: center; gap: 12px; min-height: 48px; padding: 0 16px;">
          <span style="font-size: 16px;">Model</span><span style="margin-left: auto; display: inline-flex; align-items: center; gap: 8px; font-size: 16px; color: var(--text-secondary);">Runtime default${icon('caret-right', 12, 'color: var(--text-muted);')}</span>
        </div>
      </div>
    </div>
    <div style="position: absolute; left: 0; right: 0; bottom: 0; padding: 12px 16px 34px; display: flex; flex-direction: column; gap: 10px; border-top: 1px solid var(--border-hairline); background: var(--bg-base);">
      <span class="receipt" style="align-self: flex-start;">${icon('check', 11, 'color: var(--color-success);')}Cody · full access · sandbox running</span>
      <div style="display: flex; align-items: center; gap: 10px;">
        <div style="flex: 1; display: flex; align-items: center; min-height: 44px; padding: 0 16px; border-radius: 22px; border: 1px solid var(--border-strong); background: var(--bg-raised); color: var(--text-muted); font-size: 16px;">Message Cody…</div>
        <span style="display: grid; place-items: center; width: 44px; height: 44px; border-radius: 50%; border: 1px solid var(--accent-presence); color: var(--accent-presence);">${icon('arrow-up', 16)}</span>
      </div>
    </div>`,
  }));
}

/* ───────────────────────── AddProject ───────────────────────── */
{
  const card = (ic, title, sub, hover = false) => `
    <div class="ui-template-card${hover ? ' ui-template-card--hover' : ''}"><span class="ui-template-card-icon">${icon(ic, 16)}</span><span class="ui-template-card-title">${title}</span><span class="ui-template-card-subtitle">${sub}</span></div>`;
  write('AddProject.dc.html', page({
    title: 'Add project', width: 640, height: 520, bg: 'var(--bg-base)',
    body: `
    <div class="ui-modal-backdrop" style="position: absolute; inset: 0;">
      <div class="ui-modal" style="max-width: 580px;">
        <div class="ui-modal-header"><strong>Add project</strong><span class="ui-modal-close">${icon('x', 14)}</span></div>
        <div class="ui-modal-body">
          <div class="ui-template-grid">
            ${card('folder-open', 'Choose a folder', 'Any folder on this Mac. Git is detected, never required.', true)}
            ${card('github-logo', 'Clone from GitHub', 'Into your projects folder as owner/repo. Links the repository.')}
            ${card('books', 'Try the sample project', 'A small read-only project to learn the Cave. Remove it any time.')}
          </div>
          <div class="ui-help">Projects can live anywhere. New clones go to <span class="mono">~/Coven/projects</span>. Change that in Settings › General.</div>
        </div>
        <div class="ui-modal-footer"><span class="ui-btn ui-btn--secondary">Cancel</span></div>
      </div>
    </div>`,
  }));
}

/* ───────────────────────── CloneRepo ───────────────────────── */
{
  const field = (name, control, help = '', optional = false) => `
    <div class="ui-field">
      <div class="ui-field__label-row"><span class="ui-field__label">${name}</span>${optional ? '<span class="ui-field__optional">Optional</span>' : ''}</div>
      ${control}
      ${help ? `<div class="ui-help">${help}</div>` : ''}
    </div>`;
  const suggestion = (slug, lang, when, active = false) => `
    <div class="ui-popover-item${active ? ' ui-popover-item--active' : ''}" style="padding: 5px 10px;">${icon('github-logo', 12, 'color: var(--text-secondary);')}<span style="flex: 1;">${slug}</span><span class="caption">${lang}</span><span class="caption" style="min-width: 44px; text-align: right;">${when}</span></div>`;
  const swatch = (hue, on = false) => `<span style="width: 20px; height: 20px; border-radius: 50%; background: oklch(0.74 0.12 ${hue}); ${on ? 'box-shadow: 0 0 0 2px var(--bg-raised), 0 0 0 4px var(--ring-focus);' : ''}"></span>`;
  const seg = (text, on = false) => `<span class="ui-btn ui-btn--sm${on ? ' ui-btn--primary' : ' ui-btn--ghost'}" style="flex: 1;">${text}</span>`;
  write('CloneRepo.dc.html', page({
    title: 'Clone from GitHub', width: 600, height: 840, bg: 'var(--bg-base)',
    body: `
    <div class="ui-modal-backdrop" style="position: absolute; inset: 0; align-items: flex-start; padding-top: 24px;">
      <div class="ui-modal">
        <div class="ui-modal-header"><span>Add project</span><span class="ui-modal-header__sep">›</span><strong>Clone from GitHub</strong><span class="ui-modal-close">${icon('x', 14)}</span></div>
        <div class="ui-modal-body">
          ${field('Repository', `
            <div class="ui-input" style="border-color: color-mix(in oklch, var(--accent-presence) 60%, transparent);">${icon('github-logo', 13, 'color: var(--text-secondary);')}<span>OpenCoven/coven-c</span><span style="width: 1px; height: 14px; background: var(--text-primary);"></span></div>
            <div class="ui-popover" style="margin-top: -4px;"><div class="ui-popover-body">
              ${suggestion('OpenCoven/coven-cave', 'TypeScript', '2h ago', true)}
              ${suggestion('OpenCoven/coven-cli', 'Rust', '1d ago')}
              ${suggestion('OpenCoven/coven-code', 'TypeScript', '3d ago')}
            </div></div>`, 'Paste a link or type owner/repo. Private repositories use your GitHub token from the Vault.')}
          ${field('Destination', `
            <div class="workspace-control"><div class="ui-input ui-input--readonly">~/Coven/projects/OpenCoven/coven-cave</div><span class="ui-btn ui-btn--secondary ui-btn--sm">Change…</span></div>`, 'Your projects folder, laid out as owner/repo so projects group by organization.')}
          ${field('Name', `<div class="ui-input"><span>Coven Cave</span></div>`)}
          ${field('Color', `<div style="display: flex; gap: 10px; align-items: center;">${swatch(25)}${swatch(85)}${swatch(145)}${swatch(205)}${swatch(265, true)}${swatch(325)}</div>`, '', true)}
          ${field("Cody's access", `<div style="display: flex; gap: 4px; padding: 3px; border: 1px solid var(--border-hairline); border-radius: var(--radius-control); background: var(--bg-sunken);">${seg('No access')}${seg('Read')}${seg('Write', true)}</div>`, 'Cody is the acting familiar. Other familiars get access from Projects › Access.')}
        </div>
        <div class="ui-modal-footer"><span class="ui-btn ui-btn--secondary">Cancel</span><span class="ui-btn ui-btn--primary">Clone and register</span></div>
      </div>
    </div>`,
  }));
}

/* ───────────────────────── ProjectsFolder (Settings) ───────────────────────── */
{
  const row = (name, hint, control) => `
    <div class="settings-row"><div><div class="settings-row__label">${name}</div><div class="settings-row__hint">${hint}</div></div>${control}</div>`;
  const pathControl = (p) => `
    <div class="workspace-control"><div class="workspace-path">${p}</div><div style="display: flex; gap: 8px;"><span class="ui-btn ui-btn--secondary ui-btn--sm">${icon('folder-open', 11)}Choose folder…</span><span class="ui-btn ui-btn--ghost ui-btn--sm">Open</span></div></div>`;
  write('ProjectsFolder.dc.html', page({
    title: 'Settings · projects folder', width: 720, height: 440, bg: 'var(--bg-base)',
    body: `
    <div style="padding: 28px 32px; display: flex; flex-direction: column; gap: 6px;">
      <div class="settings-rule"><span class="eyebrow">Workspace</span><span class="settings-rule__line"></span></div>
      <p class="settings-desc">Where the Cave keeps things on this Mac. Both can be pinned for a deployment with an environment variable.</p>
      <div class="settings-panel">
        ${row('Familiar workspaces', 'Each familiar keeps its identity and memory here.', pathControl('~/.coven/workspaces'))}
        ${row('Projects folder', 'Where cloned and new projects go by default. Any folder can still be registered.', pathControl('~/Coven/projects'))}
      </div>
      <div class="caption" style="padding: 10px 4px 0;">Set <span class="mono">COVEN_PROJECTS_ROOT</span> to pin the projects folder. When it is pinned, this row reads the value and the Choose folder button is hidden.</div>
    </div>`,
  }));
}

/* ───────────────────────── ProjectsHub ───────────────────────── */
{
  const org = (ic, name, count) => `
    <div style="display: flex; align-items: center; gap: 8px; padding: 14px 4px 6px;">${icon(ic, 13, 'color: var(--text-secondary);')}<span style="font-size: 12px; font-weight: 600;">${name}</span><span class="caption">${count}</span></div>`;
  const hostChip = (ic, text, accent = false) => `<span style="display: inline-flex; align-items: center; gap: 5px; height: 20px; padding: 0 8px; border-radius: 999px; border: 1px solid var(--border-hairline); font-size: 10px; color: ${accent ? 'var(--text-primary)' : 'var(--text-secondary)'}; ${accent ? 'background: color-mix(in oklch, var(--accent-presence) 12%, transparent); border-color: color-mix(in oklch, var(--accent-presence) 40%, transparent);' : ''}">${icon(ic, 11, accent ? 'color: var(--accent-presence);' : '')}${text}</span>`;
  const row = (kindIcon, initials, tone, name, meta, host, access) => `
    <div style="display: flex; align-items: center; gap: 10px; min-height: 44px; padding: 0 12px; border: 1px solid var(--border-hairline); border-radius: var(--radius-control); background: var(--bg-raised);">
      ${icon(kindIcon, 13, 'color: var(--text-secondary);')}${tile(initials, tone)}
      <span style="display: flex; flex-direction: column; min-width: 0; flex: 1;"><span style="font-size: 13px; font-weight: 500;">${name}</span><span class="picker-root">${meta}</span></span>
      ${host}
      <span class="picker-access">${access}</span>
      ${icon('gear-six', 13, 'color: var(--text-muted);')}
    </div>`;
  write('ProjectsHub.dc.html', page({
    title: 'Projects hub rows', width: 680, height: 460, bg: 'var(--bg-base)',
    body: `
    <div style="padding: 24px 28px; display: flex; flex-direction: column; gap: 6px;">
      <div style="display: flex; align-items: baseline; gap: 12px;"><span style="font-size: 16px; font-weight: 600;">Projects</span><span class="caption">Grouped by organization. The host chip says where the files live.</span></div>
      ${org('github-logo', 'OpenCoven', '3 projects')}
      ${row('github-logo', 'CC', CC_TILE, 'Coven Cave', 'OpenCoven/coven-cave · ~/Coven/projects/OpenCoven/coven-cave', hostChip('desktop', 'This Mac'), 'Full')}
      ${row('github-logo', 'CL', 'oklch(0.74 0.12 145)', 'Coven CLI', 'OpenCoven/coven-cli · sandbox:/home/daytona/workspace/coven-cli', hostChip('cloud-bold', 'Sandbox · running', true), 'Full')}
      ${row('github-logo', 'CD', 'oklch(0.74 0.12 325)', 'Coven Code', 'OpenCoven/coven-code · build-box:~/src/coven-code', hostChip('globe', 'build-box · offline'), 'Read')}
      ${org('folder', 'Personal', '1 project')}
      ${row('folder', 'N', 'oklch(0.74 0.12 85)', 'Notes', 'no remote · ~/Notes', hostChip('desktop', 'This Mac'), 'Full')}
    </div>`,
  }));
}

/* ───────────────────────── VesselStage ───────────────────────── */
{
  const vessel = (ic, title, hint) => `
    <div class="summoning-vessel"><span class="summoning-vessel__icon">${icon(ic, 18)}</span><span class="summoning-vessel__title">${title}</span><span class="summoning-vessel__hint">${hint}</span></div>`;
  const mini = (name, value, ok = false) => `
    <div style="display: flex; flex-direction: column; gap: 3px; min-width: 0;"><span class="spec-label" style="font-size: 9px;">${name}</span><span style="display: inline-flex; align-items: center; gap: 5px; font-size: 12px; color: var(--text-primary);">${ok ? icon('check', 11, 'color: var(--color-success);') : ''}${value}</span></div>`;
  write('VesselStage.dc.html', page({
    title: 'Summoning · vessel', width: 720, height: 540, bg: 'var(--bg-base)',
    body: `
    <div style="padding: 28px 32px; display: flex; flex-direction: column; gap: 14px;">
      <div class="eyebrow">Stage I · The vessel</div>
      <div style="font-size: 16px; font-weight: 600;">Where will this familiar run?</div>
      <div class="summoning-vessels">
        ${vessel('desktop', "Local runtime — Val's Mac", "Runs on Val's Mac, the host serving this Cave.")}
        ${vessel('globe', 'A remote machine', 'Reaches over SSH to a host you name.')}
        ${vessel('robot', 'An OpenClaw agent', 'Bridge an agent you already keep.')}
        ${vessel('brain-bold', 'A Hermes profile', 'Bring a saved Hermes mind, skills, and SOUL.')}
        <div class="summoning-vessel summoning-vessel--active summoning-vessel--expanded" style="display: grid; grid-template-columns: auto minmax(0, 1fr) auto; column-gap: 12px; row-gap: 12px; align-items: center;">
          <span class="summoning-vessel__icon" style="grid-column: 1; grid-row: 1 / 3;">${icon('cloud-bold', 22)}</span>
          <span style="grid-column: 2; grid-row: 1; display: flex; flex-direction: column; gap: 3px;"><span class="summoning-vessel__title">A cloud sandbox</span><span class="summoning-vessel__hint">Runs in an isolated Daytona sandbox with its own filesystem and network. Billed while running, stops when idle.</span></span>
          <span class="summoning-vessel__action" style="grid-column: 3; grid-row: 1; margin-top: 0;">Test connection</span>
          <div style="grid-column: 2 / 4; grid-row: 2; display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 16px; padding-top: 10px; border-top: 1px solid var(--border-hairline);">
            ${mini('Provider', 'Daytona · Vault key', true)}
            ${mini('Snapshot', 'cave-sandbox:0.3')}
            ${mini('Size', '2 vCPU · 4 GB')}
            ${mini('Auto-stop', '15 min idle')}
          </div>
        </div>
      </div>
      <div class="caption">Runtimes that need an interactive sign-in can't run inside a sandbox. Only runtimes with an API-key inference route are offered on the next stage.</div>
    </div>`,
  }));
}

/* ───────────────────────── HostChip ───────────────────────── */
{
  const choice = (ic, text, status, meta = '', opts = {}) => `
    <div class="host-choice${opts.selected ? ' host-choice--selected' : ''}${opts.connect ? ' host-choice--connect' : ''}">${icon(ic, 13, opts.connect ? '' : 'color: var(--accent-presence);')}<span style="display: flex; flex-direction: column; min-width: 0;"><span>${text}</span>${meta ? `<span class="caption" style="font-size: 10px;">${meta}</span>` : ''}</span>${status ? `<span class="host-status host-status--${status}"><span class="host-dot host-dot--${status}"></span>${status}</span>` : ''}</div>`;
  const chip = (ic, value, dot) => `<span class="host-chip">${icon(ic, 13)}<span class="host-chip__label">Runs on</span><span class="host-chip__value">${value}</span><span class="host-dot host-dot--${dot}"></span></span>`;
  write('HostChip.dc.html', page({
    title: 'Host chip and receipts', width: 560, height: 680, bg: 'var(--bg-base)',
    body: `
    <div style="padding: 24px 28px; display: flex; flex-direction: column; gap: 22px;">
      <div>
        ${label('Composer control row · sandbox selected')}
        <div style="display: flex; align-items: center; gap: 8px;">
          ${chip('cloud-bold', 'Sandbox · coven-cave', 'online')}
          <span class="host-chip">${icon('cube', 13)}<span class="host-chip__label">Model</span><span class="host-chip__value">Sonnet 5</span></span>
        </div>
        <div class="ui-popover" style="width: 320px; margin-top: 6px;"><div class="ui-popover-body">
          <div class="ui-popover-label">Host</div>
          ${choice('desktop', "Val's Mac", 'online')}
          ${choice('cloud-bold', 'Sandbox · coven-cave', 'online', '2 vCPU · 4 GB · $0.31 today', { selected: true })}
          ${choice('globe', 'build-box', 'offline', 'ssh · ~/src')}
          <div class="ui-popover-separator"></div>
          ${choice('plus', 'Connect a host…', '', '', { connect: true })}
          ${choice('cloud-bold', 'New cloud sandbox…', '', '', { connect: true })}
        </div></div>
      </div>
      <div>
        ${label('Transcript · phase lines and the receipt')}
        <div style="display: flex; flex-direction: column; gap: 8px; padding: 12px 14px; border: 1px solid var(--border-hairline); border-radius: var(--radius-card); background: var(--bg-raised);">
          <span class="mono" style="font-size: 11px; color: var(--text-muted);">starting sandbox · coven-cave · 6s</span>
          <span class="mono" style="font-size: 11px; color: var(--text-muted);">reading diff · 14 files</span>
          <span class="mono" style="font-size: 11px; color: var(--text-secondary);">running tests · 34/34 · clean</span>
          <span class="receipt" style="align-self: flex-start; margin-top: 4px;">sandbox 42 min · 2 vCPU · $0.31</span>
        </div>
      </div>
      <div>
        ${label('Stopped sandbox · wakes on send, and says so')}
        <div style="display: flex; align-items: center; gap: 8px;">
          ${chip('cloud-bold', 'Sandbox · stopped', 'unknown')}
          <span class="caption" style="flex: 1;">Wakes on send. Disk keeps billing at $0.02/day while stopped.</span>
        </div>
      </div>
    </div>`,
  }));
}

/* ───────────────────────── CloudHosts (Settings) ───────────────────────── */
{
  const row = (name, hint, control) => `
    <div class="settings-row"><div><div class="settings-row__label">${name}</div><div class="settings-row__hint">${hint}</div></div>${control}</div>`;
  const sandboxRow = (name, state, size, today, cost, actions) => `
    <div style="display: grid; grid-template-columns: 1.3fr 0.9fr 1.1fr 0.7fr 0.6fr auto; align-items: center; gap: 12px; padding: 10px 14px; border-top: 1px solid var(--border-hairline); font-size: 12px;">
      <span style="display: inline-flex; align-items: center; gap: 8px;">${icon('cloud-bold', 13, 'color: var(--accent-presence);')}${name}</span>
      <span class="lifecycle${state === 'running' ? ' lifecycle--running' : ''}">${state}</span>
      <span class="caption">${size}</span><span class="caption">${today}</span><span class="mono" style="font-size: 11px;">${cost}</span>
      <span style="display: flex; gap: 6px;">${actions}</span>
    </div>`;
  write('CloudHosts.dc.html', page({
    title: 'Settings · cloud sandboxes', width: 720, height: 740, bg: 'var(--bg-base)',
    body: `
    <div style="padding: 28px 32px; display: flex; flex-direction: column; gap: 6px;">
      <div class="settings-rule"><span class="eyebrow">Cloud sandboxes · Daytona</span><span class="settings-rule__line"></span></div>
      <p class="settings-desc">Familiars can run in isolated sandboxes instead of on this Mac. Nothing starts until a chat picks a sandbox host.</p>
      <div class="settings-panel">
        ${row('Enable cloud sandboxes', 'Adds the vessel and the host option everywhere hosts are picked.', '<div style="display: flex; justify-content: flex-end;"><span class="toggle"></span></div>')}
        ${row('API key', 'Stored as a Vault reference. The value never leaves the Vault.', `<div class="workspace-control"><div class="workspace-path">op://Coven/Daytona/api-key</div><div style="display: flex; align-items: center; gap: 8px;"><span class="ui-btn ui-btn--secondary ui-btn--sm">Test</span><span class="caption" style="color: var(--color-success); white-space: nowrap;">Valid · OpenCoven</span></div></div>`)}
        ${row('Default snapshot', 'Coven CLI and harness runtimes preinstalled.', `<div class="ui-input" style="justify-content: space-between;"><span class="mono" style="font-size: 11px;">opencoven/cave-sandbox:0.3</span>${icon('caret-down', 11, 'color: var(--text-muted);')}</div>`)}
        ${row('Daily budget', "New sandboxes won't start above this. Running turns finish.", `<div class="workspace-control" style="grid-template-columns: 120px auto;"><div class="ui-input"><span>$5.00</span></div><span class="caption">$0.33 used today</span></div>`)}
      </div>
      <div class="settings-rule" style="margin-top: 18px;"><span class="eyebrow">Sandboxes</span><span class="settings-rule__line"></span><span class="caption">2 · one running</span></div>
      <div class="settings-panel">
        <div style="display: grid; grid-template-columns: 1.3fr 0.9fr 1.1fr 0.7fr 0.6fr auto; gap: 12px; padding: 8px 14px;">${['Project', 'State', 'Size', 'Today', 'Cost', ''].map((h) => `<span class="spec-label" style="font-size: 9px;">${h}</span>`).join('')}</div>
        ${sandboxRow('coven-cave', 'running', '2 vCPU · 4 GB', '42 min', '$0.31', '<span class="ui-btn ui-btn--secondary ui-btn--xs">Stop</span><span class="ui-btn ui-btn--ghost ui-btn--xs">Archive</span>')}
        ${sandboxRow('coven-cli', 'stopped', '10 GB disk', '—', '$0.02', '<span class="ui-btn ui-btn--secondary ui-btn--xs">Start</span><span class="ui-btn ui-btn--danger-ghost ui-btn--xs">Delete…</span>')}
      </div>
      <div class="caption" style="padding: 10px 4px 0;">Delete removes the sandbox and its checkout after a confirmation. Archived sandboxes cost nothing; snapshots keep billing for storage.</div>
    </div>`,
  }));
}

/* ───────────────────────── CreditsSketch (Phase B, low-fi) ───────────────────────── */
{
  const bar = (name, pct, amount) => `
    <div style="display: grid; grid-template-columns: 96px 1fr 52px; align-items: center; gap: 10px; font-size: 12px; color: var(--text-secondary);"><span>${name}</span><span style="height: 8px; border: 1px dashed var(--border-strong); border-radius: 999px; overflow: hidden;"><span style="display: block; width: ${pct}%; height: 100%; background: var(--border-strong);"></span></span><span class="mono" style="text-align: right; font-size: 11px;">${amount}</span></div>`;
  write('CreditsSketch.dc.html', page({
    title: 'Credits sketch', width: 460, height: 560, bg: 'var(--bg-base)',
    body: `
    <div style="margin: 24px; padding: 20px; border: 1px dashed var(--border-strong); border-radius: var(--radius-card); display: flex; flex-direction: column; gap: 16px; filter: grayscale(1);">
      <div class="eyebrow" style="color: var(--text-muted);">Phase B · sketch · not in scope yet</div>
      <div style="font-size: 16px; font-weight: 600;">OpenCoven Cloud credits</div>
      <div style="display: flex; align-items: baseline; gap: 10px;"><span class="mono" style="font-size: 28px; font-weight: 500;">$12.40</span><span class="caption">available · bring your own key stays free</span></div>
      <div style="display: flex; flex-direction: column; gap: 6px; padding: 12px; border: 1px dashed var(--border-hairline); border-radius: var(--radius-control);">
        <span style="font-size: 12px;">Auto top-up when balance is below <span class="mono">$5.00</span>, bring it to <span class="mono">$20.00</span></span>
        <span class="caption">Prepaid credits priced per sandbox-hour by size, plus stopped disk and snapshots. A wall-clock cap ends any sandbox after 8 h.</span>
      </div>
      <div style="display: flex; flex-direction: column; gap: 8px;">
        <span class="spec-label">This month by project</span>
        ${bar('Coven Cave', 61, '$4.12')}
        ${bar('coven-cli', 31, '$2.09')}
        ${bar('OpenKnot', 8, '$0.54')}
      </div>
      <div class="caption">Needs an account and a broker service holding the master Daytona organization. Neither exists in the Cave today.</div>
    </div>`,
  }));
}

/* ───────────────────────── canvas.json ───────────────────────── */
const canvas = {
  artboards: [
    { file: 'Main.dc.html', x: 0, y: 0, w: 960, h: 1000, title: 'Decisions' },
    { file: 'ContextRail.dc.html', x: 0, y: 1160, w: 880, h: 660, title: 'Shell rail · project + crew' },
    { file: 'ProjectPicker.dc.html', x: 960, y: 1160, w: 340, h: 700, title: 'Project picker' },
    { file: 'CrewPicker.dc.html', x: 1380, y: 1160, w: 320, h: 600, title: 'Crew picker' },
    { file: 'ActingFamiliarGate.dc.html', x: 1780, y: 1160, w: 600, h: 480, title: 'Acting familiar gate' },
    { file: 'SurfaceAdapters.dc.html', x: 2460, y: 1160, w: 760, h: 600, title: 'Surface adapters (Stage 2)' },
    { file: 'MobileNewChat.dc.html', x: 3300, y: 1160, w: 390, h: 844, title: 'iOS · new chat sheet' },
    { file: 'AddProject.dc.html', x: 0, y: 2160, w: 640, h: 520, title: 'Add project · two intakes' },
    { file: 'CloneRepo.dc.html', x: 720, y: 2160, w: 600, h: 840, title: 'Clone from GitHub' },
    { file: 'ProjectsFolder.dc.html', x: 1400, y: 2160, w: 720, h: 440, title: 'Settings · projects folder' },
    { file: 'ProjectsHub.dc.html', x: 2200, y: 2160, w: 680, h: 460, title: 'Projects hub · host chip' },
    { file: 'VesselStage.dc.html', x: 0, y: 3160, w: 720, h: 540, title: 'Summoning · cloud vessel' },
    { file: 'HostChip.dc.html', x: 800, y: 3160, w: 560, h: 680, title: 'Host chip · receipts' },
    { file: 'CloudHosts.dc.html', x: 1440, y: 3160, w: 720, h: 740, title: 'Settings · cloud sandboxes' },
    { file: 'CreditsSketch.dc.html', x: 2240, y: 3160, w: 460, h: 560, title: 'Phase B · credits (sketch)' },
  ],
  annotations: [
    { id: 'build-order', x: 1040, y: 0, w: 360, text: 'HOW TO READ THIS CANVAS\nRow 1 is the context model (Stage 2 of the approved 2026-08-18 spec).\nRow 2 is project intake and the default projects folder.\nRow 3 is the cloud sandbox as a host.\n\nThe handoff spec with data-model changes, file map and acceptance criteria lives in the repo: docs/superpowers/specs/2026-09-02-context-projects-cloud-sandbox-design.md' },
    { id: 'row-context', x: 0, y: 1060, w: 720, text: '1 · CONTEXT — project first, familiar retained\nProject chooses the workspace. Crew chooses who. One acting familiar executes.\nStage 1 is shipped (rail switcher, acting-familiar gate, Home pilot). These frames are Stage 2: Chat, Tasks, Queue, Calendar and Code follow the shell project; a historical chat overrides visibly and never moves the shell; global surfaces say they ignore the project; deep links resolve project before familiar.' },
    { id: 'row-mobile', x: 3300, y: 1060, w: 390, text: 'iOS keeps its familiars-first Chats list. Project is a per-thread setting on the new-chat sheet, not a global filter. "Runs on" is where a phone-only operator meets the cloud sandbox.' },
    { id: 'row-projects', x: 0, y: 2060, w: 720, text: '2 · PROJECTS — any folder, one entity, two intakes, a default home\nA project stays a local directory, one per root; git is detected, never required. No separate route for GitHub repositories: Clone from GitHub is a second intake into ~/Coven/projects/<owner>/<repo>, created lazily and changeable in Settings. The registry gains a host field, local by default.' },
    { id: 'row-cloud', x: 0, y: 3060, w: 720, text: '3 · CLOUD SANDBOX — a host, not a project type\nDaytona is a fifth vessel in the Summoning Circle and a host in the chat host chip. Reuse the SSH transport with short-lived sandbox tokens. One sandbox per project, auto-stop when idle, auto-archive later; the cost is a receipt the operator always sees. Bring your own key first. Metered credits (Phase B) need an account and a broker: a separate service and a separate decision.' },
  ],
  launch: { view: 'canvas' },
};
writeFileSync('canvas.json', JSON.stringify(canvas, null, 2));
console.log('wrote canvas.json');
