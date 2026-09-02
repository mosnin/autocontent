"""Register an OAuth client (see docs/OAUTH.md).

There is no open dynamic-registration endpoint. Anyone who can reach
/oauth/register on a server that has one can mint clients and phish that
server's users with a plausible consent screen, so on marketer.sh a client
is created deliberately, by someone with database access, with this script.

Usage
-----
  python scripts/oauth_client.py create \
      --name "Acme Dashboard" \
      --redirect-uri https://acme.example/oauth/callback/marketer \
      --scope openid --scope profile --scope email --scope content:read

  python scripts/oauth_client.py create --name "Acme Server" \
      --redirect-uri https://acme.example/cb --confidential

  python scripts/oauth_client.py list
  python scripts/oauth_client.py disable --client-id mkoc_...

The client_id is printed on creation and can be read back with `list`. A
client secret (confidential clients only) is printed ONCE and never stored
in plaintext -- only its sha256. Losing it means creating a new client.

Environment
-----------
  MARKETER_DATABASE_URL   Postgres DSN (same as the runtime app).
"""
from __future__ import annotations

import argparse
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))

from marketer.repos import oauth as oauth_repo  # noqa: E402
from marketer.services import oauth as oauth_service  # noqa: E402


async def _create(args: argparse.Namespace) -> int:
    scopes = list(args.scope) or list(oauth_service.DEFAULT_CLIENT_SCOPES)
    unsupported = oauth_service.unsupported_scopes(scopes)
    if unsupported:
        print(f"error: unknown scope(s): {', '.join(unsupported)}", file=sys.stderr)
        print(f"supported: {', '.join(oauth_service.SUPPORTED_SCOPES)}", file=sys.stderr)
        return 2

    for uri in args.redirect_uri:
        if not oauth_service.is_registerable_redirect_uri(uri):
            print(
                f"error: {uri!r} is not a registerable redirect URI "
                "(https, no fragment; http allowed only on localhost)",
                file=sys.stderr,
            )
            return 2

    client_id = args.client_id or oauth_service.new_client_id()
    secret = oauth_service.new_client_secret() if args.confidential else None

    client = await oauth_repo.create_client(
        client_id=client_id,
        name=args.name,
        redirect_uris=list(args.redirect_uri),
        scopes=scopes,
        client_secret_hash=oauth_service.hash_secret(secret) if secret else None,
        resources=list(args.resource),
    )

    print("client registered")
    print(f"  client_id     {client.client_id}")
    print(f"  name          {client.name}")
    print(f"  redirect_uris {', '.join(client.redirect_uris)}")
    print(f"  scopes        {' '.join(client.scopes)}")
    print(f"  type          {'confidential' if secret else 'public (PKCE only)'}")
    if secret:
        print(f"  client_secret {secret}")
        print("  ^ shown once. Store it in the client's secret manager now.")
    return 0


async def _list(_args: argparse.Namespace) -> int:
    clients = await oauth_repo.list_clients()
    if not clients:
        print("no clients registered")
        return 0
    for client in clients:
        state = "disabled" if not client.is_active else "active"
        kind = "confidential" if client.is_confidential else "public"
        print(f"{client.client_id}  {state:8}  {kind:12}  {client.name}")
        print(f"    redirect_uris {', '.join(client.redirect_uris)}")
        print(f"    scopes        {' '.join(client.scopes)}")
    return 0


async def _disable(args: argparse.Namespace) -> int:
    ok = await oauth_repo.disable_client(args.client_id)
    print("disabled" if ok else "no such active client")
    return 0 if ok else 1


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Manage OAuth clients")
    sub = parser.add_subparsers(dest="command", required=True)

    create = sub.add_parser("create", help="register a new client")
    create.add_argument("--name", required=True, help="shown on the consent screen")
    create.add_argument(
        "--redirect-uri",
        action="append",
        required=True,
        help="exact redirect URI; repeat for more than one",
    )
    create.add_argument(
        "--scope",
        action="append",
        default=[],
        help=f"repeatable; defaults to: {' '.join(oauth_service.DEFAULT_CLIENT_SCOPES)}",
    )
    create.add_argument(
        "--resource",
        action="append",
        default=[],
        help="extra RFC 8707 resource indicator this client may request",
    )
    create.add_argument(
        "--confidential",
        action="store_true",
        help="issue a client secret (server-side clients only)",
    )
    create.add_argument("--client-id", help="use a specific client_id instead of a generated one")
    create.set_defaults(handler=_create)

    listing = sub.add_parser("list", help="list registered clients")
    listing.set_defaults(handler=_list)

    disable = sub.add_parser("disable", help="turn a client off")
    disable.add_argument("--client-id", required=True)
    disable.set_defaults(handler=_disable)

    args = parser.parse_args(argv)
    return asyncio.run(args.handler(args))


if __name__ == "__main__":
    raise SystemExit(main())
