import { definePersonas } from '../../packages/testing/src/index.ts';
import spec from './spec.ts';

// Developer tools learn the org from the account, not from a business email guess.
export const fieldMap = { displayName: 'displayName', timezone: 'timezone', referralSource: 'referralSource' };

const flaky = (repo: string, count: number, hours: number) => ({
  values: { repo, count, hours },
  examples: [{ title: 'checkout.spec.ts > applies discount', subtitle: 'Failed 5 of the last 40 runs, always on a timeout', meta: '12% flaky' }],
  source: 'own' as const,
});

export default definePersonas({
  spec,
  activations: {
    github_flaky: { seconds: 20, result: flaky('acme/api', 12, 9) },
    gitlab_flaky: { seconds: 22, result: flaky('platform/web', 7, 5) },
    public_demo: { seconds: 12, result: { values: { repo: 'a popular open-source web framework', count: 31 }, examples: [], source: 'public' } },
  },
  personas: [
    {
      name: 'Engineer signing in with GitHub',
      email: 'mo@acme.dev',
      fullName: 'Mo Haddad',
      provider: 'github',
      timezone: 'Europe/Berlin',
      answers: { code_host: 'preselected' },
      connectors: { github: { inferences: [{ field: 'org', value: 'acme' }, { field: 'primaryRepo', value: 'acme/api' }] } },
      decisions: { github_flaky: { prMode: 'draft_prs', scope: 'default_branch' } },
    },
    {
      name: 'GitLab team lead',
      email: 'sofia@platformco.eu',
      fullName: 'Sofia Rossi',
      provider: 'google',
      timezone: 'Europe/Rome',
      answers: { code_host: ['gitlab'] },
      connectors: { gitlab: { inferences: [{ field: 'org', value: 'platform' }, { field: 'primaryRepo', value: 'platform/web' }] } },
    },
    {
      name: 'Just exploring, no install',
      email: 'curious.dev@gmail.com',
      fullName: 'Alex Kim',
      provider: 'google',
      timezone: 'Asia/Seoul',
      answers: { code_host: ['exploring'] },
    },
  ],
});
