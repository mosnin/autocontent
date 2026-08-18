# The Steve Jobs Audit — marketer.sh

*An in-depth product and usability audit, conducted through the eyes — and in the voice — of Steve Jobs. Every claim below was verified against the code; file:line references are included so nobody can argue with the mirror. Nothing here proposes cutting a feature. It proposes finishing one product.*

---

## Part I — The verdict

You've built something technically remarkable. A pipeline that ideates, scripts, renders, voices, scores, and ships video. An article engine with real QA. An ads system with a fail-closed money contract that most banks would envy. Four hundred passing tests. Append-only audit logs. I've seen billion-dollar companies with worse engineering.

And then you wrapped it in an experience that fights the user at every single step.

You've baked a beautiful cake and frosted it with the contents of your issue tracker.

Here's the thing you have to internalize: **the customer doesn't experience your architecture. They experience the seams.** And this product is *all* seams. Five products with five names that don't match the marketing. A word — "niche" — that appears 375 times in the app and zero times in the mind of any marketer on Earth. Errors that print raw JSON. A pricing page that's wrong by 4–6×. An onboarding that promises "your first short ships today" and then lets the user's very first action die silently in a "Failures inbox" because nobody told them they have $0.

You start with the customer experience and work backwards to the technology. You did it in the other direction. The technology is done. Now we do the product.

Nothing gets cut. Everything gets *finished*.

---

## Part II — The first five minutes are a crime scene

The first five minutes are the whole product. If they fail, nothing else exists. So I walked them, screen by screen, as a new customer. Here is what your customer actually lives through:

**Minute 0 — The promise.** The homepage says "Get started. It's $5." and "Your first short ships today" (`web/components/marketing/home/hero.tsx:98`, `closing-cta.tsx:61`). The quickstart says "no card required" and "Your first video costs about fifty cents" (`quickstart-steps.tsx:12`, `resources/quickstart/page.tsx:50`). The pricing page says $5 buys 8–12 videos.

**Minute 1 — The signup.** A bare, unstyled Clerk widget. No echo of the promise, no "$5 to start," nothing (`app/sign-up/[[...sign-up]]/page.tsx` — 10 lines). The moment of maximum commitment gets the minimum design.

**Minute 2 — Onboarding.** Actually — credit where due — the one-sentence-to-drafted-channel flow is *good*. "Describe a channel in a sentence. We'll produce the video…" That's the right idea. A sentence in, a channel out. This is the taste the rest of the product is missing.

But notice what onboarding never says: **the word "credit" does not appear anywhere in it.** Not once (grep of `app/(app)/onboarding/` for billing/credit/balance: zero hits). The user is never told they have a balance, never told it's $0, never asked to load the $5 the marketing quoted.

**Minute 4 — The betrayal.** The user clicks Run. The dialog says "Run for $1.82." A toast says "Run enqueued on tiktok" — a raw enum, by the way. The job appears. And then it dies, deep inside the pipeline, because `POST /api/v1/jobs` never checks the balance (`backend/routes/jobs.py:45-72`) and the spend guard refuses the first LLM call at $0 (`src/marketer/services/spend_context.py:128-142`). The failure surfaces as a raw backend string filed under "Spend cap" in a component called the **Failures inbox** — which, incredibly, is the *first thing rendered on the Queue page even for a brand-new user with zero jobs* (`FailuresInbox.tsx`). The row offers one action: **Retry**. Which will fail again. There is no "top up" button on it.

Their first experience of your product is a failure inbox and a retry button that lies to them.

**And if they somehow don't hit that wall:** the default posting window is 9:00 AM, the cron scans in 30-minute windows (`modal_app.py:275-329`), and nothing after niche creation says "run one now." So the "first short ships today" customer waits **up to 24 hours** unless they discover three tiny icon buttons on a dashboard card.

**And the price was wrong anyway.** The product's own estimator prices the default niche at $1.815/video (`web/lib/cost-estimator.ts`), and every debit is charged at 1.5× (`billing_margin`, `src/marketer/config.py:93`, applied at `spend_context.py:176-184`). Real cost: **~$2.72 per video. $5 buys about 1.8 videos, not 8–12.** The settings page and the pricing page disagree about the same number by a factor of five.

This is not a UX bug. This is a broken promise, delivered in the first session, with the user's money. There is no feature you can ship that recovers from this.

One more indignity: a user who signs up, wanders off, and signs back in lands on `/home` — whose primary action creates a *campaign*, which with zero niches leads to a page with a niche dropdown containing only "Pick a niche…" and **no link to create one** (`CampaignDetailClient.tsx:194-200`). Their second session is a dead end too.

---

## Part III — Is this one product or five? Pick one. (It's one.)

Simplicity isn't a visual style. It's coherence — one mental model, held everywhere. Right now the product can't even agree on its own nouns.

**The names.** Marketing sells **Studio, Press, and Ads** ("Meet the marketer.sh suite: Studio, Press, and Ads" — `nav.tsx:291`). The app sidebar shows **Campaigns, Content, SEO, Ads, Suite** (`web/lib/products.ts`). Inside the app, copy still says "create a niche in **Studio** first" (`CampaignsClient.tsx:134`) and "used by **Press**" (`EditNicheForm.tsx:499`) — names that appear nowhere in the chrome the user is looking at. And then you sell a $50 credit pack literally named **"Studio"** (`BillingClient.tsx:33`). Three meanings of one word. A customer who reads your homepage, opens your app, and buys your top pack meets three different taxonomies in fifteen minutes.

**The noun.** "Niche" appears **375 times** in the app; onboarding, the brand kit, and the repurpose card call the same object a **"channel"** — sometimes in the same sentence ("Describe your **channel** in one sentence… The AI drafts the full **niche** from it" — `quickstart-steps.tsx:16-18`). Nobody wakes up wanting to "create a niche." They want a channel. One word. Everywhere. Forever.

**"Campaign" means three things:** the orchestrator product (`/campaigns`), ad campaigns (`/ads/campaigns`), and the topbar's global **"New campaign"** button — which is rendered on *every* page, including `/admin/audit` and `/settings/privacy`, and takes you to `/campaigns` even when you're standing inside Ads where "New campaign" means something else (`header.tsx:57-59`).

**Two front doors.** `/home` and `/dashboard` both exist, both show your latest videos, and they disagree with each other in the same viewport: on `/home`, the sidebar highlights **Content** while the topbar says **Home** (`products.ts:158-171` falls through to STUDIO). Two campaign-creation forms. Two niche lists with word-for-word duplicated empty states. **Four different places** to watch a finished video, none canonical. Three near-identical hero headlines — "Bring any idea to the feed," "Bring your next campaign to life," "Bring any campaign to market" — which is what happens when nobody decides what the product's one sentence is.

**The seams between products are held together with duct tape.** To link an ad campaign into an orchestrator campaign, the user pastes **a raw UUID into a text field** whose placeholder reads `"uuid from Ads → Campaigns"` (`CampaignDetailClient.tsx:187-191`). In 2026. In a product whose tagline is "marketing that runs itself." An article cannot become a video. A video cannot become an ad creative. The repurpose feature generates social posts and then **throws them away** — ephemeral React state, no save, no schedule, no handoff to the connected socials (`ArticleDetailClient.tsx:423-574`). The calendar isn't a calendar — it's a table that anchors articles on the day they were *requested* and ads on the day they were *drafted* (`src/marketer/repos/calendar.py:28-33`).

The suite isn't the problem. The suite is fine — keep all five. The problem is that nobody made them *one thing*. A suite is a family: same last name, same table manners, one language.

---

## Part IV — The product speaks engineer. The customer speaks human.

Every screen leaks the implementation. This is the difference between a product and a demo of a backend.

- **Pipeline vocabulary as user copy:** "All pipeline runs. Updates every 5s." "We'll **spawn** a new pipeline run." "Run **enqueued** on reels." "Replay enqueued." A status badge that just says **"QA."** Failure categories named "Render QA" and "Content QA." A wizard section called **"Engine room."**
- **Raw identifiers:** full UUIDs in mono on job and article headers; 8-char UUID prefixes as *titles* for remixes, uploads, and ad accounts ("google ads — 3f2a1b9c" as an account name, `NewCampaignClient.tsx:75-80`); a masked credential labeled **`profile_key`** shown to a marketer on the Connect page (`ConnectCard.tsx:47-55`).
- **Raw enums as UI:** approvals and the audit log print `campaign.activate`, `budget.change`, `ad_campaign`, `approval.rejected` in mono badges (`ApprovalsClient.tsx:104`, `activity/page.tsx:108-116`). The calendar prints ad statuses with a code comment *admitting* it: "raw backend status string, no enum on the client" (`CalendarClient.tsx:172-173`).
- **Raw JSON as error handling:** FastAPI `{"detail": …}` bodies land in toasts across articles, ads, templates, and campaigns. The campaign page's idea of polish is stripping the leading "402 " off the string before showing the user `{"detail":"account kill-switch is engaged"}` (`CampaignDetailClient.tsx:66`).
- **Vendor names as features:** Ayrshare, Grok Imagine, Whisper, Pixabay, ElevenLabs voice IDs pasted as raw strings ("e.g. 21m00Tcm4TlvDq8ikWAM"). The customer bought marketer.sh. Your subcontractors are your business, not theirs.
- **A tab labeled "Logs" that is not logs** — it's the error field or the words "No errors" (`JobDetailClient.tsx:263-271`).
- **SEO scores with no scale:** a "Quality" grid where Overall/E-E-A-T/Readability are 0–1 and **Kw density sits beside them on a totally different scale**, so a healthy density renders as `0.01` next to `0.82` (`ArticleDetailClient.tsx:247-262`, `llm.py:405-447`). No units, no thresholds, no color, no way to act on any of it. The QA pass/fail threshold (0.6) exists in code and is never shown. You built a grading system and forgot to tell the student what an A is.

And the interaction design has the same disease. Two design systems live side by side — `components/ui/*` and `components/square/ui/*` — mixed *within single files* (`AdsOverviewShell.tsx:6-7`). Native `window.confirm()` for rejecting a video and archiving a niche while everything else uses styled dialogs. Busy states that are the word "Retrying…" in one product and a bare "…" in the other. Buttons labeled "New niche," "Create niche," and "Create your first niche" for the same action. A "New job" button whose behavior is *opening the command palette* (`QueueClient.tsx:547-554`).

None of this is hard to fix. That's what makes it unforgivable. Details aren't details. **Design is how it works** — and right now, how it works is: the backend shrugs and the frontend passes the shrug along.

---

## Part V — The money problem. This one keeps me up at night.

Trust is the product. You're spending the customer's real dollars autonomously — the *only* thing that makes that acceptable is total, obsessive transparency. Instead:

1. **The margin is invisible.** Every number the UI ever shows — onboarding estimate, run-confirm "Estimated cost," settings "$1.82 per video," the niche performance table — is pre-margin. The actual debit is ×1.5. The multiplier appears in exactly one sentence of prose on the billing page (`billing/page.tsx:28-33`). Every price tag in your store is 33% lower than the register.
2. **The caps and the balance don't even use the same math.** Caps are evaluated against raw provider cost; the balance is charged at cost×1.5 (`spend_context.py:104-142, 176-184`). A user can be "under cap" and out of money simultaneously.
3. **"You can never owe us money"** — printed on the billing page — while `debit()` documents that the balance **can go negative** on the in-flight call (`src/marketer/repos/billing.py:60-68`).
4. **No receipt exists.** The pricing page promises "the exact cost after." No surface shows what a video actually cost. The transaction history shows one row *per provider API call* (`openai/gpt-image-1`, `xai/grok-imagine`…), capped at 50 rows with no pagination, formatted to two decimals so a $0.0042 debit renders as **$0.00** (`BillingClient.tsx:147-193`, `format.ts:4-7`). The only place a customer can audit their money shows them a wall of zeros with vendor SKUs for names.
5. **The balance isn't on the dashboard.** The pricing page says balance, meter, and limit are "visible on your dashboard at all times." Grep the dashboard for "balance": nothing. It lives three clicks away. The sidebar's one ambient money affordance says "Get more credits" — permanently, regardless of balance, with no number on it.
6. **Buying credits is a one-click redirect to Stripe.** The whole pack card is a button; touch it and you're on a checkout page (`BillingClient.tsx:57-68`). No confirmation. That's not confidence, that's carelessness.
7. **Ads governance — your proudest engineering — has no UI at all.** The fail-closed guard, the daily/monthly caps, the kill-switch: `PATCH /ads/accounts/{id}/governance` exists, the typed client method exists, and **no component ever calls it** (repo-wide grep: only the definition). Customers can be refused by a cap they cannot see, cannot set, and cannot lift — and the refusal arrives as raw JSON in a toast. The approval threshold ($50) is an env var the user never learns. The approvals inbox asks a human to approve "Set daily budget to $80" **without naming the campaign or linking to it** (`ApprovalsClient.tsx` — `campaign_id` exists on the backend model and was omitted from the client type). The audit log shows `target_type` but never `target_id`, so no row is traceable; denial *reasons* are recorded in the `after` payload and never displayed. You built a bank vault and forgot the teller window.

The engineering here is genuinely fail-closed and honest. The experience of it is opaque and therefore feels dishonest. The customer can't tell the difference between a product protecting them and a product hiding things from them — unless you *show* them.

---

## Part VI — The moments that matter, and what they feel like now

A product is a handful of moments. Get those insanely right and the customer forgives everything else. Here are yours, as shipped:

**The moment your machine finishes its first video** — the single most magical thing this product does; a machine made television out of a sentence — is a row in a table. The celebration dialog you built for it ("Your machine shipped its first video") only fires on `/home`, and onboarding redirects the user to `/dashboard`, so most users will never see it (`latest-videos.tsx:154-190`).

**The moment of approval** — the customer's one editorial act, the gate they hold — is two buttons on a table row **where the video cannot be watched**. To see it they navigate to the detail page, which has *no approve/reject buttons* (`JobDetailClient.tsx:168-184`), then go back to the row and press Approve from memory. Reject is a native `confirm()`, and a rejected video is thereafter labeled **"Failed"** and dumped into the Failures inbox — the product records the customer's own decision as an error.

**The moment of waiting** — a render takes many minutes — offers a single badge word ("Animating") with no stage count, no progress, no ETA, on a page that says "Updates every 5s." Eleven pipeline stages, and the customer is told which of nine words is currently true. The article page is worse: every pre-done status displays the word "Writing" (`ArticleDetailClient.tsx:169`).

**The moment of shipping** — doesn't exist. There is no "post now," no caption edit (the caption is silently the hook + hashtags, `pipeline.py:857-864`), no reschedule, **no download button for the video the customer paid to render**. The only download in the entire product is an article's `.md` and the GDPR export. And whether TikTok is even connected is unknowable in-product — the Connect page shows the same badge for all three platforms and tells you to go check inside Ayrshare (`connect/page.tsx:33-36, 106-110`).

These four moments are the product. Everything else is furniture.

---

## Part VII — The back of the fence

My father taught me: a great carpenter doesn't use lousy wood for the back of a cabinet, even though nobody sees it. People *feel* the back of the fence. Yours:

- **The marketing site has 84 placeholder grey boxes** where images should be, four **fabricated testimonials** under "Loved by teams that ship daily," a fake logo band under "Trusted by teams shipping daily," and dashed boxes reading `soc2.svg`, `gdpr.svg`, `ccpa.svg` under a "Compliance" heading for certifications you don't hold. Fabricated social proof isn't placeholder content; it's a lie wearing a TODO comment.
- A banner that says **"See what shipped this week"** pointing at a changelog whose newest entry is six weeks old — and which has never heard of the Ads or Campaigns products.
- **The pricing page contradicts itself on-page**: tier bullets imply feature gating ("API + MCP access" on the $50 pack) while its own FAQ says "No. Every feature… works on every pack." Both can't be true; in the code, neither gate exists.
- Dead weight shipping to production: an entire unused 820-line sidebar kit, an unused product switcher, nav group labels that are never rendered, `soon: true` flags documented to show a "Soon" hint that no code renders — so `/ads/insights` and `/ads/creatives` are invisible rather than anticipated (`products.ts:15, 88-90`).
- **x402 agent payments — fully built, tested, config-gated — has zero product surface.** The only place a customer can learn that agents can top themselves up over HTTP 402 is… the Refund Policy. You shipped a feature into a legal document.
- Skeletons that don't match their pages (settings: 3 cards vs 7, wrong width), a queue skeleton showing tabs that no longer exist, **no loading state at all** on three of the five product landings and on every single Ads page.
- `/campaigns`, `/library`, and `/templates` are **missing from the auth middleware matcher** (`middleware.ts:23-33`) — sidebar destinations that greet an unauthenticated user with the generic error boundary instead of a sign-in.
- Templates promises "their exact prompt attached," and the prompt is not displayed or copyable anywhere; video templates have no action at all; and the empty state tells customers "Admins add them from the admin console" — the shop window explaining its own stockroom.
- Sidebar "Help" ejects the user out of the app into the marketing site's layout with no way back.

Individually these are small. Together they are the smell of a product nobody walked through end-to-end while pretending to be a customer. That walk is the job.

---

## Part VIII — What insanely great looks like (nothing cut, everything finished)

You said no cuts. Good — I'm not asking for cuts. Focus isn't only saying no to features; it's saying no to *incoherence*. Here is the product, finished:

### 1. One language. This is a two-day job and it changes everything.
Write the glossary and enforce it: **Channel** (not niche), **Studio / Press / Ads / Campaigns / Suite** with the *same* names in marketing, sidebar, and copy (rename the "Studio" credit pack), **one** meaning of "campaign" per surface, one label per action. Kill "pipeline," "enqueue," "spawn," "QA," "job" from user-facing copy: runs are "creating," videos are "rendering," QA is "reviewing quality." Humanize every enum at one choke point (you already have `status-badge.tsx` — finish the job for platforms, ad actions, objectives, composition states). No UUID ever renders where a name can. No `{"detail":…}` ever reaches a toast — every error message names what happened *and the next action* ("You're out of credit — add $5 to run this" with a button, not `SpendCapExceeded` with a Retry).

### 2. One front door.
`/home` and `/dashboard` become one screen: the composer at the top (keep it — it's the best idea in the shell), the machine's latest output below, balance and today's spend in the corner. The chrome must never disagree with itself about where the user is. The topbar's global button becomes context-aware ("New video" in Studio, "New article" in Press, "New campaign" in Ads). Put Webhooks and Privacy in the sidebar with their siblings; make Help open help inside the app.

### 3. The first five minutes become the demo.
- Marketing numbers become true numbers: one honest cost-per-video figure (post-margin), shown identically on the pricing page, in settings, and in the run dialog. If the real number is $2.72, say $2.72 — or change the default niche config until the marketing number is true. Never both.
- Onboarding gets a money moment: show the balance, grant a small starter credit or take the $5 right there — the marketing already promised "It's $5"; let the product keep the promise.
- **Creating a channel immediately renders the first video.** Don't redirect to a dashboard and hope they find three icon buttons. The wizard's last click is "Create channel & render my first video — $2.72." The wait becomes the show: a real progress view — "Step 4 of 10 · Animating scene 3 of 6 · about 9 minutes left" — with the keyframes appearing as they're generated. You already *have* the stages and the artifacts; show them.
- Blocked runs are blocked at the button, not in the guts: the enqueue endpoint checks credit and the dialog says so beautifully before any money or hope is spent.
- The Failures inbox never renders when it's empty, and a spend/credit failure carries a "Add credit" action, not "Retry."
- Returning users with zero channels land in onboarding, not in a campaign dead end. Every empty state links to the action it names — today, seven of them are text with no button.

### 4. Build the Review Room. This is the feature that makes the product.
One screen: the video playing large, the caption (editable, at last), the cost it incurred, the schedule it will post to, and three real actions — **Approve & schedule · Post now · Reject** (with a reason, recorded as a *decision*, never as "Failed"). Approvals, image posts (currently a second, differently-worded approval UI buried in a Library tab), and article sign-off all use this one room. The customer's editorial moment is your Apple-keynote moment — right now it's a checkbox in a spreadsheet.

### 5. Give every dollar a face.
- A per-video **receipt**: estimate vs. actual, margin included, linked from the job, the library, and the ledger. Roll the SKU rows up under it (keep the detail one click deeper).
- Balance in the shell, always. Four-decimal formatting where cents lie. Pagination on history. Caps and billing on one page — they are one subject.
- **Ship the governance UI.** The endpoint exists; the client method exists; put daily/monthly caps, the kill-switch, and the approval threshold on the ad account card, editable, with current spend against them. Approvals name and link their campaign. The audit log links its targets and shows denial reasons. Then your fail-closed engineering stops being a secret and becomes your best sales pitch.
- Surface x402 on the billing page and the API docs — you built the most agent-native payment path in the industry and hid it in the Refund Policy.

### 6. Sew the suite together.
- Article → "Make this a video" (seed a run from the outline). Video/article → "Promote this" (seed an ad draft). Repurposed social posts get **Save & schedule**, not clipboard-and-pray.
- The ad-lane UUID field becomes a dropdown. It's a `<select>`. It's an afternoon.
- The calendar becomes a calendar — a week/month grid of what will *publish*, draggable, with articles on their publish intent, not their request date.
- Connect shows real per-platform status or honestly says it can't — and gains a disconnect.

### 7. Tell the truth on the website.
Placeholder art is fine. Fabricated testimonials, fake customer logos, and compliance badges you don't hold are not — replace them with the truth, which is genuinely impressive: show the machine making a real video, show the audit log, show the receipt. "No card required" and "8–12 videos" either become true or become gone. Update the changelog or remove the "this week" banner.

### 8. Sweat the last 2%, because it's actually 50% of the feel.
One design system (pick the square kit; migrate the stragglers). One confirmation pattern — never `window.confirm()`. One busy-state style. Skeletons that match their pages; loading states for Ads and the three product landings that lack any. Fix the middleware gap on `/campaigns`, `/library`, `/templates`. Render the "Soon" hints you designed. Delete the dead 820-line sidebar, the dead switcher, the dead marketing components — dead code is how inconsistency breeds. And give the customer a **Download** button for the video they paid for. That one is embarrassing.

---

## Part IX — Monday morning

If I ran this team, these are the first ten orders, in order:

1. **Freeze the lie.** Fix the pricing math and "no card required" on the marketing site today. Nothing else matters while the front door overpromises 5×.
2. **The $0 first run.** Check credit at enqueue; make the out-of-credit moment a beautiful top-up prompt. One endpoint, one dialog.
3. **Glossary purge.** Channel everywhere. Product names aligned app ↔ marketing. Enums humanized at the choke points. Two days, product-wide payoff.
4. **First video on channel creation,** with the staged progress view. This is the demo, the onboarding, and the retention hook in one.
5. **The Review Room** (watch + caption + approve/post-now/reject on one screen).
6. **Receipts + balance in the shell.**
7. **Ads governance UI** (caps, kill-switch, threshold; approvals name their campaign; audit rows link).
8. **Merge `/home` and `/dashboard`;** context-aware primary button.
9. **Empty states with buttons; Failures inbox hidden when empty; download buttons on videos.**
10. **Kill the dead code and the second design system.**

---

## The last word

The people who built this backend are A-players — the money contract, the resumable pipeline, the audit trail prove it. But somewhere along the way you started shipping the org chart: five surfaces, two design systems, three vocabularies, and every seam showing.

The customer doesn't want a suite, a pipeline, or a ledger. They want this: *"I described my channel in a sentence, and this morning there was a beautiful video waiting for my approval, it cost what you said it would, and when I pressed the button, it shipped."*

Every decision above serves that sentence. Everything in this product already *almost* does. Finish it. Make it one thing. Make it true. Then it's not a tool — it's magic that happens to be true, which is the only kind worth shipping.

— The audit
