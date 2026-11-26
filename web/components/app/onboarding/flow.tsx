"use client";

/**
 * Marketer's onboarding (intent-driven; spec in /onboarding/spec.ts, doctrine
 * in .intent-onboarding/RULES.md and DESIGN.md). Split frame: one question at a
 * time on the left (the design system's StepFlow: direction-aware travel,
 * focus moves with it, Enter continues, Esc and browser Back go back), their
 * workspace taking shape on the right. Activation starts as soon as we know
 * enough and keeps running while they answer; outbound posting waits for the
 * rehearsal decision (R4.4). The dashboard opens on the same object the last
 * screen showed (R5.3); a workspace with nothing to run on passes through the
 * plan screen first, which starts that object.
 */

import { Check, Clapperboard, FileText, Globe, Megaphone, Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type Ref } from "react";
import { AgentGlyph, Button, Callout, CommitWave, Field, GlassCard, IconTile, Input, Kbd, OptionList, Segmented, Shader, StatusBadge, Step, StepBack, StepFlow, StepLink, StepMark, StepProgress, Textarea, useStepFlow, WorkspaceLogo } from "@/design-system";
import { decideWithin, type DecisionQuestion } from "../../../../.intent-onboarding/packages/core/src/decisions.ts";
import { httpDecisions } from "../../../../.intent-onboarding/packages/decisions-jev/src/http.ts";
import { authClient } from "@/lib/auth/client";

export interface OnboardingProps {
  email: string;
  displayName: string;
  /** Inferred from the email domain (null for personal domains). */
  inferredBrand: string | null;
  inferredWebsite: string | null;
  /** Saved brand kit, if any (takes precedence over inference). */
  savedBrand: string | null;
  channelsConnected: boolean;
  /** The workspace onboarding created; renamed to the brand when the person confirms it. Null in previews. */
  workspaceId?: string | null;
  /**
   * The workspace has nothing to run on yet (billing on, no credit, no code).
   * The playbook is still drafted and saved; the last step goes to the plan
   * screen (/plans), which starts the first piece once there's credit.
   */
  needsPlan?: boolean;
}

type Intent = "short_video" | "blog" | "ads" | "nothing_yet";

interface Draft {
  title: string;
  description: string;
  target_audience: string;
  hashtags: string[];
  visual_style: string;
  voice: string;
  target_duration_sec: number;
  scene_count: number;
  image_quality?: string;
  video_resolution?: string;
  scene_max_duration_sec?: number;
  tts_style_directions?: string;
  character_description?: string;
}

const INTENTS: { id: Intent; label: string; icon: ReactNode; detail: string }[] = [
  { id: "short_video", label: "I post short videos", icon: <Clapperboard />, detail: "TikTok, Reels, Shorts" },
  { id: "blog", label: "I write articles for search", icon: <FileText />, detail: "Blog and SEO" },
  { id: "ads", label: "I run paid ads", icon: <Megaphone />, detail: "Google and Meta" },
  { id: "nothing_yet", label: "I don't do much yet", icon: <Sparkles />, detail: "Start with the least setup" },
];

const STEPS: Record<string, string> = {
  queued: "Queued",
  ideating: "Finding the hook",
  scripting: "Writing the script",
  generating_images: "Drawing the scenes",
  animating: "Animating",
  voicing: "Recording the voiceover",
  editing: "Editing",
  captioning: "Adding captions",
  qa: "Checking quality",
  scheduling: "Scheduling",
  awaiting_approval: "Ready for your review",
  done: "Done",
  failed: "Needs a retry",
};
const ORDER = ["queued", "ideating", "scripting", "generating_images", "animating", "voicing", "editing", "captioning", "qa", "awaiting_approval"];

// ---------------------------------------------------------------- decisions
// Decision point 7 (onboarding pre-selection). The browser never holds a model key: it asks our own route, which
// calls the decision model server-side (app/api/onboarding/decisions/route.ts). Same questions, threshold and
// timeout as the engine's scorePreselection (.intent-onboarding/packages/core/src/engine.ts). On a timeout, an
// error, shadow mode or no key, the spec's preselectWhen rule stands (short video, the ICP majority).
const decisions = httpDecisions("/api/onboarding/decisions");
const ATTENTION_PROMPT = "How do you get attention today?";
/** Engine CONFIRM_THRESHOLD: a model pick needs this probability to replace the rule's default. */
const PRESELECT_THRESHOLD = 0.8;
const DECISION_TIMEOUT_MS = 1500;

async function preselectIntent(state: { brand: string; website: string; emailDomain: string | null }): Promise<Intent | null> {
  const options = INTENTS.filter((o) => o.id !== "nothing_yet"); // never pre-select "I don't do much yet"
  const questions: Record<string, DecisionQuestion> = Object.fromEntries(
    options.map((o) => [`attention__${o.id}`, { type: "yesno", instructions: `${ATTENTION_PROMPT} Based on what we know about this business, is "${o.label}" part of the answer?` } satisfies DecisionQuestion]),
  );
  // What the model sees: the business and the email domain, never the person's name or full email.
  const businessState = { business: { brandName: state.brand, website: state.website || null }, website_summary: null, detected_on_website: [], email_domain: state.emailDomain, signed_in_with: [] };
  const r = await decideWithin(decisions, businessState, questions, DECISION_TIMEOUT_MS);
  if (!r.answers) return null;
  const scored = options.map((o) => ({ id: o.id, p: (r.answers?.[`attention__${o.id}`] as { probability?: number } | undefined)?.probability ?? 0 })).sort((a, b) => b.p - a.p);
  return scored[0] && scored[0].p >= PRESELECT_THRESHOLD ? scored[0].id : null;
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api/proxy${path}`, { ...init, headers: { "content-type": "application/json", ...(init?.headers ?? {}) } });
  if (!res.ok) {
    const text = await res.text();
    const err = new Error(text.slice(0, 200) || `HTTP ${res.status}`) as Error & { status: number };
    err.status = res.status;
    throw err;
  }
  return (res.status === 204 ? null : res.json()) as Promise<T>;
}

function tz() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}


type Screen = "confirm" | "intent" | "offer" | "connect" | "rehearsal";
const SCREENS: readonly Screen[] = ["confirm", "intent", "offer", "connect", "rehearsal"];
const needsConnect = (i: Intent) => i === "short_video" || i === "ads";

export function OnboardingFlow(props: OnboardingProps) {
  const router = useRouter();
  const flow = useStepFlow(SCREENS);
  const screen = flow.step;
  const [brand, setBrand] = useState(props.savedBrand ?? props.inferredBrand ?? "");
  const [website, setWebsite] = useState(props.inferredWebsite ?? "");
  const [editing, setEditing] = useState(!(props.savedBrand ?? props.inferredBrand));
  // Rule default (spec preselectWhen: ICP majority posts short video); the decision model may refine it once.
  const [intent, setIntentState] = useState<Intent>("short_video");
  const intentTouched = useRef(false);
  const preselectStarted = useRef(false);
  const setIntent = useCallback((v: Intent) => {
    intentTouched.current = true;
    setIntentState(v);
  }, []);
  const [offer, setOffer] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [drafting, setDrafting] = useState(false);
  const [nicheId, setNicheId] = useState<string | null>(null);
  const [pieceId, setPieceId] = useState<string | null>(null);
  const [pieceStatus, setPieceStatus] = useState<string | null>(null);
  const [hook, setHook] = useState<string | null>(null);
  const [activationError, setActivationError] = useState<string | null>(null);
  const [connected, setConnected] = useState(props.channelsConnected);
  const [connecting, setConnecting] = useState(false);
  const [approvalMode, setApprovalMode] = useState<"approve" | "auto">("approve");
  const [cadence, setCadence] = useState<"daily" | "twice">("daily");
  const [finishing, setFinishing] = useState(false);
  // The hand-off (WAVE.md "arrive"): the last button sends one wave from the brand mark, then the product opens.
  // A workspace with nothing to run on goes to the plan screen instead, without the wave (nothing is ready yet).
  const [arrived, setArrived] = useState(false);
  const dest = useRef<string | null>(null);
  const logo = useRef<HTMLSpanElement>(null);
  const openProduct = useCallback(() => {
    const to = dest.current;
    dest.current = null;
    if (to) router.push(to);
  }, [router]);
  const started = useRef(false);

  const domain = website.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  const order: Screen[] = needsConnect(intent) ? ["confirm", "intent", "offer", "connect", "rehearsal"] : ["confirm", "intent", "offer", "rehearsal"];

  // ---------------------------------------------------------------- activation
  // Starts once brand + offer are known (end of the offer step) and runs in
  // the background while the person connects channels (R4.2, R6.3). Without
  // credits, the playbook is still drafted and saved (the proof); the first
  // piece starts from the plan screen once there's something to run on.
  const activate = useCallback(
    async (chosen: Intent, sentence: string) => {
      if (started.current) return;
      started.current = true;
      setDrafting(true);
      setActivationError(null);
      let d: Draft;
      try {
        d = await call<Draft>("/api/v1/niches/draft", { method: "POST", body: JSON.stringify({ description: `${sentence}${brand ? ` (brand: ${brand})` : ""}` }) });
      } catch {
        // Never dead-end: fall back to a sensible playbook from the sentence.
        d = { title: brand || "My playbook", description: sentence, target_audience: "People who'd love " + sentence.toLowerCase(), hashtags: [], visual_style: "Clean, bright, real-world footage with bold captions", voice: "nova", target_duration_sec: 30, scene_count: 5 };
      }
      setDraft(d);
      setDrafting(false);
      if (chosen === "ads") return; // paid activation is read-only and happens on connect
      try {
        const niche = await call<{ id: string }>("/api/v1/niches", {
          method: "POST",
          body: JSON.stringify({
            ...d,
            tts_style_directions: d.tts_style_directions || null,
            character_description: d.character_description || null,
            posting_windows: [{ hour: 9, minute: 0, tz: tz() }],
            platforms: ["tiktok", "reels", "shorts"],
            daily_spend_cap_usd: "5.00",
            approve_before_post: true, // outbound waits for the rehearsal decision
          }),
        });
        setNicheId(niche.id);
        if (props.needsPlan) return;
        if (chosen === "blog") {
          const article = await call<{ id: string; status: string }>("/api/v1/articles", { method: "POST", body: JSON.stringify({ niche_id: niche.id, topic: "" }) });
          setPieceId(article.id);
          setPieceStatus(article.status);
        } else {
          const job = await call<{ id: string; status: string }>("/api/v1/jobs", { method: "POST", body: JSON.stringify({ niche_id: niche.id, platform: "tiktok" }) });
          setPieceId(job.id);
          setPieceStatus(job.status);
        }
      } catch (e) {
        const status = (e as { status?: number }).status;
        if (props.needsPlan) {
          setActivationError("Your playbook is drafted but didn't save. You can make it again from Playbooks once you're in.");
          return;
        }
        setActivationError(status === 402 ? "Your playbook is ready. Add credits and Marketer makes the first piece." : "Your playbook is ready, but the first piece didn't start. You can start it from Content.");
      }
    },
    [brand, props.needsPlan],
  );

  // Poll the first piece so the preview shows real progress.
  useEffect(() => {
    if (!pieceId) return;
    let stop = false;
    const path = intent === "blog" ? `/api/v1/articles/${pieceId}` : `/api/v1/jobs/${pieceId}`;
    const tick = async () => {
      try {
        const p = await call<{ status: string; title?: string | null; script?: { idea?: { hook?: string } } | null }>(path);
        if (stop) return;
        setPieceStatus(p.status);
        const h = p.script?.idea?.hook ?? p.title ?? null;
        if (h) setHook(h);
      } catch {
        /* keep the last known state */
      }
    };
    void tick();
    const id = setInterval(tick, 4000);
    return () => {
      stop = true;
      clearInterval(id);
    };
  }, [pieceId, intent]);

  // Channel connection: poll the verified status, never trust the redirect (R4.5).
  useEffect(() => {
    if (!connecting || connected) return;
    const id = setInterval(async () => {
      try {
        const s = await call<{ connected: boolean }>("/api/v1/connect/ayrshare/status");
        if (s.connected) {
          setConnected(true);
          setConnecting(false);
        }
      } catch {
        /* keep polling */
      }
    }, 3000);
    return () => clearInterval(id);
  }, [connecting, connected]);

  // ---------------------------------------------------------------- screens
  const confirmBrand = async () => {
    if (!brand.trim()) return setEditing(true);
    void call("/api/v1/brand-kit", { method: "PUT", body: JSON.stringify(await brandKitPayload(brand.trim())) }).catch(() => undefined);
    // The workspace was named from the email domain; it takes the confirmed brand's name.
    if (props.workspaceId) void authClient.organization.update({ organizationId: props.workspaceId, data: { name: brand.trim().slice(0, 64) } }).catch(() => undefined);
    if (!preselectStarted.current) {
      preselectStarted.current = true;
      void preselectIntent({ brand: brand.trim(), website: domain, emailDomain: props.email.split("@")[1]?.toLowerCase() ?? null })
        .then((picked) => {
          // A person's own pick always wins over the model.
          if (picked && !intentTouched.current) setIntentState(picked);
        })
        .catch(() => undefined);
    }
    flow.go("intent");
  };

  const submitOffer = () => {
    if (offer.trim().length < 8) return;
    void activate(intent, offer.trim());
    flow.go(needsConnect(intent) ? "connect" : "rehearsal");
  };

  const finish = async () => {
    setFinishing(true);
    if (nicheId) {
      await call(`/api/v1/niches/${nicheId}`, {
        method: "PUT",
        body: JSON.stringify({ approve_before_post: approvalMode === "approve", posting_windows: cadence === "twice" ? [{ hour: 9, minute: 0, tz: tz() }, { hour: 18, minute: 0, tz: tz() }] : [{ hour: 9, minute: 0, tz: tz() }] }),
      }).catch(() => undefined);
    }
    try {
      localStorage.setItem("marketer.onboarded", "1");
    } catch {
      /* ignore */
    }
    const product = intent === "ads" ? `/sessions/new?dept=paid&q=${encodeURIComponent("Review my ad accounts and tell me what to scale or pause")}` : pieceId ? (intent === "blog" ? `/seo/${pieceId}` : `/content/videos/${pieceId}`) : "/home";
    if (props.needsPlan) {
      // The plan screen starts the first piece itself once there's credit, then opens it.
      const q = new URLSearchParams();
      if (nicheId && intent !== "ads") {
        q.set("start", nicheId);
        q.set("kind", intent === "blog" ? "article" : "video");
      } else q.set("next", product);
      router.push(`/plans?${q.toString()}`);
      return;
    }
    dest.current = product;
    setArrived(true);
    // The product opens when the wave settles; this is the guard if it never reports back.
    window.setTimeout(openProduct, 3000);
  };

  // Esc goes back (D15). Enter is each step's own form; number keys are the option list's.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && flow.canBack && !finishing) flow.back();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [flow, finishing]);

  const connectChannels = async () => {
    try {
      const r = await call<{ login_url: string }>("/api/v1/connect/ayrshare", { method: "POST" });
      window.open(r.login_url, "_blank", "noopener,noreferrer");
      setConnecting(true);
    } catch {
      setActivationError("Couldn't open the channel connection. You can connect later from Integrations.");
    }
  };
  const connectAds = async (platform: "google_ads" | "meta_ads") => {
    try {
      const r = await call<{ redirect_url: string }>("/api/v1/ads/accounts/connect", { method: "POST", body: JSON.stringify({ platform }) });
      window.open(r.redirect_url, "_blank", "noopener,noreferrer");
      setConnecting(true);
    } catch {
      setActivationError("Ad connections aren't available on this workspace yet. You can connect later from Paid media.");
    }
  };

  const pieceDone = pieceStatus === "awaiting_approval" || pieceStatus === "done";
  const stepIndex = Math.max(0, ORDER.indexOf(pieceStatus ?? "queued"));
  // No credit: the playbook is the proof; its first piece waits for the plan screen.
  const waitingForPlan = Boolean(props.needsPlan && nicheId && intent !== "ads");
  const playbookReady = Boolean(props.needsPlan && draft && intent !== "ads");
  const finalLabel = props.needsPlan ? "Choose how to start" : intent === "ads" ? "Review with the Media buyer" : intent === "blog" ? "Read my first article" : "Review my first video";

  // ---------------------------------------------------------------- render
  const task = (() => {
    switch (screen) {
      case "confirm":
        return (
          <Step
            title="Is this you?"
            subtitle={props.inferredBrand ? `We found this from your email, ${props.email}. Marketer works from your brand.` : "Tell Marketer whose marketing it's running."}
            onSubmit={() => void confirmBrand()}
            primary={{ label: "Looks right", disabled: !brand.trim() }}
          >
            {editing ? (
              <div className="space-y-4">
                <Field label="Brand">
                  <Input inputSize="lg" data-autofocus value={brand} onChange={(e) => setBrand(e.target.value)} placeholder="Pasta Club" />
                </Field>
                <Field label="Website">
                  <Input inputSize="lg" value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="pastaclub.co" />
                </Field>
              </div>
            ) : (
              <button type="button" onClick={() => setEditing(true)} className="ds-press flex w-full items-center gap-3 rounded-ds-lg border border-hairline bg-surface-2 px-4 py-3.5 text-left hover:border-hairline-strong">
                <WorkspaceLogo name={brand} size={40} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[16px] font-medium">{brand}</span>
                  {domain && (
                    <span className="flex items-center gap-1 text-[12.5px] text-fg-muted">
                      <Globe className="size-3" /> {domain}
                    </span>
                  )}
                </span>
                <span className="text-[12.5px] text-fg-muted">Edit</span>
              </button>
            )}
          </Step>
        );
      case "intent":
        return (
          <Step title="How do you get attention today?" subtitle="Pick what you do now. Marketer sets itself up around it." onSubmit={() => flow.go("offer")} primary={{ label: "Continue" }}>
            <OptionList label="How do you get attention today?" value={intent} onChange={setIntent} options={INTENTS.map((o) => ({ id: o.id, label: o.label, detail: o.detail, icon: o.icon }))} />
          </Step>
        );
      case "offer":
        return (
          <Step
            title="What are you marketing?"
            subtitle="One sentence is enough. Marketer drafts your first playbook from it, and you can change everything later."
            onSubmit={submitOffer}
            primary={{ label: "Continue", disabled: offer.trim().length < 8 }}
          >
            <label className="sr-only" htmlFor="ob-offer">
              What are you marketing, in a sentence?
            </label>
            <Textarea
              id="ob-offer"
              value={offer}
              onChange={(e) => setOffer(e.target.value)}
              rows={3}
              placeholder={intent === "blog" ? "Bookkeeping for freelancers who hate spreadsheets" : "Fresh pasta kits and 15-minute recipes for busy home cooks"}
              className="resize-none px-3.5 py-3 text-[15px] leading-relaxed"
              onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && (e.preventDefault(), submitOffer())}
            />
          </Step>
        );
      case "connect":
        return intent === "ads" ? (
          <Step title="Connect your ad account" subtitle="The Media buyer reads your campaigns first and changes nothing until you say so." onSubmit={() => flow.go("rehearsal")} primary={{ label: connected ? "Continue" : "Continue without connecting" }}>
            <div className="space-y-2">
              <ConnectRow name="Google Ads" purpose="Read campaigns, spend and search terms" state={connecting ? "verifying" : "idle"} onConnect={() => void connectAds("google_ads")} />
              <ConnectRow name="Meta Ads" purpose="Read campaigns, spend and creatives" state={connecting ? "verifying" : "idle"} onConnect={() => void connectAds("meta_ads")} />
            </div>
            <Scopes items={["Read campaigns, spend and results", "Change budgets only inside caps you set, after you approve"]} />
            {activationError && <p className="mt-3 text-[13px] text-fg-muted">{activationError}</p>}
          </Step>
        ) : (
          <Step
            title="Where should videos go?"
            subtitle="Connect once. Marketer posts only what you approve, on your schedule."
            onSubmit={() => flow.go("rehearsal")}
            primary={{ label: "Continue" }}
            secondary={!connected ? <StepLink onClick={() => flow.go("rehearsal")}>Skip for now</StepLink> : undefined}
          >
            <ConnectRow name="TikTok, Instagram and YouTube" purpose="Post videos and carousels you approve" state={connected ? "connected" : connecting ? "verifying" : "idle"} onConnect={() => void connectChannels()} />
            <Scopes items={["See which accounts are linked", "Post only what you approved, on your schedule"]} />
            <ActivationLine drafting={drafting} draft={draft} status={pieceStatus} error={activationError} waitingForPlan={waitingForPlan} />
          </Step>
        );
      case "rehearsal":
        return intent === "ads" ? (
          <Step title="How should changes happen?" subtitle="Real money moves only inside caps you set. You can change this per account." onSubmit={() => void finish()} primary={{ label: finalLabel, loading: finishing }}>
            <OptionList label="How should changes happen?" value={approvalMode} onChange={setApprovalMode} options={[{ id: "approve", label: "Ask me before any change" }, { id: "auto", label: "Small changes inside my caps" }]} />
          </Step>
        ) : (
          <Step
            title={playbookReady ? "Your playbook is ready" : intent === "blog" ? "Your first article is underway" : "Your first video is underway"}
            subtitle={hook ? `"${hook}"` : draft ? `From your new playbook, "${draft.title}".` : "Drafting your playbook…"}
            onSubmit={() => void finish()}
            primary={{ label: finalLabel, loading: finishing }}
          >
            {intent !== "blog" && (
              <>
                <div className="mb-2.5 text-[13px] font-medium text-fg-muted">When a video is ready…</div>
                <OptionList label="When a video is ready" value={approvalMode} onChange={setApprovalMode} options={[{ id: "approve", label: "Ask me before posting" }, { id: "auto", label: connected ? "Post on schedule" : "Post on schedule once channels are connected" }]} />
                <div className="mt-4 flex items-center justify-between gap-3">
                  <span className="text-[13px] text-fg-muted">How often</span>
                  <Segmented size="sm" label="How often" value={cadence} onChange={setCadence} options={[{ value: "daily", label: "Once a day" }, { value: "twice", label: "Twice a day" }]} />
                </div>
              </>
            )}
            <ActivationLine drafting={drafting} draft={draft} status={pieceStatus} error={activationError} waitingForPlan={waitingForPlan} />
          </Step>
        );
    }
  })();

  return (
    <div className="flex min-h-dvh items-center justify-center bg-ds-bg p-0 text-fg sm:p-6">
      <div className="ds-enter grid w-full max-w-[1080px] overflow-hidden bg-surface sm:rounded-ds-xl sm:border sm:border-hairline sm:shadow-ds-modal md:min-h-[660px] md:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
        {/* Phones: the question comes first and the workspace preview follows it, so the one thing to answer is always on screen. */}
        <div className="order-1 flex flex-col p-6 sm:p-10">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-[13px] text-fg-muted">
              <AgentGlyph size={18} />
              Marketer
            </div>
            <StepProgress index={Math.max(0, order.indexOf(screen))} count={order.length} />
          </div>
          <div className="flex flex-1 flex-col justify-center pb-2 pt-6 md:max-w-[420px] md:py-8">
            <div className="mb-5 h-8">
              <StepBack flow={flow} />
            </div>
            <StepFlow step={screen} direction={flow.direction}>
              {task}
            </StepFlow>
          </div>
          <div className="hidden items-center gap-1.5 text-[12px] text-fg-faint md:flex">
            <Kbd>Enter</Kbd> to continue · <Kbd>Esc</Kbd> to go back
          </div>
        </div>
        <div className="order-2 p-2">
          <CommitWave
            moment="arrive"
            committed={arrived}
            source={logo}
            className="h-full min-h-[220px] md:min-h-0"
            onSettled={(done) => {
              if (done) openProduct();
            }}
            receipt={
              <div className="flex h-full min-h-[220px] flex-col items-center justify-center gap-3 p-6 text-center">
                <WorkspaceLogo name={brand || "M"} size={44} />
                <div className="text-[17px] font-medium">{brand || "Your workspace"} is set up</div>
                <p className="max-w-[32ch] text-[13px] text-fg-muted">{intent === "ads" ? "Opening your first review with the Media buyer." : pieceId ? (intent === "blog" ? "Opening your first article." : "Opening your first video.") : "Opening Marketer."}</p>
              </div>
            }
          >
            <Preview
              logoRef={logo}
              brand={brand}
              domain={domain}
              draft={draft}
              drafting={drafting}
              intent={screen === "confirm" ? null : intent}
              connected={connected}
              pieceStatus={pieceStatus}
              stepIndex={stepIndex}
              pieceDone={pieceDone}
              hook={hook}
              approvalMode={approvalMode}
              cadence={cadence}
              waitingForPlan={waitingForPlan}
            />
          </CommitWave>
        </div>
      </div>
    </div>
  );
}

async function brandKitPayload(name: string) {
  try {
    const kit = await call<Record<string, unknown>>("/api/v1/brand-kit");
    return { brand_name: name, tagline: kit.tagline ?? "", tone_of_voice: kit.tone_of_voice ?? "", target_audience: kit.target_audience ?? "", banned_words: kit.banned_words ?? [], preferred_hashtags: kit.preferred_hashtags ?? [], color_hex: kit.color_hex ?? "" };
  } catch {
    return { brand_name: name, tagline: "", tone_of_voice: "", target_audience: "", banned_words: [], preferred_hashtags: [], color_hex: "" };
  }
}

/* ------------------------------------------------------------------ pieces */

/** Connect card (DESIGN ConnectCard): Connect → Verifying… → Connected. */
function ConnectRow({ name, purpose, state, onConnect }: { name: string; purpose: string; state: "idle" | "verifying" | "connected"; onConnect: () => void }) {
  return (
    <div className="flex items-center gap-3 rounded-ds-lg border border-hairline bg-surface-2 px-3.5 py-3">
      <IconTile size={32}>
        <span className="text-[13px] font-medium">{name.slice(0, 1)}</span>
      </IconTile>
      <span className="min-w-0 flex-1">
        <span className="block text-[13.5px] font-medium">{name}</span>
        <span className="block text-[12px] text-fg-muted">{purpose}</span>
      </span>
      {state === "connected" ? (
        <StatusBadge tone="positive">Connected</StatusBadge>
      ) : state === "verifying" ? (
        <StatusBadge>Verifying…</StatusBadge>
      ) : (
        <Button variant="secondary" onClick={onConnect}>
          Connect
        </Button>
      )}
    </div>
  );
}

function Scopes({ items }: { items: string[] }) {
  return (
    <ul className="mt-3 space-y-1.5 rounded-ds-md border border-hairline px-3.5 py-3">
      {items.map((s) => (
        <li key={s} className="flex items-start gap-2 text-[12.5px] text-fg-muted">
          <Check className="mt-0.5 size-3.5 shrink-0 text-positive" /> {s}
        </li>
      ))}
    </ul>
  );
}

/** The live activation line under the control (R4.2): what's running right now. */
function ActivationLine({ drafting, draft, status, error, waitingForPlan }: { drafting: boolean; draft: Draft | null; status: string | null; error: string | null; waitingForPlan?: boolean }) {
  if (error)
    return (
      <div className="mt-4">
        <Callout tone="attention">{error}</Callout>
      </div>
    );
  if (waitingForPlan)
    return (
      <p className="mt-5 flex items-center gap-2 text-[13px] text-fg-muted">
        <StepMark state="done" /> Playbook saved. Your first piece starts as soon as you choose how to start.
      </p>
    );
  const text = drafting ? "Drafting your playbook…" : status ? `${STEPS[status] ?? status}…` : draft ? "Playbook ready. Starting your first piece…" : null;
  if (!text) return null;
  const done = status === "awaiting_approval" || status === "done";
  return (
    <p className="mt-5 flex items-center gap-2 text-[13px]">
      <StepMark state={done ? "done" : "active"} />
      <span className={done ? "text-fg" : "ds-shimmer"}>{text}</span>
    </p>
  );
}

/** Skeleton lines in the preview until real content arrives (DESIGN Skeleton). */
function Bars({ widths }: { widths: number[] }) {
  return (
    <div className="space-y-2.5">
      {widths.map((w, i) => (
        <div key={i} className="flex items-center gap-2.5">
          <span className="size-2.5 rounded-full bg-hairline-strong" />
          <span className="h-2 rounded-full bg-hairline-strong" style={{ width: `${w}%` }} />
        </div>
      ))}
    </div>
  );
}

/** The right panel: their workspace taking shape as they answer (R8.3). */
function Preview(p: {
  logoRef?: Ref<HTMLSpanElement>;
  brand: string;
  domain: string;
  draft: Draft | null;
  drafting: boolean;
  intent: Intent | null;
  connected: boolean;
  pieceStatus: string | null;
  stepIndex: number;
  pieceDone: boolean;
  hook: string | null;
  approvalMode: "approve" | "auto";
  cadence: "daily" | "twice";
  waitingForPlan?: boolean;
}) {
  const steps = useMemo(() => ORDER.slice(1, ORDER.length), []);
  return (
    <div className="relative h-full min-h-[220px] overflow-hidden rounded-ds-lg md:min-h-0">
      <div aria-hidden className="absolute inset-0 opacity-60">
        <Shader palette="mono" speed={0.4} />
      </div>
      <div aria-hidden className="absolute inset-0 bg-ds-bg/55" />
      <div className="relative flex h-full flex-col gap-2.5 p-4 sm:p-6">
        <GlassCard className="ds-enter">
          <div className="flex items-center gap-3">
            <span ref={p.logoRef} className="inline-flex">
              <WorkspaceLogo name={p.brand || "M"} size={36} />
            </span>
            <div className="min-w-0">
              <div className="truncate text-[15px] font-medium">{p.brand || "Your brand"}</div>
              {p.domain && (
                <div className="flex items-center gap-1 text-[12px] text-fg-muted">
                  <Globe className="size-3" /> {p.domain}
                </div>
              )}
            </div>
          </div>
          {p.intent && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {(p.intent === "short_video" || p.intent === "nothing_yet" ? ["TikTok", "Reels", "Shorts"] : p.intent === "blog" ? ["Blog", "SEO"] : ["Google Ads", "Meta Ads"]).map((c) =>
                p.connected && p.intent === "short_video" ? (
                  <StatusBadge key={c} tone="positive">
                    {c}
                  </StatusBadge>
                ) : (
                  <StatusBadge key={c}>{c}</StatusBadge>
                ),
              )}
            </div>
          )}
        </GlassCard>

        <GlassCard title="Playbook">
          {p.draft ? (
            <div className="ds-enter space-y-1.5 text-[13px]">
              <div className="font-medium">{p.draft.title}</div>
              <div className="text-fg-muted">{p.draft.target_audience}</div>
              <div className="text-[12px] text-fg-muted">
                <span className="text-fg-faint">Look · </span>
                {p.draft.visual_style}
              </div>
              {p.draft.hashtags.length > 0 && <div className="truncate text-[12px] text-ds-accent">{p.draft.hashtags.slice(0, 5).map((h) => (h.startsWith("#") ? h : `#${h}`)).join(" ")}</div>}
            </div>
          ) : p.drafting ? (
            <div className="space-y-2.5">
              <div className="ds-shimmer text-[13px]">Drafting from your sentence…</div>
              <Bars widths={[70, 52, 64]} />
            </div>
          ) : (
            <Bars widths={[62, 44, 56]} />
          )}
        </GlassCard>

        <GlassCard className="hidden flex-1 sm:flex" title={<span className="flex w-full items-center justify-between gap-3"><span>Today</span>{(p.pieceStatus || p.waitingForPlan) && <span className="text-fg-faint">{p.approvalMode === "approve" ? "Waits for your yes" : p.cadence === "twice" ? "Posts 9am and 6pm" : "Posts at 9am"}</span>}</span>}>
          {p.pieceStatus && p.intent !== "blog" ? (
            <div className="ds-enter">
              {p.hook && <div className="mb-2 text-[13.5px] font-medium">“{p.hook}”</div>}
              <ul className="space-y-1.5">
                {steps.slice(0, 7).map((s, i) => {
                  const done = p.stepIndex > i + 1 || p.pieceDone;
                  const active = p.stepIndex === i + 1 && !p.pieceDone;
                  return (
                    <li key={s} className="flex items-center gap-2 text-[12.5px]">
                      <StepMark state={done ? "done" : active ? "active" : "todo"} />
                      <span className={active ? "ds-shimmer" : done ? "text-fg" : "text-fg-faint"}>{STEPS[s]}</span>
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : p.pieceStatus ? (
            <div className="ds-enter flex items-center gap-2 text-[13px]">
              <StepMark state={p.pieceDone ? "done" : "active"} /> {STEPS[p.pieceStatus] ?? `Article: ${p.pieceStatus}`}
            </div>
          ) : p.waitingForPlan ? (
            <div className="ds-enter space-y-1.5 text-[12.5px] text-fg-muted">
              <div className="text-[13.5px] font-medium text-fg">First {p.intent === "blog" ? "article" : "video"}, ready to start</div>
              <p>Marketer starts it the moment there&apos;s credit, then opens it for you.</p>
            </div>
          ) : (
            <Bars widths={[58, 72, 40, 66]} />
          )}
        </GlassCard>
      </div>
    </div>
  );
}
