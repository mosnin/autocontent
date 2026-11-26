# Required Actions

A Required Action is something only a person can settle, with one link to settle it. Today there is one kind:
an **indeterminate outcome**, a publish or a spend whose result we cannot confirm. It lives in the workspace inbox next
to the approvals, because that is where people already look for "things waiting on me".

Why a person: "did the post go out?" is answered by looking at TikTok or the ad platform. An agent that answered it
for itself could talk itself into a retry, which is exactly what ADR 0006 forbids.

## API contract

### `GET /api/v1/workspace/inbox` (extended, backward compatible)

The existing fields are unchanged: `items` still holds only videos, carousels and ad changes, and `counts.total` still
counts `items`. Two fields were added:

```json
{
  "items": [ ... unchanged ... ],
  "counts": { "total": 2, "video": 1, "carousel": 0, "ad_change": 1, "required_action": 1 },
  "required_actions": [
    {
      "id": "7b0c…",                       // rails_executions.id
      "kind": "indeterminate_outcome",
      "action": "content.post.send",
      "title": "We can't confirm the post went out",
      "detail": "Check video_post 3f2b… before trying again. Nothing will retry on its own.",
      "target_type": "video_post",
      "target_id": "3f2b…",
      "principal": "system",
      "created_at": "2026-11-17T08:12:00Z",
      "resolve_path": "/api/v1/workspace/required-actions/7b0c…/resolve",
      "resolutions": ["confirmed_succeeded", "confirmed_failed"]
    }
  ]
}
```

Why not a new `items` kind: the web app's `InboxKind` is a closed union (`video | carousel | ad_change`); a new value
would reach code that switches on it. New fields are ignored by old clients. When the web app adds the lane, it reads
`required_actions`.

If the rails store cannot be read, the inbox still loads with `required_actions: []` (logged).

### `POST /api/v1/workspace/required-actions/{id}/resolve`

Body: `{ "resolution": "confirmed_succeeded" | "confirmed_failed" }`

| Response | When |
|---|---|
| 200 `{ ok, id, resolution }` | resolved by a person |
| 403 | the caller is the agent (delegated service-token auth): only a person resolves |
| 404 | not found, not the caller's, or already resolved |
| 422 | another resolution value |

Resolving records who and when (`resolved_by`, `resolved_at`) and unblocks new dispatches on the same target. It does
not change the job or campaign itself: if the post did go out, the person knows the video is live; if it did not, they
can retry it.

## What the agent does

`get_workspace_inbox` returns the whole payload, so Marketer sees `required_actions` and can tell the person, with the
link. It has no tool to resolve, and the endpoint refuses it anyway.

## Code

- Listing: `PostgresRailsStore.open_required_actions` (`src/marketer/rails/store.py`): unresolved `indeterminate`
  rows plus `dispatching` rows older than 15 minutes, newest first.
- API: `backend/routes/workspace.py` (`RequiredAction`, `inbox`, `resolve_required_action`).
- Tests: `tests/test_rails_routes.py::test_spawn_timeout_is_indeterminate_and_lands_in_the_inbox`,
  `tests/test_workspace_route.py` (contract), `tests/integration/test_pg_rails.py`.

## Later (design)

One `required_actions` model for every "a person must decide" flow: approvals (agent and ad), `ask_person` questions,
ad-account and channel connections, each with a deadline and one link; one Inbox lane in the web app. Plan section 4.1
("Required Action", "Run Deadline").
