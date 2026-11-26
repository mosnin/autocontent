/**
 * Template: agentic ad platform (an AI that runs your ads for you).
 *
 * Pass scenario this encodes:
 *   sign in → we infer the business from the domain + website and detect ad pixels →
 *   "Where do you run ads?" with Meta/Google pre-selected from the pixels →
 *   connect only those → activation pulls performance AND long-running competitor ads →
 *   rehearsal on your best ad vs. a competitor ad (CPA guardrail, approval mode) →
 *   dashboard: "6 competitor ads have run 60+ days. Build 3 variations?"
 */
import { defineSpec } from '../../packages/spec/src/index.ts';

export default defineSpec({
  product: {
    name: 'Acme Ads',
    category: 'agentic-ads',
    promise: 'An agent that plans, launches and optimizes your paid ads.',
  },

  aha: {
    statement: 'The user sees competitor ads that have worked for months next to their own, and asks the agent to build variations.',
    event: 'aha_build_variations',
  },

  fields: [
    { id: 'displayName', label: 'Your name', tier: 'blocking', category: 'profile', infer: ['oauth_profile'] },
    { id: 'businessName', label: 'Business', tier: 'blocking', category: 'system', infer: ['email_domain', 'website'], askInContext: { on: 'confirm', surface: 'workspace card' } },
    { id: 'website', label: 'Website', tier: 'blocking', category: 'system', infer: ['email_domain'], askInContext: { on: 'confirm', surface: 'workspace card (personal email domains only)' } },
    { id: 'currency', label: 'Currency', tier: 'blocking', category: 'system', infer: ['website', 'connector:meta_ads', 'connector:google_ads'] },
    { id: 'timezone', label: 'Timezone', tier: 'blocking', category: 'system', infer: ['browser', 'connector:meta_ads'] },
    { id: 'heroProduct', label: 'Product to push', tier: 'workflow', category: 'workflow', infer: ['website', 'connector:meta_ads'], askInContext: { on: 'rehearsal', surface: 'variation preview' } },
    { id: 'competitors', label: 'Competitors', tier: 'workflow', category: 'workflow', infer: ['website', 'icp'], askInContext: { on: 'rehearsal', surface: 'competitor ad chips' } },
    { id: 'targetCpa', label: 'Target CPA', tier: 'workflow', category: 'workflow', infer: ['connector:meta_ads', 'connector:google_ads'], askInContext: { on: 'rehearsal', surface: 'CPA guardrail' } },
    // Deferrable: never asked before the dashboard.
    { id: 'referralSource', label: 'How did you hear about us', tier: 'deferrable', category: 'marketing', infer: ['utm'] },
    { id: 'companySize', label: 'Company size', tier: 'deferrable', category: 'marketing', infer: ['email_domain'] },
    { id: 'teammates', label: 'Teammates', tier: 'deferrable', category: 'profile', infer: [] },
  ],

  connectors: [
    {
      id: 'meta_ads', name: 'Meta Ads', auth: 'oauth', estSeconds: 25,
      verify: 'GET /me/adaccounts returns at least one account',
      scopes: [
        { id: 'ads_read', description: 'Read campaign performance and creatives', access: 'read' },
        { id: 'ads_management', description: 'Create and pause ads within the limits you set', access: 'write' },
      ],
    },
    {
      id: 'google_ads', name: 'Google Ads', auth: 'oauth', estSeconds: 25,
      verify: 'customers:listAccessibleCustomers returns at least one customer',
      scopes: [
        { id: 'adwords_read', description: 'Read campaigns, keywords and search terms', access: 'read' },
        { id: 'adwords_write', description: 'Adjust bids and pause wasted keywords within your limits', access: 'write' },
      ],
    },
    {
      id: 'tiktok_ads', name: 'TikTok Ads', auth: 'oauth', estSeconds: 25,
      verify: 'GET /advertiser/info returns the advertiser',
      scopes: [
        { id: 'ads_read', description: 'Read campaign performance and creatives', access: 'read' },
        { id: 'ads_write', description: 'Create and pause ads within the limits you set', access: 'write' },
      ],
    },
  ],

  intents: [
    {
      id: 'channels',
      prompt: 'Where do you run ads today?',
      hint: 'We pre-selected what we found on your site.',
      about: 'workflow',
      kind: 'multi',
      allowOther: true,
      options: [
        { id: 'meta', label: 'Meta', icon: 'meta', capabilities: ['meta_ads_agent'], preselectWhen: [{ source: 'website', detects: 'meta_pixel' }, { source: 'icp', segmentShareAtLeast: 0.5 }] },
        { id: 'google', label: 'Google', icon: 'google', capabilities: ['google_ads_agent'], preselectWhen: [{ source: 'website', detects: 'google_ads_tag' }] },
        { id: 'tiktok', label: 'TikTok', icon: 'tiktok', capabilities: ['tiktok_ads_agent'], preselectWhen: [{ source: 'website', detects: 'tiktok_pixel' }] },
        { id: 'not_yet', label: 'Not running ads yet', none: true, icon: 'sparkle', capabilities: ['competitor_intel'] },
      ],
    },
  ],

  capabilities: [
    {
      id: 'meta_ads_agent',
      label: 'Meta ads agent',
      priority: 1,
      connectors: ['meta_ads'],
      fields: ['businessName', 'website', 'currency', 'timezone', 'heroProduct', 'competitors', 'targetCpa'],
      activation: {
        id: 'meta_scan',
        description: 'Pull 90 days of performance, rank your ads, and search the public ad library for competitor ads running 60+ days.',
        access: 'read',
        estSecondsToFirstResult: 25,
      },
      proof: {
        id: 'competitor_winners',
        statement: 'I found {count} competitor ads that have run 60+ days, and {winners} of your ads worth scaling.',
        metric: 'competitor_ads_found',
        cta: { label: 'Build 3 variations', event: 'aha_build_variations' },
        fallback: { source: 'public', labeled: true, statement: 'Competitors in your category have {count} ads running 60+ days.' },
      },
      rehearsal: {
        example: 'your best ad last month next to a competitor ad running 90+ days',
        artifact: 'three generated variations for your hero product',
        decisions: [
          { id: 'goal', prompt: 'Protect CPA or push volume?', default: 'hold', options: [{ id: 'hold', label: 'Hold CPA' }, { id: 'push', label: 'Push volume' }] },
          { id: 'launchMode', prompt: 'How should I launch?', default: 'approve', gatesOutbound: true, options: [{ id: 'approve', label: 'Ask me before launching' }, { id: 'auto', label: 'Launch within my budget' }] },
        ],
      },
    },
    {
      id: 'google_ads_agent',
      label: 'Google ads agent',
      priority: 2,
      connectors: ['google_ads'],
      fields: ['businessName', 'website', 'currency', 'timezone', 'targetCpa'],
      activation: {
        id: 'google_scan',
        description: 'Pull 90 days of search terms and find spend with no conversions.',
        access: 'read',
        estSecondsToFirstResult: 20,
      },
      proof: {
        id: 'wasted_spend',
        statement: 'I found {amount} in spend on {count} search terms that never converted.',
        metric: 'wasted_spend',
        cta: { label: 'Pause wasted terms', event: 'aha_pause_waste' },
      },
      rehearsal: {
        example: 'your most expensive non-converting search term',
        artifact: 'a proposed negative keyword list',
        decisions: [
          { id: 'changeMode', prompt: 'How should I apply changes?', default: 'approve', gatesOutbound: true, options: [{ id: 'approve', label: 'Ask me first' }, { id: 'auto', label: 'Apply automatically' }] },
        ],
      },
    },
    {
      id: 'tiktok_ads_agent',
      label: 'TikTok ads agent',
      priority: 3,
      connectors: ['tiktok_ads'],
      fields: ['businessName', 'currency', 'timezone', 'heroProduct'],
      activation: {
        id: 'tiktok_scan',
        description: 'Pull creative performance and trending formats in your category.',
        access: 'read',
        estSecondsToFirstResult: 25,
      },
      proof: {
        id: 'creative_fatigue',
        statement: '{count} of your creatives are fatiguing. Here are {formats} formats working in your category now.',
        metric: 'fatigued_creatives',
        cta: { label: 'Refresh creatives', event: 'aha_refresh_creatives' },
      },
      rehearsal: {
        example: 'your top creative and its fatigue curve',
        artifact: 'two refreshed creative concepts',
        decisions: [
          { id: 'launchMode', prompt: 'How should I launch?', default: 'approve', gatesOutbound: true, options: [{ id: 'approve', label: 'Ask me before launching' }, { id: 'auto', label: 'Launch within my budget' }] },
        ],
      },
    },
    {
      id: 'competitor_intel',
      label: 'Competitor intelligence',
      priority: 4,
      zeroSetup: true,
      connectors: [],
      fields: ['businessName', 'website', 'heroProduct', 'competitors'],
      activation: {
        id: 'public_scan',
        description: 'Find competitors from your website and pull their long-running ads from public ad libraries.',
        access: 'read',
        estSecondsToFirstResult: 20,
      },
      proof: {
        id: 'category_winners',
        statement: 'Competitors like {competitor} have {count} ads that have run 60+ days. Here is what they have in common.',
        metric: 'competitor_ads_found',
        cta: { label: 'Draft my first campaign', event: 'aha_draft_campaign' },
      },
      rehearsal: {
        example: "a competitor's longest-running ad",
        artifact: 'a first campaign draft for your hero product',
        decisions: [
          { id: 'budget', prompt: 'Starting daily budget?', default: 'b50', options: [{ id: 'b20', label: '$20/day' }, { id: 'b50', label: '$50/day' }, { id: 'b150', label: '$150/day' }] },
        ],
      },
    },
  ],

  budget: { maxScreens: 6, maxSeconds: 120, maxSecondsToProof: 90, maxSecondary: 1 },
});
