"""Migration runner for autocontent.

Uses yoyo-migrations with psycopg2 (sync) as the DB backend so migrations run
outside the asyncpg event loop used by the application runtime.

Subcommands
-----------
  up               Apply all pending migrations.
  status           Show how many migrations are applied vs. pending.
  down [N]         Roll back the last N migrations (default: 1).

Entry-point
-----------
  autocontent-migrate   (installed via pyproject.toml [project.scripts])

Environment
-----------
  AUTOCONTENT_DATABASE_URL   Postgres DSN (same as the runtime app).
"""
from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

MIGRATIONS_DIR = Path(__file__).parent.parent / "db" / "migrations"


def _get_database_url() -> str:
    """Return the database URL from settings or the environment.

    Importing autocontent.config triggers pydantic-settings which may raise
    if required env vars are absent.  We tolerate that and fall back to the
    raw env var so the CLI works even in minimal environments (e.g. CI before
    the full package is configured).
    """
    try:
        from autocontent.config import settings  # noqa: PLC0415

        url = settings.database_url
    except Exception:  # noqa: BLE001
        url = os.environ.get("AUTOCONTENT_DATABASE_URL", "")

    if not url:
        print(
            "ERROR: database URL not configured. "
            "Set AUTOCONTENT_DATABASE_URL or AUTOCONTENT_DATABASE_URL in your environment.",
            file=sys.stderr,
        )
        sys.exit(1)

    # yoyo expects a psycopg2-compatible DSN.  asyncpg uses
    # "postgresql+asyncpg://" or plain "postgresql://"; yoyo wants
    # "postgresql+psycopg2://" or plain "postgresql://".
    # Strip any driver qualifier so yoyo picks psycopg2 automatically.
    url = url.replace("postgresql+asyncpg://", "postgresql://")
    url = url.replace("postgres+asyncpg://", "postgres://")
    return url


def _get_backend_and_migrations(database_url: str):
    """Return a (backend, migrations) tuple ready for yoyo operations."""
    from yoyo import get_backend, read_migrations  # noqa: PLC0415

    backend = get_backend(database_url)
    migrations = read_migrations(str(MIGRATIONS_DIR))
    return backend, migrations


# ---------------------------------------------------------------------------
# Public API (called by healthz and modal apply_migrations)
# ---------------------------------------------------------------------------


def up(database_url: str | None = None) -> None:
    """Apply all pending migrations."""
    url = database_url or _get_database_url()
    backend, migrations = _get_backend_and_migrations(url)
    with backend.lock():
        pending = backend.to_apply(migrations)
        if not pending:
            print("No pending migrations — database is up to date.")
            return
        backend.apply_migrations(pending)
        print(f"Applied {len(pending)} migration(s).")


def status(database_url: str | None = None) -> dict:
    """Return {'applied': N, 'pending': M} without modifying the DB."""
    url = database_url or _get_database_url()
    backend, migrations = _get_backend_and_migrations(url)
    applied = backend.to_rollback(migrations)
    pending = backend.to_apply(migrations)
    result = {"applied": len(applied), "pending": len(pending)}
    return result


def down(n: int = 1, database_url: str | None = None) -> None:
    """Roll back the last *n* applied migrations."""
    url = database_url or _get_database_url()
    backend, migrations = _get_backend_and_migrations(url)
    with backend.lock():
        applied = list(backend.to_rollback(migrations))
        to_roll = applied[:n]
        if not to_roll:
            print("No applied migrations to roll back.")
            return
        backend.rollback_migrations(to_roll)
        print(f"Rolled back {len(to_roll)} migration(s).")


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="autocontent-migrate",
        description="Manage autocontent database migrations via yoyo-migrations.",
    )
    sub = parser.add_subparsers(dest="command", metavar="COMMAND")

    sub.add_parser("up", help="Apply all pending migrations.")

    sub.add_parser("status", help="Show applied vs. pending migration counts.")

    down_p = sub.add_parser("down", help="Roll back the last N migrations (default 1).")
    down_p.add_argument(
        "n",
        nargs="?",
        type=int,
        default=1,
        metavar="N",
        help="Number of migrations to roll back.",
    )

    return parser


def main(argv: list[str] | None = None) -> None:
    parser = _build_parser()
    args = parser.parse_args(argv)

    if args.command is None:
        parser.print_help()
        sys.exit(0)

    try:
        if args.command == "up":
            up()
        elif args.command == "status":
            result = status()
            print(f"Applied: {result['applied']}  Pending: {result['pending']}")
            if result["pending"] > 0:
                sys.exit(2)  # non-zero so CI can gate on this
        elif args.command == "down":
            down(n=args.n)
    except SystemExit:
        raise
    except Exception as exc:  # noqa: BLE001
        print(f"ERROR: {exc}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
