/**
 * Template: analytics copilot (an AI analyst that watches your numbers and explains changes).
 *
 * Pass scenario:
 *   sign in → store + platform detected (Shopify, GA4 tag) → "Where do your numbers live?"
 *   pre-selected → connect Shopify → activation backfills 90 days and looks for the biggest
 *   unexplained change → rehearsal on that real change (what matters most, how often to hear
 *   from me) → dashboard: "Revenue fell 12% last Tuesday. 80% of it was one product going out
 *   of stock." [See the breakdown]
 */
import { defineSpec } from '../../packages/spec/src/index.ts';

const focus = {
  id: 'focus',
  prompt: 'What should I watch most closely?',
  default: 'revenue',
  options: [
    { id: 'revenue', label: 'Revenue' },
    { id: 'conversion', label: 'Conversion rate' },
    { id: 'retention', label: 'Repeat customers' },
  ],
};
const cadence = {
  id: 'cadence',
  prompt: 'How often should you hear from me?',
  default: 'when_moves',
  options: [
    { id: 'when_moves', label: 'Only when something moves' },
    { id: 'daily', label: 'A short daily digest' },
    { id: 'weekly', label: 'Monday recap' },
  ],
};

const changeProof = (id: string) => ({
  id,
  statement: '{metric} {direction} {change} on {day}. {share} of it came from {driver}.',
  metric: 'explained_changes',
  cta: { label: 'See the breakdown', event: 'aha_see_breakdown' },
  fallback: { source: 'public' as const, labeled: true, statement: 'Stores in your category convert at {rate} on average. Here is where you likely stand.' },
});

export default defineSpec({
  product: { name: 'Acme Analyst', category: 'analytics-copilot', promise: 'An analyst that watches your numbers and tells you why they moved.' },
  aha: { statement: 'The user sees a real, recent change in their own numbers explained in one sentence, and opens the breakdown.', event: 'aha_see_breakdown' },

  fields: [
    { id: 'displayName', label: 'Your name', tier: 'blocking', category: 'profile', infer: ['oauth_profile'] },
    { id: 'businessName', label: 'Business', tier: 'blocking', category: 'system', infer: ['email_domain', 'website', 'connector:shopify'], askInContext: { on: 'confirm', surface: 'workspace card' } },
    { id: 'website', label: 'Website', tier: 'blocking', category: 'system', infer: ['email_domain'], askInContext: { on: 'confirm', surface: 'workspace card (personal email domains only)' } },
    { id: 'currency', label: 'Currency', tier: 'blocking', category: 'system', infer: ['website', 'connector:shopify', 'connector:stripe'] },
    { id: 'timezone', label: 'Timezone', tier: 'blocking', category: 'system', infer: ['browser', 'connector:shopify', 'connector:ga4'] },
    { id: 'companySize', label: 'Company size', tier: 'deferrable', category: 'marketing', infer: ['email_domain'] },
    { id: 'referralSource', label: 'How did you hear about us', tier: 'deferrable', category: 'marketing', infer: ['utm'] },
  ],

  connectors: [
    { id: 'shopify', name: 'Shopify', auth: 'oauth', estSeconds: 22, verify: 'GET /admin/api/2026-10/shop.json', scopes: [{ id: 'read_orders', description: 'Read orders, products and inventory', access: 'read' }] },
    { id: 'ga4', name: 'Google Analytics', auth: 'oauth', estSeconds: 22, verify: 'accountSummaries.list returns at least one property', scopes: [{ id: 'analytics_readonly', description: 'Read traffic and conversion reports', access: 'read' }] },
    { id: 'stripe', name: 'Stripe', auth: 'oauth', estSeconds: 20, verify: 'GET /v1/balance', scopes: [{ id: 'read_only', description: 'Read charges, subscriptions and refunds', access: 'read' }] },
  ],

  intents: [
    {
      id: 'data_sources',
      prompt: 'Where do your numbers live?',
      hint: 'We pre-selected what we found on your site.',
      about: 'workflow',
      kind: 'multi',
      allowOther: true,
      options: [
        { id: 'shopify', label: 'Shopify', icon: 'shopify', capabilities: ['store_analyst'], preselectWhen: [{ source: 'website', detects: 'shopify' }] },
        { id: 'ga4', label: 'Google Analytics', icon: 'google', capabilities: ['traffic_analyst'], preselectWhen: [{ source: 'website', detects: 'google_analytics' }, { source: 'website', detects: 'google_tag_manager' }] },
        { id: 'stripe', label: 'Stripe', icon: 'stripe', capabilities: ['revenue_analyst'], preselectWhen: [{ source: 'website', detects: 'stripe' }] },
        { id: 'sheets', label: 'Mostly spreadsheets', icon: 'sparkle', capabilities: ['benchmarks'] },
      ],
    },
  ],

  capabilities: [
    {
      id: 'store_analyst', label: 'Store analyst', priority: 1,
      connectors: ['shopify'], fields: ['businessName', 'currency', 'timezone'],
      activation: { id: 'shopify_backfill', description: 'Backfill 90 days of orders and find the biggest change you haven’t been told about.', access: 'read', estSecondsToFirstResult: 25 },
      proof: changeProof('store_change'),
      rehearsal: { example: 'the biggest unexplained change in the last 30 days', artifact: 'the alert you would get', decisions: [focus, cadence] },
    },
    {
      id: 'traffic_analyst', label: 'Traffic analyst', priority: 2,
      connectors: ['ga4'], fields: ['businessName', 'timezone'],
      activation: { id: 'ga4_backfill', description: 'Read 90 days of traffic and find the channel whose conversion moved most.', access: 'read', estSecondsToFirstResult: 22 },
      proof: changeProof('traffic_change'),
      rehearsal: { example: 'the channel that moved most last month', artifact: 'the alert you would get', decisions: [focus, cadence] },
    },
    {
      id: 'revenue_analyst', label: 'Revenue analyst', priority: 2,
      connectors: ['stripe'], fields: ['businessName', 'currency', 'timezone'],
      activation: { id: 'stripe_backfill', description: 'Read 12 months of charges and find churn and refund changes.', access: 'read', estSecondsToFirstResult: 20 },
      proof: changeProof('revenue_change'),
      rehearsal: { example: 'the month with the biggest churn change', artifact: 'the alert you would get', decisions: [focus, cadence] },
    },
    {
      id: 'benchmarks', label: 'Category benchmarks', priority: 3, zeroSetup: true,
      connectors: [], fields: ['businessName', 'website'],
      activation: { id: 'benchmark_lookup', description: 'Compare your category’s public benchmarks with what your site suggests.', access: 'read', estSecondsToFirstResult: 15 },
      proof: { id: 'benchmark', statement: 'Stores like {business} convert at {rate} on average. Connect your data and I’ll tell you exactly where you stand.', metric: 'benchmarks', cta: { label: 'Upload a CSV', event: 'aha_upload_csv' } },
      rehearsal: { example: 'your category’s conversion benchmark', artifact: 'the weekly recap you would get', decisions: [focus, cadence] },
    },
  ],

  budget: { maxScreens: 6, maxSeconds: 120, maxSecondsToProof: 90, maxSecondary: 1 },
});
