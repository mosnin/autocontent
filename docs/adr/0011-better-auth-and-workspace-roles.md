---
status: accepted
---

# Better Auth, workspaces and one permission catalog

Marketer signs people in with Better Auth, self-hosted in the web app, instead of Clerk. People belong to workspaces (Better Auth organizations) and hold one role in each. Roles map to permissions from a single catalog, `docs/auth/permissions.json`, which the web app, the backend and the agent all enforce. Details: `docs/auth/README.md`.

## Why

- **Teams.** Marketing is done by teams: an owner, people who launch campaigns, people who only read the numbers, someone who pays. A single account per tenant could not express that. Workspaces with roles can.
- **Least privilege for the agent.** The agent used to act with the tenant's full power. Now it acts with the agent role intersected with the role of the person who started it, so asking the agent cannot exceed what the person may do themselves.
- **Revocation that takes effect.** The backend checks the live session and membership on every request (with a 15-second cache), so signing out, removing a member or banning a person stops access within seconds rather than when a token expires.
- **Enterprise requirements in our own database.** Two-factor policy, passkeys, SAML and OIDC SSO, invitations, session management and an append-only security audit log, with the data in our Postgres rather than a vendor's.
- **One catalog, three enforcers.** Roles defined once and tested for equality in each codebase cannot drift apart silently.

## Consequences

- The product tables keep their `user_id` columns; they now hold the workspace's tenant id. Workspaces migrated from Clerk use the old Clerk user id as their tenant id, so no data moves.
- Every backend route must be classified in `backend/policy.py`; a test fails on any route that isn't.
- The web app now owns a database connection and the `auth` schema. The backend reads it and never writes it.
- Clerk is removed from the codebase. Existing people are imported with their ids; they set a password through reset, or use Google or SSO.
- Better Auth releases often. It is pinned to an exact version, and upgrades go through the CI suite and the auth end-to-end test.
