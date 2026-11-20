// Entry point for the Better Auth CLI only (schema generation and checks):
//   npx auth@1.7.26 generate --config scripts/auth-cli.ts --output ../db/migrations/0030_auth.sql
// The app itself uses lib/auth/server.ts. See docs/auth/web.md.

import { createAuth } from "../lib/auth/config";

export const auth = createAuth().auth;
