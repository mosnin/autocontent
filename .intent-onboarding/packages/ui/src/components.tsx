/**
 * Presentational primitives. Pure props → markup; no engine access. Each maps to a reference
 * screen in design/references (see DESIGN.md §3).
 */
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Icon, Mark } from './icons.tsx';

const cx = (...c: (string | false | undefined | null)[]) => c.filter(Boolean).join(' ');

// ── Layout ───────────────────────────────────────────────────────────────

export function Page({ children, mark, theme }: { children: ReactNode; mark?: ReactNode; theme?: 'light' | 'dark' }) {
  return (
    <div className="io-root io-page" data-theme={theme}>
      <div style={{ width: '100%', maxWidth: 'var(--io-frame-max)' }}>
        {mark && <div className="io-mark-top">{mark}</div>}
        {children}
      </div>
    </div>
  );
}

/** The split frame (DESIGN D4): task on the left, live preview on the right. */
export function Frame({ task, preview, label }: { task: ReactNode; preview: ReactNode; label?: string }) {
  return (
    <section className="io-frame" aria-label={label}>
      <div className="io-task">{task}</div>
      <div className="io-preview" aria-hidden="true">
        <div className="io-preview-inner">
          <div className="io-preview-sheet">{preview}</div>
        </div>
      </div>
    </section>
  );
}

export function Task({ title, subtitle, children, footer }: { title: ReactNode; subtitle?: ReactNode; children?: ReactNode; footer?: ReactNode }) {
  return (
    <>
      <div className="io-task-body io-enter">
        <header>
          <h1 className="io-title">{title}</h1>
          {subtitle && <p className="io-subtitle">{subtitle}</p>}
        </header>
        {children}
      </div>
      {footer && <div className="io-task-footer">{footer}</div>}
    </>
  );
}

// ── Controls ─────────────────────────────────────────────────────────────

export function Button({
  variant = 'primary',
  size,
  full,
  pill,
  className,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'ghost'; size?: 'sm'; full?: boolean; pill?: boolean }) {
  return <button type="button" className={cx('io-btn', `io-btn-${variant}`, size === 'sm' && 'io-btn-sm', full && 'io-btn-full', pill && 'io-btn-pill', className)} {...rest} />;
}

export interface ChipOption {
  id: string;
  label: string;
  icon?: string;
  iconNode?: ReactNode;
}

/** Pill chips with brand marks; selected = accent ring (ref 02). Number keys map to position. */
export function ChipSelect({ options, selected, onToggle, label }: { options: ChipOption[]; selected: string[]; onToggle: (id: string) => void; label: string }) {
  return (
    <div className="io-chips" role="group" aria-label={label}>
      {options.map((o, i) => (
        <button key={o.id} type="button" className="io-chip" aria-pressed={selected.includes(o.id)} onClick={() => onToggle(o.id)}>
          <Mark name={o.icon} icon={o.iconNode} size={20} />
          <span>{o.label}</span>
          {i < 9 && <span className="io-chip-key" aria-hidden="true">{i + 1}</span>}
        </button>
      ))}
    </div>
  );
}

/** Numbered rows, keys 1–9 (ref 08). */
export function OptionList({ options, value, onChange, label }: { options: { id: string; label: string }[]; value?: string; onChange: (id: string) => void; label: string }) {
  return (
    <div className="io-options" role="radiogroup" aria-label={label}>
      {options.map((o, i) => (
        <button key={o.id} type="button" role="radio" aria-checked={value === o.id} className="io-option" onClick={() => onChange(o.id)}>
          <span className="io-option-key" aria-hidden="true">{i + 1}</span>
          <span>{o.label}</span>
        </button>
      ))}
    </div>
  );
}

// ── Confirm (ref 02 right) ───────────────────────────────────────────────

export function WorkspaceCard({ name, domain, initial, color, rows, compact }: { name?: string; domain?: string; initial?: string; color?: string; rows: { icon: ReactNode; label: string; value?: string }[]; compact?: boolean }) {
  return (
    <div className="io-workspace" data-compact={compact || undefined}>
      {name ? (
        <div className="io-logo-tile io-enter" style={{ background: color ?? '#D8F25C' }}>{initial ?? name.charAt(0)}</div>
      ) : (
        <div className="io-logo-tile" style={{ background: 'var(--io-skeleton)' }} />
      )}
      <div>
        {name ? <div className="io-ws-name io-enter">{name}</div> : <div className="io-skel-bar" style={{ width: 140, height: 14 }} />}
        <div className="io-ws-meta" style={{ marginTop: 6 }}>
          <Icon.Globe size={16} />
          {domain ? <span className="io-enter">{domain}</span> : <span className="io-skel-bar" style={{ width: 110 }} />}
        </div>
      </div>
      <div className="io-rows">
        {rows.map((r) => (
          <div className="io-row" key={r.label}>
            {r.icon}
            <span>{r.label}</span>
            {r.value ? <span className="io-row-value io-enter">{r.value}</span> : <span className="io-skel-bar" style={{ width: 56, marginLeft: 'auto' }} />}
          </div>
        ))}
      </div>
    </div>
  );
}

export interface EditableField {
  id: string;
  label: string;
  value: string;
  source?: string;
  placeholder?: string;
}

/** Inferred facts as editable rows. Typing in a row is a correction. */
export function ConfirmFields({ fields, onChange }: { fields: EditableField[]; onChange: (id: string, value: string) => void }) {
  return (
    <div className="io-fields">
      {fields.map((f) => (
        <label className="io-field" key={f.id}>
          <span className="io-field-label">{f.label}</span>
          <input className="io-field-input" value={f.value} placeholder={f.placeholder} onChange={(e) => onChange(f.id, e.target.value)} />
          {f.source && <span className="io-field-source">{f.source}</span>}
        </label>
      ))}
    </div>
  );
}

// ── Connect (refs 09, 12) ────────────────────────────────────────────────

export type ConnectState = 'idle' | 'authorizing' | 'verifying' | 'verified' | 'failed' | 'skipped';

export function ConnectCard({
  name,
  icon,
  purpose,
  scopes,
  state,
  live,
  onConnect,
}: {
  name: string;
  icon?: string;
  purpose: string;
  scopes: { id: string; description: string; access: 'read' | 'write' }[];
  state: ConnectState;
  live?: { label: string; count?: number };
  onConnect: () => void;
}) {
  return (
    <div className="io-connect">
      <div className="io-connect-head">
        <Mark name={icon} size={44} />
        <div style={{ minWidth: 0 }}>
          <div className="io-connect-name">{name}</div>
          {state === 'verified' ? (
            <span className="io-connected io-enter"><Icon.CheckCircle size={16} /> Connected</span>
          ) : (
            <div className="io-label">{purpose}</div>
          )}
        </div>
      </div>

      <div className="io-scopes">
        {scopes.map((s) => (
          <div className="io-scope" key={s.id}>
            <span className="io-check" aria-hidden="true"><Icon.Check size={12} /></span>
            <div>
              <div className="io-scope-title">{s.description}</div>
              <div className="io-scope-desc">{s.access === 'read' ? 'Read only' : 'Only the way you choose in the next step'}</div>
            </div>
          </div>
        ))}
      </div>

      {state === 'verified' || state === 'failed' ? (
        <div className="io-live io-enter" aria-live="polite">
          {state === 'failed' ? (
            <>
              <span className="io-status-danger"><Icon.Alert size={16} /></span>
              <span>{name} didn't connect. Try again.</span>
            </>
          ) : live ? (
            <>
              <span className="io-pulse" />
              <span>{live.label}</span>
              {live.count !== undefined && live.count > 0 && <span className="io-live-count">{live.count} found</span>}
            </>
          ) : null}
        </div>
      ) : null}

      {state !== 'verified' && (
        <Button full onClick={onConnect} disabled={state === 'authorizing' || state === 'verifying'}>
          {state === 'authorizing' ? (<><span className="io-spinner" /> Waiting for {name}…</>) : state === 'verifying' ? (<><span className="io-spinner" /> Verifying…</>) : state === 'failed' ? `Reconnect ${name}` : `Connect ${name}`}
        </Button>
      )}
    </div>
  );
}

// ── Skeleton ─────────────────────────────────────────────────────────────

export function SkeletonList({ rows = 3, widths = [78, 92, 64] }: { rows?: number; widths?: number[] }) {
  return (
    <div className="io-skel-group" aria-hidden="true">
      {Array.from({ length: rows }, (_, i) => (
        <div className="io-skel-row" key={i}>
          <span className="io-skel-dot" />
          <span className="io-skel-bar" style={{ width: `${widths[i % widths.length]}%` }} />
        </div>
      ))}
    </div>
  );
}

// ── Items (preview list of real things: leads, ads) ──────────────────────

export interface PreviewItem {
  id: string;
  title: string;
  subtitle?: string;
  meta?: string;
  initials?: string;
}

export function ItemList({ items, label }: { items: PreviewItem[]; label?: string }) {
  return (
    <div>
      {label && <div className="io-section-label" style={{ marginBottom: 4 }}>{label}</div>}
      <div className="io-items">
        {items.map((it, i) => (
          <div className="io-item" key={it.id} style={{ animationDelay: `${i * 60}ms` }}>
            <span className="io-avatar">{it.initials ?? it.title.slice(0, 2).toUpperCase()}</span>
            <div style={{ minWidth: 0 }}>
              <div className="io-item-title">{it.title}</div>
              {it.subtitle && <div className="io-item-sub">{it.subtitle}</div>}
            </div>
            {it.meta && <span className="io-item-meta">{it.meta}</span>}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Rehearsal ────────────────────────────────────────────────────────────

export function ExampleCard({ title, quote, meta, initials }: { title: string; quote?: string; meta?: string; initials?: string }) {
  return (
    <div className="io-card-raised io-example">
      <span className="io-avatar">{initials ?? title.slice(0, 2).toUpperCase()}</span>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
          <span className="io-item-title">{title}</span>
          {meta && <span className="io-item-meta">{meta}</span>}
        </div>
        {quote && <div className="io-quote">“{quote}”</div>}
      </div>
    </div>
  );
}

export function DraftCard({ label, body, signature }: { label: string; body: string; signature?: string }) {
  return (
    <div className="io-card io-draft">
      <div className="io-draft-label"><Icon.Sparkle size={14} /> {label}</div>
      <div className="io-draft-body">
        {body}
        {signature && <><br /><br /><span className="io-signature">{signature}</span></>}
      </div>
    </div>
  );
}

// ── Dashboard: activity feed (ref 01) ────────────────────────────────────

export interface FeedItem {
  id: string;
  title: string;
  detail?: string;
  status?: 'info' | 'warning' | 'danger' | 'success' | 'question';
  cta?: { label: string; onClick?: () => void };
}

const STATUS_ICON = {
  info: <Icon.Info size={18} />,
  warning: <Icon.Warning size={18} />,
  danger: <Icon.Alert size={18} />,
  success: <Icon.CheckCircle size={18} />,
  question: <Icon.Question size={18} />,
};

export function ActivityFeed({ title, subtitle, items, changes, setup }: { title: string; subtitle?: string; items: FeedItem[]; changes?: { metric: string; text: string }[]; setup?: { label: string; value: string }[] }) {
  return (
    <div className="io-dash">
      <header>
        <h1 className="io-dash-title">{title}</h1>
        {subtitle && <p className="io-subtitle">{subtitle}</p>}
      </header>
      <section className="io-panel" aria-label="Needs your input">
        <div className="io-panel-head">{items.length === 1 ? '1 item needs your input' : `${items.length} items need your input`}</div>
        <div className="io-panel-body">
          {items.map((it, i) => (
            <div className="io-feed-item" key={it.id} style={{ animationDelay: `${i * 70}ms` }}>
              <span className={cx('io-status', `io-status-${it.status === 'question' ? 'info' : it.status ?? 'info'}`)}>{STATUS_ICON[it.status ?? 'info']}</span>
              <div>
                <div className="io-feed-title">{it.title}</div>
                {it.detail && <div className="io-feed-detail">{it.detail}</div>}
              </div>
              {it.cta && <Button size="sm" variant={i === 0 ? 'primary' : 'secondary'} onClick={it.cta.onClick}>{it.cta.label}</Button>}
            </div>
          ))}
        </div>
      </section>
      {changes && changes.length > 0 && (
        <section className="io-panel" aria-label="What's changed">
          <div className="io-panel-head">What’s changed</div>
          <div className="io-panel-body io-changes">
            {changes.map((c) => (
              <div className="io-change" key={c.metric}>
                <span className="io-change-metric">{c.metric}</span>
                <span className="io-change-text">{c.text}</span>
              </div>
            ))}
          </div>
        </section>
      )}
      {setup && setup.length > 0 && (
        <section className="io-panel" aria-label="What I set up">
          <div className="io-panel-head">What I set up</div>
          <div className="io-panel-body io-changes">
            {setup.map((c) => (
              <div className="io-change" key={c.label}>
                <span className="io-change-metric">{c.label}</span>
                <span className="io-change-text">{c.value}</span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

// ── Invite (ref 11) ──────────────────────────────────────────────────────

export function InviteFields({ emails, onChange, max = 3 }: { emails: string[]; onChange: (emails: string[]) => void; max?: number }) {
  const rows = [...emails, ...Array(Math.max(0, max - emails.length)).fill('')].slice(0, max);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {rows.map((e, i) => (
        <input key={i} className="io-input" type="email" placeholder="name@company.com" value={e} onChange={(ev) => {
          const next = [...rows];
          next[i] = ev.target.value;
          onChange(next.filter(Boolean));
        }} />
      ))}
      <div className="io-hint"><Icon.Info2 size={14} /> Max {max}. You can add more later.</div>
    </div>
  );
}
