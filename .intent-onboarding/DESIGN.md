# DESIGN: Visual Doctrine

The visual bar for every onboarding built with this framework. It sits next to [`RULES.md`](./RULES.md): RULES decides **what** appears, DESIGN decides **how it looks**.

- **Reference screens:** [`design/references/`](./design/references). Open them before building any screen. They define the target.
- **Tokens:** [`packages/ui/tokens.css`](./packages/ui/tokens.css). Every color, size, radius and duration comes from there.
- **Components:** [`packages/ui`](./packages/ui) implements everything below. **Current baseline:** [`design/screenshots/`](./design/screenshots), regenerated with `npm run screenshots`.

> If a screen could be mistaken for a default component-library template or a generic AI-generated form, it fails review.

---

## 1. The character, in one paragraph

Quiet, confident, editorial software. Near-black ink or warm paper, hairline borders, generous space, and **one** solid action per screen. Color is never decoration: it comes only from brand logos, status, and the selection ring. The right side of the screen shows *their* product taking shape (their logo, their leads, their ads), so every answer visibly changes something. The overall effect is that the product is already working.

## 2. Hard rules (MUST / MUST NOT)

**Color**
- D1 **MUST** use only tokens. **MUST NOT** introduce new hues, gradients on buttons, or colored backgrounds behind icons.
- D2 The interface is monochrome. Color is allowed only for brand logos, status icons (warning/danger/info/success), the accent selection ring, checkboxes, and "Connected".
- D3 Both themes **MUST** work: dark (ink) and light (paper). Test both before calling a screen done.

**Layout**
- D4 Onboarding screens use the **split frame**: a task column on the left (max 440px: title, one-line subtitle, the control, the primary action) and a **live preview panel** on the right, set inside a textured wash at radius 24px. References: 02, 11. On mobile the preview collapses into a compact strip above the action.
- D5 The task column has exactly **one** question or task, **one** primary button, and at most one quiet secondary ("Skip for now", "Skip").
- D6 The primary action sits at the bottom of the task column at full column width (ref 02, 11), or inline after numbered options (ref 08).
- D7 Use generous whitespace: at least 32px padding inside the frame, and 24px between title block and control. Never cram.

**Type**
- D8 Title is 22px/500 with tight leading. Subtitle is 15px/400 in `--io-text-secondary`, one or two lines at most. Don't stack more than one heading.
- D9 Serif (`--io-font-serif`) only for editorial moments (plan cards, ref 07). Never for controls.
- D10 Sentence case everywhere. No ALL CAPS except tiny section labels in app chrome (ref 06).

**Shape and depth**
- D11 Radii: 12px for controls, 16px for cards, 24px for the preview panel, 28px for the outer frame, pill shapes for chips. Don't mix radii within a component.
- D12 Borders are hairlines (`--io-border`). Shadows are soft and large-radius (`--io-shadow-card`), only on the frame or floating cards.

**Motion**
- D13 150–250ms with `--io-ease`. Elements fade and translate 4–8px. Skeleton lines in the preview turn into real content as context arrives. **Nothing bounces, spins decoratively, or confettis.**
- D14 Respect `prefers-reduced-motion` (the tokens already do).

**Interaction**
- D15 Keyboard-first: number keys pick options, Enter continues, Esc goes back or skips. Show the number badge on option rows (ref 08).
- D16 Selected state is the accent ring plus a subtle surface lift (ref 02, the Google chip). Never a filled colored background.
- D17 Every async state has a designed form: connecting, verifying, scanning (with live counts), done, failed with a reconnect action (ref 01, "GA4 disconnected mid-recap").

**Copy**
- D18 Short and human, and specific to the user: "What needs you, and what moved." "I found 14 leads who went quiet." Use their names, their channels, their numbers.
- D19 **MUST NOT** use "Step 3 of 7", "Welcome aboard! 🎉", "Let's get you set up", "Tell us about yourself", or emoji in UI copy.
- D20 The agent speaks in the first person only when reporting work it did ("I found…", "I drafted…").

## 3. Component anatomy

Each primitive maps to a reference screen. Build to the reference, not from memory.

| Primitive | Ref | Anatomy |
|---|---|---|
| **Frame** | 02, 11 | Outer card (radius 28, hairline border, card shadow) on the page background. Split grid: task column on the left, preview panel on the right inset 8–12px from the frame edge. |
| **ConfirmCard** | 02 (right) | A workspace card: logo tile (radius 12) with brand color, business name at 17px, domain with globe icon in secondary text, then icon + label rows (Country, Currency). One tap "Looks right" / inline edit. |
| **ChipSelect** | 02 | Pill chips, 44px tall, brand icon at 18px plus label, wrapping in rows with a 12px gap. Unselected: hairline border on surface. Selected: accent ring (2px) plus `--io-accent-soft` halo. Pre-selected chips arrive selected, with a tiny "from your site" hint under the group. |
| **OptionList** | 08 | Rows 48px tall, number badge (radius 6, sunken) plus label at 17px. The hovered or selected row gets a sunken background spanning the full width. Continue (solid) + Skip (text) below. |
| **IntentPrompt** | 03 | One large input (radius 16, 2 lines), a "+" affordance, a context tray (Project / Apps) attached below, and 3 suggested prompts as icon + text rows. Use only when free text genuinely beats choices. |
| **ConnectCard** | 09, 04 | Brand logo, name and one-line purpose. Button: Connect → Verifying… → ✓ Connected (accent). Below it, the **live activation line**: "Reading conversations… 212 · 9 leads", with the count ticking up. |
| **ConsentList** | 12 | Dual logo badge (product + agent), title "Connect X to Y", a workspace selector, then a raised list of scopes: checkbox (accent) + title at 15px/500 + description at 13px secondary. Cancel (secondary, full width) above Approve (solid, full width). |
| **RehearsalCard** | 01, 08 | The real example (lead or ad) as a compact card, the generated artifact underneath, and 1–3 decisions as OptionList or ChipSelect rows. The decision changes the artifact live. |
| **InviteStep** | 11 | An optional "Connect Slack" row, an "OR" divider, up to 3 email inputs with clear buttons, and a helper line. The preview shows colored cursors labeled with each email. Only rendered when RULES says invites are blocking. |
| **PlanChoice** | 07, 10 | Two cards with a textured image header, a serif title, a price badge, a "What you get" list with check-circle icons, and a pill CTA. One CTA solid, the other secondary. |
| **ProofPanel / ActivityFeed** | 01 | Section card "N items need your input" with status-icon rows (title at 17px plus a one-line secondary detail), then a "What's changed" table: metric name on the left, a sentence on the right. This is the first dashboard view. |
| **Skeleton** | 02, 09 | Rounded bars (radius pill, `--io-skeleton`) with small circle bullets. Used in the preview until real data arrives. Never a spinner by itself. |

## 4. Working inside an existing product

The framework has to fit into products that already have a design system.

1. **A host design system exists:** use the host's components and color tokens. Map `--io-*` tokens to the host's variables in one file. **Structural rules still apply:** the split frame with live preview (D4), one primary action (D5), monochrome plus status color (D2), keyboard-first (D15), and designed async states (D17).
2. **No design system (a new product):** use `tokens.css` and the `packages/ui` components as they are.
3. **Optimizing an existing onboarding:** don't restyle as a side effect. Apply DESIGN rules only to screens you're changing, and record the remaining gaps in the review scorecard.

## 5. Anti-patterns: the "vibe-coded" tells

Any one of these fails review.

- A centered single column of stacked labeled inputs (Name, Company, Role, Bio) with a "Next" button
- A progress bar or "Step X of Y" header
- A purple/indigo gradient hero, gradient buttons, glassmorphism, neon glows
- Feature grids of icons in colored circles, emoji as icons
- Default component-library cards with no hierarchy: equal-weight title, description and button repeated
- More than one solid button on a screen, or "Back" and "Next" with equal weight
- Generic placeholder copy ("Lorem", "Your company", "Welcome! 🎉", "Let's get started")
- An empty dashboard with "Get started by creating your first…" after onboarding
- Spinners with no information ("Loading…") where a live count or skeleton could show progress
- Every integration in a grid during onboarding (the catalog belongs on the dashboard, not here)

## 6. Review checklist (UI)

- [ ] Compared side by side with the matching reference in `design/references/`
- [ ] Only `--io-*` tokens (or host tokens mapped to them); no stray hex values
- [ ] Split frame with a live preview that changes on every answer
- [ ] One primary action; keyboard: numbers, Enter, Esc
- [ ] Checked in dark and light; checked at 375px wide
- [ ] Every async state designed (connecting, verifying, scanning with counts, failed with reconnect)
- [ ] Copy uses the user's own data; no banned phrases (D19)
- [ ] None of the §5 anti-patterns present
