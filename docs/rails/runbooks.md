# Runbooks

## Engage a kill switch

**When:** an agent is doing something wrong at scale, a platform is misbehaving, a billing incident, or you are not
sure and need time to look.

Backend (authoritative, every tenant, takes effect on the next dispatch):

```sql
-- or the admin feature-flags page
insert into feature_flags (key, enabled, description, updated_by)
values ('rails.kill_switch.spend', true, 'incident #123: optimizer raising budgets', 'you@marketer.sh')
on conflict (key) do update set enabled = excluded.enabled, description = excluded.description, updated_by = excluded.updated_by;
```

Keys: `rails.kill_switch.all`, `rails.kill_switch.publish`, `rails.kill_switch.spend`.

Agent fleet only (no backend change; a secret takes effect without a deploy):

```bash
cd agent && printf 'spend' | npx wrangler secret put MARKETER_RAILS_KILL_SWITCH
# values: off | all | publish | spend | publish,spend   (anything else counts as all)
```

One ad account: `PATCH /api/v1/ads/accounts/{id}/governance` with `{"killswitch": true}` (audited as
`account.governance`). This changes the account's governance hash, so its pending ad approvals are refused (and
expired) if someone later tries to execute them.

**What still works:** pausing and ending campaigns, rejecting content and ad changes, reads, drafts, MEDIUM makers
(content credits are bounded by the playbook spend caps, not the rails).

**What people see:** 402 `kill_switch: kill switch engaged (spend)`; the agent reports it and does not retry.

**Release:** set `enabled = false` (or `MARKETER_RAILS_KILL_SWITCH=off`). Nothing queued replays on its own: refused
dispatches were never queued.

## Resolve unknown outcomes

**When:** the inbox shows "We can't confirm …", or a retry answers 409 `outcome_unknown`.

1. Open the target: `video_post` / `carousel_post` → the social account (and the scheduler's dashboard);
   `ad_campaign` → the ad platform's campaign page; `job` / `image_post` → whether the scheduling function ran
   (Modal logs) and whether a post exists.
2. Decide what actually happened.
3. Resolve as a person (the agent cannot):

   ```bash
   curl -X POST "$API/api/v1/workspace/required-actions/$ID/resolve" \
     -H "Authorization: Bearer $PERSON_TOKEN" -H 'content-type: application/json' \
     -d '{"resolution":"confirmed_failed"}'
   ```

4. If it failed, retry the original action (retry the video, re-run the budget change). If it succeeded, do nothing:
   retrying would duplicate it.

Find them in SQL:

```sql
select id, user_id, action, target_type, target_id, error, created_at
from rails_executions
where resolution is null
  and (outcome = 'indeterminate' or (outcome is null and created_at < now() - interval '15 minutes'))
order by created_at desc;
```

Many at once usually means an upstream outage (scheduler or ad platform timing out). Check the provider's status,
engage the matching kill switch, and resolve after the provider confirms what landed.

## The rails store is down

**Symptoms:** HIGH/CRITICAL routes answer 503 `rails_unavailable`; the inbox loads without Required Actions; logs show
`rails: kill switch / ledger read failed` or `could not open execution record`.

**Why it is closed:** acting without a record would make unknown outcomes invisible (ADR 0003).

1. Check Postgres health and the pool (`MARKETER_DATABASE_URL`, connections).
2. Check migration 0027 is applied: `select to_regclass('rails_executions');` (null means apply it:
   `marketer-migrate up`).
3. Nothing needs replaying: refused dispatches sent nothing. Agents told the person; people retry.

If you ever see `rails: could not record outcome …` at ERROR: the side effect ran (or not) but its outcome was not
written. The row stays open, turns into an unknown outcome after 15 minutes, and appears in the inbox: resolve it as
above.

## An approval was refused with `approval_args_mismatch` or `approval_governance_changed`

Expected behaviour, not an incident. The campaign's budget, the draft budget or the account's caps changed after the
approval was requested. The approval is now `expired` (audited `approval.invalidated`). Ask for a new change from the
current state; the new approval binds to it.

## Add a HIGH or CRITICAL action

1. **Backend:** add it to `ACTIONS` in `src/marketer/rails/actions.py` (tier, scopes, `reduces` if it only winds
   down). At the dispatch site:

   ```python
   try:
       dispatch = await rails.enforce_dispatch("x.y", user_id=..., principal=rails.principal_of(ctx),
                                               args={...}, target_type="...", target_id=str(...))
   except rails.RailsDenied as e:
       raise to_http(e) from e
   try:
       result = await dispatch.run(lambda: send(...), definite=(MyDomainError,))
   except rails.OutcomeUnknown as e:
       raise to_http(e) from e
   ```

   Settle every dispatch exactly once (`run`, `succeeded`, `failed`). Add the router dependency
   `Depends(rails_request_context)` if the module is new.
2. **Agent:** if a tool reaches it, define the tool with `writeTool` at the right tier, add it to `RAILS_TOOLS`
   (`backendAction` = the new action) and to `EXPECTED_RISK`.
3. **Tests:** a truth-table or route test for the new action (kill switch, outcome), `tests/test_rails_core.py` and
   `agent/test/marketer-rails.test.ts` will check the tables line up.
4. **Docs:** the dispatch-site table in [README.md](README.md) and, if the action changes what a person must approve,
   an ADR.

## Roll back migration 0027

`db/migrations/0027_rails.rollback.sql` drops `rails_executions`. The code needs the table: roll back the code first,
or every HIGH/CRITICAL route will answer 503. Approval bindings live in `ad_approvals.payload_json` and survive a
rollback; older code ignores the `rails` key.
