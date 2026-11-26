/**
 * Replay suite for the follow-up agent template. Each persona is a realistic user; the harness
 * runs them through the real engine and asserts every runtime rule (packages/testing).
 */
import { definePersonas } from '../../packages/testing/src/index.ts';
import spec from './spec.ts';

export const fieldMap = { displayName: 'displayName', avatar: 'avatar', businessName: 'brokerage', timezone: 'timezone', referralSource: 'referralSource' };

const quietLeads = (count: number) => ({
  values: { count },
  examples: [{ name: 'Sarah Kim', lastMessage: 'Is the 3-bed on Elm still available?', quietDays: 12 }],
  source: 'own' as const,
});

export default definePersonas({
  spec,
  activations: {
    instagram_followup: { seconds: 20, result: quietLeads(9) },
    email_followup: { seconds: 15, result: quietLeads(14) },
    outlook_followup: { seconds: 15, result: quietLeads(11) },
    crm_followup: { seconds: 10, result: quietLeads(23) },
  },
  personas: [
    {
      name: 'IG-first agent at a brokerage',
      email: 'jordan@kw.com',
      fullName: 'Jordan Lee',
      provider: 'google',
      timezone: 'America/Chicago',
      website: { businessName: 'Keller Williams', detects: ['instagram_link'] },
      answers: { followup_channels: 'preselected' }, // instagram (site link) + gmail (google sign-in)
      decisions: { instagram_followup: { tone: 'casual', sendMode: 'approve' } },
    },
    {
      name: 'Solo agent on Gmail',
      email: 'sam.realty@gmail.com',
      fullName: 'Sam Ortiz',
      provider: 'google',
      timezone: 'America/Denver',
      answers: { followup_channels: ['gmail'] },
      provide: { brokerage: 'Ortiz Realty' },
    },
    {
      name: "Doesn't follow up today",
      email: 'alex@sunsethomes.com',
      fullName: 'Alex Rivera',
      provider: 'microsoft',
      timezone: 'America/Los_Angeles',
      answers: { followup_channels: ['none'] },
    },
    {
      name: 'Team lead on Follow Up Boss, skips the extra step',
      email: 'priya@harborgroup.com',
      fullName: 'Priya Shah',
      provider: 'google',
      timezone: 'America/New_York',
      signals: { icpOptionShare: { fub: 0.46 } },
      answers: { followup_channels: ['fub', 'gmail'] },
      skipOptional: true,
    },
    {
      name: 'Instagram connect fails once, then works',
      email: 'mia@coastalliving.com',
      fullName: 'Mia Chen',
      provider: 'google',
      timezone: 'America/Los_Angeles',
      answers: { followup_channels: ['instagram'] },
      connectors: { instagram: { failFirst: 'User cancelled the Instagram dialog' } },
    },
  ],
});
