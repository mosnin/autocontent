---
name: onboarding-ui
description: Build or adapt onboarding screens to the framework's visual doctrine (DESIGN.md) so they match the reference screens instead of looking like a generic component-library form. Covers the split frame with live preview, chips, option lists, connect cards with live activation, rehearsal, consent and the proof-first dashboard, in dark and light. Use whenever creating or restyling any onboarding or first-dashboard UI.
---

# UI

The logic decides what appears; this skill makes sure it looks like the references and not like a vibe-coded wizard.

## Before writing any markup

1. Open every image in `design/references/` (or at least the ones listed for your screen in DESIGN.md §3). Describe to yourself what you see: spacing, weights, border contrast, where the single action sits.
2. Read `DESIGN.md` fully: rules D1–D20 and the §5 anti-patterns.
3. Load `packages/ui/tokens.css`, or map its `--io-*` variables to the host design system in one file (DESIGN.md §4).

## Screen recipes

Each derived screen kind (from `derivePath`) maps to a recipe:

| Screen kind | Task column (left) | Preview panel (right) | Ref |
|---|---|---|---|
| `signin` | Product mark, "Continue with Google / Microsoft", email link | Product shell with skeleton lines | 11 |
| `confirm` | Title "Is this you?", the inferred facts as editable rows, **Looks right** (solid) | ConfirmCard with their logo, name, domain, country and currency filling in | 02 |
| `intent` | Question (22px) + one-line hint, ChipSelect with pre-selected chips and a "from your site" hint, Continue | The workspace now showing the chosen channels as empty slots | 02, 08 |
| `connect` | One ConnectCard: logo, purpose, plain-language scopes, Connect → Verifying → ✓ Connected, then the **live activation line** with counts | Their real items appearing (leads, ads) as activation streams | 09, 12 |
| `rehearsal` | The real example card, the generated artifact, 1–3 decisions as OptionList (number keys) | The artifact updating live as decisions change (tone, signature with their name) | 08, 01 |
| `invite` (only if blocking) | Slack row, OR, ≤ 3 emails, helper line | Teammate cursors labeled with emails | 11 |
| `handoff` = first dashboard | n/a (full app chrome) | ActivityFeed: "N items need your input" with the proof first, then "What's changed" | 01 |

The **preview panel is not decoration**. It renders the user's actual context graph and activation output. While data is pending, show skeleton lines (radius pill) that turn into content. Never show a lone spinner.

## Use the components first

`packages/ui` already implements every recipe above, built to the references:
- `<OnboardingFlow>`, inside `<OnboardingProvider onboarding={engine}>` from `packages/react`, renders any derived screen.
- Product-specific content is passed as props, not forked: `workspace`, `previewItems`, `renderExample`, `renderArtifact`, `renderDashboard`, `changes`.
- Primitives can also be used one at a time: `Frame`, `Task`, `ChipSelect`, `OptionList`, `ConfirmFields`, `ConnectCard`, `ExampleCard`, `DraftCard`, `ActivityFeed`, `InviteFields`, `SkeletonList`, `Mark`, `Icon`.
- Import `@intent-onboarding/ui/styles.css` once.

Build custom markup only for what these can't express, and then follow the recipes exactly.

## Building in a host app

- **Host has a component library** (shadcn, MUI, Chakra, its own): reuse its primitives for inputs and buttons, but follow the recipes' structure, the single primary action, the token mapping and the selected-state treatment (accent ring, not a filled color).
- **New product**: use `packages/ui` components and `tokens.css` directly.
- Use React for the reference bindings. Keep presentational components free of data fetching; they receive derived-screen props from the engine.

## Self-review loop (required)

After building each screen:
1. Render it in **dark and light** and at **375px and 1280px** wide. Take screenshots (Playwright if available). In this repo, `npm run screenshots` drives the real engine to every scene and writes `design/screenshots/`. It fails on horizontal overflow or console errors, and those images are the current visual baseline.
2. Put each screenshot next to its reference. List the differences (spacing, weight, border, alignment, number of actions) and fix them.
3. Run the DESIGN.md §6 checklist. Any §5 anti-pattern is a fail.
4. Keyboard test: number keys choose, Enter continues, Esc skips or goes back, focus is always visible.

## Banned output

Stacked labeled inputs for name/company/role/bio; "Step X of Y"; gradient or purple hero; emoji in copy; more than one solid button; an empty dashboard after onboarding; a grid of every integration during onboarding.
