/**
 * Template: AI support agent that answers customer tickets.
 *
 * Pass scenario:
 *   sign in → company + help center inferred from the site, Zendesk pre-selected from its widget →
 *   "Where do customer questions come in today?" → connect only that → activation reads recent
 *   tickets and checks which ones the help center already answers → rehearsal on a real ticket
 *   (tone, send mode, what to do when unsure) → dashboard: "I can answer 212 of your last 500
 *   tickets with your own docs. Drafts are ready."
 */
import { defineSpec } from '../../packages/spec/src/index.ts';

const tone = {
  id: 'tone',
  prompt: 'Does this sound like your team?',
  default: 'as_is',
  options: [
    { id: 'as_is', label: 'Like this' },
    { id: 'warmer', label: 'Warmer' },
    { id: 'shorter', label: 'Shorter' },
  ],
};
const sendMode = {
  id: 'sendMode',
  prompt: 'How should I reply?',
  default: 'draft',
  gatesOutbound: true,
  options: [
    { id: 'draft', label: 'Draft replies for my team to send' },
    { id: 'auto_confident', label: 'Send when I’m confident, draft the rest' },
  ],
};
const unsure = {
  id: 'whenUnsure',
  prompt: 'When I’m not sure?',
  default: 'assign',
  options: [
    { id: 'assign', label: 'Leave it for a person' },
    { id: 'clarify', label: 'Ask the customer a clarifying question' },
  ],
};

const ticketProof = (id: string, where: string) => ({
  id,
  statement: `I can answer {count} of your last {total} ${where} tickets ({share}) with your own help center. Drafts are ready.`,
  metric: 'answerable_tickets',
  cta: { label: 'Review drafts', event: 'aha_review_drafts' },
  fallback: { source: 'public' as const, labeled: true, statement: 'Your help center already answers {count} common questions customers ask.' },
});

export default defineSpec({
  product: { name: 'Acme Support', category: 'support-inbox-agent', promise: 'An agent that answers customer tickets from your own docs.' },
  aha: { statement: 'The user sees how many of their real recent tickets the agent can already answer from their docs, with drafts ready, and opens them.', event: 'aha_review_drafts' },

  fields: [
    { id: 'displayName', label: 'Your name', tier: 'blocking', category: 'profile', infer: ['oauth_profile'] },
    { id: 'businessName', label: 'Company', tier: 'blocking', category: 'system', infer: ['email_domain', 'website'], askInContext: { on: 'confirm', surface: 'workspace card' } },
    { id: 'website', label: 'Website', tier: 'blocking', category: 'system', infer: ['email_domain'], askInContext: { on: 'confirm', surface: 'workspace card (personal email domains only)' } },
    { id: 'helpCenterUrl', label: 'Help center', tier: 'workflow', category: 'workflow', infer: ['website', 'connector:zendesk', 'connector:intercom'], askInContext: { on: 'rehearsal', surface: 'answer citation' } },
    { id: 'timezone', label: 'Timezone', tier: 'blocking', category: 'system', infer: ['browser'] },
    { id: 'signOff', label: 'Sign-off', tier: 'workflow', category: 'workflow', infer: ['oauth_profile', 'connector:zendesk'], askInContext: { on: 'rehearsal', surface: 'reply signature preview' } },
    { id: 'teamSize', label: 'Team size', tier: 'deferrable', category: 'marketing', infer: ['email_domain'] },
    { id: 'referralSource', label: 'How did you hear about us', tier: 'deferrable', category: 'marketing', infer: ['utm'] },
  ],

  connectors: [
    { id: 'zendesk', name: 'Zendesk', auth: 'oauth', estSeconds: 24, verify: 'GET /api/v2/tickets.json?per_page=1', scopes: [
      { id: 'tickets_read', description: 'Read recent tickets and your help center', access: 'read' },
      { id: 'tickets_write', description: 'Post replies the way you choose', access: 'write' },
    ] },
    { id: 'intercom', name: 'Intercom', auth: 'oauth', estSeconds: 22, verify: 'GET /me', scopes: [
      { id: 'conversations_read', description: 'Read recent conversations and articles', access: 'read' },
      { id: 'conversations_write', description: 'Reply the way you choose', access: 'write' },
    ] },
    { id: 'gmail', name: 'Gmail', auth: 'oauth', estSeconds: 18, verify: 'users.messages.list returns successfully', scopes: [
      { id: 'gmail_read', description: 'Read the shared support inbox', access: 'read' },
      { id: 'gmail_send', description: 'Send replies the way you choose', access: 'write' },
    ] },
  ],

  intents: [
    {
      id: 'ticket_source',
      prompt: 'Where do customer questions come in today?',
      hint: 'We pre-selected what we found on your site.',
      about: 'workflow',
      kind: 'multi',
      allowOther: true,
      options: [
        { id: 'zendesk', label: 'Zendesk', icon: 'zendesk', capabilities: ['zendesk_agent'], preselectWhen: [{ source: 'website', detects: 'zendesk_widget' }] },
        { id: 'intercom', label: 'Intercom', icon: 'intercom', capabilities: ['intercom_agent'], preselectWhen: [{ source: 'website', detects: 'intercom' }] },
        { id: 'gmail', label: 'A shared Gmail inbox', icon: 'gmail', capabilities: ['gmail_agent'], preselectWhen: [{ source: 'oauth_profile', has: 'google' }, { source: 'icp', segmentShareAtLeast: 0.5 }] },
        { id: 'none', label: 'No system yet', none: true, icon: 'sparkle', capabilities: ['docs_answers'] },
      ],
    },
  ],

  capabilities: [
    {
      id: 'zendesk_agent', label: 'Zendesk agent', priority: 1,
      connectors: ['zendesk'], fields: ['businessName', 'website', 'timezone', 'helpCenterUrl', 'signOff'],
      activation: { id: 'zendesk_scan', description: 'Read your last 500 tickets, group them by question, and check which ones your help center already answers.', access: 'read', estSecondsToFirstResult: 25 },
      proof: ticketProof('zendesk_answerable', 'Zendesk'),
      rehearsal: { example: 'a real ticket from this week that your docs answer', artifact: 'a drafted reply citing your help center', decisions: [tone, sendMode, unsure] },
    },
    {
      id: 'intercom_agent', label: 'Intercom agent', priority: 1,
      connectors: ['intercom'], fields: ['businessName', 'website', 'timezone', 'helpCenterUrl', 'signOff'],
      activation: { id: 'intercom_scan', description: 'Read your last 500 conversations and check which ones your articles already answer.', access: 'read', estSecondsToFirstResult: 25 },
      proof: ticketProof('intercom_answerable', 'Intercom'),
      rehearsal: { example: 'a real conversation from this week that your articles answer', artifact: 'a drafted reply citing your article', decisions: [tone, sendMode, unsure] },
    },
    {
      id: 'gmail_agent', label: 'Shared inbox agent', priority: 2,
      connectors: ['gmail'], fields: ['businessName', 'website', 'timezone', 'signOff'],
      activation: { id: 'gmail_scan', description: 'Read the last 30 days of the support inbox and check which threads your site already answers.', access: 'read', estSecondsToFirstResult: 18 },
      proof: ticketProof('gmail_answerable', 'inbox'),
      rehearsal: { example: 'a real customer email from this week', artifact: 'a drafted reply', decisions: [tone, sendMode, unsure] },
    },
    {
      id: 'docs_answers', label: 'Answers from your docs', priority: 3, zeroSetup: true,
      connectors: [], fields: ['businessName', 'website', 'helpCenterUrl'],
      activation: { id: 'docs_scan', description: 'Read your website and help pages, and work out the questions they already answer.', access: 'read', estSecondsToFirstResult: 20 },
      proof: {
        id: 'docs_answerable',
        statement: 'Your site already answers {count} questions customers usually ask. I can handle them from day one.',
        metric: 'answerable_questions',
        cta: { label: 'Add a chat widget', event: 'aha_add_widget' },
      },
      rehearsal: { example: 'a question your pricing page already answers', artifact: 'how I would answer it', decisions: [tone, unsure] },
    },
  ],

  budget: { maxScreens: 6, maxSeconds: 120, maxSecondsToProof: 90, maxSecondary: 1 },
});
