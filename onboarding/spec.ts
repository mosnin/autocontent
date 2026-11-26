/**
 * Marketer onboarding spec (intent-driven framework, vendored in .intent-onboarding/).
 * Lint: npx tsx .intent-onboarding/packages/spec/src/cli.ts onboarding/spec.ts --paths
 *
 * Pass scenario:
 *   sign in → we infer the brand from the email domain ("Pasta Club, pastaclub.co") → one tap "Looks right" →
 *   "How do you get attention today?" → say what you're marketing in a sentence (the playbook drafts live
 *   in the preview) → connect only the channels that answer implies, while the first piece is already being
 *   made → rehearsal on that real first piece (ask before posting? cadence?) → the dashboard opens on it.
 *
 * Implemented in web/app/(onboarding)/onboarding (web/components/app/onboarding/flow.tsx), one question per
 * screen with the design system's StepFlow. The intent screen is shown in two beats: the multiple-choice
 * question, then the one-sentence offer in context (askInContext on 'intent'), so the person never sees two
 * questions at once; both beats count as the one intent screen below (~7s + ~12s typing, still well inside
 * the 120s budget on every path). Cadence rides on the rehearsal screen as a detail of the posting preview.
 *
 * After the rehearsal, a workspace with nothing to run on (billing on, no credit, no code) passes through the
 * plan screen (/plans, docs/billing/access-codes.md) before the dashboard. It is not an onboarding screen: it
 * asks no field and changes no setup, and the proof (the drafted playbook from their own sentence) is shown
 * before it. The first piece starts from there once there is credit, and the dashboard opens on it (R5.3).
 */
import { defineSpec } from '../.intent-onboarding/packages/spec/src/index.ts';

export default defineSpec({
  product: {
    name: 'Marketer',
    category: 'ai-marketing-department',
    promise: 'An AI marketing department that plans, makes, posts, buys and measures, for people and their agents.',
  },

  aha: {
    statement: 'The user watches Marketer make their first on-brand video (or article) from one sentence, and approves it to post.',
    event: 'aha_first_piece_approved',
  },

  fields: [
    { id: 'displayName', label: 'Your name', tier: 'blocking', category: 'profile', infer: ['oauth_profile'] },
    { id: 'brandName', label: 'Brand', tier: 'blocking', category: 'system', infer: ['email_domain', 'website'], askInContext: { on: 'confirm', surface: 'workspace card' } },
    { id: 'website', label: 'Website', tier: 'workflow', category: 'system', infer: ['email_domain'], askInContext: { on: 'confirm', surface: 'workspace card (personal email domains only)' } },
    { id: 'timezone', label: 'Timezone', tier: 'blocking', category: 'system', infer: ['browser'] },
    { id: 'offer', label: 'What you are marketing', tier: 'workflow', category: 'workflow', infer: ['website'], askInContext: { on: 'intent', surface: 'the second beat of the intent screen: one sentence, drafting the playbook live in the preview' } },
    { id: 'platforms', label: 'Platforms', tier: 'workflow', category: 'workflow', infer: ['connector:ayrshare'], askInContext: { on: 'connect', surface: 'channel chips on the connect card' } },
    { id: 'approvalMode', label: 'Ask before posting', tier: 'workflow', category: 'workflow', infer: [], askInContext: { on: 'rehearsal', surface: 'the first video, before it posts' } },
    { id: 'cadence', label: 'Cadence', tier: 'workflow', category: 'workflow', infer: [], askInContext: { on: 'rehearsal', surface: 'posting calendar preview' } },
    // Deferrable: never asked before the dashboard.
    { id: 'referralSource', label: 'How did you hear about us', tier: 'deferrable', category: 'marketing', infer: ['utm'] },
    { id: 'companySize', label: 'Company size', tier: 'deferrable', category: 'marketing', infer: ['email_domain'] },
    { id: 'dailyCap', label: 'Daily spend cap', tier: 'deferrable', category: 'workflow', infer: [] },
  ],

  connectors: [
    {
      id: 'ayrshare', name: 'TikTok, Instagram and YouTube', auth: 'oauth', estSeconds: 30,
      verify: 'GET /api/v1/connect/ayrshare/status returns connected: true',
      scopes: [
        { id: 'profile_read', description: 'See which accounts are linked', access: 'read' },
        { id: 'post', description: 'Post videos and carousels you approved, on your schedule', access: 'write' },
      ],
    },
    {
      id: 'ad_accounts', name: 'Google Ads and Meta Ads', auth: 'oauth', estSeconds: 30,
      verify: 'GET /api/v1/ads/accounts returns at least one account',
      scopes: [
        { id: 'ads_read', description: 'Read campaigns, spend and results', access: 'read' },
        { id: 'ads_write', description: 'Change budgets and launch ads only inside your caps, after you approve', access: 'write' },
      ],
    },
  ],

  intents: [
    {
      id: 'attention',
      prompt: 'How do you get attention today?',
      hint: 'Pick what you do now. Marketer sets itself up around it.',
      about: 'workflow',
      kind: 'single',
      allowOther: true,
      options: [
        { id: 'short_video', label: 'I post short videos', icon: 'clapperboard', capabilities: ['short_form'], preselectWhen: [{ source: 'icp', segmentShareAtLeast: 0.5 }] },
        { id: 'blog', label: 'I write articles for search', icon: 'file-text', capabilities: ['seo_articles'], preselectWhen: [{ source: 'website', detects: 'blog' }] },
        { id: 'ads', label: 'I run paid ads', icon: 'megaphone', capabilities: ['paid_ads'], preselectWhen: [{ source: 'connector:ad_accounts', has: 'account' }] },
        { id: 'nothing_yet', label: "I don't do much yet", none: true, icon: 'sparkles', capabilities: ['first_drafts'] },
      ],
    },
  ],

  capabilities: [
    {
      id: 'short_form',
      label: 'Short-form video',
      priority: 1,
      connectors: ['ayrshare'],
      fields: ['brandName', 'timezone', 'offer', 'platforms', 'approvalMode', 'cadence'],
      activation: {
        id: 'first_video',
        description: 'Draft a playbook from the brand and offer, then start the first video (script, visuals, voice, edit, QA). Nothing posts.',
        access: 'read',
        estSecondsToFirstResult: 20,
      },
      proof: {
        id: 'first_video_draft',
        statement: 'I drafted a playbook for {brand} with {hooks} hooks, and your first video "{hook}" is being made.',
        metric: 'first_piece_started',
        cta: { label: 'Review my first video', event: 'aha_first_piece_approved' },
      },
      rehearsal: {
        example: 'the first video, from the drafted playbook',
        artifact: 'the video script and hook, with its posting slot',
        decisions: [
          { id: 'approvalMode', prompt: 'When a video is ready…', default: 'approve', gatesOutbound: true, options: [{ id: 'approve', label: 'Ask me before posting' }, { id: 'auto', label: 'Post on schedule' }] },
          { id: 'cadence', prompt: 'How often?', default: 'daily', options: [{ id: 'daily', label: 'Once a day' }, { id: 'twice', label: 'Twice a day' }] },
        ],
      },
    },
    {
      id: 'seo_articles',
      label: 'SEO articles',
      priority: 2,
      zeroSetup: true,
      connectors: [],
      fields: ['brandName', 'timezone', 'offer', 'cadence'],
      activation: {
        id: 'first_article',
        description: 'Research what ranks for the offer and write the first article. Nothing is published.',
        access: 'read',
        estSecondsToFirstResult: 25,
      },
      proof: {
        id: 'first_article_draft',
        statement: 'I researched what ranks for "{keyword}" and I am writing your first article now.',
        metric: 'first_piece_started',
        cta: { label: 'Read my first article', event: 'aha_first_piece_approved' },
      },
      rehearsal: {
        example: 'the first article outline',
        artifact: 'the article and its five social posts',
        decisions: [
          { id: 'cadence', prompt: 'How often?', default: 'weekly', options: [{ id: 'weekly', label: 'One a week' }, { id: 'two', label: 'Two a week' }] },
        ],
      },
    },
    {
      id: 'paid_ads',
      label: 'Paid media',
      priority: 3,
      connectors: ['ad_accounts'],
      fields: ['brandName', 'timezone', 'offer', 'approvalMode'],
      activation: {
        id: 'ads_read',
        description: 'Read 30 days of campaigns and spend, and find the ad sets worth scaling or pausing. Changes nothing.',
        access: 'read',
        estSecondsToFirstResult: 25,
      },
      proof: {
        id: 'ads_review',
        statement: 'You spent {spend} across {campaigns} campaigns. {count} ad sets are worth a look.',
        metric: 'ad_sets_flagged',
        cta: { label: 'Review with the Media buyer', event: 'aha_first_piece_approved' },
        fallback: { source: 'sample', labeled: true, statement: 'Here is how the Media buyer reviews an account like yours.' },
      },
      rehearsal: {
        example: 'your highest-spend ad set',
        artifact: 'a proposed budget change inside your caps',
        decisions: [
          { id: 'approvalMode', prompt: 'How should changes happen?', default: 'approve', gatesOutbound: true, options: [{ id: 'approve', label: 'Ask me before any change' }, { id: 'auto', label: 'Small changes inside my caps' }] },
        ],
      },
    },
    {
      id: 'first_drafts',
      label: 'First drafts',
      priority: 4,
      zeroSetup: true,
      connectors: [],
      fields: ['brandName', 'timezone', 'offer', 'approvalMode'],
      activation: {
        id: 'first_video_offline',
        description: 'Draft a playbook and make the first video to download or post by hand. No accounts needed.',
        access: 'read',
        estSecondsToFirstResult: 20,
      },
      proof: {
        id: 'first_video_draft',
        statement: 'I drafted a playbook for {brand} and your first video "{hook}" is being made.',
        metric: 'first_piece_started',
        cta: { label: 'Review my first video', event: 'aha_first_piece_approved' },
      },
      rehearsal: {
        example: 'the first video, from the drafted playbook',
        artifact: 'the video script and hook',
        decisions: [
          { id: 'approvalMode', prompt: 'When a video is ready…', default: 'approve', gatesOutbound: true, options: [{ id: 'approve', label: 'Ask me before posting' }, { id: 'auto', label: 'Post on schedule once channels are connected' }] },
        ],
      },
    },
  ],

  budget: { maxScreens: 6, maxSeconds: 120, maxSecondsToProof: 90, maxSecondary: 1 },
});
