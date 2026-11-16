/**
 * The onboarding spec format.
 *
 * A spec describes WHAT a product can do for someone (capabilities), HOW we learn
 * which of those this user wants (intent questions), WHAT we need to know to run it
 * (fields), and HOW we prove it works (activation + proof + rehearsal).
 *
 * It deliberately does not describe a list of form steps. Screens are derived from
 * the user's answers (see derivePath). Every rule referenced in comments lives in RULES.md.
 */

/** RULES §3.1 */
export type FieldTier = 'blocking' | 'workflow' | 'deferrable';

/**
 * Where a field's value can come from before we ever ask (RULES §3.3).
 * `connector:<id>` = read from a connected account; `website` = website scan;
 * `icp` = priors from customer/ICP data.
 */
export type InferSource =
  | 'oauth_profile'
  | 'email_domain'
  | 'website'
  | 'browser'
  | 'icp'
  | 'utm'
  /** A decision model (e.g. Jev) judging what enrichment found; confidence is the model's calibrated probability. */
  | 'model'
  | `connector:${string}`;

export interface FieldDef {
  id: string;
  label: string;
  tier: FieldTier;
  /**
   * What kind of information this is. `marketing` fields (attribution, "how did you
   * hear about us", company size for sales) are never allowed before the dashboard (RULES §3.6).
   */
  category: 'system' | 'workflow' | 'profile' | 'marketing';
  /** Ordered inference sources, tried before confirming or asking (RULES §3.3). */
  infer: InferSource[];
  /**
   * Where the field is asked if inference fails: the screen kind plus the visible surface
   * that makes it matter (RULES §3.4), e.g. { on: 'rehearsal', surface: 'message signature preview' }.
   * Omit for fields that are only ever inferred.
   */
  askInContext?: { on: ScreenKind; surface: string };
  /** Capabilities that promote a deferrable field to blocking (RULES §3.2), e.g. invites for team routing. */
  blockingWhen?: string[];
}

export interface ScopeDef {
  id: string;
  /** Plain-language description shown before the agent acts on it (RULES §7.1). */
  description: string;
  access: 'read' | 'write';
}

export interface ConnectorDef {
  id: string;
  name: string;
  auth: 'oauth' | 'mcp' | 'api_key' | 'none';
  scopes: ScopeDef[];
  /** The first authenticated call that proves the connection is live (RULES §4.5). */
  verify: string;
  /** Rough seconds the connect screen takes, including the OAuth round trip. */
  estSeconds?: number;
}

/** A signal that can pre-select an intent option (RULES §2.2). */
export type PreselectSignal =
  | { source: 'website'; detects: string }            // e.g. 'meta_pixel', 'shopify', 'calendly_embed'
  | { source: 'email_domain'; matches: string }       // e.g. 'gmail.com' or a regex string
  | { source: 'oauth_profile'; has: string }
  | { source: 'icp'; segmentShareAtLeast: number }    // share of matching customers who use this option
  | { source: `connector:${string}`; has: string };

export interface IntentOption {
  id: string;
  label: string;
  /** Icon key for the UI (brand logos allowed: 'meta', 'google', 'instagram', ...). */
  icon?: string;
  /** Capabilities this answer selects. Empty only for an explicit "none / not yet" option. */
  capabilities: string[];
  /**
   * Marks the "I don't do this today" option (RULES §2.5). It is exclusive in multi-select,
   * always listed last, and never pre-selected by rules or a decision model.
   */
  none?: boolean;
  preselectWhen?: PreselectSignal[];
}

export interface IntentQuestion {
  id: string;
  prompt: string;
  /** Optional one-line helper under the prompt. */
  hint?: string;
  /** RULES §2.1: what the question is about. `product` questions are not allowed first. */
  about: 'goal' | 'workflow' | 'product';
  /** RULES §2.2: multiple choice first. */
  kind: 'single' | 'multi';
  options: IntentOption[];
  /** Free text only as an optional "Other" (RULES §2.2). Parsed by the llm adapter into options. */
  allowOther?: boolean;
  /** Only ask this question when one of these capabilities is already selected. */
  askWhen?: string[];
  /** Field this answer fills (the option id becomes the value), e.g. a goal that changes defaults. */
  fills?: string;
}

export interface DecisionOption {
  id: string;
  label: string;
}

/** A core product decision made on a real example during the rehearsal (RULES §5.2). */
export interface DecisionDef {
  id: string;
  prompt: string;
  options: DecisionOption[];
  default: string;
  /** If true, the option chosen here is what unlocks outbound/destructive actions (RULES §4.4). */
  gatesOutbound?: boolean;
}

export interface ActivationDef {
  id: string;
  /** What starts running the moment the capability's connector verifies (RULES §4.2). */
  description: string;
  /** RULES §4.4: read-only by default. `write` requires a decision with gatesOutbound. */
  access: 'read' | 'write';
  /** Expected seconds from connector verify to first proof result. */
  estSecondsToFirstResult: number;
}

export interface ProofDef {
  id: string;
  /**
   * The sentence the user sees, with {placeholders} filled from activation output.
   * Must be about THEIR data, e.g. "I found {count} leads who went quiet in the last 30 days."
   */
  statement: string;
  /** The countable thing behind the statement, e.g. 'leads_found'. */
  metric: string;
  /** The obvious next action. Clicking it is the aha event (RULES §5.3, §9.1). */
  cta: { label: string; event: string };
  /**
   * If the connector can't be used, the proof may come from public data or LABELED sample data
   * (RULES §5.1).
   */
  fallback?: { source: 'public' | 'sample'; labeled: boolean; statement: string };
}

export interface RehearsalDef {
  /** The real item from activation output the decisions are made on, e.g. 'a lead who went quiet'. */
  example: string;
  /** The artifact the user reacts to, e.g. 'drafted follow-up message'. */
  artifact: string;
  decisions: DecisionDef[];
}

export interface CapabilityDef {
  id: string;
  label: string;
  /** Connectors needed. Usually exactly one. */
  connectors: string[];
  /** Fields this capability needs before it can run correctly. */
  fields: string[];
  activation: ActivationDef;
  proof: ProofDef;
  rehearsal: RehearsalDef;
  /** Lower = more important when several are selected. Picks the primary capability (RULES §2.4). */
  priority: number;
  /** Marks the least-setup capability offered to users who "don't do this today" (RULES §2.5). */
  zeroSetup?: boolean;
}

export type ScreenKind =
  | 'signin'
  | 'confirm'      // "Is this you?" one-tap confirmation of inferred facts
  | 'intent'       // a multiple-choice intent question
  | 'connect'      // connect ONE connector, with live activation progress
  | 'rehearsal'    // core decisions on a real example
  | 'consent'      // plain-language scopes
  | 'invite'       // only when a selected capability makes invites blocking
  | 'handoff';     // first dashboard load (counted, not a screen the user fills)

export type ScreenPurpose = 'gather' | 'setup' | 'prove';

/** A product-specific screen beyond the derived ones. Must declare a purpose (RULES §1.3). */
export interface CustomScreenDef {
  id: string;
  kind: ScreenKind;
  purpose: ScreenPurpose;
  estSeconds: number;
  fills?: string[];
  /** Only shown when one of these capabilities is selected. */
  when?: string[];
}

export interface BudgetDef {
  maxScreens: number;
  maxSeconds: number;
  maxSecondsToProof: number;
  /** RULES §2.4: at most one optional secondary capability step. */
  maxSecondary: 0 | 1;
  /** Required if any limit is looser than the defaults (RULES §6.1). */
  justification?: string;
}

export interface OnboardingSpec {
  product: {
    name: string;
    /** e.g. 'agentic-ads', 'followup-agent'. */
    category: string;
    /** One sentence: what the product does for its user. */
    promise: string;
  };
  /**
   * The aha, written before anything else. `statement` is the moment, `event` is the
   * analytics event that marks the user acting on it. It must be a proof CTA event.
   */
  aha: { statement: string; event: string };
  fields: FieldDef[];
  connectors: ConnectorDef[];
  /** Asked in order. The planner skips questions whose `askWhen` doesn't match. */
  intents: IntentQuestion[];
  capabilities: CapabilityDef[];
  customScreens?: CustomScreenDef[];
  budget: BudgetDef;
}

export const DEFAULT_BUDGET: BudgetDef = {
  maxScreens: 6,
  maxSeconds: 120,
  maxSecondsToProof: 90,
  maxSecondary: 1,
};
