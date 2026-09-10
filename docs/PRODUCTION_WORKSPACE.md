# Production workspace and Company OS

Marketer owns creative production. The Production page under Campaigns brings existing outputs into one library and gives each output a delivery brief, required inputs, context references, review notes, approval, handoff history and observed results. Generation, publishing and budget controls keep their existing behavior.

## Working loop

1. Open an existing creative at `/production`. Search by title or filter by format; load more to continue through the entire library.
2. Record the objective, audience, owner and delivery requirements. Add required inputs with evidence that they are usable. Add exact Company OS document references when they inform the work.
3. Inspect the output. Add review notes against the whole creative or a video scene. Every note keeps its source revision; an old note is never silently reassigned to a new scene.
4. Resolve blocking notes and approve the current source and brief version. A later source update, re-render or brief edit invalidates that approval for the next handoff.
5. Record where the approved version was delivered. Attach observed results to that specific handoff, including measurement period, evidence and the next useful experiment. Results can describe an earlier handoff after the creative changes.

Approval records production review. It does not publish, launch an ad, authorize spending, or send a message. An outcome is a sourced observation entered by the operator, not an automatic causal verdict. External context references are recorded pins; this release does not automatically fetch or monitor external documents. Source revision records preserve approval identity and history, not immutable copies of every historical media file.

## Data and authorization

Migration `0042_production_workspace` adds tenant-scoped packages and append-only events, and a revision counter for media assets that can be overwritten at a stable storage key. Package updates lock the source and package rows and require both the expected package version and source fingerprint. A stale write returns 409; clients preserve unsaved text and require a reread rather than silently retrying approval.

The library projects the existing tables. It includes content campaigns and paid campaigns; videos, articles, image posts, ads, ad-studio variations, UGC, dramas, designs, motion, headshot outputs, compositions and media assets. Private headshot reference uploads are excluded. Campaign filters use explicit links, including orchestration campaign links to paid campaigns. Shared niches do not imply campaign membership.

Pagination uses `(created_at, kind, id)` with an upper `asOf` bound and up to 50 records per page. Inserts after that bound wait for refresh; titles/statuses are live and deleted records disappear. The opaque cursor carries a position and account/filter binding, not authorization. Every query branch separately enforces the authenticated account. There is no 1,000-record cutoff.

Native routes under `/api/v1/production` use Clerk/PAT authentication. SDK and MCP expose `production_library`, `get_production`, `update_production` and `production_preview`. The command contract is `marketer.models.production.ProductionCommand`; read before changing and never blindly retry a 409.

Company OS uses `GET /api/companyos/v1/library` and `/preview/{kind}/{creative_id}` with a delegated OAuth **access** token carrying `content:read`. These routes additionally check the active client, live grant, target resource and unsuspended account. They do not accept a Company OS company ID as account authority. The thumbnail route serves bounded JPEG data from owned storage, not arbitrary URL fetches or executable SVG. Some formats or expired local files have no thumbnail; their record remains visible and opens in Marketer.

## Rollout

Apply the migration before deploying the new API or the asset-registration change:

```sh
python scripts/migrate.py up
```

Use the existing deployment process for the FastAPI/Modal service and Marketer web. The web rewrite forwards `/api/companyos/*` to `NEXT_PUBLIC_API_BASE_URL`. Configure `MARKETER_APP_URL=https://www.marketer.sh` for source links and `MARKETER_OAUTH_ISSUER=https://www.marketer.sh` for the existing OAuth discovery flow. The public app origin must match Company OS's registered provider origin.

Register Company OS as a public PKCE client using the existing operator command (replace the callback origin with the actual Company OS deployment):

```sh
python scripts/oauth_client.py create \
  --name "Company OS" \
  --redirect-uri https://YOUR-COMPANY-OS-ORIGIN/marketplace/oauth/callback/marketer \
  --scope openid --scope profile --scope offline_access --scope content:read
```

Set the returned client ID as `MARKETER_OAUTH_CLIENT_ID` in the Company OS Convex deployment. Company OS uses its existing credential encryption key and audited rotating-token refresh lifecycle. Do not register a confidential client unless Company OS is separately extended to supply its secret.

Deploy the Marketer endpoint first, then the Company OS panel. Complete a hosted smoke test with a real account: consent, both collections, a second page, a protected image, source navigation, token refresh and disconnect/revocation. Local tests and fixture-backed screenshots do not prove this hosted flow.

For rollback, remove the UI/API entry points first and restore the old asset-registration code. The companion migration rollback drops production history; retain the additive tables on a production rollback unless losing that history is explicitly intended.

## Verification

`tests/integration/test_pg_production.py` runs against an explicitly configured disposable `MARKETER_PRODUCTION_TEST_DATABASE_URL`. It covers all families, 1,017 creatives, pagination and tenant boundaries, competing saves, source and asset revision changes, blocking review, historical outcome attribution and linked paid campaigns. CI points it at its disposable Postgres service. `test_production_contract.py`, API parity, SDK and existing OAuth tests cover the HTTP/tool/auth contracts.

Browser validation exercised brief save, note, resolution, approval, handoff and outcome against real new endpoints and disposable local Postgres at 375px and 1440px in both themes. A temporary test host supplied identity; the production Clerk boundary was verified separately and no preview/auth-bypass route is shipped.

September 10 local acceptance: 142 focused tests passed; the full database-enabled suite had 2,814 passes, four skips and one FFmpeg ASS-filter failure also reproduced on unchanged main. Ruff and the complete Next production build passed. All 43 migrations applied to a clean database; migration 0042 also rolled back and reapplied successfully. Independent review accepted the implementation and twelve Marketer screenshots. Hosted OAuth acceptance remains a separate rollout gate.
