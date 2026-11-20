// Import a Clerk user export into Better Auth (docs/auth/README.md, "Moving off Clerk").
//
//   cd web
//   AUTH_DATABASE_URL=postgres://… node --experimental-strip-types scripts/migrate-from-clerk.ts --file clerk-users.json [--dry-run]
//
// For each Clerk user:
//   - auth."user" with id = the Clerk user id, emailVerified = true, no password
//     (they sign in with Google, SSO, or set one through "Forgot your password?");
//   - auth.account for Google when the export says they used it (no tokens);
//   - a workspace (auth.organization) with tenantId = the Clerk user id, so every
//     product row already keyed by that id stays attached, and an owner membership;
//   - public.users.role = 'admin' becomes auth."user".role = 'admin'.
//
// Idempotent: people, accounts, workspaces and memberships that already exist
// are left alone, so it can be re-run after a partial import. --dry-run reads
// everything and reports what it would do, writing nothing. Output never
// includes passwords, tokens or secrets (the export's hashes are ignored).
//
// The export is Clerk's JSON user list (Dashboard → Users → Export, or the
// Backend API's GET /v1/users pages concatenated into one array).

import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import pg from "pg";

interface ClerkEmail {
  id: string;
  email_address: string;
  verification?: { status?: string } | null;
}
interface ClerkExternal {
  provider?: string;
  provider_user_id?: string;
  email_address?: string;
}
export interface ClerkUser {
  id: string;
  first_name?: string | null;
  last_name?: string | null;
  primary_email_address_id?: string | null;
  email_addresses?: ClerkEmail[];
  external_accounts?: ClerkExternal[];
  created_at?: number;
  image_url?: string | null;
}

export interface PlannedPerson {
  id: string;
  email: string;
  name: string;
  googleAccountId: string | null;
  createdAt: Date;
  image: string | null;
}

/** The person a Clerk export row becomes, or a reason it is skipped. Pure. */
export function planPerson(u: ClerkUser): PlannedPerson | { skip: string } {
  if (!u || typeof u.id !== "string" || !/^user_[A-Za-z0-9]+$/.test(u.id)) return { skip: "not a Clerk user id" };
  const emails = u.email_addresses ?? [];
  const primary = emails.find((e) => e.id === u.primary_email_address_id) ?? emails[0];
  const email = primary?.email_address?.trim().toLowerCase();
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { skip: "no usable email" };
  const google = (u.external_accounts ?? []).find((a) => /google/i.test(a.provider ?? "") && a.provider_user_id);
  const name = [u.first_name, u.last_name].filter(Boolean).join(" ").trim() || email.split("@")[0]!;
  return { id: u.id, email, name: name.slice(0, 128), googleAccountId: google?.provider_user_id ?? null, createdAt: u.created_at ? new Date(u.created_at) : new Date(), image: u.image_url ?? null };
}

function workspaceName(email: string): string {
  const domain = email.split("@")[1] ?? "";
  const personal = /^(gmail|googlemail|outlook|hotmail|live|yahoo|icloud|me|proton|protonmail|aol|gmx|hey|fastmail)\./.test(domain);
  if (personal) return "My workspace";
  const label = domain.split(".")[0] ?? "";
  return label.split(/[-_]/).filter(Boolean).map((w) => w[0]!.toUpperCase() + w.slice(1)).join(" ") || "My workspace";
}

const id = () => randomBytes(16).toString("hex");

async function main() {
  const args = process.argv.slice(2);
  const file = args[args.indexOf("--file") + 1];
  const dry = args.includes("--dry-run");
  if (!args.includes("--file") || !file) {
    console.error("usage: migrate-from-clerk.ts --file <clerk-users.json> [--dry-run]");
    process.exit(2);
  }
  const url = process.env.AUTH_DATABASE_URL || process.env.DATABASE_URL;
  if (!url) {
    console.error("Set AUTH_DATABASE_URL (or DATABASE_URL).");
    process.exit(2);
  }
  const raw = JSON.parse(readFileSync(file, "utf8")) as unknown;
  const users = (Array.isArray(raw) ? raw : ((raw as { data?: unknown[] }).data ?? [])) as ClerkUser[];
  const pool = new pg.Pool({ connectionString: url, max: 2 });
  const counts = { people: 0, existingPeople: 0, workspaces: 0, existingWorkspaces: 0, googleAccounts: 0, platformAdmins: 0, skipped: 0 };

  try {
    const admins = new Set(
      (await pool.query<{ id: string }>(`select id from public.users where role = 'admin'`).catch(() => ({ rows: [] as { id: string }[] }))).rows.map((r) => r.id),
    );
    for (const u of users) {
      const p = planPerson(u);
      if ("skip" in p) {
        counts.skipped++;
        console.log(`skip ${typeof u?.id === "string" ? u.id : "?"}: ${p.skip}`);
        continue;
      }
      const client = await pool.connect();
      try {
        await client.query("begin");
        const byId = await client.query(`select id from auth."user" where id = $1`, [p.id]);
        const byEmail = await client.query<{ id: string }>(`select id from auth."user" where lower(email) = $1`, [p.email]);
        if (byEmail.rows[0] && byEmail.rows[0].id !== p.id) {
          counts.skipped++;
          console.log(`skip ${p.id}: the address already belongs to another person (${byEmail.rows[0].id})`);
          await client.query("rollback");
          continue;
        }
        const admin = admins.has(p.id);
        if (byId.rows.length) counts.existingPeople++;
        else {
          counts.people++;
          if (!dry)
            await client.query(
              `insert into auth."user" (id, name, email, "emailVerified", image, "createdAt", "updatedAt", role, banned, "twoFactorEnabled") values ($1, $2, $3, true, $4, $5, now(), $6, false, false)`,
              [p.id, p.name, p.email, p.image, p.createdAt, admin ? "admin" : "user"],
            );
        }
        if (admin) {
          counts.platformAdmins++;
          if (!dry) await client.query(`update auth."user" set role = 'admin' where id = $1 and coalesce(role, '') <> 'admin'`, [p.id]);
        }
        if (p.googleAccountId) {
          const acct = await client.query(`select 1 from auth.account where "providerId" = 'google' and "accountId" = $1`, [p.googleAccountId]);
          if (!acct.rows.length) {
            counts.googleAccounts++;
            if (!dry) await client.query(`insert into auth.account (id, "accountId", "providerId", "userId", "createdAt", "updatedAt") values ($1, $2, 'google', $3, now(), now())`, [id(), p.googleAccountId, p.id]);
          }
        }
        const org = await client.query<{ id: string }>(`select id from auth.organization where "tenantId" = $1`, [p.id]);
        let orgId = org.rows[0]?.id;
        if (orgId) counts.existingWorkspaces++;
        else {
          counts.workspaces++;
          orgId = id();
          if (!dry)
            await client.query(`insert into auth.organization (id, name, slug, "createdAt", "tenantId", "requireTwoFactor") values ($1, $2, $3, now(), $4, false)`, [orgId, workspaceName(p.email), `w-${orgId.slice(0, 12)}`, p.id]);
        }
        if (!dry) await client.query(`insert into auth.member (id, "organizationId", "userId", role, "createdAt") values ($1, $2, $3, 'owner', now()) on conflict ("organizationId", "userId") do nothing`, [id(), orgId, p.id]);
        await client.query(dry ? "rollback" : "commit");
      } catch (e) {
        await client.query("rollback").catch(() => undefined);
        counts.skipped++;
        console.log(`skip ${p.id}: ${e instanceof Error ? e.message.slice(0, 160) : "error"}`);
      } finally {
        client.release();
      }
    }
  } finally {
    await pool.end();
  }
  console.log(`${dry ? "[dry run] would import" : "imported"}: ${JSON.stringify(counts)}`);
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) void main();
