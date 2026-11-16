# AGENTS.md: Intent-Driven Onboarding Framework

This repository is a **framework for building onboarding**, not a product. It holds rules, design doctrine, a spec format with a linter, templates, and agent skills. Any coding agent (Claude Code, Codex, Cursor, others) should be able to open it and know exactly what to build and what to optimize for.

## The goal

Onboarding must **set the product up around what this user is trying to do, and prove it works on their real data, before they first see the dashboard.** That means configured for their workflow, already running, showing proof, understood, in ≤ 6 screens / ≤ 120s, with first proof in ≤ 90s.

**Never build a generic step-by-step form** (name → company → role → bio → "how did you hear about us" → connect everything → empty dashboard). That is the failure this framework exists to prevent.

## Start here

1. Read `skills/intent-onboarding/SKILL.md`. It picks the mode (**build**, **replace** or **optimize**) and sequences the other skills.
2. `RULES.md`: logic doctrine (MUST/MUST NOT with ids such as R2.3), enforced by the linter.
3. `DESIGN.md` + `design/references/`: visual doctrine and reference screens. Match them.

## Skills (`skills/*/SKILL.md`)

| Skill | Use when |
|---|---|
| `intent-onboarding` | Any onboarding/activation/first-run task. Always read first. |
| `onboarding-discover` | Auditing a host codebase, its integrations, existing onboarding, and customer/ICP data |
| `onboarding-spec` | Writing or changing `onboarding/spec.ts` |
| `onboarding-ui` | Building or restyling onboarding or first-dashboard screens |
| `onboarding-implement` | Wiring the spec into the host's auth, DB, jobs and connectors |
| `onboarding-instrument` | PostHog events, funnels, flags and dashboards |
| `onboarding-optimize` | Turning analytics into ranked, approvable changes |
| `onboarding-review` | Scoring any onboarding against RULES + DESIGN |

## Commands

```bash
npm install
npm run check            # everything below, in order (what CI runs)
npm test                 # linter, engine and replay tests
npm run lint:specs       # lint the templates
npm run replay           # replay every template's personas through the real engine
npm run screenshots      # visual baseline: every scene, light and dark, 375px and 1280px
npm run e2e:demo         # build the reference app and click through it in a real browser
npm run verify:install   # install every template into a scratch host; lint and replay there
npx tsx packages/spec/src/cli.ts <spec.ts> --paths   # lint any spec and print derived paths
npm run typecheck
```

## Paths

All paths in the skills are relative to the framework root: this repo, or `.intent-onboarding/` when vendored into a host repo with `npx github:mosnin/onboarding-starter init` (or `scripts/install.sh`).

## Conventions for changing the framework itself

- A new rule in RULES.md needs a lint check (where statically checkable) and a test in `packages/spec/test`.
- Templates must lint with 0 errors and 0 warnings.
- `packages/spec/test/fixtures/generic-form.spec.ts` is the anti-example and must keep failing.
- Every template ships `personas.ts`; all personas must replay with zero doctrine violations.
- `packages/core` is headless: no DOM, no framework, no vendor SDKs. Everything external goes through an adapter, including decision models (`adapters.decisions`). Vendor code lives in its own package (e.g. `packages/decisions-jev`).
- A decision model is an optimization, never a dependency: every model call has a timeout and a rule-based fallback, and API keys stay server-side.
