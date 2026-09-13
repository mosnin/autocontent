# Verification receipt

Repository: mosnin/autocontent. Baseline: a099a57ca7e5d14b5cb3b5d85783a4956213ecca. Branch: codex/marketer-website-positioning. Tests run locally with Chrome and Next production build; source and artifacts in this directory. The existing purchased theme checkout supplied installed node_modules for these runs (Next 15.5.25); isolated checkout owns the source, build and changes. Lockfile installation was not replayed as a clean-room install; test dependencies are declared for reproduction.

## Implemented

Seven new public destinations plus rewritten homepage, product/solution pages, pricing, About, shared FAQs, resource content and navigation. All source images, the paid template, fonts, palette, orbit/film/gallery and walkthrough remain. A 24-entry page content catalog and six complete guides replace engineering-led promotional copy with audience jobs, mechanism, benefits, responsibilities and next steps. Current prepaid catalog is unified; proposed $49/$149/$399 subscriptions are explicitly not purchasable. No backend, billing catalog, entitlements, private app, or live customer migration changed.

## Executed checks

- TypeScript noEmit passes; production Next build passes (see production-build.txt).
- Production browser pass: 53 route scenarios (all public marketing pages plus a selected-plan demo URL) returned 200 with one H1, descriptions, canonicals, no recorded horizontal overflow and no completed broken images. See route-checks.json.
- Desktop Product/Solutions/Resources/Company keyboard opening, Escape dismissal and focus return pass.
- Mobile menu exposes Solutions and supports Escape close; tablet content route fits without horizontal overflow.
- Proposed Grow selection reaches demo request with reason and message prefilled. No message sent. Form uses a mailto draft, preserves entered details and explains that sending and scheduling are separate.
- Pricing, product, demo and guide axe WCAG 2/2.1 A/AA scans are recorded in pricing-accessibility.json and additional-accessibility.json. The product scan first found 4.34:1 gray-on-gray contrast in workflow text; the shared panel text was corrected with the existing foreground token and retested. This is a bounded automated scan, not full assistive-technology or WCAG conformance evidence.
- Full-page production Chrome captures include homepage, product, pricing, demo, 390px mobile, 768px tablet and dark appearance. Captures scroll the page to load actual artwork.
- Reduced-motion shared InView now reveals content without requiring scroll; final fan has static visible state. Ordinary-motion homepage intro and feature reveal were exercised; see detail-checks.json.
- Pricing skill checker passes the stated scenario arithmetic; 27 usage/cost scenarios in economics.csv. It does not prove willingness to pay, provider cost truth, or billing implementation.
- Content checker passes the 728-string story/guide inventory. Copy meaning and truth reviewed manually; this inventory does not claim every legacy legal/API string was mechanically audited.
- git diff --check passes. No changes to web/public assets or global theme CSS.

## Design OS then Details review

Design OS scoped implementation review: local page hierarchy, content fit, theme composition, responsive examples, navigation and price disclosures were reviewed against DESIGN.md. Observed failures repaired: pricing contradiction, unsupported popular badge and imagery provenance, missing Solutions access, reduced-motion reveal behavior, legal heading/canonical gaps. Local implementation is reviewable; full product release remains conditional on the checks below. No numerical premium score or representative-user comprehension claim.

Details review after the scoped design pass: preserve purchased visual character; distinguish generate/approve/publish; remove false output counts and payment promises; keep price currency, included credit and availability adjacent; restore usable form recovery; maintain optical breathing room for longer headlines; prevent menu hover/click conflict and intermediate-width navigation collision; add current-page state and Escape focus return; repair workflow-panel contrast without changing the palette. Rechecked affected render and interaction paths. Verdict: Pass for inspected local copy/structure changes; full website acceptance remains Needs work for the explicit external and broader-test gates below. This was agent self-review applying the loaded skills, not independent reviewers.

## Remaining gates and explicit limitations

Company OS and Symbolic live context unavailable. No permissioned customer logo proof or outcome studies supplied. Do not invent these to pass the frontend framework. The site spec intentionally records missing proof and reuse of purchased artwork; the full 132-item assessment retains not_tested and justified not_applicable entries, so it does not claim a framework-wide pass. Reused campaign imagery is an intentional supplied-theme choice, not a unique illustration for every page.

Clerk environment is absent locally, so actual signup, session recovery, authenticated onboarding, account generation and publishing were not exercised. No email sent or calendar booking confirmed. Subscription catalog/grants/entitlement enforcement, renewals, refunds and migration remain proposed engineering work. No production deployment or customer price change executed. Native Safari/Firefox/mobile hardware, screen-reader use, all error states, measured field performance and legal-policy review remain outside this local receipt.

npm registry audit of the existing production lockfile reported 6 dependency findings (5 high, 1 critical), including Next and transitive packages. Adding the two browser-test dependencies did not upgrade production dependencies. Resolve inherited dependency findings and repeat a clean-lockfile build before deployment; the tested installed tree differs from the older lockfile. No claim of a clean security audit.

## Reproduce

In web/, install declared dependencies in an adequately provisioned environment, install Chrome or a supported Playwright browser, run npm run build and npm run start -- --port 3107. In another terminal run npm run test:website and npm run capture:website. WEBSITE_BASE_URL overrides the local base URL. Inspect evidence JSON and captures. A passing local script cannot certify source claims, customer demand, provider availability or launch permission.
