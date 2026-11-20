/**
 * Template: AI follow-up agent (e.g. real estate lead follow-ups).
 *
 * Pass scenario this encodes:
 *   sign in → brokerage inferred from the domain → "How do you follow up with leads today?"
 *   (multiple choice, pre-selected) → connect ONLY what they picked → activation scans
 *   conversations for leads that went quiet → rehearsal on a real lead's drafted follow-up
 *   (tone, send mode, signature with name and brokerage confirmed in place) →
 *   dashboard: "I found 14 leads who went quiet. Start following up?"
 */
import { defineSpec } from '../../packages/spec/src/index.ts';

const sendMode = {
  id: 'sendMode',
  prompt: 'How should I send follow-ups?',
  default: 'approve',
  gatesOutbound: true,
  options: [
    { id: 'approve', label: 'Ask me before sending' },
    { id: 'auto', label: 'Send automatically' },
  ],
};

const tone = {
  id: 'tone',
  prompt: 'Does this sound like you?',
  default: 'as_is',
  options: [
    { id: 'as_is', label: 'Like this' },
    { id: 'casual', label: 'More casual' },
    { id: 'professional', label: 'More professional' },
  ],
};

export default defineSpec({
  product: {
    name: 'Acme Follow-up',
    category: 'followup-agent',
    promise: 'An agent that follows up with every lead so none go cold.',
  },

  aha: {
    statement: 'The user sees real leads from their own inbox or DMs that went quiet, with follow-ups already drafted, and starts the agent.',
    event: 'aha_start_followups',
  },

  fields: [
    { id: 'displayName', label: 'Your name', tier: 'blocking', category: 'profile', infer: ['oauth_profile'], askInContext: { on: 'rehearsal', surface: 'message signature preview' } },
    { id: 'brokerage', label: 'Brokerage', tier: 'workflow', category: 'workflow', infer: ['email_domain', 'website', 'icp'], askInContext: { on: 'rehearsal', surface: 'message signature preview' } },
    { id: 'timezone', label: 'Timezone', tier: 'blocking', category: 'system', infer: ['browser'], askInContext: { on: 'rehearsal', surface: 'send-window preview' } },
    { id: 'market', label: 'Market', tier: 'workflow', category: 'workflow', infer: ['website', 'connector:follow_up_boss', 'connector:gmail'] },
    { id: 'avatar', label: 'Profile photo', tier: 'deferrable', category: 'profile', infer: ['oauth_profile'] },
    { id: 'referralSource', label: 'How did you hear about us', tier: 'deferrable', category: 'marketing', infer: ['utm'] },
    { id: 'teamSize', label: 'Team size', tier: 'deferrable', category: 'marketing', infer: ['email_domain'] },
  ],

  connectors: [
    {
      id: 'instagram', name: 'Instagram', auth: 'oauth', estSeconds: 22,
      verify: 'GET /me/conversations returns successfully',
      scopes: [
        { id: 'messages_read', description: 'Read your DM conversations to find leads', access: 'read' },
        { id: 'messages_send', description: 'Send follow-ups the way you choose', access: 'write' },
      ],
    },
    {
      id: 'gmail', name: 'Gmail', auth: 'oauth', estSeconds: 18,
      verify: 'users.messages.list returns successfully',
      scopes: [
        { id: 'gmail_read', description: 'Read email threads to find leads', access: 'read' },
        { id: 'gmail_send', description: 'Send follow-ups the way you choose', access: 'write' },
      ],
    },
    {
      id: 'outlook', name: 'Outlook', auth: 'oauth', estSeconds: 18,
      verify: 'GET /me/messages returns successfully',
      scopes: [
        { id: 'mail_read', description: 'Read email threads to find leads', access: 'read' },
        { id: 'mail_send', description: 'Send follow-ups the way you choose', access: 'write' },
      ],
    },
    {
      id: 'follow_up_boss', name: 'Follow Up Boss', auth: 'api_key', estSeconds: 25,
      verify: 'GET /v1/people?limit=1 returns successfully',
      scopes: [
        { id: 'people_read', description: 'Read your leads and their last contact date', access: 'read' },
        { id: 'notes_write', description: 'Log follow-ups back to the lead record', access: 'write' },
      ],
    },
  ],

  intents: [
    {
      id: 'followup_channels',
      prompt: 'How do you follow up with leads today?',
      hint: 'Pick all that apply.',
      about: 'workflow',
      kind: 'multi',
      allowOther: true,
      options: [
        { id: 'instagram', label: 'Instagram DMs', icon: 'instagram', capabilities: ['instagram_followup'], preselectWhen: [{ source: 'website', detects: 'instagram_link' }] },
        { id: 'gmail', label: 'Gmail', icon: 'gmail', capabilities: ['email_followup'], preselectWhen: [{ source: 'oauth_profile', has: 'google' }] },
        { id: 'outlook', label: 'Outlook', icon: 'outlook', capabilities: ['outlook_followup'], preselectWhen: [{ source: 'oauth_profile', has: 'microsoft' }] },
        { id: 'fub', label: 'Follow Up Boss', icon: 'crm', capabilities: ['crm_followup'], preselectWhen: [{ source: 'icp', segmentShareAtLeast: 0.4 }] },
        { id: 'none', label: "I don't. That's the problem.", none: true, icon: 'sparkle', capabilities: ['email_followup'] },
      ],
    },
  ],

  capabilities: [
    {
      id: 'instagram_followup', label: 'Instagram follow-ups', priority: 1,
      connectors: ['instagram'],
      fields: ['displayName', 'brokerage', 'timezone'],
      activation: { id: 'ig_scan', description: 'Scan the last 30 days of DMs for buyer/seller leads that went quiet.', access: 'read', estSecondsToFirstResult: 20 },
      proof: {
        id: 'ig_quiet_leads',
        statement: 'I found {count} leads in your DMs who went quiet, and drafted a follow-up for each.',
        metric: 'leads_found',
        cta: { label: 'Start following up', event: 'aha_start_followups' },
      },
      rehearsal: { example: 'a real lead who asked about a listing and went quiet', artifact: 'a drafted follow-up DM', decisions: [tone, sendMode] },
    },
    {
      id: 'email_followup', label: 'Email follow-ups', priority: 2, zeroSetup: true,
      connectors: ['gmail'],
      fields: ['displayName', 'brokerage', 'timezone'],
      activation: { id: 'gmail_scan', description: 'Scan the last 60 days of threads for leads with no reply from you or them.', access: 'read', estSecondsToFirstResult: 15 },
      proof: {
        id: 'email_quiet_leads',
        statement: 'I found {count} leads in your inbox who went quiet, and drafted a follow-up for each.',
        metric: 'leads_found',
        cta: { label: 'Start following up', event: 'aha_start_followups' },
      },
      rehearsal: { example: 'a real lead thread with no reply in 10+ days', artifact: 'a drafted follow-up email', decisions: [tone, sendMode] },
    },
    {
      id: 'outlook_followup', label: 'Outlook follow-ups', priority: 2,
      connectors: ['outlook'],
      fields: ['displayName', 'brokerage', 'timezone'],
      activation: { id: 'outlook_scan', description: 'Scan the last 60 days of threads for leads with no reply.', access: 'read', estSecondsToFirstResult: 15 },
      proof: {
        id: 'outlook_quiet_leads',
        statement: 'I found {count} leads in your inbox who went quiet, and drafted a follow-up for each.',
        metric: 'leads_found',
        cta: { label: 'Start following up', event: 'aha_start_followups' },
      },
      rehearsal: { example: 'a real lead thread with no reply in 10+ days', artifact: 'a drafted follow-up email', decisions: [tone, sendMode] },
    },
    {
      id: 'crm_followup', label: 'CRM follow-ups', priority: 3,
      connectors: ['follow_up_boss'],
      fields: ['displayName', 'brokerage', 'timezone'],
      activation: { id: 'fub_scan', description: 'Find leads in your CRM with no contact in 14+ days.', access: 'read', estSecondsToFirstResult: 10 },
      proof: {
        id: 'crm_stale_leads',
        statement: '{count} leads in Follow Up Boss have had no contact in 14+ days. Follow-ups are drafted.',
        metric: 'leads_found',
        cta: { label: 'Start following up', event: 'aha_start_followups' },
      },
      rehearsal: { example: 'your highest-value lead with no contact in 14+ days', artifact: 'a drafted follow-up', decisions: [tone, sendMode] },
    },
  ],

  budget: { maxScreens: 6, maxSeconds: 120, maxSecondsToProof: 90, maxSecondary: 1 },
});
