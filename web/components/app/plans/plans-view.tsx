"use client";

/**
 * The plan screen (/plans): after onboarding, before the dashboard, for a
 * workspace with nothing to run on (docs/billing/access-codes.md, PLANS.md).
 *
 * One surface, one decision: three credit packs under their shader light,
 * the middle one recommended. "Have an invite or pilot code?" is a quiet
 * second way in that turns the screen into its own short flow (which kind,
 * enter it, what it unlocked) with the same StepFlow as sign-up, never a
 * dropdown. When credit arrives (a code, or Stripe's return), the first
 * piece the onboarding prepared is started and opened.
 */
import { ArrowRight, Check, Gift, Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { AgentGlyph, Input, Notice, NotAllowed, OptionList, PlanOption, Step, StepBack, StepFlow, StepLink, useStepFlow, WorkspaceLogo } from "@/design-system";
import { authClient } from "@/lib/auth/client";
import { PLAN_COPY, redeemErrorMessage, type BillingAccess, type CodeRedemption } from "@/lib/billing-access";

type View = "plans" | "kind" | "code" | "unlocked" | "confirming";
const ORDER: readonly View[] = ["plans", "kind", "code", "unlocked", "confirming"];
type Kind = "invite" | "pilot";

export interface PlansStart {
  /** The playbook onboarding created, whose first piece starts once there's credit. */
  nicheId: string | null;
  kind: "video" | "article" | null;
  /** Where to go when there is no piece to start (a same-site path). */
  next: string;
}

const PENDING_KEY = "marketer.plans.pending";

async function call<T>(path: string, init?: RequestInit): Promise<{ ok: true; data: T } | { ok: false; status: number; detail: string | null }> {
  try {
    const res = await fetch(`/api/proxy${path}`, { ...init, headers: { "content-type": "application/json", ...(init?.headers ?? {}) } });
    if (!res.ok) {
      let detail: string | null = null;
      try {
        const j = (await res.json()) as { detail?: unknown };
        detail = typeof j.detail === "string" ? j.detail : null;
      } catch {
        /* not JSON */
      }
      return { ok: false, status: res.status, detail };
    }
    return { ok: true, data: (res.status === 204 ? null : await res.json()) as T };
  } catch {
    return { ok: false, status: 0, detail: null };
  }
}

const money = (v: string | number) => {
  const n = Number(v);
  return Number.isInteger(n) ? `$${n}` : `$${n.toFixed(2)}`;
};

export function PlansView({ access, start, brand, email, purchase, ready }: { access: BillingAccess | null; start: PlansStart; brand: string; email: string; purchase?: "success" | "cancelled" | null; ready?: boolean }) {
  const router = useRouter();
  const flow = useStepFlow(ORDER, { initial: purchase === "success" || ready ? "confirming" : "plans" });
  const [kind, setKind] = useState<Kind>("invite");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(purchase === "cancelled" ? "Checkout was cancelled. Nothing was charged." : null);
  const [redeemed, setRedeemed] = useState<CodeRedemption | null>(null);
  const [confirmState, setConfirmState] = useState<"waiting" | "arrived" | "slow">(ready ? "arrived" : "waiting");
  const codeId = useId();
  const pending = useRef<PlansStart>(start);

  // Stripe sends the person back without our query: the piece to start was kept for the trip.
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(PENDING_KEY);
      if (raw && purchase) {
        const p = JSON.parse(raw) as PlansStart;
        if (p && typeof p.next === "string" && p.next.startsWith("/") && !p.next.startsWith("//")) pending.current = p;
      }
      if (purchase) sessionStorage.removeItem(PENDING_KEY);
    } catch {
      /* storage can be unavailable; the fallback is /home */
    }
  }, [purchase]);

  // After Stripe: the webhook credits the balance a moment later. Poll until it lands.
  useEffect(() => {
    if (flow.step !== "confirming" || confirmState !== "waiting") return;
    let tries = 0;
    let stop = false;
    const tick = async () => {
      if (stop) return;
      const r = await call<BillingAccess>("/api/v1/billing/access");
      if (stop) return;
      if (r.ok && !r.data.needs_plan) return setConfirmState("arrived");
      if (++tries >= 45) return setConfirmState("slow");
      window.setTimeout(tick, 2000);
    };
    void tick();
    return () => {
      stop = true;
    };
  }, [flow.step, confirmState]);

  /** Start the first piece (when onboarding prepared one) and open it; else go on. */
  const continueToProduct = useCallback(async () => {
    setBusy("continue");
    const p = pending.current;
    if (p.nicheId && p.kind) {
      const r = p.kind === "article" ? await call<{ id: string }>("/api/v1/articles", { method: "POST", body: JSON.stringify({ niche_id: p.nicheId, topic: "" }) }) : await call<{ id: string }>("/api/v1/jobs", { method: "POST", body: JSON.stringify({ niche_id: p.nicheId, platform: "tiktok" }) });
      if (r.ok && r.data?.id) {
        router.push(p.kind === "article" ? `/seo/${r.data.id}` : `/content/videos/${r.data.id}`);
        return;
      }
    }
    router.push(p.next || "/home");
  }, [router]);

  const checkout = async (pack: string) => {
    if (busy) return;
    setBusy(pack);
    setError(null);
    setNote(null);
    try {
      sessionStorage.setItem(PENDING_KEY, JSON.stringify(pending.current));
    } catch {
      /* fine: the return falls back to /home */
    }
    const r = await call<{ url: string }>("/api/v1/billing/checkout", { method: "POST", body: JSON.stringify({ pack, return_to: "plans" }) });
    if (r.ok) {
      try {
        const u = new URL(r.data.url);
        if (u.protocol === "https:") {
          window.location.assign(u.toString());
          return;
        }
      } catch {
        /* fall through */
      }
    }
    setBusy(null);
    setError(!r.ok && r.status === 503 ? "Checkout isn't available on this deployment yet." : !r.ok && r.status === 403 ? "Your role can't buy credit. Ask an owner or admin." : "Checkout didn't open. Try again in a moment.");
  };

  const redeem = async () => {
    if (busy) return;
    const value = code.trim();
    if (value.replace(/[^a-z0-9]/gi, "").length < 8) return setError("Enter the whole code, including the letters at the start.");
    setBusy("redeem");
    setError(null);
    const r = await call<CodeRedemption>("/api/v1/billing/redeem", { method: "POST", body: JSON.stringify({ code: value }) });
    setBusy(null);
    if (!r.ok) return setError(redeemErrorMessage(r.detail, r.status));
    setRedeemed(r.data);
    flow.go("unlocked", { lock: true });
  };

  const signOut = async () => {
    await authClient.signOut().catch(() => undefined);
    window.location.assign("/sign-in");
  };

  const canManage = Boolean(access?.can_manage);
  const packs = (access?.packs ?? []).filter((p) => PLAN_COPY[p.id]);
  const firstThing = pending.current.kind === "article" ? "first article" : "first video";
  const narrow = flow.step !== "plans";

  const view = (() => {
    switch (flow.step) {
      case "plans":
        return (
          <div>
            <div className="ds-stagger mx-auto max-w-[600px] text-center">
              <div className="inline-flex items-center gap-2 rounded-full border border-hairline bg-surface px-2.5 py-1 text-[12.5px] text-fg-muted">
                <WorkspaceLogo name={brand || "M"} size={16} />
                {brand || "Your workspace"} · playbook ready
              </div>
              <h1 className="mt-5 text-[30px] font-medium leading-[1.1] tracking-[-0.025em] outline-none sm:text-[34px]">Choose how to start</h1>
              <p className="mx-auto mt-3 max-w-[48ch] text-[15px] leading-relaxed text-fg-muted">
                Add a pack of credit and Marketer starts your {firstThing} right away. Pay once, no subscription. Credit never expires.
              </p>
            </div>
            {!access ? (
              <p className="mt-12 text-center text-[13.5px] text-fg-muted">Plans didn&apos;t load. Refresh the page in a moment.</p>
            ) : (
              <div className="ds-stagger mt-10 grid items-stretch gap-4 md:grid-cols-3">
                {packs.map((p) => {
                  const c = PLAN_COPY[p.id]!;
                  return (
                    <PlanOption
                      key={p.id}
                      palette={c.palette}
                      title={c.title}
                      headline={money(p.amount_usd)}
                      badge={c.recommended ? "Recommended" : undefined}
                      highlighted={c.recommended}
                      description={c.line}
                      features={[`${money(p.credit_usd)} of credit`, ...c.points]}
                      cta={{ label: busy === p.id ? "Opening checkout…" : `Add ${money(p.amount_usd)} of credit`, onClick: () => void checkout(p.id), loading: busy === p.id, disabled: !canManage || (busy !== null && busy !== p.id) }}
                      className={c.recommended ? "-order-1 md:order-none md:-my-2" : undefined}
                    />
                  );
                })}
              </div>
            )}
            <div className="mt-8 flex min-h-5 flex-col items-center gap-2 text-center">
              <Notice error={error} ok={note} />
              {!canManage && access && <NotAllowed>Owners, admins and billing members choose a pack. Ask one of them to add credit, then come back.</NotAllowed>}
            </div>
            {canManage && (
              <div className="mt-2 flex justify-center">
                <button type="button" onClick={() => (setError(null), setNote(null), flow.go("kind"))} className="ds-press group inline-flex items-center gap-2 rounded-full px-3.5 py-2 text-[14px] text-fg-muted hover:bg-surface-2 hover:text-fg">
                  <Gift className="size-4" /> Have an invite or pilot code?
                  <ArrowRight className="size-3.5 transition-transform duration-200 group-hover:translate-x-0.5" />
                </button>
              </div>
            )}
            <p className="mt-6 text-center text-[12px] text-fg-faint">Prices in US dollars. Checkout is secured by Stripe.</p>
          </div>
        );
      case "kind":
        return (
          <Step title="Which kind of code?" subtitle="Both add something to this workspace. Pick the one you were given." onSubmit={() => (setError(null), flow.go("code"))} primary={{ label: "Continue" }} secondary={<StepLink onClick={flow.back}>Back to plans</StepLink>}>
            <OptionList
              label="Which kind of code?"
              value={kind}
              onChange={setKind}
              options={[
                { id: "invite", label: "Invite code", detail: "From someone at Marketer, or a friend who uses it. Adds credit to start with.", icon: <Gift /> },
                { id: "pilot", label: "Pilot code", detail: "Your team is in a pilot with us. Opens the pilot and its credit.", icon: <Sparkles /> },
              ]}
            />
          </Step>
        );
      case "code":
        return (
          <Step
            title={kind === "invite" ? "Enter your invite code" : "Enter your pilot code"}
            subtitle={
              <>
                It looks like <span className="font-mono text-[14px] text-fg">{kind === "invite" ? "INV-7K2M-Q9XD-4T1B" : "PLT-3HVA-8WQE-K2NZ"}</span>. Dashes and capitals don&apos;t matter.
              </>
            }
            onSubmit={() => void redeem()}
            primary={{ label: "Redeem code", loading: busy === "redeem" }}
          >
            <label htmlFor={codeId} className="mb-2 block text-[13px] font-medium text-fg-muted">
              {kind === "invite" ? "Invite code" : "Pilot code"}
            </label>
            <Input
              id={codeId}
              inputSize="lg"
              value={code}
              onChange={(e) => (setCode(e.target.value.toUpperCase()), setError(null))}
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              maxLength={64}
              placeholder={kind === "invite" ? "INV-" : "PLT-"}
              aria-invalid={Boolean(error) || undefined}
              className="font-mono tracking-[0.08em]"
            />
            <div className="mt-3 min-h-5">
              <Notice error={error} />
            </div>
          </Step>
        );
      case "unlocked": {
        const r = redeemed;
        const until = r?.access_until ? new Date(r.access_until).toLocaleDateString(undefined, { day: "numeric", month: "long" }) : null;
        const credit = r && Number(r.credit_usd) > 0 ? money(r.credit_usd) : null;
        return (
          <Step
            eyebrow={<SuccessMark />}
            title={r?.kind === "pilot" ? "Your pilot is on" : "Code accepted"}
            subtitle={[credit ? `${credit} of credit is in your workspace.` : null, until ? `Your pilot runs until ${until}.` : null].filter(Boolean).join(" ") || "It's applied to this workspace."}
            onSubmit={() => void continueToProduct()}
            primary={{ label: pending.current.nicheId ? `Start my ${firstThing}` : "Open Marketer", loading: busy === "continue" }}
          />
        );
      }
      case "confirming":
        return confirmState === "arrived" ? (
          <Step eyebrow={<SuccessMark />} title={ready ? "You're all set" : "Credit added"} subtitle={ready ? "This workspace already has what it needs to run." : "Thanks. Your workspace is ready to make things."} onSubmit={() => void continueToProduct()} primary={{ label: pending.current.nicheId ? `Start my ${firstThing}` : "Open Marketer", loading: busy === "continue" }} />
        ) : confirmState === "slow" ? (
          <Step
            title="Your payment went through"
            subtitle="The credit is taking longer than usual to arrive. It will show up on its own; you can check again or carry on."
            onSubmit={() => setConfirmState("waiting")}
            primary={{ label: "Check again" }}
            secondary={<StepLink onClick={() => void continueToProduct()}>Open Marketer</StepLink>}
          />
        ) : (
          <Step title="Adding your credit" subtitle={<span className="ds-shimmer">Confirming the payment with Stripe…</span>} />
        );
    }
  })();

  return (
    <main className="flex min-h-dvh flex-col bg-ds-bg text-fg">
      <header className="flex h-16 shrink-0 items-center justify-between gap-3 px-5 sm:px-8">
        <span className="flex items-center gap-2 text-[14px] font-medium">
          <AgentGlyph size={22} /> Marketer
        </span>
        <span className="flex min-w-0 items-center gap-1 text-[12.5px] text-fg-muted">
          <span className="hidden truncate sm:inline">{email}</span>
          <button type="button" onClick={() => void signOut()} className="ds-press shrink-0 rounded-ds-sm px-2 py-1 hover:bg-surface-2 hover:text-fg">
            Sign out
          </button>
        </span>
      </header>
      <div className="flex flex-1 flex-col items-center px-4 pb-16 pt-6 sm:pt-[5vh]">
        <div className="w-full max-w-[1000px]">
          <StepFlow step={flow.step} direction={flow.direction}>
            {narrow ? (
              <div className="mx-auto max-w-[400px] pt-[4vh]">
                <div className="mb-6 h-8">
                  <StepBack flow={flow} />
                </div>
                {view}
              </div>
            ) : (
              view
            )}
          </StepFlow>
        </div>
      </div>
    </main>
  );
}

function SuccessMark() {
  return (
    <span className="ds-pop inline-flex size-10 items-center justify-center rounded-full bg-positive/15 text-positive" style={{ ["--origin" as string]: "center" }}>
      <Check className="size-5" strokeWidth={2.5} />
    </span>
  );
}
