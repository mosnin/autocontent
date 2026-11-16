/**
 * Replay suite for the agentic ads template.
 */
import { definePersonas } from '../../packages/testing/src/index.ts';
import spec from './spec.ts';

export const fieldMap = { displayName: 'displayName', businessName: 'businessName', website: 'website', timezone: 'timezone', referralSource: 'referralSource' };

const competitorAds = {
  values: { count: 6, winners: 2, competitor: 'GlowRival' },
  examples: [{ advertiser: 'GlowRival', runningDays: 94, hook: 'Dermatologist-tested Vitamin C in 7 days' }],
  source: 'own' as const,
};

export default definePersonas({
  spec,
  activations: {
    meta_ads_agent: { seconds: 25, result: competitorAds },
    google_ads_agent: { seconds: 20, result: { values: { count: 31, amount: '$1,240' }, examples: [{ term: 'free skincare samples' }], source: 'own' } },
    tiktok_ads_agent: { seconds: 25, result: { values: { count: 4, formats: 3 }, examples: [], source: 'own' } },
    competitor_intel: { seconds: 20, result: { values: { count: 11, competitor: 'GlowRival' }, examples: [], source: 'public' } },
  },
  personas: [
    {
      name: 'DTC skincare brand, Meta + Google pixels on site',
      email: 'maya@lumaskin.co',
      fullName: 'Maya Brooks',
      provider: 'google',
      timezone: 'America/New_York',
      utmSource: 'podcast',
      website: { businessName: 'Luma Skin', currency: 'USD', detects: ['meta_pixel', 'google_ads_tag', 'shopify'], fields: { heroProduct: 'Vitamin C serum' } },
      answers: { channels: 'preselected' },
      decisions: { meta_ads_agent: { goal: 'push', launchMode: 'approve' } },
    },
    {
      name: 'Founder on Gmail, Meta only',
      email: 'theo.candles@gmail.com',
      fullName: 'Theo Grant',
      provider: 'google',
      timezone: 'Europe/London',
      answers: { channels: ['meta'] },
      provide: { website: 'https://theocandles.com', businessName: 'Theo Candles', currency: 'GBP' },
    },
    {
      name: 'Not running ads yet',
      email: 'ines@petalandpine.com',
      fullName: 'Inès Laurent',
      provider: 'google',
      timezone: 'Europe/Paris',
      website: { businessName: 'Petal & Pine', currency: 'EUR', detects: [], fields: { heroProduct: 'Linen bedding', competitors: ['Parachute', 'Brooklinen'] } },
      answers: { channels: ['not_yet'] },
    },
    {
      name: 'Agency running everything (third channel deferred)',
      email: 'ops@northbeam-agency.com',
      fullName: 'Chris Park',
      provider: 'google',
      timezone: 'America/Los_Angeles',
      website: { businessName: 'Northbeam Agency', currency: 'USD', detects: ['meta_pixel', 'google_ads_tag', 'tiktok_pixel'] },
      answers: { channels: ['meta', 'google', 'tiktok'] },
    },
  ],
});
