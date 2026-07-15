# web

Next.js (App Router) UI for marketer. Clerk handles auth and forwards
the session JWT to the Modal-hosted FastAPI backend.

## Setup

```bash
cp .env.local.example .env.local
# fill Clerk keys + the Modal API URL
npm install
npm run dev
```

## Pages

- `/` — landing.
- `/onboarding` — niche setup wizard (TODO).
- `/dashboard` — niches list + today's spend + next posting slot (TODO).
- `/queue` — jobs grouped by status (TODO).

## API client

`lib/api.ts` — server-side `fetch` wrapper that attaches the Clerk JWT.
