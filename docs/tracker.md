# Tracker

Tables a marketing team keeps next to the work: the content calendar, social posts, the A/B test log, campaigns, a
launch checklist, creative briefs, or anything else. Each table has typed fields, rows, and saved views (grid, board,
calendar, gallery). Fields can link to rows of another table or to Marketer's own objects, whose status and numbers
show live. People and Marketer's agent edit the same rows under the same permissions, and every change is kept.

## Where the code is

| Area | Files |
|---|---|
| Schema | `db/migrations/0037_tracker.sql` (rollback alongside) |
| Field types, values | `src/marketer/tracker/fields.py` (pure) |
| Filters and sorts | `src/marketer/tracker/filters.py` (pure; compiles to parameterised SQL) |
| Templates | `src/marketer/tracker/templates.py` |
| Service | `src/marketer/tracker/service.py` (every query scoped by tenant) |
| Routes | `backend/routes/tracker.py`, classified in `backend/policy.py` |
| Agent tools | `agent/src/marketer/tools/tracker.ts` |
| Web | `web/app/(app)/tracker/**`, `web/components/app/tracker/**`, `web/lib/tracker.ts`, `web/lib/tracker-client.ts` |
| Design system | `Sheet`, `Popover`, `Tag`/`TagDot` and the `--ds-tag-*` tokens (`web/design-system/components/sheet.tsx`, `tokens.css`) |
| Preview | `/preview/app/tracker`, `/tracker/empty`, `/tracker/content-calendar` (`/board`, `/calendar`, `/gallery`, `/row`), `/tracker/ab-tests` |
| Tests | `tests/test_tracker_fields.py`, `tests/test_tracker_routes.py`, `tests/integration/test_pg_tracker.py`, `agent/test/tracker-tools.test.ts`, `web/test/tracker.test.ts` |

## Data model

Five tables, all carrying `user_id` (the workspace's tenant id) like every product table:

| Table | Holds |
|---|---|
| `tracker_tables` | name, description, the template it came from |
| `tracker_fields` | name, type, `options` (JSON), position, `is_primary` (one per table: the row's title) |
| `tracker_rows` | `data` (JSON object, field id → value), fractional `position` for manual order, who created and last changed it |
| `tracker_views` | type, `config` (board grouping, calendar date field, card fields, column widths), `filters`, `filter_type`, `sorts`, `hidden_fields` |
| `tracker_row_history` | every create, change and delete: `changes` = field id → before/after, the actor id and type. Append-only (a trigger refuses UPDATE and DELETE; rows leave only when their table is deleted) |

Children reference their table through `(table_id, user_id)` → `tracker_tables (id, user_id)`, so a field, row, view
or history entry cannot point at another workspace's table even if application code were wrong. The service also
filters every query by tenant; the integration tests try every read and write across workspaces.

### Field types

| Type | Stored as | Notes |
|---|---|---|
| `text` | string ≤ 500 | newlines folded |
| `long_text` | string ≤ 20,000 | |
| `number` | number | `decimals` 0–6, optional `prefix`/`suffix` ("$", "%"); "1,204" is accepted |
| `single_select` | choice id | `choices` [{id, label, colour}], up to 100; values may be written as labels (the agent does) |
| `multi_select` | choice ids | up to 50 per cell |
| `date` | `YYYY-MM-DD`, or `YYYY-MM-DDTHH:MM` with `include_time` | a calendar day, no time zone shift |
| `checkbox` | boolean | |
| `url` | http or https only | `example.com` becomes `https://example.com`; `javascript:`, `mailto:` and other schemes are refused |
| `person` | member id | must be a member of this workspace (read from the `auth` schema) |
| `link_row` | row ids | rows of a table in the same workspace (the same table is allowed), up to 100 |
| `marketer_link` | object id | `kind`: video, carousel, article or campaign; must belong to the workspace |

Select colours are names (gray, blue, green, orange, red, purple, pink, teal, yellow), never hex, so both themes map
them to tokens. A removed option disappears from cells on read without rewriting rows. Compatible type changes convert
values (text ↔ long text ↔ link, single ↔ multiple select); anything else is refused with "add a new field instead".
The primary field stays text and can't be deleted.

Deleting a field removes its values and every view reference to it. Deleting a row removes it from link fields that
pointed at it. Deleting a table deletes its rows, views and history, and the link fields elsewhere that pointed at it.

### Live Marketer items

`marketer_link` values store only the id. Every row read resolves them in one query per kind, scoped to the workspace,
and returns them beside the rows (`resolved.objects["campaign:<id>"]`): title, current status, a link into Marketer,
and the numbers that matter for the kind (latest views and likes for a video, words for an article, budget for a
campaign). Nothing is copied into the row, so a status change in Marketer shows on the next read. Campaigns resolve
only for callers with `campaign:read`.

### Limits

50 tables per workspace, 60 fields and 30 views per table, 10,000 rows per table, 20 filters and 5 sorts per view,
pages of at most 500 rows. Creating a table, field, view or row takes a lock on its parent so the limits hold under
concurrency. Over a limit: 409 with the reason.

### Views, filters and sorts

A view saves `filters` (field, operator, value), `filter_type` (and/or), `sorts`, `hidden_fields` and `config`. The
row endpoint applies a view's saved filters and sorts when given `view_id`; ad hoc `filters` are added to them (and),
ad hoc `sorts` replace them, and `q` searches text, long text and link fields. The web app sends the view's current
settings explicitly, so unsaved changes (for a role that can't save the view) still filter.

Operators: text `contains`, `not_contains`, `is`, `is_not`; number `eq`, `neq`, `gt`, `gte`, `lt`, `lte`; date `is`,
`before`, `after`, `on_or_before`, `on_or_after`; checkbox `is`; single select and person `is`, `is_not`
(`is_any_of` for selects); multiple select `has`, `has_not`; links `has`; every type `empty` and `not_empty`.
Filters and sorts compile to SQL in which field ids and values are bind parameters, never text; a filter or sort on a
field deleted since is skipped.

## Permissions

The tracker reuses the catalog; it adds no resource.

| Action | Permission | Roles |
|---|---|---|
| Read tables, rows, history, members, templates, object search | `content:read` | owner, admin, marketer, analyst, agent |
| Add, edit and reorder rows; log an A/B test | `content:update` | owner, admin, marketer, agent |
| Delete a row | `content:delete` | owner, admin, marketer |
| Create a table (blank or from a template) | `playbook:create` | owner, admin, marketer, agent |
| Rename a table; add, change or delete fields; add, change or delete views | `playbook:update` | owner, admin, marketer, agent |
| Delete a table | `playbook:delete` | owner, admin, marketer |
| Search campaigns for a link | `content:read` + `campaign:read` (checked in the route) | |
| Log an A/B test when the workspace has no log yet | `content:update` + `playbook:create` (checked in the route) | |

Why reuse: rows are the team's working records about content, which is what `content:*` already governs, and the
shape of a table (its fields and views) is how the team organises its work, which is what `playbook:*` already
governs. The existing roles then come out right with no catalog change: an analyst reads but changes nothing; billing
sees nothing; the agent adds and edits rows and reshapes nothing it can't undo (it has no `content:delete` or
`playbook:delete`). A new `tracker:*` resource would have meant a catalog change in four copies for the same grants.
If a workspace ever needs "may edit trackers but not content", that is the moment to add one.

The agent's tools reshape nothing even though `agent ∩ marketer` holds `playbook:update`: the tool set has no field
or view tools. Its effective permissions are always `agent ∩` the person who started the session, so an analyst's
session can read trackers and write nothing.

Saved view settings (filters, sorts, hidden fields, widths) are part of the table's shape (`playbook:update`). People
without it can still filter and sort; the web app keeps those changes on their screen and says they aren't saved.

Nothing here moves money or publishes, so no tracker route goes through the rails. Deleting a table or a field is
recorded in `security_audit_log` (`tracker.table_deleted`, `tracker.field_deleted`); row changes are in
`tracker_row_history`.

## API

All under `/api/v1/tracker`.

| Method and path | Does |
|---|---|
| `GET /templates` | the template catalog |
| `GET /members` | the workspace's people for person fields (the agent gets names, not emails) |
| `GET /objects?kind=&q=` | Marketer items to link |
| `GET /tables`, `POST /tables`, `POST /tables/from-template` | list (with row counts), create blank, create from a template |
| `GET /tables/{id}`, `PATCH`, `DELETE` | one table with fields and views |
| `POST /tables/{id}/fields`, `PATCH /fields/{field}`, `DELETE` | fields |
| `POST /tables/{id}/views`, `PATCH /views/{view}`, `DELETE` | views (a table keeps at least one) |
| `GET /tables/{id}/rows?view_id=&filters=&filter_type=&sorts=&q=&limit=&offset=` | a page of rows, `total`, and `resolved` (linked row titles, live Marketer items) |
| `POST /tables/{id}/rows` `{values, before_id?}` | add a row; values keyed by field id or field name |
| `GET`, `PATCH`, `DELETE /tables/{id}/rows/{row}` | one row; PATCH changes only the cells passed (`null` clears) |
| `POST /tables/{id}/rows/{row}/move` `{before_id}` | reorder (null: to the end) |
| `GET /tables/{id}/rows/{row}/history` | the row's changes, newest first |
| `POST /ab-tests` `{values}` | append to the workspace's A/B test log, creating it from its template the first time |

Errors: 404 for anything outside the workspace (never 403, so ids can't be probed), 422 with a sentence for invalid
values (it lists the valid fields or options), 409 at a limit.

## Templates

One click creates the table, its fields, its views and starter rows:

| Template | Views | Prefilled with |
|---|---|---|
| Content calendar | Calendar, board by status, grid | the last 30 days of videos and articles, linked, with status and channel |
| Social post tracker | Board by status, calendar, grid | the last 30 days of carousels, linked |
| A/B test log | Grid, board by status, "Running" | nothing; the agent logs tests here |
| Campaign tracker | Board by stage, timeline, grid | every campaign, linked, with stage, goal, budget and dates |
| Launch checklist | Checklist sorted by due date, board by phase, calendar | eight standard launch tasks |
| Creative brief board | Board by stage, gallery, grid | nothing |

## The agent

| Tool | Tier | Permission | Departments |
|---|---|---|---|
| `list_trackers`, `get_tracker`, `list_tracker_rows` | LOW | `content:read` | all; `list_trackers` is also in Marketer's own reads |
| `add_tracker_row`, `update_tracker_row` | MEDIUM | `content:update` | strategist, content producer, SEO editor, distribution manager |
| `log_ab_test` | MEDIUM | `content:update` | the same, plus the media buyer (where it waits for a person, like everything above LOW there) |

Values are keyed by field name and options by label, so the agent writes `{"Status": "Running"}`; a wrong name or
label is refused with the valid ones listed. `get_tracker` tells it the names first. The strategist and content
producer are told to log every A/B test they plan, and the `ad-test-plan` skill registers its test in the log.
Rows the agent writes carry its actor type in the row history.

## The web app

- **Sidebar:** Tracker, under Plan.
- **`/tracker`:** your tables as cards (rows, last update), then the templates. With no tables, one line and the
  templates. People who can't create tables see the templates and who can.
- **`/tracker/[id]`:** crumbs and New row; a view switcher; search, filter, sort and visible fields; then the view.
  Views keep their own filters, sorts, hidden fields and column widths, saved for everyone when your role can.
- **Grid:** keyboard first. Arrows move, Enter or typing edits, Esc cancels, Enter commits and moves down, Tab
  commits and moves right, Delete clears, Space or Shift+Enter opens the row, Home/End jump. Columns resize by dragging
  their edge; the header menu edits, sorts or hides a field. The primary column stays put while you scroll sideways.
- **Board:** a column per option (or person). Drag a card to another column or within one; Alt+←/→ moves the
  focused card a column. "New" in a column adds a row already in it.
- **Calendar:** a month, Monday first. Drag a row to another day (the time is kept); + on a day adds a row there;
  rows without a date are counted.
- **Gallery:** cards with the first few fields.
- **Row sheet:** every field editable in place, linked Marketer items with their live numbers and a link to open
  them, and the history ("Ana changed Status from Drafting to In review · 2h ago").
- **Field sheet:** name, type with a one-line hint, then the type's options (choices with colours, decimals and
  prefix, include time, the linked table, the Marketer kind).
- **Motion:** sheets slide 24px in 220ms and out in 150ms; popovers pop from their trigger; a view fades up when you
  switch; drag shows the drop line and the card's place. Reduced motion keeps only fades.

## Not built yet

- Formula, rollup, lookup, attachment and rating fields.
- Grid row reordering by drag (rows reorder on the board, and through the API).
- Real-time updates between people looking at the same table (the next read shows changes).
- Undo beyond the row history (the history shows what to put back).
- Import from CSV and export.
