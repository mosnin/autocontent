/**
 * <OnboardingFlow>: renders whatever screen the engine derives, using the screen recipes in
 * skills/onboarding-ui. Every product-specific surface (preview items, the rehearsal artifact,
 * the workspace card, copy) is a prop, so hosts customize content without forking layout.
 */
import { useMemo, useState, type ReactNode } from 'react';
import { isNoneOption, type ActivationState, type ContextGraph, type DashboardItem } from '../../core/src/index.ts';
import type { CapabilityDef } from '../../spec/src/index.ts';
import { useConnector, useIntent, useOnboardingEngine, useOnboardingKeys, useOnboardingState, useRehearsal, useScreen } from '../../react/src/index.tsx';
import {
  ActivityFeed,
  Button,
  ChipSelect,
  ConfirmFields,
  ConnectCard,
  DraftCard,
  ExampleCard,
  Frame,
  InviteFields,
  ItemList,
  OptionList,
  Page,
  SkeletonList,
  Task,
  WorkspaceCard,
  type FeedItem,
  type PreviewItem,
} from './components.tsx';
import { Icon } from './icons.tsx';

export interface WorkspaceSummary {
  name?: string;
  domain?: string;
  color?: string;
  rows: { icon: ReactNode; label: string; value?: string }[];
}

export interface OnboardingFlowProps {
  /** Product mark shown above the frame. */
  mark?: ReactNode;
  theme?: 'light' | 'dark';
  /** Map context to the workspace card in the preview. */
  workspace?: (ctx: ContextGraph) => WorkspaceSummary;
  /** Map activation output to preview rows (leads, ads, tickets…). */
  previewItems?: (capability: CapabilityDef, activation: ActivationState | undefined) => PreviewItem[];
  /** The real example the rehearsal is about. */
  renderExample?: (capability: CapabilityDef, example: unknown) => ReactNode;
  /** The generated artifact, re-rendered as decisions change. */
  renderArtifact?: (capability: CapabilityDef, example: unknown, decisions: Record<string, string>, ctx: ContextGraph) => ReactNode;
  /** Replace the default first dashboard (ActivityFeed). */
  renderDashboard?: (items: DashboardItem[], onAha: (proofId: string) => void) => ReactNode;
  /** Extra "What's changed" rows for the dashboard. */
  changes?: { metric: string; text: string }[];
}

const str = (v: unknown) => (typeof v === 'string' ? v : v === undefined || v === null ? '' : String(v));

function defaultWorkspace(ctx: ContextGraph): WorkspaceSummary {
  const name = str(ctx.businessName?.value || ctx.brokerage?.value || ctx.displayName?.value) || undefined;
  const website = str(ctx.website?.value);
  return {
    name,
    domain: website ? website.replace(/^https?:\/\//, '').replace(/\/$/, '') : undefined,
    rows: [
      { icon: <Icon.Clock size={18} />, label: 'Timezone', value: str(ctx.timezone?.value).split('/').pop()?.replace(/_/g, ' ') || undefined },
      ...(ctx.currency ? [{ icon: <Icon.Coins size={18} />, label: 'Currency', value: str(ctx.currency.value) }] : []),
    ],
  };
}

function defaultItems(_cap: CapabilityDef, a: ActivationState | undefined): PreviewItem[] {
  return (a?.result?.examples ?? []).slice(0, 4).map((e, i) => {
    const o = (e ?? {}) as Record<string, unknown>;
    const title = str(o.name ?? o.title ?? o.advertiser ?? o.term ?? `Item ${i + 1}`);
    return { id: String(i), title, subtitle: str(o.lastMessage ?? o.hook ?? o.subtitle) || undefined, meta: o.quietDays ? `${o.quietDays}d quiet` : o.runningDays ? `${o.runningDays} days` : undefined };
  });
}

export function OnboardingFlow(props: OnboardingFlowProps) {
  const state = useOnboardingState();
  const { screen } = useScreen();
  const ob = useOnboardingEngine();

  if (state.phase === 'complete' || screen.kind === 'handoff') {
    const items = ob.dashboard();
    const onAha = (proofId: string) => ob.aha(proofId);
    if (props.renderDashboard) return <div className="io-root" data-theme={props.theme}>{props.renderDashboard(items, onAha)}</div>;
    const feed: FeedItem[] = items.map((it, i) => ({
      id: `${it.kind}-${i}`,
      title: it.title,
      detail: it.detail,
      status: it.kind === 'proof' ? 'success' : it.kind === 'suggestion' ? 'question' : it.status === 'danger' ? 'danger' : 'warning',
      cta: it.cta ? { label: it.cta.label, onClick: it.kind === 'proof' ? () => onAha(state.proofs[i]!.proofId) : undefined } : undefined,
    }));
    return (
      <div className="io-root" data-theme={props.theme} style={{ minHeight: '100dvh', background: 'var(--io-bg)' }}>
        <ActivityFeed title="Activity" subtitle="What needs you, and what moved." items={feed} changes={props.changes} setup={setupSummary(ob)} />
      </div>
    );
  }

  return (
    <Page mark={props.mark} theme={props.theme}>
      {screen.kind === 'confirm' && <ConfirmScreen {...props} />}
      {screen.kind === 'intent' && <IntentScreen key={screen.id} questionId={screen.id.slice('intent:'.length)} {...props} />}
      {screen.kind === 'connect' && <ConnectScreen key={screen.id} connectorId={screen.connector!} capabilityId={screen.capability!} optional={!!screen.optional} {...props} />}
      {screen.kind === 'rehearsal' && <RehearsalScreen key={screen.id} capabilityId={screen.capability!} {...props} />}
      {screen.kind === 'invite' && <InviteScreen fields={screen.fields} {...props} />}
    </Page>
  );
}

/** Human-readable ledger for the handoff (RULES §7.2): what was connected and decided. */
function setupSummary(ob: ReturnType<typeof useOnboardingEngine>): { label: string; value: string }[] {
  const st = ob.getState();
  const rows: { label: string; value: string }[] = [];
  for (const [id, status] of Object.entries(st.connectors)) {
    if (status === 'verified') rows.push({ label: ob.spec.connectors.find((c) => c.id === id)?.name ?? id, value: 'Connected and scanning' });
  }
  for (const [capId, decisions] of Object.entries(st.decisions)) {
    const cap = ob.spec.capabilities.find((c) => c.id === capId);
    for (const d of cap?.rehearsal.decisions ?? []) {
      const opt = d.options.find((o) => o.id === decisions[d.id]);
      if (opt) rows.push({ label: d.prompt.replace(/\?$/, ''), value: opt.label });
    }
  }
  return rows;
}

// ── Screens ──────────────────────────────────────────────────────────────

/**
 * The live preview. `focus` says what matters on this screen: on phones only that part is shown,
 * and on desktop a content-focused preview collapses the workspace card to a compact header.
 */
function Preview({ props, children, focus = 'workspace' }: { props: OnboardingFlowProps; children?: ReactNode; focus?: 'workspace' | 'content' }) {
  const state = useOnboardingState();
  const ws = (props.workspace ?? defaultWorkspace)(state.context);
  return (
    <div className="io-pv" data-focus={focus}>
      <div className="io-pv-ws">
        <WorkspaceCard name={ws.name} domain={ws.domain} color={ws.color} rows={ws.rows} compact={focus === 'content'} />
      </div>
      {children && <div className="io-pv-content">{children}</div>}
    </div>
  );
}

const SOURCE_LABEL: Record<string, string> = {
  oauth_profile: 'from sign-in',
  email_domain: 'from your email',
  website: 'from your site',
  browser: 'from your device',
  icp: 'suggested',
  answer: 'edited',
};

function ConfirmScreen(props: OnboardingFlowProps) {
  const ob = useOnboardingEngine();
  const state = useOnboardingState();
  const { screen, canAdvance } = useScreen();
  const [edits, setEdits] = useState<Record<string, string>>({});
  // Show what we inferred, plus anything the spec asks on this screen. Fields that a connector or the
  // rehearsal will resolve later never appear here as empty "required" rows.
  const fields = screen.fields
    .map((id) => ob.spec.fields.find((f) => f.id === id)!)
    .filter((f) => f && (state.context[f.id]?.value !== undefined || f.askInContext?.on === 'confirm'))
    .map((f) => {
      const v = state.context[f.id];
      return { id: f.id, label: f.label, value: edits[f.id] ?? str(v?.value), source: edits[f.id] !== undefined ? 'edited' : v ? SOURCE_LABEL[v.source] ?? '' : undefined, placeholder: f.tier === 'blocking' ? 'Required' : 'Optional' };
    });
  const submit = () => {
    const changed = Object.fromEntries(Object.entries(edits).filter(([k, v]) => v !== str(state.context[k]?.value)));
    for (const [k, v] of Object.entries(changed)) if (!state.context[k]) ob.provide(k, v);
    ob.confirm(Object.fromEntries(Object.entries(changed).filter(([k]) => state.context[k])));
    if (ob.view().canAdvance) ob.next();
  };
  const missingRequired = fields.some((f) => {
    const def = ob.spec.fields.find((x) => x.id === f.id);
    return !f.value && def?.tier === 'blocking' && def.askInContext?.on === 'confirm';
  });
  useOnboardingKeys({ onEnter: () => !missingRequired && submit() });
  return (
    <Frame
      label="Confirm your details"
      task={
        <Task
          title="Is this you?"
          subtitle="We filled this in from your sign-in and website. Change anything that’s off."
          footer={<Button full onClick={submit} disabled={missingRequired && !canAdvance}>Looks right</Button>}
        >
          <ConfirmFields fields={fields} onChange={(id, v) => setEdits((e) => ({ ...e, [id]: v }))} />
        </Task>
      }
      preview={<Preview props={props} />}
    />
  );
}

function IntentScreen({ questionId, ...props }: OnboardingFlowProps & { questionId: string }) {
  const ob = useOnboardingEngine();
  const intent = useIntent(questionId);
  const chips = intent.options.map((o) => ({ id: o.id, label: o.label, icon: o.icon }));
  const [other, setOther] = useState('');
  const [busy, setBusy] = useState(false);
  const [unmatched, setUnmatched] = useState(false);
  // Free text is optional (RULES §2.2): mapped onto the options by the decision model, or by label matching.
  const submit = async () => {
    const text = other.trim();
    if (!intent.selected.length && !text) return;
    let ids = intent.selected;
    if (text) {
      setBusy(true);
      const mapped = await ob.interpretOther(questionId, text);
      setBusy(false);
      if (!mapped.length && !ids.length) return setUnmatched(true);
      const keep = mapped.length ? ids.filter((id) => !isNoneOption(intent.question.options.find((o) => o.id === id)!)) : ids;
      ids = [...new Set([...keep, ...mapped])];
      if (intent.question.kind === 'single') ids = ids.slice(-1);
    }
    ob.answer(questionId, ids, text || undefined);
    ob.next();
  };
  useOnboardingKeys({ onNumber: (n) => chips[n - 1] && intent.toggle(chips[n - 1]!.id), onEnter: () => void submit() });
  const chosen = intent.options.filter((o) => intent.selected.includes(o.id) && o.capabilities.length);
  return (
    <Frame
      label={intent.question.prompt}
      task={
        <Task
          title={intent.question.prompt}
          subtitle={intent.question.hint}
          footer={<Button full onClick={() => void submit()} disabled={busy || (!intent.selected.length && !other.trim())}>{busy ? <><span className="io-spinner" /> Reading your answer…</> : 'Continue'}</Button>}
        >
          <ChipSelect label={intent.question.prompt} options={chips} selected={intent.selected} onToggle={intent.toggle} />
          {unmatched ? (
            <div className="io-hint"><Icon.Info2 size={14} /> I couldn’t match that to an option. Pick the closest one above.</div>
          ) : intent.preselected.length > 0 && <div className="io-hint"><Icon.Sparkle size={14} /> Pre-selected from your site and sign-in</div>}
          {intent.question.allowOther && (
            <input
              id={`io-other-${questionId}`}
              className="io-input"
              placeholder="Something else? Describe it"
              aria-label="Other answer"
              value={other}
              onChange={(e) => { setOther(e.target.value); setUnmatched(false); }}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void submit(); } }}
            />
          )}
        </Task>
      }
      preview={
        <Preview props={props}>
          <div>
            <div className="io-section-label" style={{ marginBottom: 12 }}>Connected tools</div>
            {chosen.length ? (
              <div className="io-skel-group">
                {chosen.map((o) => (
                  <div className="io-skel-row io-enter" key={o.id}>
                    <span className="io-label" style={{ width: 110, color: 'var(--io-text)' }}>{o.label}</span>
                    <span className="io-skel-bar" style={{ flex: 1 }} />
                  </div>
                ))}
              </div>
            ) : (
              <SkeletonList />
            )}
          </div>
        </Preview>
      }
    />
  );
}

function ConnectScreen({ connectorId, capabilityId, optional, ...props }: OnboardingFlowProps & { connectorId: string; capabilityId: string; optional: boolean }) {
  const ob = useOnboardingEngine();
  const c = useConnector(connectorId, capabilityId);
  const { canAdvance } = useScreen();
  const icon = ob.spec.intents.flatMap((q) => q.options).find((o) => o.capabilities.includes(capabilityId))?.icon;
  const live = c.activation?.status === 'done' && c.activation.result
    ? { label: 'Done.', count: Number(c.activation.result.values.count ?? 0) }
    : c.activation?.progress
      ? { label: c.activation.progress.label, count: c.activation.progress.found }
      : c.status === 'verified'
        ? { label: 'Starting…' }
        : undefined;
  const items = (props.previewItems ?? defaultItems)(c.capability!, c.activation);
  const primaryAction = () => (c.status === 'verified' ? canAdvance && ob.next() : void c.connect());
  useOnboardingKeys({ onEnter: primaryAction, onEscape: () => optional && ob.skip() });
  return (
    <Frame
      label={`Connect ${c.connector.name}`}
      task={
        <Task
          title={optional ? `Add ${c.connector.name} too?` : `Connect ${c.connector.name}`}
          subtitle={c.capability?.activation.description}
          footer={
            c.status === 'verified' ? (
              <Button full onClick={() => ob.next()} disabled={!canAdvance}>Continue</Button>
            ) : optional ? (
              <Button full variant="ghost" onClick={() => ob.skip()}>Skip for now</Button>
            ) : c.status === 'failed' && canAdvance ? (
              <Button full variant="ghost" onClick={() => ob.skip()}>Continue without {c.connector.name}</Button>
            ) : undefined
          }
        >
          <ConnectCard name={c.connector.name} icon={icon} purpose={c.capability?.label ?? ''} scopes={c.connector.scopes} state={c.status} live={live} onConnect={() => void c.connect()} />
        </Task>
      }
      preview={
        <Preview props={props} focus={c.status === 'verified' ? 'content' : 'workspace'}>
          {items.length ? <ItemList items={items} label={c.capability?.label} /> : (
            <div>
              <div className="io-section-label" style={{ marginBottom: 12 }}>{c.capability?.label}</div>
              <SkeletonList rows={4} />
            </div>
          )}
        </Preview>
      }
    />
  );
}

function RehearsalScreen({ capabilityId, ...props }: OnboardingFlowProps & { capabilityId: string }) {
  const ob = useOnboardingEngine();
  const state = useOnboardingState();
  const r = useRehearsal(capabilityId);
  const { canAdvance, blockedBy } = useScreen();
  const decisions = r.capability.rehearsal.decisions;
  const [focus, setFocus] = useState(0);
  const example = r.example as Record<string, unknown> | undefined;
  const proof = state.proofs.find((p) => p.capability === capabilityId);
  useOnboardingKeys({
    onNumber: (n) => {
      const d = decisions[focus];
      if (d?.options[n - 1]) {
        r.decide(d.id, d.options[n - 1]!.id);
        if (focus < decisions.length - 1) setFocus(focus + 1);
      }
    },
    onEnter: () => canAdvance && ob.next(),
  });
  const exampleNode = props.renderExample
    ? props.renderExample(r.capability, r.example)
    : example
      ? <ExampleCard title={str(example.name ?? example.advertiser ?? example.title)} quote={str(example.lastMessage ?? example.hook) || undefined} meta={example.quietDays ? `${example.quietDays}d quiet` : example.runningDays ? `${example.runningDays} days` : undefined} />
      : <div className="io-card-raised io-example"><SkeletonList rows={2} /></div>;
  const artifact = props.renderArtifact
    ? props.renderArtifact(r.capability, r.example, r.decisions, state.context)
    : <DraftCard label={r.capability.rehearsal.artifact} body={decisions.map((d) => `${d.prompt} ${d.options.find((o) => o.id === r.decisions[d.id])?.label}`).join('\n')} />;
  return (
    <Frame
      label="Rehearsal"
      task={
        <Task
          title={proof ? proof.statement : 'Finding your first results…'}
          subtitle={`Here’s ${r.capability.rehearsal.example}. Make the calls once; I’ll handle the rest the same way.`}
          footer={
            <>
              <Button full onClick={() => ob.next()} disabled={!canAdvance}>Looks good</Button>
              {!canAdvance && blockedBy && <div className="io-hint" style={{ justifyContent: 'center' }}><span className="io-spinner" /> {blockedBy}</div>}
            </>
          }
        >
          {exampleNode}
          {decisions.map((d, i) => (
            <div className="io-decision" key={d.id} onFocus={() => setFocus(i)}>
              <div className="io-label">{d.prompt}</div>
              <OptionList label={d.prompt} options={d.options} value={r.decisions[d.id]} onChange={(o) => { r.decide(d.id, o); setFocus(Math.min(i + 1, decisions.length - 1)); }} />
            </div>
          ))}
        </Task>
      }
      preview={<Preview props={props} focus="content">{artifact}</Preview>}
    />
  );
}

function InviteScreen({ fields, ...props }: OnboardingFlowProps & { fields: string[] }) {
  const ob = useOnboardingEngine();
  const [emails, setEmails] = useState<string[]>([]);
  const field = fields[0];
  const submit = () => {
    if (field) ob.provide(field, emails);
    ob.next();
  };
  const cursors = useMemo(() => emails.slice(0, 3), [emails]);
  const colors = ['#5B5BD6', '#3E9BE9', '#E5484D'];
  return (
    <Frame
      label="Invite your team"
      task={
        <Task title="Who else is on your team?" subtitle="They’ll get leads routed to them from day one." footer={<Button full onClick={submit} disabled={!emails.length}>Invite</Button>}>
          <InviteFields emails={emails} onChange={setEmails} />
        </Task>
      }
      preview={
        <Preview props={props}>
          <div style={{ position: 'relative', flex: 1, minHeight: 160 }}>
            {cursors.map((e, i) => (
              <div className="io-cursor" key={e + i} style={{ left: `${18 + i * 22}%`, top: `${20 + (i % 2) * 34}%` }}>
                <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M1 1l12 5-5 1.5L6.5 13z" fill={colors[i]} /></svg>
                <span className="io-cursor-tag" style={{ background: colors[i] }}>{e}</span>
              </div>
            ))}
          </div>
        </Preview>
      }
    />
  );
}
