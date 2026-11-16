/**
 * Template: developer tool agent (finds and fixes flaky tests).
 *
 * Pass scenario:
 *   sign in with GitHub → org + repos read from the account → "Where does your code live?"
 *   pre-selected → connect (GitHub App install) → activation reads the last 200 CI runs and
 *   ranks flaky tests → rehearsal on the flakiest real test (PRs or comments only, which branches)
 *   → dashboard: "I found 12 flaky tests in acme/api costing about 9 CI hours a week." [Open fix PRs]
 */
import { defineSpec } from '../../packages/spec/src/index.ts';

const prMode = {
  id: 'prMode',
  prompt: 'How should I fix them?',
  default: 'draft_prs',
  gatesOutbound: true,
  options: [
    { id: 'draft_prs', label: 'Open draft PRs for review' },
    { id: 'comment', label: 'Comment the fix, I’ll apply it' },
  ],
};
const scope = {
  id: 'scope',
  prompt: 'Which runs should I watch?',
  default: 'default_branch',
  options: [
    { id: 'default_branch', label: 'Default branch only' },
    { id: 'all', label: 'All branches and PRs' },
  ],
};

export default defineSpec({
  product: { name: 'Acme CI', category: 'devtool-agent', promise: 'An agent that finds flaky tests and opens the fixes.' },
  aha: { statement: 'The developer sees the flaky tests in their own repo ranked by wasted CI time, and asks the agent to open the fixes.', event: 'aha_open_fix_prs' },

  fields: [
    { id: 'displayName', label: 'Your name', tier: 'blocking', category: 'profile', infer: ['oauth_profile'] },
    { id: 'org', label: 'Organization', tier: 'blocking', category: 'system', infer: ['connector:github', 'connector:gitlab', 'email_domain'], askInContext: { on: 'rehearsal', surface: 'repo picker' } },
    { id: 'primaryRepo', label: 'Repository', tier: 'workflow', category: 'workflow', infer: ['connector:github', 'connector:gitlab'], askInContext: { on: 'rehearsal', surface: 'repo picker' } },
    { id: 'timezone', label: 'Timezone', tier: 'blocking', category: 'system', infer: ['browser'] },
    { id: 'role', label: 'Role', tier: 'deferrable', category: 'marketing', infer: [] },
    { id: 'referralSource', label: 'How did you hear about us', tier: 'deferrable', category: 'marketing', infer: ['utm'] },
  ],

  connectors: [
    { id: 'github', name: 'GitHub', auth: 'oauth', estSeconds: 20, verify: 'GET /installation/repositories returns at least one repo', scopes: [
      { id: 'actions_read', description: 'Read CI runs and test results', access: 'read' },
      { id: 'contents_read', description: 'Read code to understand failing tests', access: 'read' },
      { id: 'pull_requests_write', description: 'Open fix PRs the way you choose', access: 'write' },
    ] },
    { id: 'gitlab', name: 'GitLab', auth: 'oauth', estSeconds: 22, verify: 'GET /api/v4/projects?membership=true&per_page=1', scopes: [
      { id: 'read_api', description: 'Read pipelines, jobs and code', access: 'read' },
      { id: 'write_mr', description: 'Open merge requests the way you choose', access: 'write' },
    ] },
  ],

  intents: [
    {
      id: 'code_host',
      prompt: 'Where does your code live?',
      about: 'workflow',
      kind: 'single',
      options: [
        { id: 'github', label: 'GitHub', icon: 'github', capabilities: ['github_flaky'], preselectWhen: [{ source: 'oauth_profile', has: 'github' }] },
        { id: 'gitlab', label: 'GitLab', icon: 'gitlab', capabilities: ['gitlab_flaky'], preselectWhen: [{ source: 'oauth_profile', has: 'gitlab' }] },
        { id: 'exploring', label: 'Just exploring', none: true, icon: 'sparkle', capabilities: ['public_demo'] },
      ],
    },
  ],

  capabilities: [
    {
      id: 'github_flaky', label: 'Flaky test fixer', priority: 1,
      connectors: ['github'], fields: ['org', 'primaryRepo', 'timezone'],
      activation: { id: 'gh_ci_scan', description: 'Read the last 200 CI runs across your repos and rank flaky tests by wasted CI time.', access: 'read', estSecondsToFirstResult: 20 },
      proof: {
        id: 'gh_flaky',
        statement: 'I found {count} flaky tests in {repo}, costing about {hours} CI hours a week.',
        metric: 'flaky_tests',
        cta: { label: 'Open fix PRs', event: 'aha_open_fix_prs' },
        fallback: { source: 'public', labeled: true, statement: 'Here is what I found in a public repo like yours: {count} flaky tests.' },
      },
      rehearsal: { example: 'your flakiest real test and its last 5 failures', artifact: 'the fix I would propose', decisions: [prMode, scope] },
    },
    {
      id: 'gitlab_flaky', label: 'Flaky test fixer', priority: 1,
      connectors: ['gitlab'], fields: ['org', 'primaryRepo', 'timezone'],
      activation: { id: 'gl_ci_scan', description: 'Read the last 200 pipelines and rank flaky tests by wasted CI time.', access: 'read', estSecondsToFirstResult: 22 },
      proof: {
        id: 'gl_flaky',
        statement: 'I found {count} flaky tests in {repo}, costing about {hours} CI hours a week.',
        metric: 'flaky_tests',
        cta: { label: 'Open fix MRs', event: 'aha_open_fix_prs' },
      },
      rehearsal: { example: 'your flakiest real test and its last 5 failures', artifact: 'the fix I would propose', decisions: [{ ...prMode, options: [{ id: 'draft_prs', label: 'Open draft MRs for review' }, { id: 'comment', label: 'Comment the fix, I’ll apply it' }] }, scope] },
    },
    {
      id: 'public_demo', label: 'Try it on a public repo', priority: 2, zeroSetup: true,
      connectors: [], fields: ['timezone'],
      activation: { id: 'public_scan', description: 'Run the flaky-test scan on a well-known public repo so you can see real output.', access: 'read', estSecondsToFirstResult: 12 },
      proof: { id: 'public_flaky', statement: 'In {repo} I found {count} flaky tests. Install on your repo to see yours.', metric: 'flaky_tests', cta: { label: 'Install on my repo', event: 'aha_install_from_demo' } },
      rehearsal: { example: 'the flakiest test in that public repo', artifact: 'the fix I would propose', decisions: [scope] },
    },
  ],

  budget: { maxScreens: 6, maxSeconds: 120, maxSecondsToProof: 90, maxSecondary: 0 },
});
