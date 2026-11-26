<!-- intent-onboarding -->
## Onboarding

This repo uses the intent-driven onboarding framework, vendored in `.intent-onboarding/`.
For any signup, onboarding, activation, first-run or first-dashboard work, first read
`.claude/skills/intent-onboarding/SKILL.md` (same file in `.agents/skills/`), then
`.intent-onboarding/RULES.md` and `.intent-onboarding/DESIGN.md`. Paths inside the skills are relative to
`.intent-onboarding/`. Never build a generic step-by-step signup form.

- Lint the spec: `npx tsx .intent-onboarding/packages/spec/src/cli.ts onboarding/spec.ts --paths`
- Replay personas: `npx tsx .intent-onboarding/packages/testing/src/cli.ts onboarding/personas.ts`
- Insights: `npx tsx .intent-onboarding/packages/analytics/src/cli.ts --spec onboarding/spec.ts`
