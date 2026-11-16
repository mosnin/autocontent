import { definePersonas } from '../../packages/testing/src/index.ts';
import spec from './spec.ts';

export const fieldMap = { displayName: 'displayName', businessName: 'businessName', website: 'website', timezone: 'timezone', referralSource: 'referralSource' };

const change = (metric: string, direction: string, size: string, day: string, share: string, driver: string) => ({
  values: { metric, direction, change: size, day, share, driver, count: 1 },
  examples: [{ title: `${metric} ${direction} ${size}`, subtitle: driver }],
  source: 'own' as const,
});

export default definePersonas({
  spec,
  activations: {
    store_analyst: { seconds: 24, result: change('Revenue', 'fell', '12%', 'Tuesday', '80%', 'the Vitamin C serum going out of stock') },
    traffic_analyst: { seconds: 22, result: change('Conversion', 'rose', '0.6 points', 'Oct 28', '70%', 'paid social traffic after the new landing page') },
    revenue_analyst: { seconds: 20, result: change('Churn', 'rose', '1.8 points', 'October', 'Two thirds', 'annual plans that failed to renew') },
    benchmarks: { seconds: 14, result: { values: { business: 'your store', rate: '2.4%' }, examples: [], source: 'public' } },
  },
  personas: [
    {
      name: 'Shopify store with GA4 on the site',
      email: 'kai@northwindgoods.com',
      fullName: 'Kai Morgan',
      provider: 'google',
      timezone: 'America/Chicago',
      website: { businessName: 'Northwind Goods', currency: 'USD', detects: ['shopify', 'google_analytics'] },
      answers: { data_sources: 'preselected' },
      decisions: { store_analyst: { focus: 'revenue', cadence: 'daily' } },
    },
    {
      name: 'Subscription app on Stripe only',
      email: 'jo@meetquill.app',
      fullName: 'Jo Lindqvist',
      provider: 'google',
      timezone: 'Europe/Stockholm',
      website: { businessName: 'Quill', currency: 'EUR', detects: ['stripe'] },
      answers: { data_sources: ['stripe'] },
    },
    {
      name: 'Spreadsheet-only shop owner on Gmail',
      email: 'rosa.ceramics@gmail.com',
      fullName: 'Rosa Diaz',
      provider: 'google',
      timezone: 'America/Mexico_City',
      answers: { data_sources: ['sheets'] },
      provide: { website: 'https://rosaceramics.mx', businessName: 'Rosa Ceramics' },
    },
  ],
});
