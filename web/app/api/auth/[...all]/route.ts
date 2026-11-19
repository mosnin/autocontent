// Better Auth's HTTP API: sign-in, sign-up, two-factor, passkeys, SSO,
// workspaces, invitations and sessions. Configuration: web/lib/auth/config.ts.

import { toNextJsHandler } from "better-auth/next-js";
import { auth } from "@/lib/auth/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const handler = (req: Request) => auth().handler(req);

export const { GET, POST, PATCH, PUT, DELETE } = toNextJsHandler(handler);
