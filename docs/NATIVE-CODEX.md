# Native Codex connection

The connector is deployed as the separate `marketer-native-connector` Modal app.
It uses the existing production account database and Clerk identity. Generation
workers remain on their existing `marketer-sh` deployment.

`MARKETER_NATIVE_CONNECTOR_URL` on Vercel forwards only `/api/mcp`, `/oauth/*`, and
the OAuth metadata documents. The public issuer is `https://www.marketer.sh`;
the exact MCP resource is `https://www.marketer.sh/api/mcp`.

The native catalog reads account identity, niches, article summaries and job
summaries. Every query uses the verified grant owner; OAuth cannot start paid
generation or publish content. `offline_access` requests persisted authorization
and refresh. Initial consent is once per account connection, not once per chat.

## Deployment evidence

This repair branch starts at production website revision
`f7d7bd4b4e78b42044d858557b11c1d2808f008c`. It preserves the deployed pages.
Only migration `0041_oauth_provider` is applied, through the existing migration
runner, to the database whose inspected identity hash is `aff24f0fdeb55424`.
No generation schedules or workers are deployed by this connector module.

Focused OAuth and native protocol tests pass. Live database inspection confirms
the OAuth tables exist, public registration returns 201, and a real authorization
request redirects to the product sign-in page. Account consent, authenticated
reads, refresh, restart reuse and revocation recovery remain acceptance gates.

For rollback, restore the preceding Vercel deployment. Existing workers are
unaffected. Retain grants unless the account owner requests revocation; do not
drop the OAuth tables as a routine rollback step.
