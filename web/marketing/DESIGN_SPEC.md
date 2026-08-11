# marketer.sh — Marketing Site Design Spec (binding)

Every logged-out page follows this spec exactly. Deviations read as
"vibecoded" — don't.

## Brand voice

marketer.sh is the autonomous marketing platform for AI agents: it
ideates, produces, publishes, and learns — short-form video AND
SEO-articles — from one system with real spend controls. Copy is calm,
confident, concrete. Short declarative sentences. Numbers over
adjectives. Never "revolutionize", "unleash", "supercharge", "10x".
Headlines are benefit-first, Apple-cadence: "Marketing that runs
itself." / "One brief. Every format." / "Your agents ship the campaign."
No em-dashes in display copy (period or comma instead).

## Visual language (from reference)

- **Canvas**: near-white cool canvas `#f5f6f8`, sections alternate with
  pure white panels and soft sky-gradient scenes.
- **Panels**: big floating rounded panels (`rounded-[2rem]` /
  `rounded-[2.5rem]`), 1px `border-black/[0.06]`, shadow
  `shadow-[0_8px_40px_rgba(15,23,42,0.08)]`. Panels sit inside a padded
  viewport container (like the reference's inset browser frame).
- **Glass**: overlays and the nav use `backdrop-blur-xl` +
  `bg-white/70` (dark: `bg-zinc-900/70`) with hairline borders
  `border-white/40`.
- **Gradient scenes**: soft sky/pearl/lavender radial gradients
  (like the Dona reference): sky `#dbeafe→#eff6ff`, pearl
  `#fafafa→#f0f4ff`, mist `#e0e7ff→#fdf2f8` at low saturation. Use as
  full-bleed section backgrounds behind glass panels. Subtle grain
  optional via CSS, never noisy.
- **Type**: display headlines use the existing display font from
  app/layout.tsx, tracking-tight, `text-5xl→text-7xl` on desktop,
  weight 600. Body `text-zinc-600` (dark `text-zinc-300`), 17px,
  relaxed leading. Kickers: 11px uppercase tracking-[0.2em]
  `text-zinc-400`.
- **Ink**: headings `text-zinc-900` (#18181b-ish), never pure black.
- **Accent**: the existing brand orange is used ONLY as the
  "recording light" micro-accent (dots, live indicators, small
  highlights) — the marketing surface itself stays cool/neutral.
  Primary CTA buttons: ink-dark pill (`bg-zinc-900 text-white`,
  hover lifts), secondary: white pill with hairline border.
- **Buttons**: pills (`rounded-full`), 44px min height, arrow-circle
  glyph on primary CTAs like the reference ("Try live demo ⊙").

## Motion (motion/react — already installed; import from "motion/react")

- Every section content reveals on scroll: `whileInView` fade + 24px
  rise, `viewport={{ once: true, margin: "-80px" }}`, ease
  `[0.22, 1, 0.36, 1]`, duration 0.7, small stagger (0.06-0.1) for
  children. Use the shared `<Reveal>`.
- Hero: staged entrance on load (kicker → headline lines → sub → CTAs),
  slight parallax drift of background gradient via `useScroll` +
  `useTransform`.
- Apple-style pinned scenes where specified: sticky container
  (`h-[300vh]` wrapper, `sticky top-0 h-screen` scene) with
  scroll-linked `useTransform` (scale/opacity/x) — max ONE per page.
- ALWAYS respect `useReducedMotion()`: reduced = opacity-only, no
  pinned scenes (render stacked static sections).
- Numbers count up on reveal (shared `<CountUp>`), max 3 per page.
- No bounce easings, no rotation gimmicks, no parallax on text bodies.

## Illustrations

Custom animated SVG components (shared library in
web/components/marketing/illustrations/) — line-art + soft gradient
fills, animated with motion/react (path draw via pathLength, gentle
float loops, staggered node pulses). Never emoji, never stock, never
lorem-ipsum-style screenshots. Product UI mockups are hand-built JSX
"cards" in the glass style (like the reference's chat panel), not
images.

## Layout rules

- Max content width `max-w-6xl mx-auto px-6`.
- Section vertical rhythm: `py-24 md:py-32`.
- Mobile-first; every grid collapses cleanly; no horizontal scroll.
- Footer: multi-column sitemap + brand mark + fine print.

## SEO (every page)

- `export const metadata: Metadata` with unique `title`
  (`"<Page> — marketer.sh"`), 150-160 char `description`, `openGraph`
  {title, description, type}, and `alternates.canonical`.
- Exactly one `<h1>` per page. Semantic sections with `aria-label`.
- Key pages embed JSON-LD via `<script type="application/ld+json">`
  (Organization on /company, SoftwareApplication on /, FAQPage on
  /resources/faq).

## Sitemap (canonical URLs — nav and pages must agree)

/                       home
/pricing
/company
/features               hub
/features/video
/features/articles
/features/automation    (agents, MCP, API, autopilot story)
/features/analytics     (performance loop, spend controls)
/use-cases              hub
/use-cases/creators
/use-cases/ecommerce
/use-cases/saas
/use-cases/agencies
/use-cases/local-business
/use-cases/ai-agents
/resources              hub
/resources/quickstart
/resources/api          (API + SDK + CLI + MCP overview)
/resources/guides/first-channel
/resources/guides/seo-articles
/resources/guides/agent-driven-marketing
/resources/changelog
/resources/faq
/sign-in, /sign-up      (existing Clerk routes — link, don't rebuild)

## Shared components (web/components/marketing/system/)

Foundation exports (import these, never re-invent):
`<MarketingNav>`, `<MarketingFooter>`, `<Reveal>`, `<Stagger>`,
`<PinnedScene>`, `<CountUp>`, `<GlassPanel>`, `<GradientScene
variant="sky|pearl|mist">`, `<Kicker>`, `<DisplayHeading>`, `<Lede>`,
`<CtaPill variant="primary|secondary">`, `<SectionCta>` (closing CTA
band used on EVERY page), `<LogoRow>`, `<StatStrip>`,
`<FeatureCard>`, `<MockChat>`/`<MockDashboard>` style product cards.
Illustrations: `<VideoPipelineIllustration>`, `<ArticleFlowIllustration>`,
`<AutomationOrbitIllustration>`, `<AnalyticsLoopIllustration>`,
`<SpendGuardIllustration>`, `<AgentGridIllustration>`.

## Amendment 2 — Card language + warm accent (binding, supersedes conflicts)

### The vignette card (every card on every page)
Cards never carry decorative icons. A card is: (top) a **product
vignette** — a real-looking miniature of the product UI (queue rows,
article SEO panel, agent chat, cap gauge, schedule strip, SERP scan,
terminal, metrics) staged inside a soft gradient vignette frame
(rounded-2xl inner panel, subtle inner hairline, light mode ALWAYS) —
then (bottom) a plain text block: title (text-lg/xl, ink) + 1-2 line
zinc-600 description. Reference: Expo's use-case grid and feature
cards, rendered in light mode. Use the shared `<VignetteCard>` +
vignette library; never a lucide icon as card decoration. (Functional
glyphs in real UI vignettes — play, check, arrows inside the mock UI —
are fine; that's product, not decoration.)

### Warm accent gradient (replaces ALL green on marketing surfaces)
Green/emerald is retired from marketing pages. Positive/success/live
moments use the warm gradient accent: `linear-gradient(135deg, #f59e0b,
#f43f5e)` (amber-500 → rose-500), exposed as utility classes/tokens
(`.accent-warm-bg`, `.accent-warm-text` via bg-clip-text). Small
"pass/ok" dots use solid amber-500; the brand recording-light orange
remains the live-pulse accent (they are family). Never green.

## Amendment 3 — Reference redesign (binding, supersedes conflicts)

The logged-out surface now follows the converged-platform reference:

- **Canvas** is pure white; alternating sections may use `#f5f6f8`.
  The floating pill nav is retired: the site chrome is a black
  announcement banner + sticky full-width white bar (border-b hairline,
  `backdrop-blur`) with columned mega-menu panels (kicker heading per
  column, pastel icon tiles + title + desc rows, plain-link right
  column) and Contact sales / Login / Sign up on the right.
- **Buttons** are rounded-xl blocks (`rounded-xl bg-zinc-900 text-white`),
  not pills. Secondary: `bg-zinc-100` block.
- **Kickers** are Geist Mono uppercase (`font-mono tracking-[0.18em]`).
- **Dark panels**: one `bg-zinc-950 rounded-[2.5rem]` mega-panel per page
  max (the autopilot section), hand-built UI mocks only.
- **Warm gradient** (amber→rose) remains the sole accent family; the
  closing CTA is the full-bleed warm-gradient rounded panel.
- **Imagery**: real screenshots/photos render via the shared
  `<ImagePlaceholder label file>` frame until assets are uploaded; swap
  by replacing the element with `<Image>`.

## Amendment 4 — Logged-in hub language (binding for (app) surfaces)

Product dashboards (Campaigns, Content, SEO, Ads, Suite — that order)
share the hub language in `web/components/hub/primitives.tsx`: sparkle
`HubHeading`, cascading `HubSection` rise-ins, `hubCardClass` rounded-3xl
light cards, `HoverLift` spring hovers, `VignetteFrame` mini previews.
The shell header carries the center pill `DashboardSwitcher` whose active
pill glides via shared-layout spring. All motion honors
`useReducedMotion`.
