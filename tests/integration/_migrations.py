"""Shared helpers for the migration rollback tests."""
from __future__ import annotations

from pathlib import Path

MIGRATIONS_DIR = Path(__file__).resolve().parents[2] / "db" / "migrations"


def migration_count() -> int:
    """Forward migrations on disk (rollback files excluded): an upper bound on down steps,
    so a rollback loop never strands the database half rolled back as migrations land."""
    return sum(1 for p in MIGRATIONS_DIR.glob("[0-9]*.sql") if not p.name.endswith(".rollback.sql"))
