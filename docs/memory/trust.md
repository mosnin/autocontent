# Trust rules

## Trust levels

Trust is derived from the source in code (`trustFor` in `facts.ts`, `trust_for` in `repos/memory.py`). An extractor's
output, a tool argument or a request body cannot set it.

| Source | Trust | Shown as |
|---|---|---|
| `person`: the account owner, on the Memory page | `trusted` | no badge |
| Any fact a person confirmed | `trusted` | no badge |
| `message`: something the person wrote in chat, read by the extractor | `unconfirmed` | Unconfirmed |
| `approval`, `job`, `metric`: the platform's own records | `unconfirmed` | Unconfirmed |
| `web`, `document`, `tool`: content the person did not write | `untrusted` | Outside source |

A chat message is `unconfirmed` and not `trusted` because a model read it. The person said something; the extractor
decided what it meant.

## What untrusted content cannot do

1. **It cannot become a brand rule.** A rule-bearing fact (`rule.text`, `rule.scope`, `claim.status`, `forbids`) from
   any source other than the person is stored pending. It is not retrieved, and the agent cannot confirm it. This
   holds for `unconfirmed` chat extractions too: a rule waits for a click.
2. **It cannot replace what the person confirmed.** A lower-trust value for a single-valued slot is stored pending as
   a challenge. The confirmed value stays current until the person accepts the new one.
3. **It cannot promote itself.** Confirm, correct and forget are refused for the agent's service token
   (`backend/routes/memory.py`), and the agent can never write a `person` source. Nothing a model reads can make a
   fact trusted.
4. **It cannot give instructions.** Text from a non-person source that reads like an instruction ("ignore previous
   instructions", role or delimiter spoofing, tool coercion) is rejected at write time. On the way out, every fact
   reaches the model inside `<untrusted_content>` with its trust label, and angle brackets in remembered text are
   replaced so a value cannot close that wrapper.
5. **It cannot undo a forget.** A value the person forgot or dismissed is refused when a non-person source offers it
   again.

Extraction adds two checks of its own (`validateExtraction`): at most 8 candidates per message, and a grounding check
that at least half of a value's words appear in the text it was read from.

## Secrets

Memory never stores secrets or raw credentials.

- A fact whose value, entity name or source reference looks like a credential is **rejected**, not stored with a hole
  in it. "Our API key is ..." is not a marketing fact.
- The source excerpt is **redacted** before it is stored.
- The check runs in the agent (`redact.ts`) and again in the backend (`secret_kinds`).

It covers API key prefixes, JWTs, private keys, card numbers (Luhn-checked), US social security numbers, IBANs (agent
side), `password:` / `secret=` / `token is ...` assignments, `Bearer` and `Basic` headers, URLs with a password, and
long hex strings. It is a pattern check: it will miss a secret that looks like an ordinary word, and it will reject
some harmless text that looks like a key. A rejected fact shows up in the write log as `rejected: secret`.

## Size caps

| Cap | Limit | When it is hit |
|---|---|---|
| Entity name | 120 characters | rejected |
| Value | 500 characters | rejected |
| Source excerpt | 300 characters | truncated |
| Source reference | 200 characters | rejected |
| Current and pending facts per account | 2,000 | the write is refused (`tenant_full`) |
| All fact rows per account, history included | 20,000 | the write is refused |
| Learnings per account | 500 | refused |
| Claim | 300 characters | rejected |
| Evidence items per learning | 12 | rejected |
| Memory injected per turn | 1,600 characters, 14 facts, 3 learnings | lower-ranked lines are left out |

A full account refuses new facts. It never evicts old ones, because an eviction would be a silent forget.

## Tenant isolation

- The tenant is the authenticated user. In the backend that is `ctx.user_id`; for the agent it is the `x-tenant-id`
  header, set from the server-derived execution context in `agent/src/marketer/api.ts`. No path, query or body field
  names a tenant.
- Every repo function takes `user_id` and every query filters on it. There is no function that reads across users.
- Another account's fact id behaves like an id that does not exist: 404 on history, confirm, correct and forget, and
  a merge that touches nothing.
- The agent's stores take the tenant id as an argument on every call and validate its shape. The read path drops any
  row whose tenant is not the caller's, as a second check.
- Tests: `tenant isolation` in `agent/test/memory.test.ts`, `test_tenant_a_cannot_touch_tenant_b` in
  `tests/integration/test_pg_memory.py`, and `test_reads_are_scoped_to_the_caller` in `tests/test_memory_route.py`.

## Who may call what

| Operation | Person (app) | Agent (service token) |
|---|---|---|
| Read facts, history, learnings, audit | yes | yes |
| Write a fact | yes, always as `person` | yes, never as `person` |
| Confirm, correct, forget | yes | no (403) |
| Record a learning, change its status | yes | yes, under the evidence rules |
| Merge exact duplicates | yes | yes |
