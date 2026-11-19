# web

Next.js (App Router) UI for marketer. People sign in with Better Auth, which
runs here (`/api/auth/*`) with its tables in the Postgres schema `auth`. The
server mints a five-minute backend JWT per request and forwards it to the
Modal-hosted FastAPI backend; the browser never holds one. How it fits
together, the environment and the end-to-end test: `../docs/auth/web.md`.

## Setup

```bash
cp .env.example .env.local
# fill BETTER_AUTH_SECRET, BETTER_AUTH_URL, AUTH_DATABASE_URL and the API URL
npm install
npm run dev
```

The `auth` schema comes from `db/migrations/0030_auth.sql`, applied with the
other migrations (`scripts/migrate.py up`).

## API client

`lib/api.ts` — server-side `fetch` wrapper that attaches the backend JWT
(`lib/auth/backend-token.ts`). Browser code goes through `/api/proxy`, which
does the same.
