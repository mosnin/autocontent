# SEO articles

Marketer's article pipeline (`src/marketer/articles/`) already researched the SERP, outlined, wrote, scored, and produced
metadata, JSON-LD, internal links and a hero image. This page covers what was added to it, using Open SEO
(maximemarsal/open-seo, MIT) as the feature reference: web research with cited sources, editable SEO metadata, Unsplash
covers, bulk generation, WordPress publishing with Yoast or Rank Math fields, and drag-and-drop rescheduling. There is
no second app and no Firebase. Everything runs inside the existing stack, rails, caps and permissions.

## What existed, what was added

| Capability | Before | Added |
|---|---|---|
| Research | Exa SERP excerpts summarised by a model | OpenRouter search model with cited sources stored on the article (`articles/research.py`) |
| Metadata | Model-written title, slug, description, keywords; read-only | Rules (`articles/seo_meta.py`): the pipeline fits model output, `PATCH /articles/{id}/seo` refuses invalid edits; separate `meta_title` |
| Images | gpt-image-1 hero image | Unsplash cover with stored attribution (`services/unsplash.py`) |
| Bulk | One article per request | Keyword list → queued items with per-item status, under the caps (`articles/bulk.py`) |
| Publishing | Markdown download only | WordPress draft, live or scheduled, through the rails (`articles/publishing.py`, `services/wordpress.py`) |
| Calendar | Articles shown at creation time | Scheduled articles shown at their publish time and draggable to another day |

## Research

One call per article to `settings.article_research_model` (default `perplexity/sonar`) through OpenRouter, after the
Exa SERP step. Needs `MARKETER_OPENROUTER_API_KEY`; `MARKETER_ARTICLE_WEB_RESEARCH=false` turns it off. Without it the
pipeline runs exactly as before.

Everything that comes back is **untrusted content**:

- notes are cut to 6,000 characters, control characters removed, secrets redacted (`repos.memory.redact_secrets`);
- lines that read like instructions to a model (`repos.memory.instruction_like`) are dropped and counted in `flagged`;
- sources keep only `http(s)` URLs without credentials, at most 12, titles and snippets bounded and checked the same way;
- later prompts (outline, every section) only see it inside `<untrusted_content source="web_research">` with the
  instruction to treat it as facts to check, never as directions. A closing tag inside the content is escaped.

Stored on `articles.research` (`query`, `model`, `notes`, `sources[]`, `flagged`, `fetched_at`, `cost_usd`) and shown on
the article page as "Sources". The web renders only `https` links, with `rel="noopener noreferrer nofollow"`.

**Money and traces.** The call checks the caps first (`ensure_can_spend`), runs in a GenAI span (`chat {model}`,
provider `openrouter`, tokens, `marketer.cost_usd`, sources and flagged counts), and writes one `spend_ledger` row
(`provider=openrouter`, `sku=research:{model}`) through the article's `SpendContext`. Cost is computed from a price
registry in code (`RESEARCH_MODELS`, quantised to micro-dollars) or OpenRouter's reported cost when higher; a model not
in the registry is refused, never run unpriced. A retry of the same article reuses research stored for the same
keyword, so it is not paid for twice.

## Metadata

| Field | Rule |
|---|---|
| `meta_title` | 1 to 60 characters (the SEO title; `title` stays the H1) |
| `meta_description` | 1 to 155 characters |
| `slug` | lowercase ASCII words and single hyphens, at most 80 |
| `focus_keyword` | 1 to 100 characters |
| `keywords` (secondary) | at most 10, each 1 to 60, distinct from each other and the focus keyword |

The pipeline fits what the model wrote (cut at a word boundary, slugified, deduplicated). A person edits in the
"Search metadata" sheet, with live counts and a search-result preview; the route validates and answers 422
`{"errors": {field: message}}` rather than shortening anything. `web/lib/seo.ts` mirrors the rules for inline feedback.

## Unsplash covers

`MARKETER_UNSPLASH_ACCESS_KEY` stays on the server. With it, the pipeline picks a cover for the focus keyword when none
is set (`MARKETER_ARTICLE_UNSPLASH_COVER`), and a person can search and choose another. Per the Unsplash API guidelines:

- images are hotlinked from `images.unsplash.com`, never re-hosted (WordPress gets a `<figure>` that hotlinks it);
- the photographer and Unsplash are credited and linked with `utm_source=marketer&utm_medium=referral` everywhere the
  cover appears (article page, WordPress caption);
- choosing a photo calls its `download_location`.

The server re-reads a chosen photo by id; nothing the browser sends about a photo is stored. Search results never
include the download link or the key. Unsplash is free, so nothing is metered.

## Bulk generation

`POST /api/v1/article-batches {niche_id, keywords}` (a list, or one string with a keyword per line; at most
`MARKETER_ARTICLE_BULK_MAX_KEYWORDS`, default 50) stores one item per keyword. `bulk.tick_batch` moves a batch on; the
create route calls it once and the `seo_tick` cron every five minutes:

1. running items take their article's final status;
2. at most `MARKETER_ARTICLE_BULK_CONCURRENCY` (default 2) items of a batch run at once;
3. before an item starts, the caps are checked now (playbook daily cap, account global cap, prepaid credit) for one
   article's estimate ($0.80). A refusal fails nothing: the rest wait (`held_reason=spend_cap`, batch `paused_cap`) and
   start on a later tick when the caps allow;
4. the item is claimed atomically (`queued → running`) and its spawn is guarded by the idempotency key
   `article_batch_item:{id}`, so overlapping ticks never start it twice.

Each article run then meters every model call itself. A playbook whose cap is below one article is refused up front
(402). `POST /article-batches/{id}/cancel` stops the items that have not started.

## WordPress

### Connection

One per workspace (`wordpress_connections`): site URL, username, an application password, and the SEO plugin
(`yoast`, `rankmath` or `none`). `PUT /api/v1/integrations/wordpress` verifies before saving (`GET
/wp-json/wp/v2/users/me?context=edit`, reporting `can_publish`). The password is sealed with AES-256-GCM under
`MARKETER_INTEGRATION_SECRET_KEY` (32 bytes, base64), bound to the tenant and purpose (`services/secret_box.py`), and
never returned: responses carry `has_password`. Without the key, connecting is refused (503), never stored in the clear.
A check constraint refuses an unsealed value in the column.

Every request to the site (`services/wordpress.py`):

- https only, no credentials, query or fragment in the URL;
- the host is resolved and any non-public address refused (`services/ssrf.py`: loopback, RFC 1918, link-local and cloud
  metadata, CGNAT, NAT64 and friends), then the connection goes to the address that was checked (no second lookup, so
  DNS rebinding cannot swap in an internal host); TLS and the Host header keep the name;
- redirects are refused, never followed; 30 s timeout.

### Publishing

`POST /api/v1/articles/{id}/publish {mode: "draft" | "live", publish_at?}`:

- **draft** creates (or updates) a WordPress draft. Nothing goes public.
- **live** publishes now. If WordPress quietly keeps a draft (a user without `publish_posts`), it is reported as a
  failure with the post id, not as published.
- **live + publish_at** schedules it. Nothing is sent until the time; the cron sends it (up to five minutes late).

Each send is the HIGH rails action **`content.article.publish`** (`publish` kill-switch scope) through
`enforce_dispatch`: kill switches, an unresolved unknown outcome on the article, the request's idempotency key, and an
execution record. A 5xx or read timeout is an unknown outcome: the article shows "Check WordPress", a Required Action
appears in the inbox, and nothing retries until a person resolves it. Publish, schedule, move and unschedule are also
written to `security_audit_log` (`content.article.*`), as are connect and disconnect (`integration.*`).

Who may do what: `content:publish` to publish, schedule, move or unschedule; `integration:connect` /
`integration:disconnect` for the connection. The agent may send drafts only: live publishing, now or scheduled, needs a
person (403 `person_required`). A draft over a post that is already live is refused (it would take the post down).

**Scheduled publishes are bound to what was scheduled.** The canonical hash of what will be sent (content and cover,
metadata, site, plugin, mode) is stored at scheduling time and checked at send time as an approval binding. If the
article changed, nothing is sent and it waits as `needs_review`. Moving the time keeps the binding.

SEO fields go in the post's `meta`: Yoast `_yoast_wpseo_title`, `_yoast_wpseo_metadesc`, `_yoast_wpseo_focuskw`; Rank
Math `rank_math_title`, `rank_math_description`, `rank_math_focus_keyword` (focus, then secondary keywords). WordPress
stores only meta keys a site registers for the REST API, so sites that do not expose these keys get the post without
them; this is reported in the open questions below.

The Markdown becomes HTML in `articles/html.py`: headings, paragraphs, lists, quotes, emphasis, code and links. All text
is escaped and raw HTML is shown as text, so model-written content cannot inject markup into a customer's site; links
keep only `http(s)` and site-relative targets. The leading H1 is dropped (WordPress shows the title).

### States

`articles.publish_status`: `none`, `scheduled`, `publishing`, `published` (draft or live; `published_at` is set only for
live), `failed`, `unknown` (sent, no answer), `needs_review` (a scheduled publish that could not go out as scheduled).

## Calendar

`GET /api/v1/calendar` returns articles at `publish_at` when scheduled or published (status `scheduled`/`published`,
platform `wordpress`) and marks scheduled ones `movable`. On the Plan page a movable item can be dragged to another day;
it keeps its local time of day and calls `PATCH /api/v1/articles/{id}/schedule`. The move shows at once and is undone
with the server's reason if refused. Keyboard and touch users change the time in the article's publish sheet.

## Data and migration

`db/migrations/0035_seo_articles.sql` (rollback `0035_seo_articles.rollback.sql`): the `articles` columns above plus
`batch_id`, and the tables `wordpress_connections`, `article_batches`, `article_batch_items`. Pipeline saves
(`repos/articles.save`) never touch research, cover or publishing state; those have their own writes
(`repos/article_seo.py`) so a stage cannot overwrite a person's edit or a publish in flight.

## Configuration

| Variable | Default | Notes |
|---|---|---|
| `MARKETER_OPENROUTER_API_KEY` | empty | Research needs it |
| `MARKETER_ARTICLE_WEB_RESEARCH` | `true` | |
| `MARKETER_ARTICLE_RESEARCH_MODEL` | `perplexity/sonar` | Must be in `RESEARCH_MODELS` |
| `MARKETER_UNSPLASH_ACCESS_KEY` | empty | Covers need it |
| `MARKETER_ARTICLE_UNSPLASH_COVER` | `true` | Automatic cover in the pipeline |
| `MARKETER_ARTICLE_BULK_MAX_KEYWORDS` | `50` | |
| `MARKETER_ARTICLE_BULK_CONCURRENCY` | `2` | Per batch |
| `MARKETER_INTEGRATION_SECRET_KEY` | empty | 32 random bytes, base64. Without it WordPress cannot be connected |

Add them to a Modal secret the app already mounts. The `seo_tick` function (every five minutes) is new in
`modal_app.py`.

## Routes

| Method | Path | Permission |
|---|---|---|
| PATCH | `/api/v1/articles/{id}/seo` | `content:update` |
| GET | `/api/v1/articles/{id}/cover/search?q=` | `content:update` |
| PUT, DELETE | `/api/v1/articles/{id}/cover` | `content:update` |
| POST | `/api/v1/articles/{id}/publish` | `content:publish` |
| PATCH, DELETE | `/api/v1/articles/{id}/schedule` | `content:publish` |
| POST, GET | `/api/v1/article-batches` | `content:create`, `content:read` |
| GET | `/api/v1/article-batches/{id}` | `content:read` |
| POST | `/api/v1/article-batches/{id}/cancel` | `content:update` |
| GET | `/api/v1/integrations/wordpress` | `integration:read` |
| PUT | `/api/v1/integrations/wordpress` | `integration:connect` |
| DELETE | `/api/v1/integrations/wordpress` | `integration:disconnect` |

## Web

- SEO page: "Bulk generate" beside the one primary action opens its own sheet; recent batches show per-keyword status,
  progress and "Paused at cap".
- Article page: the publishing card (one next step: Connect WordPress, Publish, Change time or Update), the credited
  cover, search metadata with a search-result preview and an Edit sheet, and Sources.
- Integrations: a WordPress row; the connect sheet verifies and never shows the password again.
- Plan: drag scheduled articles between days.
- Previews: `/preview/app/seo/bulk`, `seo/a1/publish`, `seo/a1/connect`, `seo/a1/scheduled`, `seo/a1/live`,
  `seo/a1/unknown`, `integrations/wordpress`.

## Tests

`tests/test_seo_research.py`, `test_seo_meta.py` (metadata, HTML renderer, sealing), `test_wordpress_client.py`
(SSRF refusals, pinned connections, plugin fields, demoted publish), `test_article_publishing.py` (rails outcomes, kill
switch, unknown outcome and inbox, scheduled binding, agent drafts only), `test_article_bulk.py` (queue, concurrency,
cap holds, idempotent spawns), `test_seo_routes.py` (permissions by role, secret never returned, idempotency key),
`tests/integration/test_pg_seo.py`; web `test/seo.test.ts`.

## Open questions

- **Yoast and Rank Math meta over REST.** Neither plugin registers its meta keys for the core REST API by default. Sites
  need a small snippet (`register_post_meta(..., ['show_in_rest' => true])`) or a companion plugin for the fields to
  stick. Detecting this and telling the person is a follow-up.
- **Agent tool.** No agent tool publishes articles yet. When one is added it needs a row in the agent rails registry
  pointing at `content.article.publish`.
- **Spend ledger idempotency.** The ledger has no idempotency key column; repeat payment is prevented at the call sites
  (stored research is reused, bulk spawns are claim-guarded) rather than in the ledger.
