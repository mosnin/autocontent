# DESIGN.md (the app)

The app's design system lives in [`design-system/`](./design-system). Its spec is [`design-system/README.md`](./design-system/README.md).

- **Target look:** the reference screens in `design-system/references/`. When a screen and a reference disagree, the screen is wrong.
- **Tokens:** `design-system/tokens.css`. Dark is the default (`.ds`) and light is `.ds.ds-light`. The `marketer-theme` cookie picks one.
- **Components:** import them from `@/design-system`. Never restyle by hand. If something is missing, add it to the system, with a README row and a reference, and then use it.
- **Page templates:** README section 5 maps each route to its template: Home, Chat, Dashboard, Column, Tool, Detail or Marketplace.
- **Enforcement:** `npm run ds:guard` fails on hard colours, `dark:`, off-system corners, animated status decoration, imports from old kits, and illustrated empty states. CI runs it.

The marketing site (`app/(marketing)`, `marketing/`) has its own look and is out of scope here.
