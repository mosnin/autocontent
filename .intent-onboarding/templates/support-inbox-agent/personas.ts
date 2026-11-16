import { definePersonas } from '../../packages/testing/src/index.ts';
import spec from './spec.ts';

export const fieldMap = { displayName: 'displayName', businessName: 'businessName', website: 'website', timezone: 'timezone', referralSource: 'referralSource' };

const answerable = (count: number, total: number) => ({
  values: { count, total, share: `${Math.round((count / total) * 100)}%` },
  examples: [{ name: 'Priya N.', title: 'How do I change my billing date?', lastMessage: 'I need to move my renewal to the 15th' }],
  source: 'own' as const,
});

export default definePersonas({
  spec,
  activations: {
    zendesk_agent: { seconds: 25, result: answerable(212, 500) },
    intercom_agent: { seconds: 24, result: answerable(188, 500) },
    gmail_agent: { seconds: 18, result: answerable(64, 140) },
    docs_answers: { seconds: 18, result: { values: { count: 37 }, examples: [], source: 'public' } },
  },
  personas: [
    {
      name: 'SaaS support lead with a Zendesk widget on the site',
      email: 'dana@ledgerly.io',
      fullName: 'Dana Whitfield',
      provider: 'google',
      timezone: 'America/New_York',
      website: { businessName: 'Ledgerly', detects: ['zendesk_widget', 'help_center_link'], fields: { helpCenterUrl: 'https://help.ledgerly.io' } },
      answers: { ticket_source: 'preselected' }, // zendesk (widget) + gmail (google sign-in)
      skipOptional: true,
    },
    {
      name: 'Founder answering from a shared Gmail inbox',
      email: 'sam@tinyroast.coffee',
      fullName: 'Sam Patel',
      provider: 'google',
      timezone: 'Europe/London',
      website: { businessName: 'Tiny Roast', detects: [] },
      answers: { ticket_source: ['gmail'] },
      decisions: { gmail_agent: { tone: 'warmer', sendMode: 'draft' } },
    },
    {
      name: 'Intercom team, Zendesk connect fails once',
      email: 'lee@orbitpay.com',
      fullName: 'Lee Ortega',
      provider: 'microsoft',
      timezone: 'America/Los_Angeles',
      website: { businessName: 'OrbitPay', detects: ['intercom'] },
      answers: { ticket_source: ['intercom'] },
      connectors: { intercom: { failFirst: 'Workspace picker closed' } },
    },
    {
      name: 'No support system yet',
      email: 'ana@fieldnotes.studio',
      fullName: 'Ana Costa',
      provider: 'google',
      timezone: 'America/Sao_Paulo',
      website: { businessName: 'Field Notes Studio', detects: ['help_center_link'], fields: { helpCenterUrl: 'https://fieldnotes.studio/faq' } },
      answers: { ticket_source: ['none'] },
    },
  ],
});
