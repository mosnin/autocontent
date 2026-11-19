-- 0030: Better Auth (docs/auth/README.md, ADR 0011). Schema `auth` holds every
-- Better Auth table: people, sessions, accounts, verification tokens,
-- workspaces (organization), memberships, invitations, two-factor secrets,
-- passkeys, SSO providers, the JWT signing keys and the rate-limit counters.
-- Web is the only writer; the backend reads auth."user", auth.session,
-- auth.organization and auth.member.
--
-- Generated from web/lib/auth/config.ts with the Better Auth CLI:
--   cd web && npx auth@1.7.26 generate --config scripts/auth-cli.ts --output <file>
-- then two hand edits, marked "hand edit" below, that the CLI can't express:
-- a database default for organization."requireTwoFactor", and one membership
-- per person per workspace. Regenerate and re-apply the edits after changing
-- plugins or fields in the config. Better Auth never migrates at runtime.

create schema if not exists "auth";

create table "auth"."user" ("id" text not null primary key, "name" text not null, "email" text not null unique, "emailVerified" boolean not null, "image" text, "createdAt" timestamptz default CURRENT_TIMESTAMP not null, "updatedAt" timestamptz default CURRENT_TIMESTAMP not null, "twoFactorEnabled" boolean, "role" text, "banned" boolean, "banReason" text, "banExpires" timestamptz);

create table "auth"."session" ("id" text not null primary key, "expiresAt" timestamptz not null, "token" text not null unique, "createdAt" timestamptz default CURRENT_TIMESTAMP not null, "updatedAt" timestamptz not null, "ipAddress" text, "userAgent" text, "userId" text not null references "auth"."user" ("id") on delete cascade, "activeOrganizationId" text, "impersonatedBy" text);

create table "auth"."account" ("id" text not null primary key, "accountId" text not null, "providerId" text not null, "userId" text not null references "auth"."user" ("id") on delete cascade, "accessToken" text, "refreshToken" text, "idToken" text, "accessTokenExpiresAt" timestamptz, "refreshTokenExpiresAt" timestamptz, "scope" text, "password" text, "createdAt" timestamptz default CURRENT_TIMESTAMP not null, "updatedAt" timestamptz not null);

create table "auth"."verification" ("id" text not null primary key, "identifier" text not null, "value" text not null, "expiresAt" timestamptz not null, "createdAt" timestamptz default CURRENT_TIMESTAMP not null, "updatedAt" timestamptz default CURRENT_TIMESTAMP not null);

create table "auth"."organization" ("id" text not null primary key, "name" text not null, "slug" text not null unique, "logo" text, "createdAt" timestamptz not null, "metadata" text, "tenantId" text not null unique, "requireTwoFactor" boolean not null default false); -- hand edit: default false

create table "auth"."member" ("id" text not null primary key, "organizationId" text not null references "auth"."organization" ("id") on delete cascade, "userId" text not null references "auth"."user" ("id") on delete cascade, "role" text not null, "createdAt" timestamptz not null);

create table "auth"."invitation" ("id" text not null primary key, "organizationId" text not null references "auth"."organization" ("id") on delete cascade, "email" text not null, "role" text, "status" text not null, "expiresAt" timestamptz not null, "createdAt" timestamptz default CURRENT_TIMESTAMP not null, "inviterId" text not null references "auth"."user" ("id") on delete cascade);

create table "auth"."twoFactor" ("id" text not null primary key, "secret" text not null, "backupCodes" text not null, "userId" text not null references "auth"."user" ("id") on delete cascade, "verified" boolean, "failedVerificationCount" integer, "lockedUntil" timestamptz);

create table "auth"."passkey" ("id" text not null primary key, "name" text, "publicKey" text not null, "userId" text not null references "auth"."user" ("id") on delete cascade, "credentialID" text not null, "counter" integer not null, "deviceType" text not null, "backedUp" boolean not null, "transports" text, "createdAt" timestamptz, "aaguid" text);

create table "auth"."ssoProvider" ("id" text not null primary key, "issuer" text not null, "oidcConfig" text, "samlConfig" text, "userId" text not null references "auth"."user" ("id") on delete cascade, "providerId" text not null unique, "organizationId" text, "domain" text not null, "domainVerified" boolean);

create table "auth"."jwks" ("id" text not null primary key, "publicKey" text not null, "privateKey" text not null, "createdAt" timestamptz not null, "expiresAt" timestamptz, "alg" text, "crv" text);

create table "auth"."rateLimit" ("id" text not null primary key, "key" text not null unique, "count" integer not null, "lastRequest" bigint not null);

create index "session_userId_idx" on "auth"."session" ("userId");

create index "account_userId_idx" on "auth"."account" ("userId");

create index "verification_identifier_idx" on "auth"."verification" ("identifier");

create index "member_organizationId_idx" on "auth"."member" ("organizationId");

create index "member_userId_idx" on "auth"."member" ("userId");

create index "invitation_organizationId_idx" on "auth"."invitation" ("organizationId");

create index "invitation_email_idx" on "auth"."invitation" ("email");

create index "twoFactor_secret_idx" on "auth"."twoFactor" ("secret");

create index "twoFactor_userId_idx" on "auth"."twoFactor" ("userId");

create index "passkey_userId_idx" on "auth"."passkey" ("userId");

create index "passkey_credentialID_idx" on "auth"."passkey" ("credentialID");
-- hand edit: a person holds one membership per workspace.
create unique index "member_organizationId_userId_uidx" on "auth"."member" ("organizationId", "userId");
