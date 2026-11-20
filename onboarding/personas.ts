/**
 * Persona replays for Marketer's onboarding.
 * Run: npx tsx .intent-onboarding/packages/testing/src/cli.ts onboarding/personas.ts
 */
import { definePersonas } from '../.intent-onboarding/packages/testing/src/index.ts';
import spec from './spec.ts';

export const fieldMap = { displayName: 'displayName', businessName: 'brandName', website: 'website', timezone: 'timezone', referralSource: 'referralSource' };

const firstVideo = { values: { brand: 'Pasta Club', hooks: 6, hook: '3 pasta mistakes every home cook makes' }, examples: [{ hook: '3 pasta mistakes every home cook makes' }], source: 'own' as const };

export default definePersonas({
  spec,
  activations: {
    short_form: { seconds: 20, result: firstVideo },
    seo_articles: { seconds: 25, result: { values: { keyword: 'fresh pasta at home' }, examples: [], source: 'own' } },
    paid_ads: { seconds: 25, result: { values: { spend: '$1,840', campaigns: 4, count: 2 }, examples: [], source: 'own' } },
    first_drafts: { seconds: 20, result: firstVideo },
  },
  personas: [
    {
      name: 'Creator brand on its own domain, posts short videos',
      email: 'sam@pastaclub.co',
      fullName: 'Sam Rossi',
      provider: 'google',
      timezone: 'America/New_York',
      website: { businessName: 'Pasta Club', currency: 'USD', detects: ['tiktok_link'], fields: { offer: 'Fresh pasta kits and recipes' } },
      answers: { attention: ['short_video'] },
      decisions: { short_form: { approvalMode: 'approve', cadence: 'daily' } },
    },
    {
      name: 'SaaS founder who writes for search',
      email: 'lee@ledgerly.io',
      fullName: 'Lee Park',
      provider: 'google',
      timezone: 'Europe/London',
      website: { businessName: 'Ledgerly', currency: 'GBP', detects: ['blog'], fields: { offer: 'Bookkeeping for freelancers' } },
      answers: { attention: ['blog'] },
    },
    {
      name: 'DTC shop already running ads',
      email: 'maya@lumaskin.co',
      fullName: 'Maya Brooks',
      provider: 'google',
      timezone: 'America/Los_Angeles',
      website: { businessName: 'Luma Skin', currency: 'USD', detects: ['meta_pixel'], fields: { offer: 'Vitamin C serum' } },
      answers: { attention: ['ads'] },
      decisions: { paid_ads: { approvalMode: 'approve' } },
    },
    {
      name: 'Founder on Gmail who does no marketing yet',
      email: 'theo.candles@gmail.com',
      fullName: 'Theo Grant',
      provider: 'google',
      timezone: 'Europe/Paris',
      answers: { attention: ['nothing_yet'] },
      provide: { website: 'https://theocandles.com', brandName: 'Theo Candles', offer: 'Hand-poured soy candles' },
    },
  ],
});
