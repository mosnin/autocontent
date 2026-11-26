# Declutter audit: the web app

Audited every app screen through the fixture preview (`/preview/app/...`) at 1280px and 390px, in dark and light. Before and after screenshots were kept outside the repo.

The goal: each surface has one job and one primary action. A page opens with a summary (what needs you, the few numbers that matter), and the detail sits one step away. Focused tasks open in a dialog, and reference material folds away. Never more than one level of hiding, and common actions stay visible.

Severity: **High** means the page is a wall where the main task gets lost. **Medium** means noticeable noise or duplication. **Low** means polish.

## System-level findings

| Finding | Severity | Fix |
|---|---|---|
| Tool pages stack every table vertically: composer, KPIs, approvals, then two to four full sections. | High | A summary block, then one `Segmented` for the detail. Applied to Paid and Distribution. |
| Section titles carry counts as "Title · 3", which reads as part of the name. | Low | `Section` gained `count`: a faint number beside the title. |
| Reference material sits open on every visit (role descriptions, signing code, daily tables under a chart, production settings). | Medium | `Section` gained `collapsible`, with a height-following disclosure and no measuring. |
| Tab changes and toggles jump instead of moving. | Medium | `ds-swap` (220ms fade, 3px rise) on tab bodies through `Column panelKey`. The `Segmented` pill now slides. All of it uses the shared duration and easing tokens and collapses under reduced motion. |
| Two stacked segmented controls on one surface (Paid detail tabs plus the campaign status filter). | Medium | Secondary filters are `FilterPill`s. |
| Rows repeat a status badge that the row's own actions already say ("Needs approval" next to Approve, "Done" on every finished video, "Failed" beside a red error line). | Medium | Badges only where they add information. |
| The sidebar shows an empty "Chat / No chat" block on every page. | Low | Recents show once there are some. |

## Per screen

| Screen | What was crammed | Severity | Fix |
|---|---|---|---|
| **Home** | Nothing serious: brand, composer, a small bento. | Low | Unchanged, apart from the sidebar change above. |
| **Sessions / chat chrome** | The layout matches ref 02. The right panel open by default is dense, but it's the trace people ask for. | Low | Unchanged. Left for a decision: should the agent panel start closed below 1440px? |
| **Inbox / Activity** | Needs you: grouped approvals, which is good. Decisions: up to three badges per row (Corrected, Fallback used, Enforced/Shadow) plus time. Day groups print their count as a floating number on the right. | Medium | Each decision row has at most one badge, for a correction or for an enforced model that fell back. Mode and fallback now read as words in the subtitle on every width. Counts sit beside the title. Tab bodies swap with `ds-swap`, and an opened decision fades in. |
| **Content** | Three rows of controls before any work: status chips with counts, a search box, a playbook select. A second "Failed" section repeats failed items with its own chip row. Every row carries a badge. A five-item stat line. | High | One toolbar: search, a status `FilterPill`, a playbook `FilterPill`. The cross-tool Failed panel is folded, with its count in the title. Redundant badges are gone. The stat line has four items. |
| **Library (Deliverables)** | 21+ identical thumbs in one undifferentiated grid. | Medium | The grid is grouped Today / This week / Earlier, with counts. Paging and select-to-remix are unchanged. |
| **Plan** | Clean calendar. | Low | Unchanged. |
| **Paid media** | Composer, KPIs, Needs you (with an empty state when there's nothing), the Guardrails table, Campaigns (search, a five-way segmented filter, a duplicate "New" button), then a six-row audit trail. Four tables deep. | High | Summary: composer, KPIs, and Needs you only when something waits. Then one `Segmented`: Campaigns (n live) / Guardrails / Audit trail. The status filter is a `FilterPill`. The duplicate "New" is removed, since the header already has "New campaign". `/paid#activity` still opens the audit trail. With no accounts, the audit trail still shows. |
| **Paid campaign detail** | The chart is followed by a 14-row daily table with the same numbers. Details repeat the status (already a badge in the title) and the daily budget (editable just above). | Medium | The daily table is folded ("Day by day 14"). The duplicate facts are removed. |
| **Distribution** | Composer, KPIs, Needs you, Upcoming, Channels (one profile row plus three rows that all say "In Ayrshare"), and Campaigns, all stacked. | High | Summary, then one `Segmented`: Upcoming / Campaigns (n running) / Channels. Channels is one row naming the platforms. With no posting profile, Channels moves above the tabs, because nothing posts until it's connected. |
| **Distribution campaign detail** | Details repeat the status and budget shown above. A full "Add a lane" form sits open under the lanes. | Medium | "Add lane" is a button in the Lanes header that opens a dialog. The duplicate facts are removed. The wave on launch is untouched. |
| **SEO** | The status segmented control sits above the composer, far from the list it filters. | Medium | Search and status are one toolbar directly above the articles table. |
| **Analytics** | Three header actions (Accounts, Refresh, Get a report). The spend breakdown mixes a "Today" row into a 30-day breakdown. Pipeline and By playbook butt against the cards above. | Medium | The header has one primary ("Get a report"). Refresh is an icon button at the end of the filter toolbar; Accounts duplicated Integrations in the sidebar. The "Today" row is removed from the 30-day breakdown. The lower sections get breathing room. |
| **Brand** | Three boxed forms, then the save button, then a different thing (kits) under it, so it's unclear what "Save brand" saves. | High | `Segmented` Profile / Kits. Profile is flat fields with no boxes-in-sections, plus a sticky save bar that names when it was last saved. Kits has the kind switch with "New …" beside it, and each kit is edited in its dialog. `/brand#kits` opens Kits. |
| **Playbooks / playbook detail** | A nine-row "How it runs" list mixes what matters weekly (audience, cadence, cap, approval) with production settings. | Medium | Five rows stay visible. Format, voice, cost per 1k and hashtags fold under "Production details". |
| **Memory** | Every unconfirmed fact carries a pill, so a column of pills drowns the values. | Medium | Trust is a quiet word, not a badge. Groups show counts. Opened facts fade in, and the chevron turns. Tab bodies swap. |
| **Integrations** | One page holds the banner, search, three app groups, the agent-access code block, tokens, x402 and webhooks, at about 2,000px tall. | High | `Segmented` Apps / Developers. Apps: banner, search, app groups. Developers: agent access, tokens, x402, webhooks. The "For agents" rows and `#agents` / `#webhooks` links open Developers at the right place. Webhook rows go from four controls to two (a switch and a "more" menu with Test and Delete), and the signature code folds into "Verify signatures". |
| **Settings (all tabs)** | Seven tabs in one segmented control that overflows on a phone. Account and workspace settings are mixed in one row. | High | A calm grouped index: You (General, Security, Privacy) and Workspace (Team, Workspace, Spend, Billing), beside one section at a time. On a phone it's one scrolling row. It is still a tablist with arrow keys, and deep links (`#team`, `#security`, `?purchase=`) behave as before. A tab the role can't open now falls back to General instead of a blank panel. |
| **Settings → Team** | People, an always-open invite form, pending invitations (with an empty state), and a five-row role table, all at once. | High | People first, with a count and "Invite people" in the header (owners and admins only). The invite form is in a dialog, and its confirmation shows under People. Pending invitations show only when there are some. Role descriptions fold into "What each role can do". Analysts still see "Owners and admins invite people." |
| **Settings → Security, Workspace** | The password form is always open, and passkeys have an inline form. | Medium | **Not changed:** these live in `components/auth/security-settings.tsx` and `workspace-security.tsx`, which belong to the parallel auth work. Recommended: "Change password" as a row that opens a dialog, and "Add a passkey" as a button plus a dialog. |
| **Settings → Tokens, Webhooks** | See Integrations → Developers. Creating either was already a dialog. | Medium | Covered above. |
| **Settings → Billing** | Fine. | Low | Unchanged. It now sits under the Workspace group. |
| **Admin** | Eight bordered section pills, eight KPI cards, and a "Go to" list that repeats the pills. | Medium | Section links are quiet chips (no border until selected). Four headline KPIs, then a two-column Platform facts block. "Go to" is removed. |

## Primitives extended

- `Section`: `count`, `collapsible`, `defaultOpen`, `id`.
- `Column`: `panelKey` swaps the body with `ds-swap` when the tab changes.
- `Segmented`: a sliding selected pill, measured after mount. The server render is unchanged.
- `Chip`: `quiet`.
- `tokens.css`: `.ds-swap`, `.ds-disclosure`, `.ds-seg-thumb`, all on the shared duration and easing tokens. The existing reduced-motion rule collapses them.

## Left for a decision

1. The agent panel in a session: open by default, or closed below a width?
2. Security and Workspace settings (auth-owned files): move the password and passkey forms behind dialogs, as recommended above.
3. Analytics spend breakdown: playbook rows repeat the By playbook table's spend column. Keep them, or show departments only?
4. Memory facts: seven entity sections stacked. A type filter (`FilterPill`) would shorten the page once a workspace has dozens of facts.
